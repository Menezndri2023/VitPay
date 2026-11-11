import { Money } from '@vitpay/money';
import { EntryInput } from './ledger.service';

/**
 * Règles comptables : un événement métier → une écriture équilibrée.
 * Fonctions pures, testées unitairement. La clé d'idempotence est dérivée de l'objet métier,
 * de sorte qu'un webhook rejoué ne produit jamais une seconde écriture.
 */

export function paymentSucceededEntry(p: {
  orgId: string;
  attemptId: string;
  amount: Money;
  providerFee: Money;
  vitpayFee: Money;
}): EntryInput {
  return {
    orgId: p.orgId,
    entryType: 'payment.succeeded',
    referenceType: 'payment_attempt',
    referenceId: p.attemptId,
    idempotencyKey: `payment.succeeded:${p.attemptId}`,
    description: 'Paiement confirmé par le prestataire',
    postings: [
      { account: 'PROVIDER_RECEIVABLE', direction: 'debit', amount: p.amount },
      { account: 'GROSS_SALES', direction: 'credit', amount: p.amount },
      { account: 'PROVIDER_FEES', direction: 'debit', amount: p.providerFee },
      { account: 'PROVIDER_RECEIVABLE', direction: 'credit', amount: p.providerFee },
      { account: 'VITPAY_FEES', direction: 'debit', amount: p.vitpayFee },
      { account: 'VITPAY_FEES_PAYABLE', direction: 'credit', amount: p.vitpayFee },
    ],
  };
}

export function refundSucceededEntry(p: { orgId: string; refundId: string; amount: Money }): EntryInput {
  return {
    orgId: p.orgId,
    entryType: 'refund.succeeded',
    referenceType: 'refund',
    referenceId: p.refundId,
    idempotencyKey: `refund.succeeded:${p.refundId}`,
    description: 'Remboursement confirmé par le prestataire',
    postings: [
      { account: 'REFUNDS', direction: 'debit', amount: p.amount },
      { account: 'PROVIDER_RECEIVABLE', direction: 'credit', amount: p.amount },
    ],
  };
}

export function disputeOpenedEntry(p: { orgId: string; disputeId: string; amount: Money }): EntryInput {
  return {
    orgId: p.orgId,
    entryType: 'dispute.opened',
    referenceType: 'dispute',
    referenceId: p.disputeId,
    idempotencyKey: `dispute.opened:${p.disputeId}`,
    description: 'Litige ouvert : montant retenu par le prestataire',
    postings: [
      { account: 'DISPUTE_RESERVE', direction: 'debit', amount: p.amount },
      { account: 'PROVIDER_RECEIVABLE', direction: 'credit', amount: p.amount },
    ],
  };
}

export function disputeClosedEntry(p: { orgId: string; disputeId: string; amount: Money; outcome: 'won' | 'lost' }): EntryInput {
  return {
    orgId: p.orgId,
    entryType: `dispute.${p.outcome}`,
    referenceType: 'dispute',
    referenceId: p.disputeId,
    idempotencyKey: `dispute.${p.outcome}:${p.disputeId}`,
    description: p.outcome === 'won' ? 'Litige gagné : montant libéré' : 'Litige perdu',
    postings: [
      p.outcome === 'won'
        ? { account: 'PROVIDER_RECEIVABLE', direction: 'debit', amount: p.amount }
        : { account: 'CHARGEBACK_LOSSES', direction: 'debit', amount: p.amount },
      { account: 'DISPUTE_RESERVE', direction: 'credit', amount: p.amount },
    ],
  };
}

export function settlementEntry(p: { orgId: string; attemptId: string; settlementRef: string; net: Money }): EntryInput {
  return {
    orgId: p.orgId,
    entryType: 'settlement',
    referenceType: 'payment_attempt',
    referenceId: p.attemptId,
    idempotencyKey: `settlement:${p.attemptId}`,
    description: `Règlement constaté (rapport prestataire ${p.settlementRef})`,
    postings: [
      { account: 'BANK_SETTLED', direction: 'debit', amount: p.net },
      { account: 'PROVIDER_RECEIVABLE', direction: 'credit', amount: p.net },
    ],
  };
}
