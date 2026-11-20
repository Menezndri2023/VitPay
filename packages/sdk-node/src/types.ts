/** Montant renvoyé par l'API : `minor` en unités mineures (centimes), `value` en décimal. */
export interface Amount {
  minor: string;
  value: string;
  currency: string;
}

export type PaymentRequestStatus = 'open' | 'paid' | 'expired' | 'cancelled';
export type Mode = 'sandbox' | 'live';

export interface PaymentRequest {
  id: string;
  reference: string;
  merchantReference: string | null;
  amount: Amount;
  description: string | null;
  customerName: string | null;
  customerContact: string | null;
  customerEmail: string | null;
  successUrl: string | null;
  cancelUrl: string | null;
  metadata: Record<string, string>;
  mode: Mode;
  status: PaymentRequestStatus;
  posId: string | null;
  expiresAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  /** Page de paiement hébergée : redirigez votre client ici. */
  payUrl: string;
}

export interface PaymentAttempt {
  id: string;
  providerCode: string;
  providerRef: string | null;
  method: string;
  status: string;
  amount: Amount;
  [key: string]: unknown;
}

/** Détail d'une demande : tentatives de paiement, remboursements, litiges et reçu. */
export interface PaymentRequestDetail extends PaymentRequest {
  displayStatus: string;
  attempts: PaymentAttempt[];
  [key: string]: unknown;
}

export interface CreatePaymentRequestParams {
  /** Montant décimal en chaîne, ex. "149.90". Jamais un nombre flottant. */
  amount: string;
  currency?: 'MAD';
  /** Votre n° de commande ou de facture (unique dans votre organisation). */
  merchantReference?: string;
  description?: string;
  customerName?: string;
  customerContact?: string;
  customerEmail?: string;
  expiresInHours?: number;
  /** Retour du client après un paiement confirmé (HTTPS). */
  successUrl?: string;
  /** Retour du client s'il abandonne, ou si la demande expire ou est annulée (HTTPS). */
  cancelUrl?: string;
  /** Jusqu'à 20 paires clé/valeur texte, renvoyées dans les webhooks. */
  metadata?: Record<string, string>;
}

export interface ListPaymentRequestsParams {
  status?: PaymentRequestStatus;
  q?: string;
  merchantReference?: string;
  /** Curseur : `nextCursor` de la page précédente. */
  before?: string;
  limit?: number;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface CreateRefundParams {
  /** Identifiant de la tentative de paiement réussie (`attempts[].id`). */
  attemptId: string;
  /** Montant partiel décimal ; absent = remboursement total. */
  amount?: string;
  reason: string;
}

export interface Refund {
  id: string;
  status: string;
  amount: Amount;
  [key: string]: unknown;
}

export interface RequestOptions {
  /**
   * Clé d'idempotence. Fortement recommandée : utilisez un identifiant stable de VOTRE côté
   * (ex. `facture-INV-42`) pour qu'un nouvel essai après coupure ne crée jamais de doublon.
   * Absente : le kit en génère une, réutilisée pour ses propres nouvelles tentatives.
   */
  idempotencyKey?: string;
  /** Délai maximal de la requête, en millisecondes. */
  timeoutMs?: number;
}

export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'dispute.opened'
  | 'dispute.won'
  | 'dispute.lost'
  | 'test';

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: WebhookEventType | (string & {});
  created: string;
  /** `true` : paiement réel ; `false` : test. Ignorez les événements de test en production. */
  livemode: boolean;
  data: T;
}

export interface PaymentEventData {
  objectType: 'payment_attempt';
  objectId: string;
  requestId: string;
  merchantReference: string | null;
  metadata: Record<string, string>;
  amount?: { amount: string; currency: string };
  status?: string;
  failureCode?: string | null;
}
