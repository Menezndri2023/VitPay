import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Agent } from 'undici';
import { APP_CONFIG, AppConfig } from '../../config';
import { decrypt, encrypt, hmacSha256Hex, randomToken, sha256 } from '../../common/crypto';
import { Errors } from '../../common/errors';
import { createSafeAgent, safePost, UnsafeUrlError, validateWebhookUrl } from '../../common/safe-http';
import { Db } from '../../database/db.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { API_KEY_SCOPES } from '../identity/permissions';
import { toCamel } from '../organizations/organizations.service';
import { OutboxEvent, OutboxService } from '../platform/outbox.service';

export const WEBHOOK_EVENTS = ['payment.succeeded', 'payment.failed', 'refund.succeeded', 'refund.failed', 'dispute.opened', 'dispute.won', 'dispute.lost'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const MAX_DELIVERY_ATTEMPTS = 10;
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
        `UPDATE api_keys k SET last_used_at = now() FROM users u, organizations o
          WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND u.id = k.created_by AND u.status = 'active' AND o.id = k.org_id
         RETURNING k.id, k.org_id, k.scopes, u.id AS user_id, u.email, u.full_name`,
        [sha256(secret)],
      );
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

  /** Worker : livraisons dues, chacune dans sa transaction, avec reprise exponentielle. */
  async deliverDue(limit = 20): Promise<number> {
    const due = await this.db.system((tx) =>
      tx.query<{ id: string }>(`SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1`, [limit]),
    );
    let ok = 0;
    for (const { id } of due) {
      await this.db.system(async (tx) => {
        const d = await tx.maybeOne<{ id: string; event_id: string; payload: unknown; attempts: number; url: string; secret_enc: string; ep_status: string }>(
          `SELECT d.id, d.event_id, d.payload, d.attempts, e.url, e.secret_enc, e.status AS ep_status
             FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
            WHERE d.id = $1 AND d.status = 'pending' FOR UPDATE OF d SKIP LOCKED`,
          [id],
        );
        if (!d) return;
        if (d.ep_status !== 'active') {
          await tx.query(`UPDATE webhook_deliveries SET status = 'failed', last_error = 'endpoint disabled' WHERE id = $1`, [id]);
          return;
        }
        const body = JSON.stringify(d.payload);
        const ts = Math.floor(Date.now() / 1000).toString();
        const signature = `t=${ts},v1=${hmacSha256Hex(decrypt(d.secret_enc, this.config.encryptionKey), `${ts}.${body}`)}`;
        let status: number | null = null;
        let error: string | null = null;
        try {
          status = (await safePost(this.agent, d.url, body, { 'vitpay-signature': signature, 'vitpay-event-id': d.event_id })).status;
          if (status < 200 || status >= 300) error = `HTTP ${status}`;
        } catch (e) {
          const err = e as Error & { cause?: Error };
          error = (err.cause?.message ? `${err.message}: ${err.cause.message}` : err.message).slice(0, 300);
        }
        if (!error) {
          await tx.query(`UPDATE webhook_deliveries SET status = 'succeeded', attempts = attempts + 1, last_status_code = $2, last_error = NULL, delivered_at = now() WHERE id = $1`, [id, status]);
          ok += 1;
          return;
        }
        const attempts = d.attempts + 1;
        await tx.query(
          `UPDATE webhook_deliveries SET attempts = $2, last_status_code = $3, last_error = $4, status = $5,
             next_attempt_at = now() + make_interval(secs => $6) WHERE id = $1`,
          [id, attempts, status, error, attempts >= MAX_DELIVERY_ATTEMPTS ? 'failed' : 'pending', Math.min(6 * 3600, 30 * 2 ** (attempts - 1))],
        );
      });
    }
    return ok;
  }
}
