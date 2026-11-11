import { Injectable } from '@nestjs/common';
import { canonicalJson, sha256Hex } from '../../common/crypto';
import { Errors } from '../../common/errors';
import { Db, isUniqueViolation } from '../../database/db.service';

const KEY_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Idempotence des opérations sensibles (création de demande, remboursement…).
 *
 * 1. On réserve la clé (INSERT) — une requête concurrente avec la même clé échoue en 409.
 * 2. On exécute l'opération.
 * 3. On enregistre la réponse ; un rejeu identique renvoie la réponse stockée.
 * Une même clé avec un corps différent est refusée (422).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly db: Db) {}

  async run<T>(scope: string, key: string | undefined, request: unknown, fn: () => Promise<{ status: number; body: T }>): Promise<IdempotentResult<T>> {
    if (!key) throw Errors.badRequest('idempotency_key_required', 'Idempotency-Key header is required');
    if (!KEY_RE.test(key)) throw Errors.badRequest('idempotency_key_invalid', 'Idempotency-Key must be 8-128 chars [A-Za-z0-9_-:.]');
    const requestHash = sha256Hex(canonicalJson(request));

    // Une clé restée « en cours » plus de 5 minutes (processus interrompu) est libérée.
    await this.db.system((tx) =>
      tx.query(`DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2 AND response_status IS NULL AND created_at < now() - interval '5 minutes'`, [scope, key]),
    );
    const existing = await this.db.system((tx) =>
      tx.maybeOne<{ request_hash: string; response_status: number | null; response_body: T | null }>(
        'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE scope = $1 AND key = $2',
        [scope, key],
      ),
    );
    if (existing) return this.replay(existing, requestHash);

    try {
      await this.db.system((tx) =>
        tx.query('INSERT INTO idempotency_keys (scope, key, request_hash) VALUES ($1, $2, $3)', [scope, key, requestHash]),
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        const row = await this.db.system((tx) =>
          tx.one<{ request_hash: string; response_status: number | null; response_body: T | null }>(
            'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE scope = $1 AND key = $2',
            [scope, key],
          ),
        );
        return this.replay(row, requestHash);
      }
      throw e;
    }

    try {
      const result = await fn();
      await this.db.system((tx) =>
        tx.query('UPDATE idempotency_keys SET response_status = $3, response_body = $4 WHERE scope = $1 AND key = $2', [
          scope,
          key,
          result.status,
          JSON.stringify(result.body),
        ]),
      );
      return { ...result, replayed: false };
    } catch (e) {
      // L'opération a échoué sans effet durable : la clé est libérée pour permettre un nouvel essai.
      await this.db.system((tx) => tx.query('DELETE FROM idempotency_keys WHERE scope = $1 AND key = $2', [scope, key]));
      throw e;
    }
  }

  private replay<T>(
    row: { request_hash: string; response_status: number | null; response_body: T | null },
    requestHash: string,
  ): IdempotentResult<T> {
    if (row.request_hash !== requestHash) {
      throw Errors.validation({ reason: 'Idempotency-Key reused with a different request body' });
    }
    if (row.response_status === null) {
      throw Errors.conflict('idempotency_in_progress', 'A request with this Idempotency-Key is still in progress');
    }
    return { status: row.response_status, body: row.response_body as T, replayed: true };
  }
}
