import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Money } from '@vitpay/money';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { paymentSucceededEntry } from '../src/modules/ledger/posting-rules';
import { registerMerchant, resetDb, startApp, TestCtx } from './helpers';

describe('grand livre — invariants garantis par la base', () => {
  let ctx: TestCtx;
  let ledger: LedgerService;
  let orgId: string;
  let otherOrg: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    ledger = ctx.app.get(LedgerService);
    orgId = (await registerMerchant(ctx, 'ledger@test.test')).orgId;
    otherOrg = (await registerMerchant(ctx, 'ledger2@test.test')).orgId;
  });
  afterAll(async () => ctx.close());

  const mad = (n: number) => Money.of(n, 'MAD');

  it('refuse une écriture déséquilibrée (contrôle applicatif)', async () => {
    await expect(
      ctx.db.forOrg(orgId, (tx) =>
        ledger.post(tx, {
          orgId,
          entryType: 'test',
          referenceType: 'test',
          referenceId: '1',
          idempotencyKey: 'unbalanced-1',
          postings: [
            { account: 'PROVIDER_RECEIVABLE', direction: 'debit', amount: mad(100) },
            { account: 'GROSS_SALES', direction: 'credit', amount: mad(99) },
          ],
        }),
      ),
    ).rejects.toThrow(/Unbalanced/);
  });

  it('refuse une écriture déséquilibrée insérée directement en SQL (trigger différé)', async () => {
    await expect(
      ctx.db.forOrg(orgId, async (tx) => {
        const e = await tx.one<{ id: string }>(
          `INSERT INTO journal_entries (org_id, entry_type, reference_type, reference_id, idempotency_key) VALUES ($1,'x','x','x','raw-1') RETURNING id`,
          [orgId],
        );
        const acc = await tx.one<{ id: string }>(
          `INSERT INTO ledger_accounts (org_id, code, type, currency) VALUES ($1,'provider_receivable','asset','MAD')
           ON CONFLICT (org_id, code, currency) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
          [orgId],
        );
        await tx.query(`INSERT INTO postings (entry_id, org_id, account_id, direction, amount_minor, currency) VALUES ($1,$2,$3,'debit',100,'MAD')`, [e.id, orgId, acc.id]);
      }),
    ).rejects.toThrow(/LEDGER_ENTRY/);
  });

  it('les écritures sont immuables pour le rôle applicatif', async () => {
    await ctx.db.forOrg(orgId, (tx) =>
      ledger.post(tx, paymentSucceededEntry({ orgId, attemptId: '00000000-0000-0000-0000-000000000001', amount: mad(1000), providerFee: mad(15), vitpayFee: mad(0) })),
    );
    await expect(ctx.db.forOrg(orgId, (tx) => tx.query(`UPDATE postings SET amount_minor = 1`))).rejects.toThrow(/permission denied|IMMUTABLE/);
    await expect(ctx.db.forOrg(orgId, (tx) => tx.query(`DELETE FROM journal_entries`))).rejects.toThrow(/permission denied|IMMUTABLE/);
  });

  it('idempotence sous concurrence : 50 écritures identiques simultanées → 1 seule', async () => {
    const entry = paymentSucceededEntry({ orgId, attemptId: '00000000-0000-0000-0000-000000000002', amount: mad(5000), providerFee: mad(75), vitpayFee: mad(50) });
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => ctx.db.forOrg(orgId, (tx) => ledger.post(tx, entry))));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const created = results.filter((r) => r.status === 'fulfilled' && r.value.created).length;
    expect(created).toBe(1);
  });

  it('soldes exacts après 200 écritures concurrentes, balance générale équilibrée', async () => {
    const n = 200;
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        ctx.db.forOrg(otherOrg, (tx) =>
          ledger.post(tx, paymentSucceededEntry({ orgId: otherOrg, attemptId: `10000000-0000-0000-0000-${String(i).padStart(12, '0')}`, amount: mad(1001), providerFee: mad(15), vitpayFee: mad(10) })),
        ),
      ),
    );
    const balances = Object.fromEntries((await ledger.balances(otherOrg)).map((b) => [b.code, b.balanceMinor]));
    expect(balances.gross_sales).toBe(String(1001 * n));
    expect(balances.provider_receivable).toBe(String((1001 - 15) * n));
    expect(balances.vitpay_fees_payable).toBe(String(10 * n));
    expect((await ledger.trialBalance(otherOrg)).every((t) => t.balanced)).toBe(true);
  });

  it('une organisation ne voit jamais le ledger d’une autre (RLS)', async () => {
    const visible = await ctx.db.forOrg(orgId, (tx) => tx.query<{ org_id: string }>('SELECT DISTINCT org_id FROM postings'));
    expect(visible.every((r) => r.org_id === orgId)).toBe(true);
    await expect(
      ctx.db.forOrg(orgId, (tx) =>
        ledger.post(tx, paymentSucceededEntry({ orgId: otherOrg, attemptId: '00000000-0000-0000-0000-000000000003', amount: mad(1), providerFee: mad(0), vitpayFee: mad(0) })),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('une ligne ne peut pas viser le compte d’une autre organisation (trigger SECURITY DEFINER)', async () => {
    const foreign = await ctx.db.forOrg(otherOrg, (tx) => tx.one<{ id: string }>(`SELECT id FROM ledger_accounts LIMIT 1`));
    await expect(
      ctx.db.forOrg(orgId, async (tx) => {
        const e = await tx.one<{ id: string }>(
          `INSERT INTO journal_entries (org_id, entry_type, reference_type, reference_id, idempotency_key) VALUES ($1,'x','x','x','cross-1') RETURNING id`,
          [orgId],
        );
        await tx.query(`INSERT INTO postings (entry_id, org_id, account_id, direction, amount_minor, currency) VALUES ($1,$2,$3,'debit',100,'MAD')`, [e.id, orgId, foreign.id]);
        await tx.query(`INSERT INTO postings (entry_id, org_id, account_id, direction, amount_minor, currency) VALUES ($1,$2,$3,'credit',100,'MAD')`, [e.id, orgId, foreign.id]);
      }),
    ).rejects.toThrow(/LEDGER_ORG_MISMATCH/);
  });

  it('contre-passation : soldes revenus à zéro', async () => {
    const r = await ctx.db.forOrg(orgId, (tx) =>
      ledger.post(tx, paymentSucceededEntry({ orgId, attemptId: '00000000-0000-0000-0000-000000000009', amount: mad(777), providerFee: mad(7), vitpayFee: mad(0) })),
    );
    const before = Object.fromEntries((await ledger.balances(orgId)).map((b) => [b.code, BigInt(b.balanceMinor)]));
    await ctx.db.forOrg(orgId, (tx) => ledger.reverse(tx, r.entryId, `reverse:${r.entryId}`, 'test'));
    const after = Object.fromEntries((await ledger.balances(orgId)).map((b) => [b.code, BigInt(b.balanceMinor)]));
    expect((before.gross_sales as bigint) - (after.gross_sales as bigint)).toBe(777n);
  });
});
