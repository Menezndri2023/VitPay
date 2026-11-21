import { Inject, Injectable, Optional } from '@nestjs/common';
import { isCurrency, Money } from '@vitpay/money';
import { hmacSha256Hex, safeEqualHex } from '../../common/crypto';
import { APP_CONFIG, AppConfig } from '../../config';
import { AppError, Errors } from '../../common/errors';
import {
  CreatePaymentInput,
  CredentialField,
  PaymentProvider,
  ProviderAccountContext,
  ProviderCapabilities,
  ProviderDispute,
  ProviderMode,
  ProviderPayment,
  ProviderPaymentSession,
  ProviderPaymentStatus,
  ProviderRefund,
  SettlementReport,
  VerifiedProviderEvent,
  WebhookVerificationError,
} from './provider.interface';

const ORIGIN = 'https://youcanpay.com';

/**
 * Adaptateur YouCan Pay (Modèle A : clés du commerçant, page de paiement hébergée par YouCan Pay).
 *
 * Références vérifiées (novembre 2026) :
 *  - docs.youcan.shop/youcan-pay : payment-flow, payment/tokenize, transactions/object, webhooks, yp-js/sandbox,
 *    authentication (l'API v2 refuse les clés sandbox : en sandbox, relecture par l'API v1) ;
 *  - SDK officiel github.com/NextmediaMa/youcan-payment-php-sdk (tokenize, transactions/{id}, payment-form/{token}).
 *
 * Capacités déclarées : uniquement ce qui est vérifié. Litiges et relevés de règlement ne sont PAS
 * déclarés (règle ADR-004).
 *
 * Remboursements : API v2 (docs.youcan.shop/youcan-pay/refunds/create et /object), qui refuse les clés
 * sandbox. Ils ne peuvent donc être éprouvés qu'avec un compte RÉEL : désactivés par défaut et ouverts
 * par YOUCAN_REFUNDS_ENABLED=true après le test Y4 (petit paiement réel puis remboursement).
 */
@Injectable()
export class YouCanPayProvider implements PaymentProvider {
  constructor(@Optional() @Inject(APP_CONFIG) private readonly config?: AppConfig) {}

  readonly code = 'youcanpay';
  readonly displayName = 'YouCan Pay';
  readonly supportedModes = ['sandbox' as const, 'live' as const];
  readonly credentialFields: CredentialField[] = [
    { key: 'publicKey', label: 'Clé publique (pub_…)', secret: false },
    { key: 'privateKey', label: 'Clé privée (pri_…)', secret: true },
  ];

  capabilities(): ProviderCapabilities {
    return {
      currencies: ['MAD'],
      methods: ['card'],
      refunds: false,
      partialRefunds: false,
      disputesWebhooks: false,
      settlementReports: false,
      hostedCheckout: true,
    };
  }

  /** Les webhooks YouCan Pay sont signés avec la clé privée du compte. */
  webhookSecretFromCredentials(credentials: Record<string, string>): string {
    return credentials.privateKey ?? '';
  }

  validateCredentials(mode: 'sandbox' | 'live', credentials: Record<string, string>): void {
    const { publicKey = '', privateKey = '' } = credentials;
    const sandbox = mode === 'sandbox';
    const ok = (k: string, p: string) => (sandbox ? k.startsWith(`${p}_sandbox_`) : k.startsWith(`${p}_`) && !k.startsWith(`${p}_sandbox_`));
    if (!ok(publicKey, 'pub') || !ok(privateKey, 'pri') || publicKey.length > 200 || privateKey.length > 200) {
      throw Errors.validation({ credentials: sandbox ? 'Use the sandbox keys (pub_sandbox_… / pri_sandbox_…)' : 'Use the live keys (pub_… / pri_…)' });
    }
  }

  async checkCredentials(mode: 'sandbox' | 'live', credentials: Record<string, string>): Promise<void> {
    const res = await this.post(mode, 'keys/check', { pri_key: credentials.privateKey, pub_key: credentials.publicKey });
    if (res.status !== 200) throw Errors.validation({ credentials: 'YouCan Pay rejected these keys' });
  }

  private apiBase(mode: 'sandbox' | 'live'): string {
    return `${ORIGIN}/${mode === 'sandbox' ? 'sandbox/' : ''}api/`;
  }

  private async post(mode: 'sandbox' | 'live', path: string, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${this.apiBase(mode)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async createPayment(account: ProviderAccountContext, input: CreatePaymentInput): Promise<ProviderPaymentSession> {
    if (input.amount.currency !== 'MAD') throw Errors.badRequest('currency_not_supported', 'YouCan Pay accepts MAD only through VITPAY');
    const { status, json } = await this.post(account.mode, 'tokenize', {
      pri_key: account.credentials.privateKey,
      order_id: input.attemptId,
      amount: input.amount.minor.toString(),
      currency: input.amount.currency,
      customer_ip: input.customerIp ?? '127.0.0.1',
      success_url: input.returnUrl,
      error_url: input.returnUrl,
      metadata: { vitpay_attempt_id: input.attemptId },
    });
    if (status === 422 || status === 404) throw new AppError('provider_rejected', 422, String(json.message ?? 'Rejected by YouCan Pay'));
    if (status !== 200) throw Errors.provider(`YouCan Pay tokenize failed with ${status}`);
    const token = (json.token as { id?: unknown } | undefined)?.id;
    const transactionId = json.transaction_id;
    if (typeof token !== 'string' || !/^[\w-]{8,100}$/.test(token)) throw Errors.provider('YouCan Pay tokenize: missing token');
    if (typeof transactionId !== 'string' || !transactionId) throw Errors.provider('YouCan Pay tokenize: missing transaction_id');
    const lang = 'fr';
    return {
      providerRef: transactionId,
      checkoutUrl: `${ORIGIN}/${account.mode === 'sandbox' ? 'sandbox/' : ''}payment-form/${token}?lang=${lang}`,
      status: 'pending',
    };
  }

  /** Relecture serveur à serveur : seule source de vérité. */
  async getPayment(account: ProviderAccountContext, providerRef: string): Promise<ProviderPayment> {
    const id = encodeURIComponent(providerRef);
    const res =
      account.mode === 'sandbox'
        ? await fetch(`${this.apiBase('sandbox')}transactions/${id}?pri_key=${encodeURIComponent(account.credentials.privateKey ?? '')}`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(15_000),
          })
        : await fetch(`${ORIGIN}/api/v2/transactions/${id}`, {
            headers: { accept: 'application/json', authorization: `Basic ${Buffer.from(`${account.credentials.privateKey ?? ''}:`).toString('base64')}` },
            signal: AbortSignal.timeout(15_000),
          });
    if (res.status === 404) throw new AppError('provider_rejected', 404, 'Transaction not found at YouCan Pay');
    if (!res.ok) throw Errors.provider(`YouCan Pay transaction read failed with ${res.status}`);
    return parseTransaction((await res.json()) as Record<string, unknown>, providerRef);
  }

  /** Comptes réels uniquement, et seulement une fois le test Y4 validé (YOUCAN_REFUNDS_ENABLED). */
  refundsAvailable(mode: ProviderMode): boolean {
    return mode === 'live' && this.config?.YOUCAN_REFUNDS_ENABLED === true;
  }

  private v2Headers(account: ProviderAccountContext): Record<string, string> {
    return { accept: 'application/json', authorization: `Basic ${Buffer.from(`${account.credentials.privateKey ?? ''}:`).toString('base64')}` };
  }

  /**
   * POST /api/v2/refunds (formulaire) : transaction_id, amount en unités mineures, reason
   * (duplicate | fraudulent | requested-by-customer), note facultative.
   * La note porte l'identifiant VITPAY du remboursement (rapprochement, aucune donnée personnelle).
   */
  async refund(account: ProviderAccountContext, input: { providerRef: string; amount: Money; refundId: string }): Promise<ProviderRefund> {
    if (!this.refundsAvailable(account.mode)) throw Errors.invalidState('Refunds through YouCan Pay are not enabled yet in VITPAY');
    const form = new URLSearchParams({
      transaction_id: input.providerRef,
      amount: input.amount.minor.toString(),
      reason: 'requested-by-customer',
      note: `VITPAY ${input.refundId}`,
    });
    const res = await fetch(`${ORIGIN}/api/v2/refunds`, {
      method: 'POST',
      headers: { ...this.v2Headers(account), 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 404 || res.status === 422) throw new AppError('provider_rejected', 422, String(json.message ?? 'Refund rejected by YouCan Pay'));
    if (!res.ok) throw Errors.provider(`YouCan Pay refund failed with ${res.status}`);
    return parseRefund(json, input.providerRef, input.amount.currency);
  }

  /** GET /api/v2/refunds/{id} : relecture du statut (aucun webhook de remboursement documenté). */
  async getRefund(account: ProviderAccountContext, providerRefundRef: string): Promise<ProviderRefund> {
    const res = await fetch(`${ORIGIN}/api/v2/refunds/${encodeURIComponent(providerRefundRef)}`, { headers: this.v2Headers(account), signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) throw new AppError('provider_rejected', 404, 'Refund not found at YouCan Pay');
    if (!res.ok) throw Errors.provider(`YouCan Pay refund read failed with ${res.status}`);
    return parseRefund((await res.json()) as Record<string, unknown>, null, 'MAD');
  }

  async getDispute(): Promise<ProviderDispute> {
    throw Errors.invalidState('Disputes are not available for YouCan Pay in VITPAY');
  }

  async fetchSettlementReport(): Promise<SettlementReport> {
    throw Errors.invalidState('Settlement reports are not available for YouCan Pay in VITPAY');
  }

  /**
   * En-tête X-YOUCANPAY-SIGNATURE : HMAC-SHA256 hexadécimal du corps BRUT, clé = clé privée du compte.
   * L'événement n'est qu'un signal : le statut est ensuite relu par getPayment.
   */
  verifyWebhook(account: ProviderAccountContext, rawBody: Buffer, headers: Record<string, string | undefined>): VerifiedProviderEvent {
    const sig = headers['x-youcanpay-signature'];
    if (!sig) throw new WebhookVerificationError('Missing signature header');
    if (!account.webhookSecret) throw new WebhookVerificationError('Account has no signing key');
    if (!safeEqualHex(hmacSha256Hex(account.webhookSecret, rawBody), sig.trim().toLowerCase())) throw new WebhookVerificationError('Invalid signature');
    let json: { id?: unknown; event_name?: unknown; sandbox?: unknown; payload?: { transaction?: { id?: unknown } } };
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookVerificationError('Invalid JSON');
    }
    if (typeof json.sandbox === 'boolean' && json.sandbox !== (account.mode === 'sandbox')) throw new WebhookVerificationError('Sandbox flag does not match the account mode');
    const name = typeof json.event_name === 'string' ? json.event_name : '';
    const txId = json.payload?.transaction?.id;
    if (!name.startsWith('transaction.') || typeof txId !== 'string' || !txId) throw new WebhookVerificationError(`Unsupported event ${name || '(none)'}`);
    const eventId = typeof json.id === 'string' && json.id ? json.id : `${name}:${txId}:${hmacSha256Hex('id', rawBody).slice(0, 16)}`;
    return { eventId, type: 'payment.updated', objectRef: txId, occurredAt: new Date().toISOString() };
  }
}

/** Statuts v1 (entiers) et v2 (texte). Un statut inconnu ne change rien : erreur, puis nouvel essai. */
export function mapYouCanStatus(s: unknown): ProviderPaymentStatus {
  if (s === 1 || s === '1' || s === 'paid') return 'succeeded';
  if (s === 0 || s === '0' || s === 'pending') return 'pending';
  if (s === 'authorized') return 'authorized';
  if (s === -1 || s === '-1' || s === 'failed') return 'failed';
  if (s === 'canceled') return 'cancelled';
  throw Errors.provider(`Unknown YouCan Pay transaction status ${JSON.stringify(s)}`);
}

export function parseTransaction(t: Record<string, unknown>, expectedRef: string): ProviderPayment {
  // v1 : amount "20.00" + currency ; v2 : amount { amount: "20.00", currency }.
  const amt = typeof t.amount === 'object' && t.amount ? (t.amount as Record<string, unknown>) : { amount: t.amount, currency: t.currency };
  const currency = String(amt.currency ?? '');
  if (!isCurrency(currency)) throw Errors.provider(`Unsupported currency ${currency}`);
  const major = String(amt.amount ?? '');
  if (!/^\d+(\.\d{1,2})?$/.test(major)) throw Errors.provider('YouCan Pay transaction: unreadable amount');
  const id = String(t.id ?? '');
  if (id !== expectedRef) throw Errors.provider('YouCan Pay transaction: id mismatch');
  const fees = typeof t.fees === 'object' && t.fees ? (t.fees as Record<string, unknown>) : null;
  return {
    providerRef: id,
    externalRef: String(t.order_id ?? ''),
    status: mapYouCanStatus(t.status),
    amount: Money.fromMajor(major, currency),
    fee: fees && fees.currency === currency && /^\d+(\.\d{1,2})?$/.test(String(fees.amount)) ? Money.fromMajor(String(fees.amount), currency) : null,
  };
}

/** Statuts documentés : pending, succeeded, canceled, failed. Tout autre statut est une erreur (nouvel essai). */
export function mapYouCanRefundStatus(s: unknown): ProviderRefund['status'] {
  if (s === 'pending') return 'pending';
  if (s === 'succeeded') return 'succeeded';
  if (s === 'failed' || s === 'canceled') return 'failed';
  throw Errors.provider(`Unknown YouCan Pay refund status ${JSON.stringify(s)}`);
}

export function parseRefund(r: Record<string, unknown>, expectedTransaction: string | null, fallbackCurrency: string): ProviderRefund {
  const id = String(r.id ?? '');
  if (!id) throw Errors.provider('YouCan Pay refund: missing id');
  if (expectedTransaction && r.transaction_id !== expectedTransaction) throw Errors.provider('YouCan Pay refund: transaction mismatch');
  const amt = typeof r.amount === 'object' && r.amount ? (r.amount as Record<string, unknown>) : {};
  const currency = String(amt.currency ?? fallbackCurrency);
  const major = String(amt.amount ?? '');
  if (!isCurrency(currency) || !/^\d+(\.\d{1,2})?$/.test(major)) throw Errors.provider('YouCan Pay refund: unreadable amount');
  return { providerRefundRef: id, status: mapYouCanRefundStatus(r.status), amount: Money.fromMajor(major, currency) };
}
