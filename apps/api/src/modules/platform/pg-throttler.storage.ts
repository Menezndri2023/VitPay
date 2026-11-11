import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { Db } from '../../database/db.service';

/**
 * Stockage partagé des compteurs de limitation de débit : toutes les instances de l'API voient les
 * mêmes compteurs (une instance de plus ne multiplie plus la limite). Une seule requête atomique
 * (INSERT … ON CONFLICT) par appel, en auto-commit sur le pool applicatif.
 */
export class PgThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly db: Db) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const fresh = `(rate_limits.expires_at <= now() AND (rate_limits.blocked_until IS NULL OR rate_limits.blocked_until <= now()))`;
    const hits = `CASE WHEN ${fresh} THEN 1 ELSE rate_limits.hits + 1 END`;
    const r = await this.db.autocommit<{ hits: number; expires_ms: string; blocked_ms: string | null }>(
      `INSERT INTO rate_limits AS rate_limits (key, hits, expires_at, blocked_until)
       VALUES ($1, 1, now() + make_interval(secs => $2 / 1000.0), CASE WHEN 1 > $3 THEN now() + make_interval(secs => $4 / 1000.0) END)
       ON CONFLICT (key) DO UPDATE SET
         hits = ${hits},
         expires_at = CASE WHEN ${fresh} THEN now() + make_interval(secs => $2 / 1000.0) ELSE rate_limits.expires_at END,
         blocked_until = CASE
           WHEN rate_limits.blocked_until > now() THEN rate_limits.blocked_until
           WHEN ${hits} > $3 THEN now() + make_interval(secs => $4 / 1000.0)
           ELSE NULL END
       RETURNING hits,
         GREATEST(0, EXTRACT(EPOCH FROM (expires_at - now())) * 1000)::bigint::text AS expires_ms,
         CASE WHEN blocked_until > now() THEN (EXTRACT(EPOCH FROM (blocked_until - now())) * 1000)::bigint::text END AS blocked_ms`,
      [`${throttlerName}:${key}`, ttl, limit, blockDuration],
    );
    const row = r[0] as { hits: number; expires_ms: string; blocked_ms: string | null };
    return {
      totalHits: row.hits,
      timeToExpire: Math.ceil(Number(row.expires_ms) / 1000),
      isBlocked: row.blocked_ms !== null,
      timeToBlockExpire: row.blocked_ms === null ? 0 : Math.ceil(Number(row.blocked_ms) / 1000),
    };
  }
}
