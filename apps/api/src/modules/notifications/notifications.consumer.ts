import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Currency, formatMinor } from '@vitpay/money';
import { APP_CONFIG, AppConfig } from '../../config';
import { Db, Tx } from '../../database/db.service';
import { EmailService, layout } from '../email/email.service';
import { OutboxEvent, OutboxService } from '../platform/outbox.service';

interface PaidRequest {
  id: string;
  reference: string;
  description: string | null;
  customer_email: string | null;
  public_token: string;
  mode: 'sandbox' | 'live';
  merchant: string;
  receipt_number: string | null;
}

/**
 * Consommateur d'événements → notifications in-app de l'organisation, copie par e-mail aux
 * propriétaires et administrateurs, et reçu au client quand le commerçant a fourni son e-mail.
 * Idempotent : une notification (et donc un seul envoi d'e-mails) par événement outbox.
 * SMS / WhatsApp : canaux à brancher (fournisseurs à sélectionner, voir ROADMAP.md).
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  constructor(
    private readonly db: Db,
    private readonly outbox: OutboxService,
    private readonly email: EmailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    this.outbox.subscribe('payment.succeeded', (e) => this.notify(e, 'payment.succeeded', 'Paiement reçu', (p) => `Paiement confirmé : ${fmt(p.amount)}`));
    this.outbox.subscribe('refund.succeeded', (e) => this.notify(e, 'refund.succeeded', 'Remboursement effectué', (p) => `Remboursement confirmé : ${fmtView(p.amount)}`));
    this.outbox.subscribe('refund.failed', (e) => this.notify(e, 'refund.failed', 'Remboursement échoué', () => 'Le prestataire a refusé le remboursement.'));
    this.outbox.subscribe('dispute.opened', (e) => this.notify(e, 'dispute.opened', 'Litige ouvert', (p) => `Un payeur conteste un paiement de ${fmt(p.amount)}`));
  }

  private async notify(e: OutboxEvent, type: string, title: string, body: (p: Record<string, unknown>) => string): Promise<void> {
    if (!e.orgId) return;
    await this.db.forOrg(e.orgId, async (tx) => {
      const exists = await tx.maybeOne("SELECT 1 FROM notifications WHERE data->>'outboxId' = $1", [e.id.toString()]);
      if (exists) return;
      const inserted = await tx.query(
        `INSERT INTO notifications (org_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (org_id, (data->>'outboxId')) WHERE data ? 'outboxId' DO NOTHING RETURNING id`,
        [e.orgId, type, title, body(e.payload), JSON.stringify({ outboxId: e.id.toString(), aggregateId: e.aggregateId, ...e.payload })],
      );
      if (!inserted.length) return; // déjà traité : pas de second e-mail
      if (type !== 'payment.succeeded' && type !== 'dispute.opened') return;

      const requestId = typeof e.payload.requestId === 'string' ? e.payload.requestId : null;
      const req = requestId ? await this.paidRequest(tx, requestId, e.aggregateId) : null;
      const test = req?.mode === 'sandbox' ? ' (TEST — aucun paiement réel)' : '';
      const text = body(e.payload);

      // Copie aux propriétaires et administrateurs de l'organisation.
      const team = await tx.query<{ email: string }>(`SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role IN ('owner','admin')`);
      const details = req ? [`Référence ${req.reference}${req.description ? ` — ${req.description}` : ''}.`] : [];
      const cta = req ? { label: 'Voir la demande', url: `${this.config.BUSINESS_APP_URL}/app/requests/${req.id}` } : undefined;
      for (const o of team) {
        await this.email.queue(tx, {
          orgId: e.orgId,
          to: o.email,
          template: type,
          subject: `VITPAY — ${title}${test}`,
          text: [text, ...details, cta ? `${cta.label} : ${cta.url}` : ''].filter(Boolean).join('\n\n'),
          html: layout(title + test, [text, ...details], cta),
        });
      }

      // Reçu au client : uniquement si le commerçant a fourni son adresse (customerEmail).
      if (type === 'payment.succeeded' && req?.customer_email) {
        const receiptUrl = `${this.config.PAY_BASE_URL}/api/v1/public/requests/${req.public_token}/receipt.pdf`;
        const amount = fmt(e.payload.amount);
        const lines = [
          `Votre paiement de ${amount} à ${req.merchant} a été confirmé par le prestataire de paiement.`,
          `Référence ${req.reference}${req.receipt_number ? ` · reçu ${req.receipt_number}` : ''}${req.description ? ` · ${req.description}` : ''}.`,
          'Paiement traité par un prestataire de paiement agréé. VITPAY ne conserve aucune donnée de carte.',
        ];
        await this.email.queue(tx, {
          orgId: e.orgId,
          to: req.customer_email,
          template: 'payment.receipt',
          subject: `Reçu de paiement — ${req.merchant}${test}`,
          text: [...lines, `Télécharger le reçu : ${receiptUrl}`].join('\n\n'),
          html: layout(`Paiement confirmé${test}`, lines, { label: 'Télécharger le reçu', url: receiptUrl }),
        });
      }
    });
  }

  private paidRequest(tx: Tx, requestId: string, attemptId: string): Promise<PaidRequest | null> {
    return tx.maybeOne<PaidRequest>(
      `SELECT r.id, r.reference, r.description, r.customer_email, r.public_token, r.mode, o.display_name AS merchant,
              (SELECT rc.number FROM receipts rc WHERE rc.payment_attempt_id::text = $2) AS receipt_number
         FROM payment_requests r JOIN organizations o ON o.id = r.org_id
        WHERE r.id = $1`,
      [requestId, attemptId],
    );
  }
}

function fmt(v: unknown): string {
  const a = v as { amount?: string; currency?: Currency } | undefined;
  return a?.amount && a.currency ? formatMinor(a.amount, a.currency) : '';
}

function fmtView(v: unknown): string {
  const a = v as { minor?: string; currency?: Currency } | undefined;
  return a?.minor && a.currency ? formatMinor(a.minor, a.currency) : '';
}
