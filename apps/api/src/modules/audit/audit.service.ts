import { Injectable } from '@nestjs/common';
import { canonicalJson, sha256 } from '../../common/crypto';
import { Db, Tx } from '../../database/db.service';

export interface AuditActor {
  type: 'user' | 'admin' | 'system' | 'provider' | 'public' | 'api_key';
  /** Clé API utilisée (actions faites via l'API publique). */
  apiKeyId?: string | null;
  userId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  actor: AuditActor;
  orgId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

const AUDIT_LOCK_KEY = 727275;

@Injectable()
export class AuditService {
  constructor(private readonly db: Db) {}

  /**
   * Ajoute une entrée DANS la transaction métier fournie : l'action et sa trace
   * sont validées ou annulées ensemble. La chaîne de hash est sérialisée par un
   * verrou consultatif transactionnel.
   */
  async record(tx: Tx, e: AuditEntry): Promise<void> {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_LOCK_KEY]);
    // Lecture du dernier hash : le journal d'audit n'est pas soumis à RLS (voir 005_security.sql).
    const last = await tx.maybeOne<{ hash: Buffer }>('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
    const prevHash = last?.hash ?? null;
    const occurredAt = new Date().toISOString();
    const content = {
      occurredAt,
      actorType: e.actor.type,
      actorUserId: e.actor.userId ?? null,
      orgId: e.orgId ?? null,
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      reason: e.reason ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      metadata: e.actor.apiKeyId ? { ...((e.metadata as Record<string, unknown>) ?? {}), apiKeyId: e.actor.apiKeyId } : (e.metadata ?? null),
    };
    const hash = sha256(Buffer.concat([prevHash ?? Buffer.alloc(0), Buffer.from(canonicalJson(content))]));
    await tx.query(
      `INSERT INTO audit_log (occurred_at, actor_type, actor_user_id, org_id, action, target_type, target_id,
         reason, ip, user_agent, before, after, metadata, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        occurredAt,
        content.actorType,
        content.actorUserId,
        content.orgId,
        content.action,
        content.targetType,
        content.targetId,
        content.reason,
        e.actor.ip ?? null,
        e.actor.userAgent ?? null,
        jsonOrNull(content.before),
        jsonOrNull(content.after),
        jsonOrNull(content.metadata),
        prevHash,
        hash,
      ],
    );
  }

  /** Vérifie l'intégrité de toute la chaîne. Retourne l'id de la première entrée corrompue, ou null. */
  async verifyChain(): Promise<{ ok: boolean; checked: number; brokenAt: string | null }> {
    return this.db.system(async (tx) => {
      const rows = await tx.query<{
        id: string;
        occurred_at: Date;
        actor_type: string;
        actor_user_id: string | null;
        org_id: string | null;
        action: string;
        target_type: string | null;
        target_id: string | null;
        reason: string | null;
        before: unknown;
        after: unknown;
        metadata: unknown;
        prev_hash: Buffer | null;
        hash: Buffer;
      }>('SELECT * FROM audit_log ORDER BY id ASC');
      let prev: Buffer | null = null;
      for (const r of rows) {
        const content = {
          occurredAt: r.occurred_at.toISOString(),
          actorType: r.actor_type,
          actorUserId: r.actor_user_id,
          orgId: r.org_id,
          action: r.action,
          targetType: r.target_type,
          targetId: r.target_id,
          reason: r.reason,
          before: r.before,
          after: r.after,
          metadata: r.metadata,
        };
        const expected = sha256(Buffer.concat([prev ?? Buffer.alloc(0), Buffer.from(canonicalJson(content))]));
        const prevMatches = (prev === null && r.prev_hash === null) || (prev !== null && r.prev_hash?.equals(prev));
        if (!prevMatches || !expected.equals(r.hash)) return { ok: false, checked: rows.length, brokenAt: r.id };
        prev = r.hash;
      }
      return { ok: true, checked: rows.length, brokenAt: null };
    });
  }
}

function jsonOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : canonicalJson(v);
}
