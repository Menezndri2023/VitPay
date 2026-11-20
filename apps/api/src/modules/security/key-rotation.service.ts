import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config';
import { decrypt, decryptBytes, encrypt, encryptBytes } from '../../common/crypto';
import { Db } from '../../database/db.service';
import { AuditService } from '../audit/audit.service';

interface Target {
  table: string;
  column: string;
  kind: 'text' | 'bytes';
}

/** Toutes les colonnes chiffrées avec la clé applicative. Toute nouvelle colonne *_enc doit être ajoutée ici (test de garde). */
export const ENCRYPTED_COLUMNS: readonly Target[] = [
  { table: 'provider_accounts', column: 'credentials_enc', kind: 'text' },
  { table: 'provider_accounts', column: 'webhook_secret_enc', kind: 'text' },
  { table: 'webhook_endpoints', column: 'secret_enc', kind: 'text' },
  { table: 'webhook_endpoints', column: 'previous_secret_enc', kind: 'text' },
  { table: 'users', column: 'mfa_secret_enc', kind: 'text' },
  { table: 'kyb_documents', column: 'content_enc', kind: 'bytes' },
];

/**
 * Rotation de la clé de chiffrement (procédure dans SECURITY.md) :
 * 1. APP_ENCRYPTION_KEY = nouvelle clé, APP_ENCRYPTION_KEYS_PREVIOUS = ancienne (déchiffrement seul) ;
 * 2. `pnpm keys:reencrypt` rechiffre toutes les valeurs avec la clé courante (par lots, reprenable) ;
 * 3. `pnpm keys:reencrypt --status` doit indiquer 0 restant ; l'ancienne clé est alors retirée.
 * Chaque mise à jour est conditionnée à la valeur lue (pas d'écrasement d'une écriture concurrente).
 */
@Injectable()
export class KeyRotationService {
  private readonly logger = new Logger('KeyRotation');

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private predicate(t: Target): { sql: string; param: string | Buffer } {
    const kid = this.config.encryptionKey.currentId;
    return t.kind === 'text'
      ? { sql: `${t.column} IS NOT NULL AND ${t.column} NOT LIKE $1`, param: `v2.${kid}.%` }
      : { sql: `${t.column} IS NOT NULL AND substring(${t.column} from 1 for 5) <> $1::bytea`, param: Buffer.concat([Buffer.from([2]), Buffer.from(kid, 'hex')]) };
  }

  /** Nombre de valeurs encore chiffrées avec une autre clé que la clé courante. */
  async status(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    await this.db.system(async (tx) => {
      for (const t of ENCRYPTED_COLUMNS) {
        const p = this.predicate(t);
        const r = await tx.one<{ n: string }>(`SELECT count(*)::text AS n FROM ${t.table} WHERE ${p.sql}`, [p.param]);
        out[`${t.table}.${t.column}`] = Number(r.n);
      }
    });
    return out;
  }

  /**
   * [R5-2/3/4] Parcours par identifiant croissant (une ligne en échec n'arrête ni ne bloque la suite),
   * lots réduits pour les justificatifs (jusqu'à 5 Mo chacun), audit par colonne traitée.
   * Les échecs sont comptés et journalisés par table, colonne et identifiant — jamais la valeur.
   */
  async reencryptAll(batchSize = 200): Promise<Record<string, { reencrypted: number; failed: number }>> {
    const report: Record<string, { reencrypted: number; failed: number }> = {};
    const keys = this.config.encryptionKey;
    for (const t of ENCRYPTED_COLUMNS) {
      const name = `${t.table}.${t.column}`;
      const size = t.kind === 'bytes' ? Math.min(batchSize, 2) : batchSize;
      const r = { reencrypted: 0, failed: 0 };
      let last = '00000000-0000-0000-0000-000000000000';
      for (;;) {
        const batch = await this.db.system(async (tx) => {
          const p = this.predicate(t);
          const rows = await tx.query<{ id: string; v: string | Buffer }>(
            `SELECT id, ${t.column} AS v FROM ${t.table} WHERE ${p.sql} AND id > $3 ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`,
            [p.param, size, last],
          );
          for (const row of rows) {
            try {
              const next = t.kind === 'text' ? encrypt(decrypt(row.v as string, keys), keys) : encryptBytes(decryptBytes(row.v as Buffer, keys), keys);
              await tx.query(`UPDATE ${t.table} SET ${t.column} = $2 WHERE id = $1 AND ${t.column} = $3`, [row.id, next, row.v]);
              r.reencrypted += 1;
            } catch {
              r.failed += 1;
              this.logger.error({ msg: 're-encryption failed for a row', table: t.table, column: t.column, id: row.id });
            }
          }
          return rows;
        });
        if (batch.length) last = (batch[batch.length - 1] as { id: string }).id;
        if (batch.length < size) break;
      }
      report[name] = r;
      await this.db.system((tx) =>
        this.audit.record(tx, { actor: { type: 'system' }, action: 'security.keys_reencrypted', targetType: 'keyring', targetId: keys.currentId, metadata: { column: name, ...r } }),
      );
    }
    this.logger.log({ msg: 're-encryption done', keyId: keys.currentId, report });
    return report;
  }
}
