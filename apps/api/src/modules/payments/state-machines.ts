/**
 * Machines à états VITPAY — fonctions pures.
 *
 * Le cahier des charges listait une série unique de statuts ; ils appartiennent en réalité
 * à des objets différents (ADR-005). Chaque objet a sa propre machine.
 */

export class IllegalTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Illegal ${machine} transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

function makeMachine<S extends string>(name: string, transitions: Record<S, readonly S[]>) {
  return {
    name,
    states: Object.keys(transitions) as S[],
    canTransition(from: S, to: S): boolean {
      return transitions[from].includes(to);
    },
    assertTransition(from: S, to: S): void {
      if (!transitions[from].includes(to)) throw new IllegalTransitionError(name, from, to);
    },
    isTerminal(s: S): boolean {
      return transitions[s].length === 0;
    },
    transitions,
  };
}

// 1. Demande de paiement (créée par le bénéficiaire)
export type PaymentRequestStatus = 'open' | 'paid' | 'expired' | 'cancelled';
export const PaymentRequestMachine = makeMachine<PaymentRequestStatus>('payment_request', {
  open: ['paid', 'expired', 'cancelled'],
  // Un paiement confirmé par le prestataire APRÈS expiration/annulation reste un fait :
  // la demande passe en `paid` et un incident est ouvert (remboursement à décider).
  expired: ['paid'],
  cancelled: ['paid'],
  paid: [],
});

// 2. Tentative de paiement (une par passage du payeur chez le prestataire)
export type PaymentAttemptStatus =
  | 'created'
  | 'pending'
  | 'requires_action'
  | 'processing'
  | 'authorized'
  | 'captured'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export const ACTIVE_ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = [
  'created',
  'pending',
  'requires_action',
  'processing',
  'authorized',
  'captured',
];

export const PaymentAttemptMachine = makeMachine<PaymentAttemptStatus>('payment_attempt', {
  created: ['pending', 'requires_action', 'processing', 'authorized', 'captured', 'succeeded', 'failed', 'cancelled', 'expired'],
  pending: ['requires_action', 'processing', 'authorized', 'captured', 'succeeded', 'failed', 'cancelled', 'expired'],
  requires_action: ['pending', 'processing', 'authorized', 'captured', 'succeeded', 'failed', 'cancelled', 'expired'],
  processing: ['authorized', 'captured', 'succeeded', 'failed'],
  authorized: ['captured', 'succeeded', 'failed', 'cancelled'],
  captured: ['succeeded', 'failed'],
  // `succeeded` = confirmé par preuve serveur. Les remboursements et litiges sont des objets séparés.
  succeeded: [],
  failed: [],
  cancelled: [],
  expired: [],
});

// 3. Remboursement
export type RefundStatus = 'requested' | 'pending' | 'succeeded' | 'failed';
export const RefundMachine = makeMachine<RefundStatus>('refund', {
  requested: ['pending', 'succeeded', 'failed'],
  pending: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
});

// 4. Litige
export type DisputeStatus = 'opened' | 'evidence_submitted' | 'won' | 'lost';
export const DisputeMachine = makeMachine<DisputeStatus>('dispute', {
  opened: ['evidence_submitted', 'won', 'lost'],
  evidence_submitted: ['won', 'lost'],
  won: [],
  lost: [],
});

// 5. Règlement et reversement (observés chez le prestataire)
export type SettlementStatus = 'unsettled' | 'settled';
export const SettlementMachine = makeMachine<SettlementStatus>('settlement', {
  unsettled: ['settled'],
  settled: [],
});

export type PayoutStatus = 'payout_pending' | 'paid_out' | 'payout_failed';
export const PayoutMachine = makeMachine<PayoutStatus>('payout', {
  payout_pending: ['paid_out', 'payout_failed'],
  paid_out: [],
  payout_failed: [],
});

/**
 * Statut AFFICHÉ d'une demande, dérivé (jamais stocké) de la demande, de ses
 * remboursements et litiges.
 */
export type DisplayStatus = PaymentRequestStatus | 'partially_refunded' | 'refunded' | 'disputed';

export function deriveDisplayStatus(p: {
  status: PaymentRequestStatus;
  paidAmountMinor: bigint;
  refundedMinor: bigint;
  openDispute: boolean;
}): DisplayStatus {
  if (p.status !== 'paid') return p.status;
  if (p.openDispute) return 'disputed';
  if (p.refundedMinor > 0n && p.refundedMinor >= p.paidAmountMinor) return 'refunded';
  if (p.refundedMinor > 0n) return 'partially_refunded';
  return 'paid';
}
