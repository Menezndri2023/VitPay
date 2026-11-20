/**
 * Plan de comptes du ledger miroir (modèle A).
 *
 * VITPAY ne détient AUCUN fonds. Ces comptes décrivent, pour chaque organisation,
 * ce que le prestataire agréé a encaissé pour elle, ce qu'il lui a reversé, et les frais.
 * Voir docs/FINANCIAL_CORE.md.
 */
export const ACCOUNTS = {
  /** Actif : montant encaissé par le PSP pour le commerçant, non encore reversé. */
  PROVIDER_RECEIVABLE: { code: 'provider_receivable', type: 'asset' },
  /** Actif : montants contestés (litige ouvert), retenus par le PSP. */
  DISPUTE_RESERVE: { code: 'dispute_reserve', type: 'asset' },
  /** Actif : montants reversés par le PSP sur le compte bancaire du commerçant (constaté). */
  BANK_SETTLED: { code: 'bank_settled', type: 'asset' },
  /** Produit : ventes brutes encaissées. */
  GROSS_SALES: { code: 'gross_sales', type: 'revenue' },
  /** Charge (contre-produit) : remboursements accordés. */
  REFUNDS: { code: 'refunds', type: 'expense' },
  /** Charge : frais du prestataire. */
  PROVIDER_FEES: { code: 'provider_fees', type: 'expense' },
  /** Charge : commission VITPAY (facturée séparément en modèle A). */
  VITPAY_FEES: { code: 'vitpay_fees', type: 'expense' },
  /** Dette : commission VITPAY due, non encore facturée/réglée. */
  VITPAY_FEES_PAYABLE: { code: 'vitpay_fees_payable', type: 'liability' },
  /** Charge : litiges perdus. */
  CHARGEBACK_LOSSES: { code: 'chargeback_losses', type: 'expense' },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;
export type AccountType = 'asset' | 'liability' | 'revenue' | 'expense';

export function normalBalance(type: AccountType): 'debit' | 'credit' {
  return type === 'asset' || type === 'expense' ? 'debit' : 'credit';
}
