import { Currency, Money } from '@vitpay/money';

/**
 * Contrat unique entre le moteur d'orchestration VITPAY et un prestataire de paiement.
 *
 * Règles (ADR-004, règles absolues 8, 9 et 16) :
 *  - Un adaptateur ne déclare QUE des capacités vérifiées dans la documentation et le contrat du prestataire.
 *  - `verifyWebhook` authentifie l'événement ; l'état métier est TOUJOURS relu via `getPayment`/`getRefund`.
 *  - Modèle A : chaque appel se fait avec les identifiants du commerçant (`ProviderAccountContext`).
 */

export type ProviderMode = 'sandbox' | 'live';
export type PaymentMethod = 'card' | 'bank_transfer' | 'mobile_money';

export type ProviderPaymentStatus =
  | 'pending'
  | 'requires_action'
  | 'processing'
  | 'authorized'
  | 'captured'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface ProviderCapabilities {
  currencies: Currency[];
  methods: PaymentMethod[];
  refunds: boolean;
  partialRefunds: boolean;
  disputesWebhooks: boolean;
  settlementReports: boolean;
  /** Le prestataire héberge la saisie de carte (VITPAY hors périmètre de données de carte). */
  hostedCheckout: boolean;
}

export interface ProviderAccountContext {
  accountId: string;
  orgId: string;
  mode: ProviderMode;
  credentials: Record<string, string>;
  webhookSecret: string;
}

export interface CreatePaymentInput {
  /** Référence VITPAY de la tentative, transmise au prestataire. */
  attemptId: string;
  amount: Money;
  description: string;
  /** URL de retour navigateur (affichage uniquement, jamais une preuve de paiement). */
  returnUrl: string;
}

export interface ProviderPaymentSession {
  providerRef: string;
  checkoutUrl: string;
  status: ProviderPaymentStatus;
}

export interface ProviderPayment {
  providerRef: string;
  externalRef: string;
  status: ProviderPaymentStatus;
  amount: Money;
  fee: Money | null;
  failureCode?: string;
}

export interface ProviderRefund {
  providerRefundRef: string;
  /** Identifiant VITPAY du remboursement, renvoyé par le prestataire. */
  externalRef?: string;
  status: 'pending' | 'succeeded' | 'failed';
  amount: Money;
}

export interface ProviderDispute {
  providerDisputeRef: string;
  paymentRef: string;
  status: 'opened' | 'evidence_submitted' | 'won' | 'lost';
  amount: Money;
  reason?: string;
}

export interface VerifiedProviderEvent {
  eventId: string;
  type: 'payment.updated' | 'refund.updated' | 'dispute.updated';
  objectRef: string;
  occurredAt: string;
}

export interface SettlementLine {
  paymentRef: string;
  gross: Money;
  fee: Money;
  net: Money;
  payoutRef: string;
}

export interface SettlementReport {
  date: string;
  lines: SettlementLine[];
  payouts: { payoutRef: string; amount: Money; status: 'payout_pending' | 'paid_out' | 'payout_failed' }[];
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export interface PaymentProvider {
  readonly code: string;
  readonly displayName: string;
  readonly supportedModes: ProviderMode[];
  capabilities(): ProviderCapabilities;
  createPayment(account: ProviderAccountContext, input: CreatePaymentInput, idempotencyKey: string): Promise<ProviderPaymentSession>;
  getPayment(account: ProviderAccountContext, providerRef: string): Promise<ProviderPayment>;
  refund(
    account: ProviderAccountContext,
    input: { providerRef: string; amount: Money; refundId: string },
    idempotencyKey: string,
  ): Promise<ProviderRefund>;
  getRefund(account: ProviderAccountContext, providerRefundRef: string): Promise<ProviderRefund>;
  getDispute(account: ProviderAccountContext, providerDisputeRef: string): Promise<ProviderDispute>;
  verifyWebhook(account: ProviderAccountContext, rawBody: Buffer, headers: Record<string, string | undefined>): VerifiedProviderEvent;
  fetchSettlementReport(account: ProviderAccountContext, date: string): Promise<SettlementReport>;
  /** Sandbox uniquement : crée un compte de test chez le prestataire. */
  provisionSandboxAccount?(input: { orgId: string; webhookUrl: string }): Promise<{ credentials: Record<string, string>; webhookSecret: string }>;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
