import { Injectable, OnModuleInit } from '@nestjs/common';
import { Currency, formatMinor } from '@vitpay/money';
import { Db } from '../../database/db.service';
import { EmailService, layout } from '../email/email.service';
import { OutboxEvent, OutboxService } from '../platform/outbox.service';

/**
 * Consommateur d'événements → notifications in-app de l'organisation.
 * Idempotent : une notification par (événement outbox).
 * E-mail / SMS / WhatsApp : canaux à brancher (fournisseurs à sélectionner, voir ROADMAP.md).
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  constructor(
    private readonly db: Db,
    private readonly outbox: OutboxService,
    private readonly email: EmailService,
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
        [
        e.orgId,
        type,
        title,
        body(e.payload),
        JSON.stringify({ outboxId: e.id.toString(), aggregateId: e.aggregateId, ...e.payload }),
      ],
      );
      if (!inserted.length) return; // déjà traité : pas de second e-mail
      // Copie par e-mail aux propriétaires (paiements reçus et litiges).
      if (type === 'payment.succeeded' || type === 'dispute.opened') {
        const owners = await tx.query<{ email: string }>(`SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.role = 'owner'`);
        const text = body(e.payload);
        for (const o of owners) {
          await this.email.queue(tx, { orgId: e.orgId, to: o.email, template: type, subject: `VITPAY — ${title}`, text, html: layout(title, [text]) });
        }
      }
    });
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
