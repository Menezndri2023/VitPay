import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Agent } from 'undici';
import { APP_CONFIG, AppConfig } from '../../config';
import { decrypt, encrypt, hmacSha256Hex, randomToken, sha256 } from '../../common/crypto';
import { Errors } from '../../common/errors';
import { createSafeAgent, errorCategory, safePost, UnsafeUrlError, validateWebhookUrl } from '../../common/safe-http';
import { Db } from '../../database/db.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { API_KEY_SCOPES } from '../identity/permissions';
import { toCamel } from '../organizations/organizations.service';
import { OutboxEvent, OutboxService } from '../platform/outbox.service';

export const WEBHOOK_EVENTS = ['payment.succeeded', 'payment.failed', 'refund.succeeded', 'refund.failed', 'dispute.opened', 'dispute.won', 'dispute.lost'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const MAX_DELIVERY_ATTEMPTS = 10;
/** Endpoint désactivé automatiquement après ce nombre d'échecs consécutifs. */
const AUTO_DISABLE_AFTER = 50;
const DELIVERY_CONCURRENCY = 10;
const LEASE_SECONDS = 60;
const KEY_PREFIX = 'vp_sk_';

export interface ResolvedApiKey {
  keyId: string;
  orgId: string;
  scopes: string[];
  userId: string;
  email: string;
  fullName: string;
}

/**
 * API publique Business : clés API par organisation (stockées hachées, affichées une seule fois)
 * et webhooks sortants signés HMAC (au moins une fois, reprise exponentielle, anti-SSRF).
 */
@Injectable()
export class DevelopersService implements OnModuleInit {
  private readonly logger = new Logger('Developers');
  private readonly agent: Agent;

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.agent = createSafeAgent(config.ALLOW_PRIVATE_WEBHOOK_URLS);
  }

  onModuleInit(): void {
    for (const type of WEBHOOK_EVENTS) this.outbox.subscribe(type, (e) => this.enqueue(e));
  }

  // ───────────── Clés API ─────────────

  async createKey(orgId: string, actor: AuditActor & { userId: string }, input: { name: string; scopes: string[] }) {
    const scopes = [...new Set(input.scopes)];
    if (!scopes.length || scopes.some((s) => !(API_KEY_SCOPES as readonly string[]).includes(s))) {
      throw Errors.validation({ scopes: `Allowed: ${API_KEY_SCOPES.join(', ')}` });
    }
    const secret = `${KEY_PREFIX}${randomToken(32)}`;
    const prefix = secret.slice(0, KEY_PREFIX.length + 8);
    return this.db.forOrg(orgId, async (tx) => {
      const k = await tx.one<Record<string, unknown>>(
        `INSERT INTO api_keys (org_id, name, prefix, key_hash, scopes, created_by) VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, name, prefix, scopes, created_at`,
        [orgId, input.name, prefix, sha256(secret), scopes, actor.userId],
      );
      await this.audit.record(tx, { actor, orgId, action: 'developers.api_key_created', targetType: 'api_key', targetId: String(k.id), after: { name: input.name, scopes } });
      // La clé complète n'est renvoyée QU'UNE FOIS.
      return { ...toCamel(k), secret };
    });
  }

  async listKeys(orgId: string) {
    return (
      await this.db.forOrg(orgId, (tx) =>
        tx.query<Record<string, unknown>>(`SELECT id, name, prefix, scopes, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC`),
      )
    ).map(toCamel);
  }

  async revokeKey(orgId: string, actor: AuditActor, id: string) {
    await this.db.forOrg(orgId, async (tx) => {
      const r = await tx.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id`, [id]);
      if (!r.length) throw Errors.notFound('API key');
      await this.audit.record(tx, { actor, orgId, action: 'developers.api_key_revoked', targetType: 'api_key', targetId: id });
    });
  }

  isApiKey(token: string): boolean {
    return token.startsWith(KEY_PREFIX);
  }

  async resolveKey(secret: string): Promise<ResolvedApiKey | null> {
    if (!/^vp_sk_[A-Za-z0-9_-]{40,50}$/.test(secret)) return null;
    return this.db.system(async (tx) => {
      const k = await tx.maybeOne<{ id: string; org_id: string; scopes: string[]; user_id: string; email: string; full_name: string }>(
        // La clé n'est valide que si son créateur est TOUJOURS propriétaire/administrateur de l'organisation.
        `SELECT k.id, k.org_id, k.scopes, u.id AS user_id, u.email, u.full_name
           FROM api_keys k
           JOIN users u ON u.id = k.created_by AND u.status = 'active'
           JOIN memberships m ON m.org_id = k.org_id AND m.user_id = k.created_by AND m.role IN ('owner','admin')
          WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
        [sha256(secret)],
      );
      // Mise à jour de la dernière utilisation au plus une fois par minute (pas de contention).
      if (k) await tx.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [k.id]);
      return k ? { keyId: k.id, orgId: k.org_id, scopes: k.scopes, userId: k.user_id, email: k.email, fullName: k.full_name } : null;
    });
  }

  // ───────────── Webhooks sortants ─────────────

  async createEndpoint(orgId: string, actor: AuditActor & { userId: string }, input: { url: string; events: string[] }) {
    try {
      validateWebhookUrl(input.url, this.config.ALLOW_PRIVATE_WEBHOOK_URLS);
    } catch (e) {
      throw Errors.validation({ url: (e as UnsafeUrlError).message });
    }
    const events = [...new Set(input.events)];
    if (!events.length || events.some((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e))) {
      throw Errors.validation({ events: `Allowed: ${WEBHOOK_EVENTS.join(', ')}` });
    }
    const secret = `whsec_${randomToken(32)}`;
    return this.db.forOrg(orgId, async (tx) => {
      const count = await tx.one<{ n: string }>(`SELECT count(*)::text AS n FROM webhook_endpoints WHERE status = 'active'`);
      if (Number(count.n) >= 10) throw Errors.invalidState('Maximum 10 active endpoints');
      const ep = await tx.one<Record<string, unknown>>(
        `INSERT INTO webhook_endpoints (org_id, url, secret_enc, events, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, url, events, status, created_at`,
        [orgId, input.url, encrypt(secret, this.config.encryptionKey), events, actor.userId],
      );
      await this.audit.record(tx, { actor, orgId, action: 'developers.webhook_created', targetType: 'webhook_endpoint', targetId: String(ep.id), after: { url: input.url, events } });
      return { ...toCamel(ep), secret };
    });
  }

  async listEndpoints(orgId: string) {
    return this.db.forOrg(orgId, async (tx) => {
      const eps = await tx.query<Record<string, unknown>>(`SELECT id, url, events, status, created_at FROM webhook_endpoints ORDER BY created_at DESC`);
      const deliveries = await tx.query<Record<string, unknown>>(
        `SELECT id, endpoint_id, event_type, status, attempts, last_status_code, last_error, created_at, delivered_at
           FROM webhook_deliveries ORDER BY created_at DESC LIMIT 50`,
      );
      return { endpoints: eps.map(toCamel), recentDeliveries: deliveries.map(toCamel) };
    });
  }

  async disableEndpoint(orgId: string, actor: AuditActor, id: string) {
    await this.db.forOrg(orgId, async (tx) => {
      const r = await tx.query(`UPDATE webhook_endpoints SET status = 'disabled' WHERE id = $1 AND status = 'active' RETURNING id`, [id]);
      if (!r.length) throw Errors.notFound('Endpoint');
      await this.audit.record(tx, { actor, orgId, action: 'developers.webhook_disabled', targetType: 'webhook_endpoint', targetId: id });
    });
  }

  /** Événement de test envoyé à un endpoint (vérification de l'intégration par le commerçant). */
  async sendTest(orgId: string, id: string) {
    await this.db.forOrg(orgId, async (tx) => {
      const ep = await tx.maybeOne<{ id: string }>(`SELECT id FROM webhook_endpoints WHERE id = $1 AND status = 'active'`, [id]);
      if (!ep) throw Errors.notFound('Endpoint');
      const eventId = `evt_test_${randomToken(9)}`;
      await tx.query(`INSERT INTO webhook_deliveries (org_id, endpoint_id, event_id, event_type, payload) VALUES ($1,$2,$3,'test',$4)`, [
        orgId,
        id,
        eventId,
        JSON.stringify({ id: eventId, type: 'test', created: new Date().toISOString(), data: { message: 'Événement de test VITPAY' } }),
      ]);
    });
    return { queued: true };
  }

  private async enqueue(e: OutboxEvent): Promise<void> {
    if (!e.orgId) return;
    const eventId = `evt_${e.id}`;
    const payload = { id: eventId, type: e.eventType, created: new Date().toISOString(), data: { objectType: e.aggregateType, objectId: e.aggregateId, ...e.payload } };
    await this.db.forOrg(e.orgId, async (tx) => {
      const eps = await tx.query<{ id: string }>(`SELECT id FROM webhook_endpoints WHERE status = 'active' AND $1 = ANY(events)`, [e.eventType]);
      for (const ep of eps) {
        await tx.query(
          `INSERT INTO webhook_deliveries (org_id, endpoint_id, event_id, event_type, payload) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (endpoint_id, event_id) DO NOTHING`,
          [e.orgId, ep.id, eventId, e.eventType, JSON.stringify(payload)],
        );
      }
    });
  }

  /**
   * Worker : livraisons dues, en parallèle (concurrence bornée), au plus UNE par endpoint et par lot
   * (un endpoint lent ne bloque pas les autres commerçants). Bail de 60 s posé avant l'appel HTTP :
   * aucune transaction ni verrou n'est tenu pendant l'envoi.
   */
  async deliverDue(limit = 30): Promise<number> {
    const claimed = await this.db.system((tx) =>
      tx.query<{ id: string; event_id: string; payload: unknown; attempts: number; endpoint_id: string; url: string; secret_enc: string }>(
        `WITH due AS (
           SELECT DISTINCT ON (d.endpoint_id) d.id
             FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
            WHERE d.status = 'pending' AND d.next_attempt_at <= now() AND e.status = 'active'
            ORDER BY d.endpoint_id, d.next_attempt_at
            LIMIT $1)
         UPDATE webhook_deliveries d SET next_attempt_at = now() + make_interval(secs => $2)
           FROM webhook_endpoints e
          WHERE d.id IN (SELECT id FROM due) AND e.id = d.endpoint_id
         RETURNING d.id, d.event_id, d.payload, d.attempts, d.endpoint_id, e.url, e.secret_enc`,
        [limit, LEASE_SECONDS],
      ),
    );
    let ok = 0;
    for (let i = 0; i < claimed.length; i += DELIVERY_CONCURRENCY) {
      const results = await Promise.all(claimed.slice(i, i + DELIVERY_CONCURRENCY).map((d) => this.deliverOne(d)));
      ok += results.filter(Boolean).length;
    }
    await this.db.system((tx) =>
      tx.query(`UPDATE webhook_deliveries SET status = 'failed', last_error = 'endpoint_disabled'
                 WHERE status = 'pending' AND endpoint_id IN (SELECT id FROM webhook_endpoints WHERE status = 'disabled')`),
    );
    return ok;
  }

  private async deliverOne(d: { id: string; event_id: string; payload: unknown; attempts: number; endpoint_id: string; url: string; secret_enc: string }): Promise<boolean> {
    const body = JSON.stringify(d.payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    const signature = `t=${ts},v1=${hmacSha256Hex(decrypt(d.secret_enc, this.config.encryptionKey), `${ts}.${body}`)}`;
    let status: number | null = null;
    let error: string | null = null;
    try {
      status = (await safePost(this.agent, d.url, body, { 'vitpay-signature': signature, 'vitpay-event-id': d.event_id }, this.config.ALLOW_PRIVATE_WEBHOOK_URLS)).status;
      if (status < 200 || status >= 300) error = `http_${status}`;
    } catch (e) {
      error = errorCategory(e);
      this.logger.warn({ msg: 'webhook delivery failed', deliveryId: d.id, category: error });
    }
    return this.db.system(async (tx) => {
      if (!error) {
        await tx.query(`UPDATE webhook_deliveries SET status = 'succeeded', attempts = attempts + 1, last_status_code = $2, last_error = NULL, delivered_at = now() WHERE id = $1`, [d.id, status]);
        await tx.query(`UPDATE webhook_endpoints SET consecutive_failures = 0 WHERE id = $1`, [d.endpoint_id]);
        return true;
      }
      const attempts = d.attempts + 1;
      await tx.query(
        `UPDATE webhook_deliveries SET attempts = $2, last_status_code = $3, last_error = $4, status = $5,
           next_attempt_at = now() + make_interval(secs => $6) WHERE id = $1`,
        [d.id, attempts, status, error, attempts >= MAX_DELIVERY_ATTEMPTS ? 'failed' : 'pending', Math.min(6 * 3600, 30 * 2 ** (attempts - 1))],
      );
      await tx.query(
        `UPDATE webhook_endpoints SET consecutive_failures = consecutive_failures + 1,
           status = CASE WHEN consecutive_failures + 1 >= $2 THEN 'disabled' ELSE status END,
           disabled_reason = CASE WHEN consecutive_failures + 1 >= $2 THEN 'too_many_failures' ELSE disabled_reason END
         WHERE id = $1`,
        [d.endpoint_id, AUTO_DISABLE_AFTER],
      );
      return false;
    });
  }
}
