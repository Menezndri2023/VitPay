import { Injectable } from '@nestjs/common';
import { Errors } from '../../common/errors';
import { Db } from '../../database/db.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { ClientMeta } from '../identity/auth.service';
import { AdminPermission, platformRoleHas } from '../identity/permissions';
import { AuthContext } from '../identity/session';
import { toCamel } from '../organizations/organizations.service';
import { money } from '../payments/payments.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { WebhooksService } from '../webhooks/webhooks.service';

function mask(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  return v.length <= 4 ? '••••' : `${v.slice(0, 2)}${'•'.repeat(Math.max(2, v.length - 4))}${v.slice(-2)}`;
}

/**
 * VITPAY ADMIN — supervision plateforme. Toutes les lectures transverses sont faites
 * en bypass RLS (justifié : administration interne, accès restreint et MFA obligatoire)
 * et toutes les actions sont journalisées.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly reconciliation: ReconciliationService,
    private readonly webhooks: WebhooksService,
  ) {}

  private actor(a: AuthContext, meta: ClientMeta): AuditActor {
    return { type: 'admin', userId: a.userId, ...meta };
  }

  private can(a: AuthContext, p: AdminPermission): boolean {
    return !!a.platformRole && platformRoleHas(a.platformRole, p);
  }

  async dashboard() {
    return this.db.system(async (tx) => {
      const orgs = await tx.query<{ status: string; kyb_status: string; n: string }>(
        'SELECT status, kyb_status, count(*)::text AS n FROM organizations GROUP BY 1, 2',
      );
      const volume = await tx.query<{ currency: 'MAD'; mode: string; n: string; sum: string }>(
        `SELECT a.currency, pr.mode, count(*)::text AS n, sum(a.amount_minor)::text AS sum
           FROM payment_attempts a JOIN payment_requests pr ON pr.id = a.payment_request_id
          WHERE a.status = 'succeeded' AND a.succeeded_at > now() - interval '30 days' GROUP BY 1, 2`,
      );
      const incidents = await tx.query<{ severity: string; n: string }>(
        `SELECT severity, count(*)::text AS n FROM incidents WHERE status <> 'resolved' GROUP BY 1`,
      );
      const webhooks = await tx.query<{ status: string; n: string }>(
        `SELECT status, count(*)::text AS n FROM webhook_inbox WHERE received_at > now() - interval '24 hours' GROUP BY 1`,
      );
      const approvals = await tx.one<{ n: string }>(`SELECT count(*)::text AS n FROM approval_requests WHERE status = 'pending'`);
      return {
        organizations: orgs.map((o) => ({ status: o.status, kybStatus: o.kyb_status, count: Number(o.n) })),
        succeededLast30Days: volume.map((v) => ({ mode: v.mode, count: Number(v.n), total: money(v.sum, v.currency) })),
        openIncidents: incidents.map((i) => ({ severity: i.severity, count: Number(i.n) })),
        webhooksLast24h: webhooks.map((w) => ({ status: w.status, count: Number(w.n) })),
        pendingApprovals: Number(approvals.n),
      };
    });
  }

  async listOrgs(a: AuthContext, q?: string, status?: string) {
    const rows = await this.db.system((tx) =>
      tx.query<Record<string, unknown>>(
        `SELECT o.id, o.type, o.display_name, o.legal_name, o.ice, o.rc, o.status, o.kyb_status, o.vitpay_fee_bps, o.created_at,
                (SELECT count(*) FROM payment_requests pr WHERE pr.org_id = o.id)::int AS request_count
           FROM organizations o
          WHERE ($1::text IS NULL OR o.display_name ILIKE '%' || $1 || '%' OR o.legal_name ILIKE '%' || $1 || '%' OR o.ice = $1)
            AND ($2::text IS NULL OR o.status = $2 OR o.kyb_status = $2)
          ORDER BY o.created_at DESC LIMIT 200`,
        [q ?? null, status ?? null],
      ),
    );
    return rows.map((r) => this.maskOrg(a, r));
  }

  private maskOrg(a: AuthContext, r: Record<string, unknown>) {
    const pii = this.can(a, 'orgs:read_pii');
    return toCamel({ ...r, legal_name: pii ? r.legal_name : mask(r.legal_name), ice: pii ? r.ice : mask(r.ice), rc: pii ? r.rc : mask(r.rc), address: pii ? r.address : mask(r.address) });
  }

  async getOrg(a: AuthContext, id: string) {
    return this.db.system(async (tx) => {
      const o = await tx.maybeOne<Record<string, unknown>>('SELECT * FROM organizations WHERE id = $1', [id]);
      if (!o) throw Errors.notFound('Organization');
      const members = await tx.query<Record<string, unknown>>(
        `SELECT m.user_id, m.role, u.full_name, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1`,
        [id],
      );
      const accounts = await tx.query<Record<string, unknown>>('SELECT id, provider_code, mode, label, status, created_at FROM provider_accounts WHERE org_id = $1', [id]);
      const pii = this.can(a, 'orgs:read_pii');
      return {
        ...this.maskOrg(a, o),
        members: members.map((m) => toCamel({ ...m, email: pii ? m.email : mask(m.email) })),
        providerAccounts: accounts.map(toCamel),
      };
    });
  }

  async suspendOrg(a: AuthContext, id: string, reason: string, meta: ClientMeta) {
    await this.db.system(async (tx) => {
      const o = await tx.maybeOne<{ status: string }>('SELECT status FROM organizations WHERE id = $1 FOR UPDATE', [id]);
      if (!o) throw Errors.notFound('Organization');
      if (o.status !== 'active') throw Errors.invalidState(`Organization is ${o.status}`);
      await tx.query(`UPDATE organizations SET status = 'suspended', updated_at = now() WHERE id = $1`, [id]);
      await this.audit.record(tx, { actor: this.actor(a, meta), orgId: id, action: 'admin.org.suspended', targetType: 'organization', targetId: id, reason, before: o, after: { status: 'suspended' } });
    });
  }

  async decideKyb(a: AuthContext, id: string, decision: 'verified' | 'rejected', reason: string, meta: ClientMeta) {
    await this.db.system(async (tx) => {
      const o = await tx.maybeOne<{ kyb_status: string }>('SELECT kyb_status FROM organizations WHERE id = $1 FOR UPDATE', [id]);
      if (!o) throw Errors.notFound('Organization');
      if (o.kyb_status !== 'submitted') throw Errors.invalidState('KYB is not awaiting a decision');
      await tx.query(`UPDATE organizations SET kyb_status = $2, kyb_decided_at = now(), updated_at = now() WHERE id = $1`, [id, decision]);
      await this.audit.record(tx, { actor: this.actor(a, meta), orgId: id, action: `admin.kyb.${decision}`, targetType: 'organization', targetId: id, reason, before: o, after: { kybStatus: decision } });
    });
  }

  // ── Contrôle à quatre yeux ──

  async requestApproval(a: AuthContext, input: { action: 'org.fee.update' | 'org.reactivate'; targetId: string; payload: Record<string, unknown>; reason: string }, meta: ClientMeta) {
    if (input.action === 'org.fee.update') {
      const bps = Number(input.payload.vitpayFeeBps);
      if (!Number.isInteger(bps) || bps < 0 || bps > 1000) throw Errors.validation({ vitpayFeeBps: 'Integer between 0 and 1000 (0–10 %)' });
    }
    return this.db.system(async (tx) => {
      const o = await tx.maybeOne<{ vitpay_fee_bps: number; status: string }>('SELECT vitpay_fee_bps, status FROM organizations WHERE id = $1', [input.targetId]);
      if (!o) throw Errors.notFound('Organization');
      // Valeur de départ figée : l'approbation échoue si elle a changé entre-temps (approbations concurrentes).
      if (input.action === 'org.fee.update') input = { ...input, payload: { ...input.payload, expectedCurrentBps: o.vitpay_fee_bps } };
      const r = await tx.one<{ id: string }>(
        `INSERT INTO approval_requests (action, target_type, target_id, payload, reason, requested_by) VALUES ($1,'organization',$2,$3,$4,$5) RETURNING id`,
        [input.action, input.targetId, JSON.stringify(input.payload), input.reason, a.userId],
      );
      await this.audit.record(tx, { actor: this.actor(a, meta), orgId: input.targetId, action: 'admin.approval.requested', targetType: 'approval_request', targetId: r.id, reason: input.reason, after: input });
      return r;
    });
  }

  async listApprovals(status?: string) {
    const rows = await this.db.system((tx) =>
      tx.query<Record<string, unknown>>(
        `SELECT ar.*, ru.full_name AS requested_by_name, du.full_name AS decided_by_name, o.display_name AS target_name
           FROM approval_requests ar JOIN users ru ON ru.id = ar.requested_by LEFT JOIN users du ON du.id = ar.decided_by
           LEFT JOIN organizations o ON o.id::text = ar.target_id
          WHERE ($1::text IS NULL OR ar.status = $1) ORDER BY ar.requested_at DESC LIMIT 100`,
        [status ?? null],
      ),
    );
    return rows.map(toCamel);
  }

  async decideApproval(a: AuthContext, id: string, decision: 'approved' | 'rejected', note: string, meta: ClientMeta) {
    await this.db.system(async (tx) => {
      const ar = await tx.maybeOne<{ id: string; action: string; target_id: string; payload: Record<string, unknown>; status: string; requested_by: string }>(
        'SELECT * FROM approval_requests WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!ar) throw Errors.notFound('Approval request');
      if (ar.status !== 'pending') throw Errors.invalidState('Already decided');
      if (ar.requested_by === a.userId) throw Errors.forbidden('Four-eyes principle: you cannot approve your own request');
      await tx.query(`UPDATE approval_requests SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1`, [id, decision, a.userId, note]);
      if (decision === 'approved') {
        if (ar.action === 'org.fee.update') {
          const before = await tx.one<{ vitpay_fee_bps: number }>('SELECT vitpay_fee_bps FROM organizations WHERE id = $1 FOR UPDATE', [ar.target_id]);
          if (before.vitpay_fee_bps !== Number(ar.payload.expectedCurrentBps)) {
            throw Errors.invalidState('The fee changed since this request was made; create a new request');
          }
          await tx.query('UPDATE organizations SET vitpay_fee_bps = $2, updated_at = now() WHERE id = $1', [ar.target_id, Number(ar.payload.vitpayFeeBps)]);
          await this.audit.record(tx, { actor: this.actor(a, meta), orgId: ar.target_id, action: 'admin.org.fee_updated', targetType: 'organization', targetId: ar.target_id, before, after: ar.payload, metadata: { approvalId: id } });
        } else if (ar.action === 'org.reactivate') {
          const before = await tx.one<{ status: string }>('SELECT status FROM organizations WHERE id = $1 FOR UPDATE', [ar.target_id]);
          if (before.status !== 'suspended') throw Errors.invalidState('Organization is not suspended');
          await tx.query(`UPDATE organizations SET status = 'active', updated_at = now() WHERE id = $1`, [ar.target_id]);
          await this.audit.record(tx, { actor: this.actor(a, meta), orgId: ar.target_id, action: 'admin.org.reactivated', targetType: 'organization', targetId: ar.target_id, before, after: { status: 'active' }, metadata: { approvalId: id } });
        }
      }
      await this.audit.record(tx, { actor: this.actor(a, meta), orgId: ar.target_id, action: `admin.approval.${decision}`, targetType: 'approval_request', targetId: id, reason: note });
    });
  }

  // ── Transactions, audit, incidents, webhooks ──

  async payments(f: { q?: string; status?: string; orgId?: string }) {
    const rows = await this.db.system((tx) =>
      tx.query<Record<string, unknown> & { amount_minor: string; currency: 'MAD' }>(
        `SELECT a.id, a.status, a.amount_minor, a.currency, a.provider_code, a.provider_ref, a.settlement_status, a.created_at, a.succeeded_at,
                pr.reference, pr.mode, o.display_name AS org_name, o.id AS org_id
           FROM payment_attempts a JOIN payment_requests pr ON pr.id = a.payment_request_id JOIN organizations o ON o.id = a.org_id
          WHERE ($1::text IS NULL OR pr.reference = $1 OR a.provider_ref = $1 OR a.id::text = $1)
            AND ($2::text IS NULL OR a.status = $2)
            AND ($3::uuid IS NULL OR a.org_id = $3)
          ORDER BY a.created_at DESC LIMIT 200`,
        [f.q ?? null, f.status ?? null, f.orgId ?? null],
      ),
    );
    return rows.map((r) => ({ ...toCamel(r), amount: money(r.amount_minor, r.currency) }));
  }

  async auditLog(a: AuthContext, f: { orgId?: string; action?: string; before?: string }) {
    const rows = await this.db.system((tx) =>
      tx.query<Record<string, unknown>>(
        `SELECT l.id, l.occurred_at, l.actor_type, l.actor_user_id, u.full_name AS actor_name, l.org_id, l.action, l.target_type, l.target_id,
                l.reason, l.ip, l.before, l.after, l.metadata, encode(l.hash, 'hex') AS hash
           FROM audit_log l LEFT JOIN users u ON u.id = l.actor_user_id
          WHERE ($1::uuid IS NULL OR l.org_id = $1) AND ($2::text IS NULL OR l.action LIKE $2 || '%') AND ($3::bigint IS NULL OR l.id < $3)
          ORDER BY l.id DESC LIMIT 200`,
        [f.orgId ?? null, f.action ?? null, f.before ?? null],
      ),
    );
    // Les valeurs avant/après peuvent contenir des données personnelles : masquées sans `orgs:read_pii` (revue R7).
    const pii = this.can(a, 'orgs:read_pii');
    return rows.map((r) => toCamel(pii ? r : { ...r, before: r.before ? '[masqué]' : null, after: r.after ? '[masqué]' : null, ip: mask(r.ip) }));
  }

  verifyAudit() {
    return this.audit.verifyChain();
  }

  async incidents(status?: string) {
    const rows = await this.db.system((tx) =>
      tx.query<Record<string, unknown>>(
        `SELECT i.*, o.display_name AS org_name FROM incidents i LEFT JOIN organizations o ON o.id = i.org_id
          WHERE ($1::text IS NULL OR i.status = $1) ORDER BY i.created_at DESC LIMIT 200`,
        [status ?? null],
      ),
    );
    return rows.map(toCamel);
  }

  async resolveIncident(a: AuthContext, id: string, note: string, meta: ClientMeta) {
    await this.db.system(async (tx) => {
      const i = await tx.maybeOne<{ status: string; org_id: string | null }>('SELECT status, org_id FROM incidents WHERE id = $1 FOR UPDATE', [id]);
      if (!i) throw Errors.notFound('Incident');
      if (i.status === 'resolved') throw Errors.invalidState('Already resolved');
      await tx.query(`UPDATE incidents SET status = 'resolved', resolved_at = now(), resolved_by = $2, resolution_note = $3 WHERE id = $1`, [id, a.userId, note]);
      await this.audit.record(tx, { actor: this.actor(a, meta), orgId: i.org_id, action: 'admin.incident.resolved', targetType: 'incident', targetId: id, reason: note });
    });
  }

  async listWebhooks(status?: string) {
    const rows = await this.db.system((tx) =>
      tx.query<Record<string, unknown>>(
        `SELECT id, provider_code, provider_account_id, org_id, provider_event_id, event_type, object_ref, signature_valid, status, attempts, error, received_at, processed_at
           FROM webhook_inbox WHERE ($1::text IS NULL OR status = $1) ORDER BY received_at DESC LIMIT 200`,
        [status ?? null],
      ),
    );
    return rows.map(toCamel);
  }

  async replayWebhook(a: AuthContext, id: string, meta: ClientMeta) {
    await this.db.system(async (tx) => {
      const r = await tx.maybeOne<{ org_id: string | null; signature_valid: boolean }>('SELECT org_id, signature_valid FROM webhook_inbox WHERE id = $1', [id]);
      if (!r) throw Errors.notFound('Webhook');
      if (!r.signature_valid) throw Errors.invalidState('Rejected webhooks cannot be replayed');
      await tx.query(`UPDATE webhook_inbox SET status = 'received' WHERE id = $1 AND status <> 'processed'`, [id]);
      await this.audit.record(tx, { actor: this.actor(a, meta), orgId: r.org_id, action: 'admin.webhook.replayed', targetType: 'webhook', targetId: id });
    });
    await this.webhooks.process(id).catch(() => undefined);
  }

  async providerAccounts() {
    const rows = await this.db.system((tx) =>
      tx.query<Record<string, unknown>>(
        `SELECT pa.id, pa.org_id, o.display_name AS org_name, pa.provider_code, pa.mode, pa.status, pa.created_at
           FROM provider_accounts pa JOIN organizations o ON o.id = pa.org_id ORDER BY pa.created_at DESC LIMIT 500`,
      ),
    );
    return rows.map(toCamel);
  }

  runReconciliation(a: AuthContext, accountId: string, date: string, meta: ClientMeta) {
    return this.reconciliation.run(accountId, date, this.actor(a, meta));
  }

  async reconciliationRuns() {
    const rows = await this.db.system((tx) =>
      tx.query<Record<string, unknown>>(
        `SELECT r.*, o.display_name AS org_name FROM reconciliation_runs r JOIN organizations o ON o.id = r.org_id ORDER BY r.created_at DESC LIMIT 100`,
      ),
    );
    return rows.map(toCamel);
  }
}
