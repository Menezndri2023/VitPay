import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { Pool } from 'pg';
import { hmacSha256Hex } from '../../common/crypto';
import { AppConfig } from '../../config';
import { metrics } from '../../common/observability';

const CACHE_MAX = 10_000;

/**
 * Compteurs de limitation de débit partagés par toutes les instances (PostgreSQL, ADR-007).
 * - Pool dédié et borné ([R6-2]) : la limitation ne peut pas épuiser les connexions métier ;
 *   délais de connexion et d'exécution courts.
 * - Clés = HMAC à clé serveur ([R6-6]) : pas d'IP retrouvable par dictionnaire dans la base.
 * - Cache local des clés bloquées : les 429 répétés ne touchent pas la base.
 * - En cas d'indisponibilité de la base : la requête passe (journal + métrique). Les protections
 *   d'authentification (verrouillage de compte atomique, anti-rejeu TOTP) restent en base.
 * Fenêtre fixe (et non glissante) : jusqu'à 2× la limite possible à la jonction de deux fenêtres.
 */
export class PgThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger('RateLimit');
  private readonly pool: Pool;
  private readonly blocked = new Map<string, { until: number; hits: number }>();
  private readonly secret: string;

  constructor(config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 4,
      connectionTimeoutMillis: 1_000,
      statement_timeout: 250,
      application_name: 'vitpay-api-ratelimit',
    });
    this.secret = config.encryptionKey.pseudonymKey();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const k = hmacSha256Hex(this.secret, `${throttlerName}:${key}`).slice(0, 48);
    const now = Date.now();
    const cached = this.blocked.get(k);
    if (cached && cached.until > now) {
      const s = Math.ceil((cached.until - now) / 1000);
      return { totalHits: cached.hits + 1, timeToExpire: s, isBlocked: true, timeToBlockExpire: s };
    }
    if (cached) this.blocked.delete(k);
    try {
      const { rows } = await this.pool.query<{ hits: number; expires_ms: string; blocked_ms: string | null }>('SELECT * FROM rate_limit_hit($1, $2, $3, $4)', [
        k,
        Math.max(1, Math.round(ttl)),
        Math.max(1, limit),
        Math.max(0, Math.round(blockDuration)),
      ]);
      const row = rows[0] as { hits: number; expires_ms: string; blocked_ms: string | null };
      const timeToExpire = Math.ceil(Number(row.expires_ms) / 1000);
      // Sans durée de blocage : refus dès que la limite est dépassée dans la fenêtre (comportement par défaut).
      const isBlocked = row.blocked_ms !== null || (blockDuration <= 0 && row.hits > limit);
      const timeToBlockExpire = row.blocked_ms !== null ? Math.ceil(Number(row.blocked_ms) / 1000) : isBlocked ? timeToExpire : 0;
      if (isBlocked) {
        if (this.blocked.size >= CACHE_MAX) this.blocked.clear();
        this.blocked.set(k, { until: now + timeToBlockExpire * 1000, hits: row.hits });
      }
      return { totalHits: row.hits, timeToExpire, isBlocked, timeToBlockExpire };
    } catch (e) {
      metrics.inc('vitpay_rate_limit_errors_total');
      this.logger.warn({ msg: 'rate limit storage unavailable: request allowed', err: (e as Error).message });
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
