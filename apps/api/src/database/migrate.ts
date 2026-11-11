import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { sha256Hex } from '../common/crypto';

// Fonctionne depuis les sources (src/database) et depuis le build (dist/src/database).
export const MIGRATIONS_DIR = [join(__dirname, '..', '..', 'migrations'), join(__dirname, '..', '..', '..', 'migrations')].find(
  (p) => existsSync(p),
) as string;

/**
 * Migrations SQL versionnées, appliquées dans l'ordre, chacune dans sa transaction.
 * Une migration déjà appliquée dont le contenu a changé est refusée (pas de modification silencieuse).
 */
export async function migrate(ownerUrl: string, log: (m: string) => void = console.log): Promise<void> {
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query(`SELECT pg_advisory_lock(727274)`);
    const applied = new Map(
      (await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')).rows.map(
        (r) => [r.name, r.checksum],
      ),
    );
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = sha256Hex(sql);
      const prev = applied.get(file);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migration ${file} was modified after being applied`);
        continue;
      }
      log(`→ applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
    await client.query(`SELECT pg_advisory_unlock(727274)`);
  } finally {
    await client.end();
  }
}
