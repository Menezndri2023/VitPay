import type { MoneyView } from '@vitpay/ui';

export interface PaymentRequest {
  id: string;
  reference: string;
  merchantReference: string | null;
  amount: MoneyView;
  description: string | null;
  customerName: string | null;
  customerContact: string | null;
  mode: 'sandbox' | 'live';
  status: 'open' | 'paid' | 'expired' | 'cancelled';
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
  payUrl: string;
}

export interface Attempt {
  id: string;
  providerCode: string;
  providerRef: string | null;
  method: string;
  status: string;
  amount: MoneyView;
  providerFee: MoneyView | null;
  vitpayFee: MoneyView | null;
  failureCode: string | null;
  settlementStatus: string;
  createdAt: string;
  succeededAt: string | null;
}

export interface RequestDetail extends PaymentRequest {
  displayStatus: string;
  attempts: Attempt[];
  refunds: { id: string; attemptId: string; amount: MoneyView; status: string; reason: string; createdAt: string }[];
  disputes: { id: string; status: string; amount: MoneyView; reason: string | null; createdAt: string }[];
  receipt: { number: string; attemptId: string } | null;
  events: RequestEvent[];
}

export interface RequestEvent {
  id: string;
  at: string;
  type: string;
  object: { type: string; id: string };
  from: string | null;
  to: string | null;
  actor: string;
  reason: string | null;
}

/** Libellés de l'historique des événements. */
export const EVENT_LABELS: Record<string, string> = {
  'payment_request.created': 'Demande créée',
  'payment_request.cancelled': 'Demande annulée',
  'payment_request.expired': 'Demande expirée',
  'payment_attempt.created': 'Tentative de paiement ouverte',
  'payment_attempt.status_changed': 'Statut de la tentative',
  'refund.requested': 'Remboursement demandé',
  'refund.status_changed': 'Statut du remboursement',
  'dispute.opened': 'Litige ouvert',
  'dispute.status_changed': 'Statut du litige',
  'billing.fee_waived': 'Commission VITPAY annulée',
};
export const ACTOR_LABELS: Record<string, string> = {
  user: 'Utilisateur',
  api_key: 'Clé API',
  public: 'Payeur',
  provider: 'Prestataire',
  system: 'Système',
  admin: 'Administration VITPAY',
};

export const STATUS_LABELS: Record<string, string> = {
  open: 'En attente',
  paid: 'Payée',
  expired: 'Expirée',
  cancelled: 'Annulée',
  partially_refunded: 'Remb. partiel',
  refunded: 'Remboursée',
  disputed: 'Contestée',
  succeeded: 'Confirmé',
  failed: 'Échoué',
  pending: 'En cours',
  requires_action: 'Action requise',
  created: 'Créé',
};
