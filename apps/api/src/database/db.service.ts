import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { APP_CONFIG, AppConfig } from '../config';

export interface Tx {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T>;
  maybeOne<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Organisation courante de la transaction (si scopée). */
  readonly orgId: string | null;
}

export interface TxOptions {
  /** Restreint la transaction à une organisation (RLS). */
  orgId?: string;
  /**
   * Lecture/écriture transverse aux organisations, via le rôle `vitpay_system` (connexion distincte).
   * Réservé aux chemins explicitement justifiés : authentification, page publique, webhooks,
   * administration, workers. Le rôle applicatif n'a AUCUN moyen de contourner la RLS.
   */
  bypassRls?: boolean;
  isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ClientTx implements Tx {
  constructor(
    private readonly client: PoolClient,
    readonly orgId: string | null,
  ) {}

  async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.client.query<T>(sql, params);
    return r.rows;
  }

  async one<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}`);
    return rows[0] as T;
  }

  async maybeOne<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    if (rows.length > 1) throw new Error(`Expected at most one row, got ${rows.length}`);
    return rows[0] ?? null;
  }
}

@Injectable()
export class Db implements OnModuleDestroy {
  /** Pool du rôle applicatif (RLS stricte). */
  readonly pool: Pool;
  /** Pool du rôle système (BYPASSRLS). */
  private readonly systemPool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.DATABASE_URL, max: 20, application_name: 'vitpay-api' });
    this.systemPool = new Pool({ connectionString: config.DATABASE_SYSTEM_URL, max: 10, application_name: 'vitpay-api-system' });
  }

  async tx<T>(fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
    if (opts.orgId && !UUID_RE.test(opts.orgId)) throw new Error('Invalid orgId');
    if (opts.orgId && opts.bypassRls) throw new Error('orgId and bypassRls are mutually exclusive');
    const client = await (opts.bypassRls ? this.systemPool : this.pool).connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${opts.isolation ?? 'READ COMMITTED'}`);
      // set_config(..., true) = portée transaction (équivalent SET LOCAL), paramétré (pas d'injection).
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [opts.orgId ?? '']);
      const result = await fn(new ClientTx(client, opts.orgId ?? null));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Raccourci : transaction scopée à une organisation. */
  forOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.tx(fn, { orgId });
  }

  /** Raccourci : transaction système (bypass RLS). */
  system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.tx(fn, { bypassRls: true });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.pool.end(), this.systemPool.end()]);
  }
}

/** Code d'erreur PostgreSQL de violation d'unicité. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (!constraint || e.constraint === constraint);
}
