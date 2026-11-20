import { Injectable } from '@nestjs/common';
import { Currency, Money } from '@vitpay/money';
import { Db, isUniqueViolation, Tx } from '../../database/db.service';
import { AccountKey, ACCOUNTS, AccountType, normalBalance } from './chart-of-accounts';

export interface PostingInput {
  account: AccountKey;
  direction: 'debit' | 'credit';
  amount: Money;
}

export interface EntryInput {
  orgId: string;
  entryType: string;
  referenceType: string;
  referenceId: string;
  /** Clé unique : rejouer la même écriture est sans effet. */
  idempotencyKey: string;
  description?: string;
  postings: PostingInput[];
  reversesEntryId?: string;
}

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export interface AccountBalance {
  code: string;
  type: AccountType;
  currency: Currency;
  /** Solde dans le sens normal du compte, en unité mineure. */
  balanceMinor: string;
}

@Injectable()
export class LedgerService {
  constructor(private readonly db: Db) {}

  /**
   * Passe une écriture équilibrée dans la transaction fournie.
   * L'équilibre est vérifié ici ET par la base (trigger différé).
   * Retourne `{ created: false }` si l'écriture existait déjà (idempotence).
   */
  async post(tx: Tx, e: EntryInput): Promise<{ entryId: string; created: boolean }> {
    const postings = e.postings.filter((p) => !p.amount.isZero());
    if (postings.length < 2) throw new LedgerError('An entry needs at least two non-zero postings');
    const sums = new Map<Currency, bigint>();
    for (const p of postings) {
      if (p.amount.isNegative()) throw new LedgerError('Posting amounts must be positive; use direction instead');
      const signed = p.direction === 'debit' ? p.amount.minor : -p.amount.minor;
      sums.set(p.amount.currency, (sums.get(p.amount.currency) ?? 0n) + signed);
    }
    for (const [currency, sum] of sums) {
      if (sum !== 0n) throw new LedgerError(`Unbalanced entry in ${currency}: ${sum}`);
    }

    const existing = await tx.maybeOne<{ id: string }>('SELECT id FROM journal_entries WHERE org_id = $1 AND idempotency_key = $2', [
      e.orgId,
      e.idempotencyKey,
    ]);
    if (existing) return { entryId: existing.id, created: false };

    let entryId: string;
    try {
      await tx.query('SAVEPOINT ledger_entry');
      const row = await tx.one<{ id: string }>(
        `INSERT INTO journal_entries (org_id, entry_type, reference_type, reference_id, idempotency_key, description, reverses_entry_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [e.orgId, e.entryType, e.referenceType, e.referenceId, e.idempotencyKey, e.description ?? null, e.reversesEntryId ?? null],
      );
      entryId = row.id;
      await tx.query('RELEASE SAVEPOINT ledger_entry');
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Écriture concurrente avec la même clé : on revient à l'état d'avant et on renvoie l'existante.
        await tx.query('ROLLBACK TO SAVEPOINT ledger_entry');
        const row = await tx.one<{ id: string }>('SELECT id FROM journal_entries WHERE org_id = $1 AND idempotency_key = $2', [e.orgId, e.idempotencyKey]);
        return { entryId: row.id, created: false };
      }
      throw err;
    }

    for (const p of postings) {
      const accountId = await this.ensureAccount(tx, e.orgId, p.account, p.amount.currency);
      await tx.query(
        `INSERT INTO postings (entry_id, org_id, account_id, direction, amount_minor, currency) VALUES ($1,$2,$3,$4,$5,$6)`,
        [entryId, e.orgId, accountId, p.direction, p.amount.minor.toString(), p.amount.currency],
      );
    }
    return { entryId, created: true };
  }

  /** Contre-passe une écriture existante (les écritures ne sont jamais modifiées). */
  async reverse(tx: Tx, entryId: string, idempotencyKey: string, description: string): Promise<{ entryId: string; created: boolean }> {
    const entry = await tx.maybeOne<{ org_id: string; entry_type: string; reference_type: string; reference_id: string }>(
      'SELECT org_id, entry_type, reference_type, reference_id FROM journal_entries WHERE id = $1',
      [entryId],
    );
    if (!entry) throw new LedgerError('Entry not found');
    const rows = await tx.query<{ code: string; direction: 'debit' | 'credit'; amount_minor: string; currency: Currency }>(
      `SELECT a.code, p.direction, p.amount_minor, p.currency
         FROM postings p JOIN ledger_accounts a ON a.id = p.account_id WHERE p.entry_id = $1`,
      [entryId],
    );
    return this.post(tx, {
      orgId: entry.org_id,
      entryType: `${entry.entry_type}.reversal`,
      referenceType: entry.reference_type,
      referenceId: entry.reference_id,
      idempotencyKey,
      description,
      reversesEntryId: entryId,
      postings: rows.map((r) => ({
        account: accountKeyFromCode(r.code),
        direction: r.direction === 'debit' ? 'credit' : 'debit',
        amount: Money.of(r.amount_minor, r.currency),
      })),
    });
  }

  private async ensureAccount(tx: Tx, orgId: string, key: AccountKey, currency: Currency): Promise<string> {
    const def = ACCOUNTS[key];
    const row = await tx.one<{ id: string }>(
      `INSERT INTO ledger_accounts (org_id, code, type, currency) VALUES ($1,$2,$3,$4)
       ON CONFLICT (org_id, code, currency) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`,
      [orgId, def.code, def.type, currency],
    );
    return row.id;
  }

  async balances(orgId: string): Promise<AccountBalance[]> {
    return this.db.forOrg(orgId, async (tx) => {
      const rows = await tx.query<{ code: string; type: AccountType; currency: Currency; debit: string; credit: string }>(
        `SELECT a.code, a.type, a.currency,
                COALESCE(SUM(p.amount_minor) FILTER (WHERE p.direction = 'debit'), 0)::text AS debit,
                COALESCE(SUM(p.amount_minor) FILTER (WHERE p.direction = 'credit'), 0)::text AS credit
           FROM ledger_accounts a LEFT JOIN postings p ON p.account_id = a.id
          GROUP BY a.id ORDER BY a.code, a.currency`,
      );
      return rows.map((r) => {
        const d = BigInt(r.debit);
        const c = BigInt(r.credit);
        const bal = normalBalance(r.type) === 'debit' ? d - c : c - d;
        return { code: r.code, type: r.type, currency: r.currency, balanceMinor: bal.toString() };
      });
    });
  }

  /** Contrôle global : Σ débits = Σ crédits par devise sur tout le ledger de l'organisation. */
  async trialBalance(orgId: string): Promise<{ currency: Currency; debit: string; credit: string; balanced: boolean }[]> {
    return this.db.forOrg(orgId, async (tx) => {
      const rows = await tx.query<{ currency: Currency; debit: string; credit: string }>(
        `SELECT currency,
                COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'debit'), 0)::text AS debit,
                COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'credit'), 0)::text AS credit
           FROM postings GROUP BY currency`,
      );
      return rows.map((r) => ({ ...r, balanced: r.debit === r.credit }));
    });
  }
}

function accountKeyFromCode(code: string): AccountKey {
  const found = (Object.keys(ACCOUNTS) as AccountKey[]).find((k) => ACCOUNTS[k].code === code);
  if (!found) throw new LedgerError(`Unknown account code ${code}`);
  return found;
}
