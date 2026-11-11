import { Inject, Injectable } from '@nestjs/common';
import { Currency, isCurrency, Money } from '@vitpay/money';
import { APP_CONFIG, AppConfig } from '../../config';
import { hmacSha256Hex, safeEqualHex } from '../../common/crypto';
import { Errors } from '../../common/errors';
import {
  CreatePaymentInput,
  PaymentProvider,
  ProviderAccountContext,
  ProviderCapabilities,
  ProviderDispute,
  ProviderPayment,
  ProviderPaymentSession,
  ProviderPaymentStatus,
  ProviderRefund,
  SettlementReport,
  VerifiedProviderEvent,
  WebhookVerificationError,
} from './provider.interface';

const WEBHOOK_TOLERANCE_SEC = 300;

/**
 * Adaptateur du prestataire SIMULÉ. Il communique en HTTP, avec les identifiants du
 * commerçant, exactement comme le ferait l'adaptateur d'un vrai prestataire.
 * Il sert de modèle pour les adaptateurs réels (voir docs/PAYMENT_FLOWS.md §Ajouter un prestataire).
 */
@Injectable()
export class MockProvider implements PaymentProvider {
  readonly code = 'mock';
  readonly displayName = 'Prestataire simulé (sandbox)';
  readonly supportedModes = ['sandbox' as const];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  capabilities(): ProviderCapabilities {
    return {
      currencies: ['MAD', 'EUR', 'USD', 'GBP', 'XOF', 'XAF'],
      methods: ['card'],
      refunds: true,
      partialRefunds: true,
      disputesWebhooks: true,
      settlementReports: true,
      hostedCheckout: true,
    };
  }

  private async call<T>(account: ProviderAccountContext, method: 'GET' | 'POST', path: string, body?: unknown, idem?: string): Promise<T> {
    if (account.mode !== 'sandbox') throw Errors.legalGate();
    const res = await fetch(`${this.config.PUBLIC_API_URL}/mock-psp/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${account.credentials.apiKey ?? ''}`,
        'content-type': 'application/json',
        ...(idem ? { 'idempotency-key': idem } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw Errors.provider(`Mock PSP ${method} ${path} failed with ${res.status}`);
    return (await res.json()) as T;
  }

  async provisionSandboxAccount(input: { orgId: string; webhookUrl: string }) {
    const res = await fetch(`${this.config.PUBLIC_API_URL}/mock-psp/api/merchants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ webhookUrl: input.webhookUrl }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw Errors.provider(`Mock PSP onboarding failed with ${res.status}`);
    const m = (await res.json()) as { merchantId: string; apiKey: string; webhookSecret: string };
    return { credentials: { merchantId: m.merchantId, apiKey: m.apiKey }, webhookSecret: m.webhookSecret };
  }

  async createPayment(account: ProviderAccountContext, input: CreatePaymentInput, idempotencyKey: string): Promise<ProviderPaymentSession> {
    const p = await this.call<{ id: string; status: string; checkout_url: string }>(
      account,
      'POST',
      '/payments',
      {
        externalRef: input.attemptId,
        amountMinor: input.amount.minor.toString(),
        currency: input.amount.currency,
        description: input.description,
        returnUrl: input.returnUrl,
      },
      idempotencyKey,
    );
    return { providerRef: p.id, checkoutUrl: p.checkout_url, status: mapStatus(p.status) };
  }

  async getPayment(account: ProviderAccountContext, providerRef: string): Promise<ProviderPayment> {
    const p = await this.call<{ id: string; external_ref: string; amount_minor: string; currency: string; status: string; fee_minor: string; failure_code: string | null }>(
      account,
      'GET',
      `/payments/${encodeURIComponent(providerRef)}`,
    );
    const currency = asCurrency(p.currency);
    return {
      providerRef: p.id,
      externalRef: p.external_ref,
      status: mapStatus(p.status),
      amount: Money.of(p.amount_minor, currency),
      fee: Money.of(p.fee_minor, currency),
      failureCode: p.failure_code ?? undefined,
    };
  }

  async refund(account: ProviderAccountContext, input: { providerRef: string; amount: Money; refundId: string }, idempotencyKey: string): Promise<ProviderRefund> {
    const r = await this.call<{ id: string; external_ref: string; status: string; amount_minor: string }>(
      account,
      'POST',
      `/payments/${encodeURIComponent(input.providerRef)}/refunds`,
      { externalRef: input.refundId, amountMinor: input.amount.minor.toString() },
      idempotencyKey,
    );
    return { providerRefundRef: r.id, externalRef: r.external_ref, status: mapRefund(r.status), amount: Money.of(r.amount_minor, input.amount.currency) };
  }

  async getRefund(account: ProviderAccountContext, ref: string): Promise<ProviderRefund> {
    const r = await this.call<{ id: string; external_ref: string; status: string; amount_minor: string; currency: string }>(account, 'GET', `/refunds/${encodeURIComponent(ref)}`);
    return { providerRefundRef: r.id, externalRef: r.external_ref, status: mapRefund(r.status), amount: Money.of(r.amount_minor, asCurrency(r.currency)) };
  }

  async getDispute(account: ProviderAccountContext, ref: string): Promise<ProviderDispute> {
    const d = await this.call<{ id: string; payment_id: string; amount_minor: string; currency: string; status: string; reason: string | null }>(
      account,
      'GET',
      `/disputes/${encodeURIComponent(ref)}`,
    );
    const status = (['opened', 'evidence_submitted', 'won', 'lost'] as const).find((s) => s === d.status);
    if (!status) throw Errors.provider(`Unknown dispute status ${d.status}`);
    return { providerDisputeRef: d.id, paymentRef: d.payment_id, status, amount: Money.of(d.amount_minor, asCurrency(d.currency)), reason: d.reason ?? undefined };
  }

  verifyWebhook(account: ProviderAccountContext, rawBody: Buffer, headers: Record<string, string | undefined>): VerifiedProviderEvent {
    const header = headers['x-mockpsp-signature'];
    if (!header) throw new WebhookVerificationError('Missing signature header');
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
    const ts = Number(parts.t);
    if (!Number.isInteger(ts) || !parts.v1) throw new WebhookVerificationError('Malformed signature header');
    if (Math.abs(Date.now() / 1000 - ts) > WEBHOOK_TOLERANCE_SEC) throw new WebhookVerificationError('Signature timestamp outside tolerance (replay?)');
    const expected = hmacSha256Hex(account.webhookSecret, Buffer.concat([Buffer.from(`${ts}.`), rawBody]));
    if (!safeEqualHex(expected, parts.v1)) throw new WebhookVerificationError('Invalid signature');
    let json: { id?: string; type?: string; created?: string; data?: { object_id?: string } };
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookVerificationError('Invalid JSON');
    }
    const type = json.type;
    if (!json.id || !json.data?.object_id || (type !== 'payment.updated' && type !== 'refund.updated' && type !== 'dispute.updated')) {
      throw new WebhookVerificationError('Unsupported event');
    }
    return { eventId: json.id, type, objectRef: json.data.object_id, occurredAt: json.created ?? new Date().toISOString() };
  }

  async fetchSettlementReport(account: ProviderAccountContext, date: string): Promise<SettlementReport> {
    const r = await this.call<{
      date: string;
      lines: { paymentRef: string; currency: string; grossMinor: string; feeMinor: string; netMinor: string; payoutRef: string }[];
      payouts: { payoutRef: string; currency: string; amountMinor: string; status: 'payout_pending' | 'paid_out' | 'payout_failed' }[];
    }>(account, 'GET', `/settlements?date=${encodeURIComponent(date)}`);
    return {
      date: r.date,
      lines: r.lines.map((l) => {
        const c = asCurrency(l.currency);
        return { paymentRef: l.paymentRef, gross: Money.of(l.grossMinor, c), fee: Money.of(l.feeMinor, c), net: Money.of(l.netMinor, c), payoutRef: l.payoutRef };
      }),
      payouts: r.payouts.map((p) => ({ payoutRef: p.payoutRef, amount: Money.of(p.amountMinor, asCurrency(p.currency)), status: p.status })),
    };
  }
}

function asCurrency(c: string): Currency {
  if (!isCurrency(c)) throw Errors.provider(`Unsupported currency ${c}`);
  return c;
}

function mapStatus(s: string): ProviderPaymentStatus {
  const known: ProviderPaymentStatus[] = ['pending', 'requires_action', 'processing', 'authorized', 'captured', 'succeeded', 'failed', 'cancelled', 'expired'];
  const found = known.find((k) => k === s);
  if (!found) throw Errors.provider(`Unknown payment status ${s}`);
  return found;
}

function mapRefund(s: string): 'pending' | 'succeeded' | 'failed' {
  if (s === 'pending' || s === 'succeeded' || s === 'failed') return s;
  throw Errors.provider(`Unknown refund status ${s}`);
}
