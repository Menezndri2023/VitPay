import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Currency, isCurrency, Money } from '@vitpay/money';
import { APP_CONFIG, AppConfig } from '../../config';
import { randomToken } from '../../common/crypto';
import { AppError, Errors } from '../../common/errors';
import { Db, isUniqueViolation, Tx } from '../../database/db.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { paymentSucceededEntry } from '../ledger/posting-rules';
import { LedgerService } from '../ledger/ledger.service';
import { IncidentsService } from '../platform/incidents.service';
import { OutboxService } from '../platform/outbox.service';
import { ProviderAccountRow, ProviderRegistry } from '../providers/provider-registry';
import { PaymentMethod, ProviderMode, ProviderPayment } from '../providers/provider.interface';
import {
  ACTIVE_ATTEMPT_STATUSES,
  deriveDisplayStatus,
  PaymentAttemptMachine,
  PaymentAttemptStatus,
  PaymentRequestMachine,
  PaymentRequestStatus,
} from './state-machines';

export interface PaymentRequestRow {
  id: string;
  org_id: string;
  merchant_reference?: string | null;
  pos_id: string | null;
  created_by: string;
  reference: string;
  public_token: string;
  amount_minor: string;
  currency: Currency;
  description: string | null;
  customer_name: string | null;
  customer_contact: string | null;
  mode: ProviderMode;
  status: PaymentRequestStatus;
  expires_at: Date;
  paid_at: Date | null;
  cancelled_at: Date | null;
  version: number;
  created_at: Date;
}

export interface PaymentAttemptRow {
  id: string;
  org_id: string;
  payment_request_id: string;
  provider_account_id: string;
  provider_code: string;
  provider_ref: string | null;
  method: PaymentMethod;
  status: PaymentAttemptStatus;
  amount_minor: string;
  currency: Currency;
  provider_fee_minor: string | null;
  vitpay_fee_minor: string | null;
  vitpay_fee_waived_minor?: string;
  checkout_url: string | null;
  failure_code: string | null;
  failure_message: string | null;
  settlement_status: 'unsettled' | 'settled';
  settled_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  succeeded_at: Date | null;
}

const MAX_TTL_HOURS = 24 * 30;
/** Au-delà, une demande échue peut expirer même si une tentative reste ouverte chez le prestataire (un succès tardif sera tracé). */
export const ATTEMPT_ABANDON_MINUTES = 30;

export function money(minor: string | bigint, currency: Currency) {
  const m = Money.of(minor, currency);
  return { minor: m.minor.toString(), value: m.toMajorString(), currency };
}

function newReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans caractères ambigus
  const bytes = randomBytes(8);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `VP-${s}`;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly incidents: IncidentsService,
    private readonly providers: ProviderRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async merchantRefOf(tx: Tx, requestId: string): Promise<string | null> {
    const r = await tx.maybeOne<{ merchant_reference: string | null }>('SELECT merchant_reference FROM payment_requests WHERE id = $1', [requestId]);
    return r?.merchant_reference ?? null;
  }

  payUrl(token: string): string {
    return `${this.config.PAY_BASE_URL}/r/${token}`;
  }

  // ───────────────────────────── Demandes de paiement ─────────────────────────────

  async createRequest(
    orgId: string,
    actor: { userId: string; ip: string | null; userAgent: string | null; apiKeyId?: string | null },
    input: { amount: string; currency: string; merchantReference?: string; description?: string; customerName?: string; customerContact?: string; expiresInHours?: number; posId?: string },
  ) {
    if (!isCurrency(input.currency)) throw Errors.validation({ currency: 'Unsupported currency' });
    let amount: Money;
    try {
      amount = Money.fromMajor(input.amount, input.currency);
    } catch (e) {
      throw Errors.validation({ amount: (e as Error).message });
    }
    if (!amount.isPositive()) throw Errors.validation({ amount: 'Amount must be positive' });
    const ttl = Math.min(input.expiresInHours ?? this.config.PAYMENT_REQUEST_DEFAULT_TTL_HOURS, MAX_TTL_HOURS);

    try {
      return await this.createRequestTx(orgId, actor, input, amount, ttl);
    } catch (e) {
      // Deux créations simultanées avec la même référence : l'index unique tranche.
      if (isUniqueViolation(e, 'payment_requests_merchant_ref_uq')) {
        throw Errors.conflict('merchant_reference_exists', 'A payment request already exists for this order reference');
      }
      throw e;
    }
  }

  private async createRequestTx(
    orgId: string,
    actor: { userId: string; ip: string | null; userAgent: string | null; apiKeyId?: string | null },
    input: { merchantReference?: string; description?: string; customerName?: string; customerContact?: string; posId?: string },
    amount: Money,
    ttl: number,
  ) {
    return this.db.forOrg(orgId, async (tx) => {
      const cur = await tx.maybeOne<{ enabled: boolean }>('SELECT enabled FROM currencies WHERE code = $1', [amount.currency]);
      if (!cur?.enabled) throw Errors.validation({ currency: `${amount.currency} is not enabled on VITPAY yet` });
      const org = await tx.one<{ status: string }>('SELECT status FROM organizations WHERE id = $1', [orgId]);
      if (org.status !== 'active') throw Errors.forbidden('Organization is not active');
      if (input.posId) {
        const pos = await tx.maybeOne("SELECT 1 FROM points_of_sale WHERE id = $1 AND status = 'active'", [input.posId]);
        if (!pos) throw Errors.validation({ posId: 'Unknown point of sale' });
      }
      const mode = await this.resolveMode(tx, amount.currency);
      // [P5] Une commande = une demande : référence unique par organisation (index unique en base).
      if (input.merchantReference) {
        const dup = await tx.maybeOne<{ id: string; status: string }>('SELECT id, status FROM payment_requests WHERE merchant_reference = $1', [input.merchantReference]);
        if (dup) throw Errors.conflict('merchant_reference_exists', 'A payment request already exists for this order reference', { requestId: dup.id, status: dup.status });
      }
      const row = await tx.one<PaymentRequestRow>(
        `INSERT INTO payment_requests (org_id, pos_id, created_by, reference, public_token, amount_minor, currency, description,
            customer_name, customer_contact, mode, status, expires_at, merchant_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open', now() + make_interval(hours => $12), $13) RETURNING *`,
        [
          orgId,
          input.posId ?? null,
          actor.userId,
          newReference(),
          randomToken(16),
          amount.minor.toString(),
          amount.currency,
          input.description ?? null,
          input.customerName ?? null,
          input.customerContact ?? null,
          mode,
          ttl,
          input.merchantReference ?? null,
        ],
      );
      await this.audit.record(tx, {
        actor: { type: actor.apiKeyId ? 'api_key' : 'user', ...actor },
        orgId,
        action: 'payment_request.created',
        targetType: 'payment_request',
        targetId: row.id,
        after: { reference: row.reference, merchantReference: row.merchant_reference ?? null, amount: amount.toJSON(), mode },
      });
      await this.outbox.publish(tx, {
        eventType: 'payment_request.created',
        aggregateType: 'payment_request',
        aggregateId: row.id,
        orgId,
        payload: { reference: row.reference, merchantReference: row.merchant_reference ?? null },
      });
      return this.requestView(row);
    });
  }

  /** sandbox, sauf si le mode live est autorisé ET qu'un compte live actif existe. */
  private async resolveMode(tx: Tx, currency: Currency): Promise<ProviderMode> {
    const accounts = await tx.query<ProviderAccountRow>("SELECT * FROM provider_accounts WHERE status = 'active' ORDER BY priority");
    const usable = (mode: ProviderMode) =>
      accounts.some((a) => {
        if (a.mode !== mode) return false;
        try {
          return this.providers.get(a.provider_code).capabilities().currencies.includes(currency);
        } catch {
          return false;
        }
      });
    if (this.config.PAYMENTS_LIVE_ENABLED && this.config.appEnv === 'production' && usable('live')) return 'live';
    if (usable('sandbox')) return 'sandbox';
    throw Errors.invalidState('No active payment provider account supports this currency. Connect a provider first.', { currency });
  }

  requestView(r: PaymentRequestRow) {
    return {
      id: r.id,
      reference: r.reference,
      merchantReference: r.merchant_reference ?? null,
      amount: money(r.amount_minor, r.currency),
      description: r.description,
      customerName: r.customer_name,
      customerContact: r.customer_contact,
      mode: r.mode,
      status: r.status,
      posId: r.pos_id,
      expiresAt: r.expires_at.toISOString(),
      paidAt: r.paid_at?.toISOString() ?? null,
      cancelledAt: r.cancelled_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      payUrl: this.payUrl(r.public_token),
    };
  }

  attemptView(a: PaymentAttemptRow) {
    return {
      id: a.id,
      providerCode: a.provider_code,
      providerRef: a.provider_ref,
      method: a.method,
      status: a.status,
      amount: money(a.amount_minor, a.currency),
      providerFee: a.provider_fee_minor === null ? null : money(a.provider_fee_minor, a.currency),
      vitpayFee: a.vitpay_fee_minor === null ? null : money(a.vitpay_fee_minor, a.currency),
      vitpayFeeWaived: money(a.vitpay_fee_waived_minor ?? '0', a.currency),
      failureCode: a.failure_code,
      settlementStatus: a.settlement_status,
      settledAt: a.settled_at?.toISOString() ?? null,
      createdAt: a.created_at.toISOString(),
      succeededAt: a.succeeded_at?.toISOString() ?? null,
    };
  }

  async listRequests(orgId: string, f: { status?: PaymentRequestStatus; q?: string; before?: string; limit?: number; posId?: string; merchantReference?: string }) {
    const limit = Math.min(Math.max(f.limit ?? 25, 1), 100);
    const rows = await this.db.forOrg(orgId, (tx) =>
      tx.query<PaymentRequestRow>(
        `SELECT * FROM payment_requests
          WHERE ($1::text IS NULL OR status = $1)
            AND ($2::text IS NULL OR reference ILIKE '%' || $2 || '%' OR merchant_reference ILIKE '%' || $2 || '%' OR description ILIKE '%' || $2 || '%' OR customer_name ILIKE '%' || $2 || '%')
            AND ($3::timestamptz IS NULL OR created_at < $3)
            AND ($5::uuid IS NULL OR pos_id = $5)
            AND ($6::text IS NULL OR merchant_reference = $6)
          ORDER BY created_at DESC LIMIT $4`,
        [f.status ?? null, f.q ?? null, f.before ?? null, limit + 1, f.posId ?? null, f.merchantReference ?? null],
      ),
    );
    const page = rows.slice(0, limit);
    return {
      data: page.map((r) => this.requestView(r)),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.created_at.toISOString() ?? null) : null,
    };
  }

  async getRequest(orgId: string, id: string) {
    return this.db.forOrg(orgId, async (tx) => {
      const r = await tx.maybeOne<PaymentRequestRow>('SELECT * FROM payment_requests WHERE id = $1', [id]);
      if (!r) throw Errors.notFound('Payment request');
      const attempts = await tx.query<PaymentAttemptRow>('SELECT * FROM payment_attempts WHERE payment_request_id = $1 ORDER BY created_at', [id]);
      const refunds = await tx.query<{ id: string; payment_attempt_id: string; amount_minor: string; currency: Currency; status: string; reason: string; created_at: Date }>(
        `SELECT r.* FROM refunds r JOIN payment_attempts a ON a.id = r.payment_attempt_id WHERE a.payment_request_id = $1 ORDER BY r.created_at`,
        [id],
      );
      const disputes = await tx.query<{ id: string; status: string; amount_minor: string; currency: Currency; reason: string | null; created_at: Date }>(
        `SELECT d.* FROM disputes d JOIN payment_attempts a ON a.id = d.payment_attempt_id WHERE a.payment_request_id = $1`,
        [id],
      );
      const receipt = await tx.maybeOne<{ number: string; payment_attempt_id: string }>(
        `SELECT rc.number, rc.payment_attempt_id FROM receipts rc JOIN payment_attempts a ON a.id = rc.payment_attempt_id
          WHERE a.payment_request_id = $1 ORDER BY rc.issued_at LIMIT 1`,
        [id],
      );
      const succeeded = attempts.filter((a) => a.status === 'succeeded');
      const paid = succeeded.reduce((s, a) => s + BigInt(a.amount_minor), 0n);
      const refunded = refunds.filter((x) => x.status === 'succeeded').reduce((s, x) => s + BigInt(x.amount_minor), 0n);
      return {
        ...this.requestView(r),
        displayStatus: deriveDisplayStatus({
          status: r.status,
          paidAmountMinor: paid,
          refundedMinor: refunded,
          openDispute: disputes.some((d) => d.status === 'opened' || d.status === 'evidence_submitted'),
        }),
        attempts: attempts.map((a) => this.attemptView(a)),
        refunds: refunds.map((x) => ({ id: x.id, attemptId: x.payment_attempt_id, amount: money(x.amount_minor, x.currency), status: x.status, reason: x.reason, createdAt: x.created_at.toISOString() })),
        disputes: disputes.map((d) => ({ id: d.id, status: d.status, amount: money(d.amount_minor, d.currency), reason: d.reason, createdAt: d.created_at.toISOString() })),
        receipt: receipt ? { number: receipt.number, attemptId: receipt.payment_attempt_id } : null,
        events: await this.eventsFor(tx, r.id, attempts.map((a) => a.id), refunds.map((x) => x.id), disputes.map((d) => d.id)),
      };
    });
  }

  /**
   * [P5] Historique des événements d'une demande (création, tentatives, changements de statut,
   * remboursements, litiges, annulation, commission annulée), tiré du journal d'audit chaîné.
   * Données exposées : action, statut avant/après, acteur (type), date — jamais d'IP ni de navigateur.
   */
  private async eventsFor(tx: Tx, requestId: string, attemptIds: string[], refundIds: string[], disputeIds: string[]) {
    const rows = await tx.query<{ id: string; occurred_at: Date; actor_type: string; action: string; target_type: string; target_id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null }>(
      `SELECT id::text, occurred_at, actor_type, action, target_type, target_id, before, after, reason FROM audit_log
        WHERE (target_type = 'payment_request' AND target_id = $1)
           OR (target_type = 'payment_attempt' AND target_id = ANY($2::text[]))
           OR (target_type = 'refund' AND target_id = ANY($3::text[]))
           OR (target_type = 'dispute' AND target_id = ANY($4::text[]))
        ORDER BY id ASC LIMIT 500`,
      [requestId, attemptIds, refundIds, disputeIds],
    );
    const statusOf = (v: Record<string, unknown> | null) => (v && typeof v.status === 'string' ? v.status : null);
    return rows.map((e) => ({
      id: e.id,
      at: e.occurred_at.toISOString(),
      type: e.action,
      object: { type: e.target_type, id: e.target_id },
      from: statusOf(e.before),
      to: statusOf(e.after),
      actor: e.actor_type,
      reason: e.reason,
    }));
  }

  async getRequestEvents(orgId: string, id: string) {
    return this.db.forOrg(orgId, async (tx) => {
      const r = await tx.maybeOne<{ id: string }>('SELECT id FROM payment_requests WHERE id = $1', [id]);
      if (!r) throw Errors.notFound('Payment request');
      const attempts = await tx.query<{ id: string }>('SELECT id FROM payment_attempts WHERE payment_request_id = $1', [id]);
      const refunds = await tx.query<{ id: string }>('SELECT r.id FROM refunds r JOIN payment_attempts a ON a.id = r.payment_attempt_id WHERE a.payment_request_id = $1', [id]);
      const disputes = await tx.query<{ id: string }>('SELECT d.id FROM disputes d JOIN payment_attempts a ON a.id = d.payment_attempt_id WHERE a.payment_request_id = $1', [id]);
      return { requestId: id, events: await this.eventsFor(tx, id, attempts.map((a) => a.id), refunds.map((x) => x.id), disputes.map((d) => d.id)) };
    });
  }

  async cancelRequest(orgId: string, id: string, actor: { userId: string; ip: string | null; userAgent: string | null; apiKeyId?: string | null }, reason?: string) {
    return this.db.forOrg(orgId, async (tx) => {
      const r = await tx.maybeOne<PaymentRequestRow>('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [id]);
      if (!r) throw Errors.notFound('Payment request');
      if (!PaymentRequestMachine.canTransition(r.status, 'cancelled')) throw Errors.invalidState(`Cannot cancel a ${r.status} request`);
      const active = await tx.maybeOne(`SELECT 1 FROM payment_attempts WHERE payment_request_id = $1 AND status = ANY($2)`, [id, ACTIVE_ATTEMPT_STATUSES]);
      if (active) throw Errors.invalidState('A payment is in progress for this request; it cannot be cancelled now');
      const u = await tx.one<PaymentRequestRow>(
        `UPDATE payment_requests SET status = 'cancelled', cancelled_at = now(), version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`,
        [id],
      );
      await this.audit.record(tx, { actor: { type: actor.apiKeyId ? 'api_key' : 'user', ...actor }, orgId, action: 'payment_request.cancelled', targetType: 'payment_request', targetId: id, reason, before: { status: r.status }, after: { status: 'cancelled' } });
      return this.requestView(u);
    });
  }

  // ───────────────────────────── Parcours payeur (public) ─────────────────────────────

  /** Vue publique : AUCUNE donnée privée du bénéficiaire (ni e-mail, ni téléphone, ni identité légale). */
  async publicView(token: string) {
    const data = await this.db.system(async (tx) => {
      const r = await tx.maybeOne<PaymentRequestRow & { display_name: string; kyb_status: string; org_status: string }>(
        `SELECT pr.*, o.display_name, o.kyb_status, o.status AS org_status FROM payment_requests pr
           JOIN organizations o ON o.id = pr.org_id WHERE pr.public_token = $1`,
        [token],
      );
      if (!r) return null;
      const latest = await tx.maybeOne<PaymentAttemptRow>(
        'SELECT * FROM payment_attempts WHERE payment_request_id = $1 ORDER BY created_at DESC LIMIT 1',
        [r.id],
      );
      const methods = await this.availableMethods(tx, r);
      return { r, latest, methods };
    });
    if (!data) throw Errors.notFound('Payment request');
    const { r, latest, methods } = data;
    const expired = r.status === 'open' && r.expires_at <= new Date();
    return {
      reference: r.reference,
      beneficiary: { displayName: r.display_name, verified: r.kyb_status === 'verified' },
      amount: money(r.amount_minor, r.currency),
      description: r.description,
      status: expired ? 'expired' : r.status,
      payable: r.status === 'open' && !expired && r.org_status === 'active' && methods.length > 0,
      sandbox: r.mode === 'sandbox',
      expiresAt: r.expires_at.toISOString(),
      paidAt: r.paid_at?.toISOString() ?? null,
      methods,
      latestAttempt: latest ? { status: latest.status, failureCode: latest.failure_code } : null,
    };
  }

  private async availableMethods(tx: Tx, r: PaymentRequestRow): Promise<PaymentMethod[]> {
    const accounts = await tx.query<ProviderAccountRow>(
      "SELECT * FROM provider_accounts WHERE org_id = $1 AND status = 'active' AND mode = $2 ORDER BY priority",
      [r.org_id, r.mode],
    );
    const set = new Set<PaymentMethod>();
    for (const a of accounts) {
      try {
        const caps = this.providers.get(a.provider_code).capabilities();
        if (caps.currencies.includes(r.currency)) caps.methods.forEach((m) => set.add(m));
      } catch {
        /* prestataire non chargé dans cet environnement */
      }
    }
    return [...set];
  }

  /** Le payeur choisit un moyen de paiement → redirection vers la page hébergée du prestataire. */
  async startAttempt(token: string, method: PaymentMethod, meta: { ip: string | null; userAgent: string | null }): Promise<{ checkoutUrl: string; attemptId: string }> {
    const prepared = await this.db.system(async (tx) => {
      const r = await tx.maybeOne<PaymentRequestRow & { org_status: string }>(
        `SELECT pr.*, o.status AS org_status FROM payment_requests pr JOIN organizations o ON o.id = pr.org_id
          WHERE pr.public_token = $1 FOR UPDATE OF pr`,
        [token],
      );
      if (!r) throw Errors.notFound('Payment request');
      if (r.org_status !== 'active') throw Errors.invalidState('This beneficiary cannot receive payments at the moment');
      if (r.status !== 'open' || r.expires_at <= new Date()) throw Errors.invalidState('This payment request is no longer payable', { status: r.status });

      const active = await tx.maybeOne<PaymentAttemptRow>(`SELECT * FROM payment_attempts WHERE payment_request_id = $1 AND status = ANY($2)`, [
        r.id,
        ACTIVE_ATTEMPT_STATUSES,
      ]);
      if (active) {
        if (active.checkout_url && active.method === method) return { reuse: active };
        throw Errors.conflict('attempt_in_progress', 'A payment attempt is already in progress for this request');
      }

      const accounts = await tx.query<ProviderAccountRow>(
        "SELECT * FROM provider_accounts WHERE org_id = $1 AND status = 'active' AND mode = $2 ORDER BY priority, created_at",
        [r.org_id, r.mode],
      );
      const account = accounts.find((a) => {
        try {
          const caps = this.providers.get(a.provider_code).capabilities();
          return caps.currencies.includes(r.currency) && caps.methods.includes(method);
        } catch {
          return false;
        }
      });
      if (!account) throw Errors.invalidState('This payment method is not available for this request');

      let attempt: PaymentAttemptRow;
      try {
        attempt = await tx.one<PaymentAttemptRow>(
          `INSERT INTO payment_attempts (org_id, payment_request_id, provider_account_id, provider_code, method, status, amount_minor, currency)
           VALUES ($1,$2,$3,$4,$5,'created',$6,$7) RETURNING *`,
          [r.org_id, r.id, account.id, account.provider_code, method, r.amount_minor, r.currency],
        );
      } catch (e) {
        if (isUniqueViolation(e, 'payment_attempts_one_active_uq')) {
          throw Errors.conflict('attempt_in_progress', 'A payment attempt is already in progress for this request');
        }
        throw e;
      }
      await this.audit.record(tx, {
        actor: { type: 'public', ...meta },
        orgId: r.org_id,
        action: 'payment_attempt.created',
        targetType: 'payment_attempt',
        targetId: attempt.id,
        metadata: { providerCode: account.provider_code, method },
      });
      return { request: r, attempt, account };
    });

    if ('reuse' in prepared && prepared.reuse) return { checkoutUrl: prepared.reuse.checkout_url as string, attemptId: prepared.reuse.id };
    const { request, attempt, account } = prepared as { request: PaymentRequestRow; attempt: PaymentAttemptRow; account: ProviderAccountRow };

    // Appel réseau HORS transaction (aucun verrou base tenu pendant l'appel au prestataire).
    const provider = this.providers.get(account.provider_code);
    try {
      const ctx = this.providers.context(account);
      const session = await provider.createPayment(
        ctx,
        {
          attemptId: attempt.id,
          amount: Money.of(request.amount_minor, request.currency),
          description: request.description ?? request.reference,
          returnUrl: `${this.config.PAY_BASE_URL}/r/${token}/status`,
        },
        `attempt:${attempt.id}`,
      );
      await this.db.forOrg(attempt.org_id, async (tx) => {
        const cur = await tx.one<PaymentAttemptRow>('SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE', [attempt.id]);
        const next = cur.status === 'created' && PaymentAttemptMachine.canTransition('created', session.status) ? session.status : cur.status;
        await tx.query(
          `UPDATE payment_attempts SET provider_ref = $2, checkout_url = $3, status = $4, version = version + 1, updated_at = now() WHERE id = $1`,
          [attempt.id, session.providerRef, session.checkoutUrl, next],
        );
      });
      return { checkoutUrl: session.checkoutUrl, attemptId: attempt.id };
    } catch (e) {
      this.logger.warn({ msg: 'provider createPayment failed', attemptId: attempt.id, err: (e as Error).message });
      await this.db.forOrg(attempt.org_id, (tx) =>
        tx.query(
          `UPDATE payment_attempts SET status = 'failed', failure_code = 'provider_unavailable', failure_message = $2, version = version + 1, updated_at = now()
            WHERE id = $1 AND status = 'created'`,
          [attempt.id, (e as Error).message.slice(0, 500)],
        ),
      );
      if (e instanceof AppError && e.code === 'live_payments_disabled') throw e;
      throw Errors.provider('The payment provider is unavailable. Please try again.');
    }
  }

  /**
   * Statut public. Si une tentative est active, VITPAY interroge le prestataire
   * (serveur à serveur) : c'est la seule source de vérité, jamais le retour navigateur.
   */
  async publicStatus(token: string) {
    const active = await this.db.system((tx) =>
      tx.maybeOne<{ id: string; synced: Date }>(
        `SELECT a.id, COALESCE(a.last_synced_at, a.updated_at) AS synced FROM payment_attempts a JOIN payment_requests r ON r.id = a.payment_request_id
          WHERE r.public_token = $1 AND a.status = ANY($2) AND a.provider_ref IS NOT NULL ORDER BY a.created_at DESC LIMIT 1`,
        [token, ACTIVE_ATTEMPT_STATUSES],
      ),
    );
    // Au plus un appel prestataire toutes les 3 s par demande, quel que soit le nombre de visiteurs.
    if (active && Date.now() - active.synced.getTime() > 3000) {
      await this.syncAttempt(active.id).catch((e) => this.logger.warn({ msg: 'sync failed', err: (e as Error).message }));
    }
    return this.publicView(token);
  }

  // ───────────────────────────── Application des statuts prestataire ─────────────────────────────

  /** Relit l'état chez le prestataire et l'applique. */
  async syncAttempt(attemptId: string): Promise<void> {
    const { attempt, account } = await this.db.system(async (tx) => {
      const attempt = await tx.maybeOne<PaymentAttemptRow>('SELECT * FROM payment_attempts WHERE id = $1', [attemptId]);
      if (!attempt) throw Errors.notFound('Payment attempt');
      return { attempt, account: await this.providers.loadAccount(tx, attempt.provider_account_id) };
    });
    if (!attempt.provider_ref) return;
    const provider = this.providers.get(account.provider_code);
    const payment = await provider.getPayment(this.providers.context(account), attempt.provider_ref);
    await this.applyProviderPayment(account, payment, { type: 'system' });
  }

  /**
   * Cœur de la confirmation. `payment` provient TOUJOURS d'un appel serveur authentifié
   * au prestataire (getPayment), jamais du navigateur ni du seul contenu d'un webhook.
   */
  async applyProviderPayment(account: ProviderAccountRow, payment: ProviderPayment, actor: AuditActor): Promise<void> {
    const orgId = account.org_id;
    await this.db.forOrg(orgId, async (tx) => {
      const attempt = await tx.maybeOne<PaymentAttemptRow>('SELECT * FROM payment_attempts WHERE id = $1 AND provider_account_id = $2 FOR UPDATE', [
        payment.externalRef,
        account.id,
      ]);
      if (!attempt) {
        await this.incidents.open(tx, {
          orgId,
          type: 'provider_state_conflict',
          severity: payment.status === 'succeeded' ? 'critical' : 'medium',
          summary: `Provider payment ${payment.providerRef} references unknown attempt ${payment.externalRef}`,
          details: { providerRef: payment.providerRef, status: payment.status },
          dedupeKey: `unknown_attempt:${account.id}:${payment.providerRef}:${payment.status}`,
        });
        return;
      }
      if (attempt.provider_ref && attempt.provider_ref !== payment.providerRef) {
        await this.incidents.open(tx, {
          orgId,
          type: 'provider_state_conflict',
          severity: 'high',
          summary: `Attempt ${attempt.id} provider ref mismatch`,
          details: { expected: attempt.provider_ref, got: payment.providerRef },
          dedupeKey: `ref_mismatch:${attempt.id}:${payment.providerRef}`,
        });
        return;
      }
      const expected = Money.of(attempt.amount_minor, attempt.currency);
      if (!payment.amount.equals(expected)) {
        await this.incidents.open(tx, {
          orgId,
          type: 'amount_mismatch',
          severity: 'critical',
          summary: `Amount mismatch on attempt ${attempt.id}: expected ${expected.toMajorString()} ${expected.currency}, provider reports ${payment.amount.toMajorString()} ${payment.amount.currency}`,
          details: { attemptId: attempt.id, providerStatus: payment.status },
          dedupeKey: `amount_mismatch:${attempt.id}:${payment.status}`,
        });
        return; // On ne confirme JAMAIS un montant différent.
      }

      const from = attempt.status;
      const to = payment.status;
      if (from === to) {
        await tx.query('UPDATE payment_attempts SET provider_ref = COALESCE(provider_ref, $2), last_synced_at = now() WHERE id = $1', [attempt.id, payment.providerRef]);
        return;
      }
      // Succès tardif (tentative déjà échouée/expirée/annulée) : l'argent a réellement été encaissé
      // par le prestataire. On l'enregistre (ledger, demande payée) ET on ouvre un incident.
      const lateSuccess = to === 'succeeded' && (from === 'failed' || from === 'expired' || from === 'cancelled');
      if (lateSuccess) {
        await this.incidents.open(tx, {
          orgId,
          type: 'provider_state_conflict',
          severity: 'high',
          summary: `Late success on attempt ${attempt.id} (was ${from}); payment recorded, verify with the payer`,
          details: { attemptId: attempt.id, from, providerRef: payment.providerRef },
          dedupeKey: `late_success:${attempt.id}`,
        });
      } else if (!PaymentAttemptMachine.canTransition(from, to)) {
        await this.incidents.open(tx, {
          orgId,
          type: 'provider_state_conflict',
          severity: to === 'succeeded' ? 'critical' : 'medium',
          summary: `Provider reports ${to} for attempt ${attempt.id} currently ${from}`,
          details: { attemptId: attempt.id, from, to, providerRef: payment.providerRef },
          dedupeKey: `conflict:${attempt.id}:${from}:${to}`,
        });
        return;
      }

      const succeeded = to === 'succeeded';
      let vitpayFee: Money | null = null;
      let providerFee: Money | null = null;
      if (succeeded) {
        const org = await tx.one<{ vitpay_fee_bps: number }>('SELECT vitpay_fee_bps FROM organizations WHERE id = $1', [orgId]);
        vitpayFee = expected.percentBps(org.vitpay_fee_bps, 'HALF_UP');
        providerFee = payment.fee ?? Money.zero(expected.currency);
      }
      await tx.query(
        `UPDATE payment_attempts SET status = $2, provider_ref = COALESCE(provider_ref, $3), failure_code = $4,
            provider_fee_minor = COALESCE($5, provider_fee_minor), vitpay_fee_minor = COALESCE($6, vitpay_fee_minor),
            succeeded_at = CASE WHEN $2 = 'succeeded' THEN now() ELSE succeeded_at END,
            version = version + 1, updated_at = now(), last_synced_at = now()
          WHERE id = $1`,
        [attempt.id, to, payment.providerRef, payment.failureCode ?? null, providerFee?.minor.toString() ?? null, vitpayFee?.minor.toString() ?? null],
      );
      await this.audit.record(tx, {
        actor,
        orgId,
        action: 'payment_attempt.status_changed',
        targetType: 'payment_attempt',
        targetId: attempt.id,
        before: { status: from },
        after: { status: to, providerRef: payment.providerRef },
      });

      if (succeeded && vitpayFee && providerFee) {
        await this.ledger.post(tx, paymentSucceededEntry({ orgId, attemptId: attempt.id, amount: expected, providerFee, vitpayFee }));
        await this.markRequestPaid(tx, attempt);
        const n = await tx.one<{ n: string }>("SELECT nextval('receipt_number_seq')::text AS n");
        await tx.query(`INSERT INTO receipts (org_id, payment_attempt_id, number) VALUES ($1,$2,$3) ON CONFLICT (payment_attempt_id) DO NOTHING`, [
          orgId,
          attempt.id,
          `VPR-${new Date().getUTCFullYear()}-${n.n.padStart(7, '0')}`,
        ]);
        await this.outbox.publish(tx, {
          eventType: 'payment.succeeded',
          aggregateType: 'payment_attempt',
          aggregateId: attempt.id,
          orgId,
          payload: { requestId: attempt.payment_request_id, merchantReference: await this.merchantRefOf(tx, attempt.payment_request_id), amount: expected.toJSON() },
        });
      } else if (to === 'failed' || to === 'cancelled' || to === 'expired') {
        await this.outbox.publish(tx, {
          eventType: 'payment.failed',
          aggregateType: 'payment_attempt',
          aggregateId: attempt.id,
          orgId,
          payload: { requestId: attempt.payment_request_id, merchantReference: await this.merchantRefOf(tx, attempt.payment_request_id), status: to, failureCode: payment.failureCode ?? null },
        });
      }
    });
  }

  private async markRequestPaid(tx: Tx, attempt: PaymentAttemptRow): Promise<void> {
    const r = await tx.one<PaymentRequestRow>('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [attempt.payment_request_id]);
    if (r.status === 'paid') {
      // Deux tentatives confirmées pour une même demande : le payeur a payé deux fois.
      await this.incidents.open(tx, {
        orgId: r.org_id,
        type: 'double_payment',
        severity: 'critical',
        summary: `Double payment on request ${r.reference} (attempt ${attempt.id}). Refund the duplicate.`,
        details: { requestId: r.id, attemptId: attempt.id },
        dedupeKey: `double_payment:${attempt.id}`,
      });
      return;
    }
    if (r.status === 'expired' || r.status === 'cancelled') {
      await this.incidents.open(tx, {
        orgId: r.org_id,
        type: 'payment_after_close',
        severity: 'high',
        summary: `Payment confirmed on ${r.status} request ${r.reference}`,
        details: { requestId: r.id, attemptId: attempt.id, previousStatus: r.status },
        dedupeKey: `after_close:${attempt.id}`,
      });
    }
    PaymentRequestMachine.assertTransition(r.status, 'paid');
    await tx.query(`UPDATE payment_requests SET status = 'paid', paid_at = now(), version = version + 1, updated_at = now() WHERE id = $1`, [r.id]);
  }

  // ───────────────────────────── Jobs ─────────────────────────────

  /** Expire les demandes échues sans tentative active. */
  async expireRequests(limit = 100): Promise<number> {
    return this.db.system(async (tx) => {
      const rows = await tx.query<{ id: string; org_id: string }>(
        `UPDATE payment_requests pr SET status = 'expired', version = version + 1, updated_at = now()
          WHERE pr.id IN (
            SELECT id FROM payment_requests p WHERE p.status = 'open' AND p.expires_at <= now()
              AND NOT EXISTS (SELECT 1 FROM payment_attempts a WHERE a.payment_request_id = p.id AND a.status = ANY($2)
                               AND a.created_at > now() - make_interval(mins => $3))
            ORDER BY p.expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)
         RETURNING pr.id, pr.org_id`,
        [limit, ACTIVE_ATTEMPT_STATUSES, ATTEMPT_ABANDON_MINUTES],
      );
      for (const r of rows) {
        await this.audit.record(tx, { actor: { type: 'system' }, orgId: r.org_id, action: 'payment_request.expired', targetType: 'payment_request', targetId: r.id });
      }
      return rows.length;
    });
  }

  /**
   * Resynchronise les tentatives actives (webhook perdu). Aucune expiration locale :
   * seul le prestataire décide qu'une tentative est terminée (revue R1).
   */
  async syncStaleAttempts(limit = 50): Promise<number> {
    const stale = await this.db.system((tx) =>
      tx.query<{ id: string; org_id: string }>(
        `SELECT id, org_id FROM payment_attempts
          WHERE status = ANY($1) AND provider_ref IS NOT NULL
            AND COALESCE(last_synced_at, updated_at) < now() - interval '2 minutes'
          ORDER BY COALESCE(last_synced_at, updated_at) LIMIT $2`,
        [ACTIVE_ATTEMPT_STATUSES, limit],
      ),
    );
    for (const a of stale) {
      try {
        await this.syncAttempt(a.id);
        await this.db.forOrg(a.org_id, (tx) => tx.query('UPDATE payment_attempts SET last_synced_at = now() WHERE id = $1', [a.id]));
      } catch (e) {
        this.logger.warn({ msg: 'stale attempt sync failed', attemptId: a.id, err: (e as Error).message });
      }
    }
    return stale.length;
  }
}
