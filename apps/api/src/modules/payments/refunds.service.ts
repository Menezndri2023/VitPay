import { Injectable, Logger } from '@nestjs/common';
import { Currency, isCurrency, Money } from '@vitpay/money';
import { Errors } from '../../common/errors';
import { Db } from '../../database/db.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { disputeClosedEntry, disputeOpenedEntry, refundSucceededEntry } from '../ledger/posting-rules';
import { IncidentsService } from '../platform/incidents.service';
import { OutboxService } from '../platform/outbox.service';
import { ProviderAccountRow, ProviderRegistry } from '../providers/provider-registry';
import { ProviderDispute, ProviderRefund } from '../providers/provider.interface';
import { money, PaymentAttemptRow } from './payments.service';
import { DisputeMachine, DisputeStatus, RefundMachine, RefundStatus } from './state-machines';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RefundRow {
  id: string;
  org_id: string;
  payment_attempt_id: string;
  amount_minor: string;
  currency: Currency;
  reason: string;
  status: RefundStatus;
  provider_ref: string | null;
  created_at: Date;
}

@Injectable()
export class RefundsService {
  private readonly logger = new Logger('Refunds');

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly incidents: IncidentsService,
    private readonly providers: ProviderRegistry,
  ) {}

  view(r: RefundRow) {
    return { id: r.id, attemptId: r.payment_attempt_id, amount: money(r.amount_minor, r.currency), reason: r.reason, status: r.status, providerRef: r.provider_ref, createdAt: r.created_at.toISOString() };
  }

  /**
   * Demande de remboursement : réservée côté VITPAY (contrôle du plafond sous verrou),
   * puis exécutée PAR LE PRESTATAIRE. Le statut final provient du prestataire.
   */
  async create(orgId: string, actor: { userId: string; ip: string | null; userAgent: string | null }, input: { attemptId: string; amount?: string; reason: string }) {
    const prepared = await this.db.forOrg(orgId, async (tx) => {
      const a = await tx.maybeOne<PaymentAttemptRow>('SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE', [input.attemptId]);
      if (!a) throw Errors.notFound('Payment');
      if (a.status !== 'succeeded') throw Errors.invalidState('Only confirmed payments can be refunded');
      const provider = this.providers.get(a.provider_code);
      const caps = provider.capabilities();
      if (!caps.refunds) throw Errors.invalidState('This provider does not support refunds through VITPAY');
      const openDispute = await tx.maybeOne("SELECT 1 FROM disputes WHERE payment_attempt_id = $1 AND status IN ('opened','evidence_submitted')", [a.id]);
      if (openDispute) throw Errors.invalidState('A dispute is open on this payment');

      const paid = Money.of(a.amount_minor, a.currency);
      let amount: Money;
      try {
        amount = input.amount ? Money.fromMajor(input.amount, a.currency) : paid;
      } catch (e) {
        throw Errors.validation({ amount: (e as Error).message });
      }
      if (!amount.isPositive()) throw Errors.validation({ amount: 'Amount must be positive' });
      if (!amount.equals(paid) && !caps.partialRefunds) throw Errors.invalidState('Partial refunds are not supported by this provider');
      const reserved = await tx.one<{ total: string }>(
        `SELECT COALESCE(SUM(amount_minor),0)::text AS total FROM refunds WHERE payment_attempt_id = $1 AND status <> 'failed'`,
        [a.id],
      );
      // Les litiges perdus ont déjà été débités au commerçant : non remboursables (revue R5).
      const lost = await tx.one<{ total: string }>(
        `SELECT COALESCE(SUM(amount_minor),0)::text AS total FROM disputes WHERE payment_attempt_id = $1 AND status = 'lost'`,
        [a.id],
      );
      const remaining = paid.subtract(Money.of(reserved.total, a.currency)).subtract(Money.of(lost.total, a.currency));
      if (amount.compare(remaining) > 0) {
        throw Errors.invalidState('Refund exceeds the refundable amount', { refundable: money(remaining.minor, a.currency) });
      }
      const r = await tx.one<RefundRow>(
        `INSERT INTO refunds (org_id, payment_attempt_id, amount_minor, currency, reason, status, requested_by)
         VALUES ($1,$2,$3,$4,$5,'requested',$6) RETURNING *`,
        [orgId, a.id, amount.minor.toString(), a.currency, input.reason, actor.userId],
      );
      await this.audit.record(tx, {
        actor: { type: 'user', ...actor },
        orgId,
        action: 'refund.requested',
        targetType: 'refund',
        targetId: r.id,
        reason: input.reason,
        after: { attemptId: a.id, amount: amount.toJSON() },
      });
      const account = await this.providers.loadAccount(tx, a.provider_account_id);
      return { refund: r, attempt: a, account };
    });

    const { refund, attempt, account } = prepared;
    const provider = this.providers.get(account.provider_code);
    try {
      const result = await provider.refund(
        this.providers.context(account),
        { providerRef: attempt.provider_ref as string, amount: Money.of(refund.amount_minor, refund.currency), refundId: refund.id },
        `refund:${refund.id}`,
      );
      await this.applyProviderRefund(account, { ...result, externalRef: result.externalRef ?? refund.id }, { type: 'provider' });
    } catch (e) {
      // Échec réseau : le remboursement reste « requested » ; il sera réconcilié par webhook ou par l'équipe finance.
      this.logger.warn({ msg: 'provider refund call failed', refundId: refund.id, err: (e as Error).message });
      await this.db.forOrg(orgId, (tx) =>
        this.incidents.open(tx, {
          orgId,
          type: 'refund_failed',
          severity: 'medium',
          summary: `Refund ${refund.id} could not be sent to the provider; verify its status`,
          details: { refundId: refund.id, error: (e as Error).message },
          dedupeKey: `refund_call:${refund.id}`,
        }),
      );
    }
    const final = await this.db.forOrg(orgId, (tx) => tx.one<RefundRow>('SELECT * FROM refunds WHERE id = $1', [refund.id]));
    return this.view(final);
  }

  async applyProviderRefund(account: ProviderAccountRow, pr: ProviderRefund, actor: AuditActor): Promise<void> {
    const orgId = account.org_id;
    await this.db.forOrg(orgId, async (tx) => {
      // Le remboursement doit appartenir à une tentative de CE compte prestataire (revue R8).
      const byExternal = pr.externalRef && UUID_RE.test(pr.externalRef);
      const r = await tx.maybeOne<RefundRow>(
        `SELECT r.* FROM refunds r JOIN payment_attempts a ON a.id = r.payment_attempt_id
          WHERE a.provider_account_id = $1 AND ${byExternal ? 'r.id = $2::uuid' : 'r.provider_ref = $2'} FOR UPDATE OF r`,
        [account.id, byExternal ? pr.externalRef : pr.providerRefundRef],
      );
      if (!r) {
        await this.incidents.open(tx, {
          orgId,
          type: 'provider_state_conflict',
          severity: 'high',
          summary: `Provider refund ${pr.providerRefundRef} not found in VITPAY`,
          dedupeKey: `unknown_refund:${pr.providerRefundRef}`,
        });
        return;
      }
      if (!pr.amount.equals(Money.of(r.amount_minor, r.currency))) {
        await this.incidents.open(tx, { orgId, type: 'amount_mismatch', severity: 'critical', summary: `Refund ${r.id} amount mismatch`, dedupeKey: `refund_amount:${r.id}` });
        return;
      }
      if (!r.provider_ref) await tx.query('UPDATE refunds SET provider_ref = $2 WHERE id = $1', [r.id, pr.providerRefundRef]);
      const to: RefundStatus = pr.status;
      if (r.status === to) return;
      if (!RefundMachine.canTransition(r.status, to)) {
        await this.incidents.open(tx, { orgId, type: 'provider_state_conflict', severity: 'high', summary: `Refund ${r.id}: ${r.status} → ${to} rejected`, dedupeKey: `refund_conflict:${r.id}:${to}` });
        return;
      }
      await tx.query('UPDATE refunds SET status = $2, version = version + 1, updated_at = now() WHERE id = $1', [r.id, to]);
      await this.audit.record(tx, { actor, orgId, action: 'refund.status_changed', targetType: 'refund', targetId: r.id, before: { status: r.status }, after: { status: to } });
      if (to === 'succeeded') {
        await this.ledger.post(tx, refundSucceededEntry({ orgId, refundId: r.id, amount: Money.of(r.amount_minor, r.currency) }));
        await this.outbox.publish(tx, { eventType: 'refund.succeeded', aggregateType: 'refund', aggregateId: r.id, orgId, payload: { amount: money(r.amount_minor, r.currency) } });
      } else if (to === 'failed') {
        await this.incidents.open(tx, { orgId, type: 'refund_failed', severity: 'medium', summary: `Refund ${r.id} failed at provider`, dedupeKey: `refund_failed:${r.id}` });
        await this.outbox.publish(tx, { eventType: 'refund.failed', aggregateType: 'refund', aggregateId: r.id, orgId, payload: {} });
      }
    });
  }

  async applyProviderDispute(account: ProviderAccountRow, d: ProviderDispute, actor: AuditActor): Promise<void> {
    const orgId = account.org_id;
    await this.db.forOrg(orgId, async (tx) => {
      const a = await tx.maybeOne<PaymentAttemptRow>('SELECT * FROM payment_attempts WHERE provider_account_id = $1 AND provider_ref = $2', [
        account.id,
        d.paymentRef,
      ]);
      if (!a) {
        await this.incidents.open(tx, { orgId, type: 'provider_state_conflict', severity: 'high', summary: `Dispute ${d.providerDisputeRef} on unknown payment`, dedupeKey: `unknown_dispute:${d.providerDisputeRef}` });
        return;
      }
      if (!isCurrency(d.amount.currency) || d.amount.currency !== a.currency) {
        await this.incidents.open(tx, { orgId, type: 'amount_mismatch', severity: 'critical', summary: `Dispute currency mismatch`, dedupeKey: `dispute_ccy:${d.providerDisputeRef}` });
        return;
      }
      let row = await tx.maybeOne<{ id: string; status: DisputeStatus; amount_minor: string }>(
        'SELECT id, status, amount_minor FROM disputes WHERE payment_attempt_id = $1 AND provider_ref = $2 FOR UPDATE',
        [a.id, d.providerDisputeRef],
      );
      if (!row && d.amount.compare(Money.of(a.amount_minor, a.currency)) > 0) {
        await this.incidents.open(tx, { orgId, type: 'amount_mismatch', severity: 'critical', summary: `Dispute ${d.providerDisputeRef} exceeds the paid amount`, dedupeKey: `dispute_amount:${d.providerDisputeRef}` });
        return;
      }
      if (!row) {
        row = await tx.one<{ id: string; status: DisputeStatus; amount_minor: string }>(
          `INSERT INTO disputes (org_id, payment_attempt_id, provider_ref, amount_minor, currency, reason, status)
           VALUES ($1,$2,$3,$4,$5,$6,'opened') RETURNING id, status, amount_minor`,
          [orgId, a.id, d.providerDisputeRef, d.amount.minor.toString(), a.currency, d.reason ?? null],
        );
        await this.ledger.post(tx, disputeOpenedEntry({ orgId, disputeId: row.id, amount: d.amount }));
        await this.audit.record(tx, { actor, orgId, action: 'dispute.opened', targetType: 'dispute', targetId: row.id, after: { amount: d.amount.toJSON() } });
        await this.outbox.publish(tx, { eventType: 'dispute.opened', aggregateType: 'dispute', aggregateId: row.id, orgId, payload: { amount: d.amount.toJSON() } });
      }
      if (row.status === d.status || d.status === 'opened') return;
      if (!DisputeMachine.canTransition(row.status, d.status)) return;
      await tx.query('UPDATE disputes SET status = $2, version = version + 1, updated_at = now() WHERE id = $1', [row.id, d.status]);
      await this.audit.record(tx, { actor, orgId, action: 'dispute.status_changed', targetType: 'dispute', targetId: row.id, before: { status: row.status }, after: { status: d.status } });
      if (d.status === 'won' || d.status === 'lost') {
        await this.ledger.post(tx, disputeClosedEntry({ orgId, disputeId: row.id, amount: Money.of(row.amount_minor, a.currency), outcome: d.status }));
        await this.outbox.publish(tx, { eventType: `dispute.${d.status}`, aggregateType: 'dispute', aggregateId: row.id, orgId, payload: {} });
      }
    });
  }
}
