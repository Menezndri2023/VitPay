import type { Server } from 'node:http';

export interface Invoice {
  id: string;
  customer: string;
  email: string;
  label: string;
  amount: string;
  status: 'unpaid' | 'paid';
  paymentRequestId: string | null;
  paidAt: string | null;
}

export function createSaasApp(cfg: { apiUrl: string; orgId: string; secretKey: string; webhookSecret: string; publicUrl: string }): {
  server: Server;
  invoices: Map<string, Invoice>;
};
