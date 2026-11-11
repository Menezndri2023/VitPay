import type { MoneyView } from '@vitpay/ui';

export interface PaymentRequest {
  id: string;
  reference: string;
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
}

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
