import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config';
import { hmacSha256Hex, randomToken, sha256Hex } from '../../common/crypto';
import { Errors } from '../../common/errors';
import { Db, Tx } from '../../database/db.service';

/**
 * PRESTATAIRE SIMULÉ — sandbox uniquement (interdit en production par la configuration).
 *
 * Il se comporte comme un prestataire externe : API authentifiée par clé, page de paiement
 * hébergée, webhooks signés HMAC envoyés en HTTP, rapport de règlement. Il ne traite AUCUNE
 * donnée de carte : la page propose uniquement des boutons de scénario.
 */

export interface MockPayment {
  id: string;
  merchant_id: string;
  external_ref: string;
  amount_minor: string;
  currency: string;
  description: string | null;
  return_url: string;
  status: string;
  fee_minor: string;
  failure_code: string | null;
  created_at: Date;
  succeeded_at: Date | null;
}

interface Hook {
  url: string;
  secret: string;
  body: string;
}

/** `pending` : le payeur a validé, la banque n'a pas encore répondu (résolution ultérieure, voir resolvePayment). */
export type CheckoutAction = 'succeed' | 'decline' | 'challenge' | 'cancel' | 'pending';

@Injectable()
export class MockPspService {
  private readonly logger = new Logger('MockPSP');
  private readonly inflight = new Set<Promise<void>>();

  constructor(
    private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private assertEnabled(): void {
    if (!this.config.MOCK_PSP_ENABLED) throw Errors.notFound('Resource');
  }

  /**
   * [R7-1] Anti-SSRF : hors poste local, le prestataire simulé ne notifie QUE l'endpoint de
   * webhooks de VITPAY (jamais une adresse arbitraire fournie par un tiers).
   */
  private assertAllowedWebhookUrl(url: string): void {
    if (this.config.appEnv === 'local') return;
    const base = this.config.MOCK_PSP_INTERNAL_URL ?? this.config.PUBLIC_API_URL;
    const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/webhooks/providers/mock/[0-9a-f-]{36}$`, 'i');
    if (!re.test(url)) throw Errors.validation({ webhookUrl: 'Outside local, the mock PSP only notifies the VITPAY provider webhook endpoint' });
  }

  async createMerchant(webhookUrl: string): Promise<{ merchantId: string; apiKey: string; webhookSecret: string }> {
    this.assertEnabled();
    this.assertAllowedWebhookUrl(webhookUrl);
    const merchantId = `mch_${randomToken(9)}`;
    const apiKey = `sk_test_${randomToken(24)}`;
    const webhookSecret = `whsec_${randomToken(24)}`;
    await this.db.system((tx) =>
      tx.query(`INSERT INTO mock_psp.merchants (id, api_key_hash, webhook_secret, webhook_url) VALUES ($1,$2,$3,$4)`, [
        merchantId,
        sha256Hex(apiKey),
        webhookSecret,
        webhookUrl,
      ]),
    );
    return { merchantId, apiKey, webhookSecret };
  }

  async authenticate(authHeader: string | undefined): Promise<string> {
    this.assertEnabled();
    const key = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!key) throw Errors.unauthorized('Missing API key');
    const row = await this.db.system((tx) =>
      tx.maybeOne<{ id: string }>('SELECT id FROM mock_psp.merchants WHERE api_key_hash = $1', [sha256Hex(key)]),
    );
    if (!row) throw Errors.unauthorized('Invalid API key');
    return row.id;
  }

  async createPayment(
    merchantId: string,
    input: { externalRef: string; amountMinor: string; currency: string; description?: string; returnUrl: string },
  ): Promise<MockPayment> {
    return this.db.system(async (tx) => {
      const existing = await tx.maybeOne<MockPayment>(
        'SELECT * FROM mock_psp.payments WHERE merchant_id = $1 AND external_ref = $2',
        [merchantId, input.externalRef],
      );
      if (existing) return existing; // idempotence côté prestataire
      const merchant = await tx.one<{ fee_bps: number }>('SELECT fee_bps FROM mock_psp.merchants WHERE id = $1', [merchantId]);
      const amount = BigInt(input.amountMinor);
      const fee = (amount * BigInt(merchant.fee_bps) + 5000n) / 10000n;
      return tx.one<MockPayment>(
        `INSERT INTO mock_psp.payments (id, merchant_id, external_ref, amount_minor, currency, description, return_url, status, fee_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8) RETURNING *`,
        [
          `pay_${randomToken(12)}`,
          merchantId,
          input.externalRef,
          amount.toString(),
          input.currency,
          input.description ?? null,
          input.returnUrl,
          fee.toString(),
        ],
      );
    });
  }

  async getPayment(merchantId: string | null, id: string): Promise<MockPayment> {
    const row = await this.db.system((tx) =>
      tx.maybeOne<MockPayment>(
        merchantId ? 'SELECT * FROM mock_psp.payments WHERE id = $1 AND merchant_id = $2' : 'SELECT * FROM mock_psp.payments WHERE id = $1',
        merchantId ? [id, merchantId] : [id],
      ),
    );
    if (!row) throw Errors.notFound('Payment');
    return row;
  }

  checkoutUrl(paymentId: string): string {
    return `${this.config.PUBLIC_API_URL}/mock-psp/checkout/${paymentId}`;
  }

  /** Action du payeur sur la page hébergée. Retourne l'URL de redirection. */
  async checkoutAction(paymentId: string, action: CheckoutAction): Promise<string> {
    this.assertEnabled();
    const hooks: Hook[] = [];
    const payment = await this.db.system(async (tx) => {
      const p = await tx.maybeOne<MockPayment>('SELECT * FROM mock_psp.payments WHERE id = $1 FOR UPDATE', [paymentId]);
      if (!p) throw Errors.notFound('Payment');
      if (!['pending', 'requires_action'].includes(p.status)) return p;
      const next =
        action === 'succeed'
          ? 'succeeded'
          : action === 'decline'
            ? 'failed'
            : action === 'challenge'
              ? 'requires_action'
              : action === 'pending'
                ? 'processing'
                : 'cancelled';
      const updated = await tx.one<MockPayment>(
        `UPDATE mock_psp.payments SET status = $2, failure_code = $3, updated_at = now(),
           succeeded_at = CASE WHEN $2 = 'succeeded' THEN now() ELSE succeeded_at END
         WHERE id = $1 RETURNING *`,
        [paymentId, next, action === 'decline' ? 'card_declined' : null],
      );
      await this.queueWebhook(tx, hooks, p.merchant_id, 'payment.updated', paymentId);
      return updated;
    });
    this.dispatch(hooks);
    if (payment.status === 'requires_action') return `${this.checkoutUrl(paymentId)}?step=3ds`;
    const sep = payment.return_url.includes('?') ? '&' : '?';
    return `${payment.return_url}${sep}psp_status=${encodeURIComponent(payment.status)}`;
  }

  /**
   * Résolution ultérieure d'un paiement en traitement (réponse différée de la banque, simulée).
   * Le prestataire notifie VITPAY par webhook ; VITPAY relit ensuite le statut côté serveur.
   */
  async resolvePayment(paymentId: string, outcome: 'succeeded' | 'failed'): Promise<{ status: string }> {
    this.assertEnabled();
    const hooks: Hook[] = [];
    const updated = await this.db.system(async (tx) => {
      const p = await tx.maybeOne<MockPayment>('SELECT * FROM mock_psp.payments WHERE id = $1 FOR UPDATE', [paymentId]);
      if (!p) throw Errors.notFound('Payment');
      if (p.status !== 'processing') throw Errors.invalidState(`Payment is ${p.status}, not processing`);
      const u = await tx.one<MockPayment>(
        `UPDATE mock_psp.payments SET status = $2, failure_code = $3, updated_at = now(),
           succeeded_at = CASE WHEN $2 = 'succeeded' THEN now() ELSE succeeded_at END
         WHERE id = $1 RETURNING *`,
        [paymentId, outcome, outcome === 'failed' ? 'issuer_declined' : null],
      );
      await this.queueWebhook(tx, hooks, p.merchant_id, 'payment.updated', paymentId);
      return u;
    });
    this.dispatch(hooks);
    return { status: updated.status };
  }

  async refund(merchantId: string, paymentId: string, input: { externalRef: string; amountMinor: string }) {
    const hooks: Hook[] = [];
    const result = await this.db.system(async (tx) => {
      const p = await tx.maybeOne<MockPayment>('SELECT * FROM mock_psp.payments WHERE id = $1 AND merchant_id = $2 FOR UPDATE', [
        paymentId,
        merchantId,
      ]);
      if (!p) throw Errors.notFound('Payment');
      const existing = await tx.maybeOne<{ id: string; external_ref: string; status: string; amount_minor: string }>(
        'SELECT id, external_ref, status, amount_minor FROM mock_psp.refunds WHERE payment_id = $1 AND external_ref = $2',
        [paymentId, input.externalRef],
      );
      if (existing) return existing;
      if (p.status !== 'succeeded') throw Errors.invalidState('Payment not refundable');
      const refunded = await tx.one<{ total: string }>(
        `SELECT COALESCE(SUM(amount_minor),0)::text AS total FROM mock_psp.refunds WHERE payment_id = $1 AND status <> 'failed'`,
        [paymentId],
      );
      const amount = BigInt(input.amountMinor);
      const status = BigInt(refunded.total) + amount > BigInt(p.amount_minor) ? 'failed' : 'succeeded';
      const r = await tx.one<{ id: string; external_ref: string; status: string; amount_minor: string }>(
        `INSERT INTO mock_psp.refunds (id, payment_id, external_ref, amount_minor, status) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, external_ref, status, amount_minor`,
        [`re_${randomToken(12)}`, paymentId, input.externalRef, amount.toString(), status],
      );
      await this.queueWebhook(tx, hooks, merchantId, 'refund.updated', r.id);
      return r;
    });
    this.dispatch(hooks);
    return result;
  }

  async getRefund(merchantId: string, refundId: string) {
    const r = await this.db.system((tx) =>
      tx.maybeOne<{ id: string; external_ref: string; status: string; amount_minor: string; currency: string }>(
        `SELECT r.id, r.external_ref, r.status, r.amount_minor, p.currency FROM mock_psp.refunds r
           JOIN mock_psp.payments p ON p.id = r.payment_id WHERE r.id = $1 AND p.merchant_id = $2`,
        [refundId, merchantId],
      ),
    );
    if (!r) throw Errors.notFound('Refund');
    return r;
  }

  /** Simulation : le porteur conteste le paiement. */
  async openDispute(paymentId: string, reason = 'fraudulent') {
    this.assertEnabled();
    const hooks: Hook[] = [];
    const result = await this.db.system(async (tx) => {
      const p = await tx.one<MockPayment>('SELECT * FROM mock_psp.payments WHERE id = $1', [paymentId]);
      const d = await tx.one<{ id: string }>(
        `INSERT INTO mock_psp.disputes (id, payment_id, amount_minor, status, reason) VALUES ($1,$2,$3,'opened',$4) RETURNING id`,
        [`dp_${randomToken(12)}`, paymentId, p.amount_minor, reason],
      );
      await this.queueWebhook(tx, hooks, p.merchant_id, 'dispute.updated', d.id);
      return d;
    });
    this.dispatch(hooks);
    return result;
  }

  async resolveDispute(disputeId: string, outcome: 'won' | 'lost') {
    this.assertEnabled();
    const hooks: Hook[] = [];
    await this.db.system(async (tx) => {
      const d = await tx.one<{ payment_id: string }>(
        `UPDATE mock_psp.disputes SET status = $2 WHERE id = $1 RETURNING payment_id`,
        [disputeId, outcome],
      );
      const p = await tx.one<{ merchant_id: string }>('SELECT merchant_id FROM mock_psp.payments WHERE id = $1', [d.payment_id]);
      await this.queueWebhook(tx, hooks, p.merchant_id, 'dispute.updated', disputeId);
    });
    this.dispatch(hooks);
  }

  async getDispute(merchantId: string, disputeId: string) {
    const d = await this.db.system((tx) =>
      tx.maybeOne<{ id: string; payment_id: string; amount_minor: string; currency: string; status: string; reason: string | null }>(
        `SELECT d.id, d.payment_id, d.amount_minor, p.currency, d.status, d.reason FROM mock_psp.disputes d
           JOIN mock_psp.payments p ON p.id = d.payment_id WHERE d.id = $1 AND p.merchant_id = $2`,
        [disputeId, merchantId],
      ),
    );
    if (!d) throw Errors.notFound('Dispute');
    return d;
  }

  /** Rapport de règlement J (UTC) : paiements réussis du jour, reversement net groupé. */
  async settlementReport(merchantId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Errors.badRequest('invalid_date', 'date must be YYYY-MM-DD');
    const rows = await this.db.system((tx) =>
      tx.query<{ id: string; amount_minor: string; fee_minor: string; currency: string; refunded: string }>(
        `SELECT p.id, p.amount_minor, p.fee_minor, p.currency,
                COALESCE((SELECT SUM(r.amount_minor) FROM mock_psp.refunds r WHERE r.payment_id = p.id AND r.status = 'succeeded'),0)::text AS refunded
           FROM mock_psp.payments p
          WHERE p.merchant_id = $1 AND p.status = 'succeeded'
            AND p.succeeded_at >= $2::date AND p.succeeded_at < ($2::date + 1)
          ORDER BY p.id`,
        [merchantId, date],
      ),
    );
    const payoutRef = `po_${merchantId}_${date.replaceAll('-', '')}`;
    const lines = rows.map((r) => {
      const gross = BigInt(r.amount_minor);
      const fee = BigInt(r.fee_minor);
      return {
        paymentRef: r.id,
        currency: r.currency,
        grossMinor: gross.toString(),
        feeMinor: fee.toString(),
        netMinor: (gross - fee).toString(),
        payoutRef,
      };
    });
    const byCurrency = new Map<string, bigint>();
    for (const l of lines) byCurrency.set(l.currency, (byCurrency.get(l.currency) ?? 0n) + BigInt(l.netMinor));
    return {
      date,
      lines,
      payouts: [...byCurrency].map(([currency, total]) => ({ payoutRef, currency, amountMinor: total.toString(), status: 'paid_out' })),
    };
  }

  // --- Webhooks sortants ---

  private async queueWebhook(tx: Tx, hooks: Hook[], merchantId: string, type: string, objectId: string): Promise<void> {
    const m = await tx.one<{ webhook_url: string; webhook_secret: string }>(
      'SELECT webhook_url, webhook_secret FROM mock_psp.merchants WHERE id = $1',
      [merchantId],
    );
    const body = JSON.stringify({ id: `evt_${randomToken(12)}`, type, created: new Date().toISOString(), data: { object_id: objectId } });
    hooks.push({ url: m.webhook_url, secret: m.webhook_secret, body });
  }

  /** Envoi APRÈS validation de la transaction, de façon asynchrone (comme un vrai prestataire). */
  private dispatch(hooks: Hook[]): void {
    for (const h of hooks) {
      const p = this.deliver(h.url, h.secret, h.body);
      this.inflight.add(p);
      void p.finally(() => this.inflight.delete(p));
    }
  }

  private async deliver(url: string, secret: string, body: string, attempt = 1): Promise<void> {
    try {
      this.assertAllowedWebhookUrl(url); // revérifié à l'envoi (lignes créées avant la règle)
    } catch {
      this.logger.warn({ msg: 'mock webhook to a non-VITPAY URL refused' });
      return;
    }
    const ts = Math.floor(Date.now() / 1000).toString();
    const signature = `t=${ts},v1=${hmacSha256Hex(secret, `${ts}.${body}`)}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-mockpsp-signature': signature },
        body,
      });
      if (!res.ok && attempt < 3) return this.deliver(url, secret, body, attempt + 1);
    } catch (e) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 200 * attempt));
        return this.deliver(url, secret, body, attempt + 1);
      }
      this.logger.warn({ msg: 'webhook delivery failed', url, err: (e as Error).message });
    }
  }

  /** Tests : attend la livraison de tous les webhooks en cours. */
  async drain(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }
}
