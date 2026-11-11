import { Injectable } from '@nestjs/common';
import { Money } from '@vitpay/money';
import { Errors } from '../../common/errors';
import { Db } from '../../database/db.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { LedgerService } from '../ledger/ledger.service';
import { settlementEntry } from '../ledger/posting-rules';
import { IncidentsService } from '../platform/incidents.service';
import { PaymentAttemptRow } from '../payments/payments.service';
import { ProviderRegistry } from '../providers/provider-registry';

type ItemResult = 'matched' | 'missing_in_ledger' | 'missing_in_provider' | 'amount_mismatch' | 'fee_mismatch';

/**
 * Rapprochement quotidien : rapport de règlement du prestataire ↔ tentatives et ledger VITPAY.
 * Toute anomalie produit un incident ; seules les lignes concordantes sont marquées réglées.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly db: Db,
    private readonly providers: ProviderRegistry,
    private readonly ledger: LedgerService,
    private readonly incidents: IncidentsService,
    private readonly audit: AuditService,
  ) {}

  async run(accountId: string, date: string, actor: AuditActor) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Errors.validation({ date: 'Expected YYYY-MM-DD' });
    const account = await this.db.system((tx) => this.providers.loadAccount(tx, accountId));
    const provider = this.providers.get(account.provider_code);
    if (!provider.capabilities().settlementReports) throw Errors.invalidState('Provider does not expose settlement reports');
    const report = await provider.fetchSettlementReport(this.providers.context(account), date);
    const orgId = account.org_id;

    return this.db.forOrg(orgId, async (tx) => {
      const items: { providerRef: string | null; attemptId: string | null; result: ItemResult; details: Record<string, unknown> }[] = [];
      const seen = new Set<string>();

      for (const line of report.lines) {
        seen.add(line.paymentRef);
        const a = await tx.maybeOne<PaymentAttemptRow>(
          'SELECT * FROM payment_attempts WHERE provider_account_id = $1 AND provider_ref = $2 FOR UPDATE',
          [account.id, line.paymentRef],
        );
        if (!a || a.status !== 'succeeded') {
          items.push({ providerRef: line.paymentRef, attemptId: a?.id ?? null, result: 'missing_in_ledger', details: { gross: line.gross.toJSON(), vitpayStatus: a?.status ?? null } });
          continue;
        }
        const gross = Money.of(a.amount_minor, a.currency);
        if (!line.gross.equals(gross)) {
          items.push({ providerRef: line.paymentRef, attemptId: a.id, result: 'amount_mismatch', details: { provider: line.gross.toJSON(), vitpay: gross.toJSON() } });
          continue;
        }
        const fee = Money.of(a.provider_fee_minor ?? '0', a.currency);
        if (!line.fee.equals(fee)) {
          items.push({ providerRef: line.paymentRef, attemptId: a.id, result: 'fee_mismatch', details: { provider: line.fee.toJSON(), vitpay: fee.toJSON() } });
          continue;
        }
        // Le net déclaré doit être cohérent avec brut - frais (revue R9).
        if (!line.net.equals(line.gross.subtract(line.fee))) {
          items.push({ providerRef: line.paymentRef, attemptId: a.id, result: 'amount_mismatch', details: { reason: 'net != gross - fee', net: line.net.toJSON(), gross: line.gross.toJSON(), fee: line.fee.toJSON() } });
          continue;
        }
        if (a.settlement_status === 'unsettled') {
          await tx.query(`UPDATE payment_attempts SET settlement_status = 'settled', settled_at = now(), settlement_ref = $2, updated_at = now() WHERE id = $1`, [
            a.id,
            line.payoutRef,
          ]);
          await this.ledger.post(tx, settlementEntry({ orgId, attemptId: a.id, settlementRef: line.payoutRef, net: line.net }));
        }
        items.push({ providerRef: line.paymentRef, attemptId: a.id, result: 'matched', details: { net: line.net.toJSON() } });
      }

      // Paiements confirmés chez VITPAY ce jour-là mais absents du rapport.
      const ours = await tx.query<{ id: string; provider_ref: string }>(
        `SELECT id, provider_ref FROM payment_attempts
          WHERE provider_account_id = $1 AND status = 'succeeded' AND succeeded_at >= $2::date AND succeeded_at < ($2::date + 1)`,
        [account.id, date],
      );
      for (const a of ours) if (!seen.has(a.provider_ref)) items.push({ providerRef: a.provider_ref, attemptId: a.id, result: 'missing_in_provider', details: {} });

      for (const p of report.payouts) {
        await tx.query(
          `INSERT INTO payouts (org_id, provider_account_id, provider_ref, amount_minor, currency, status, report_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (provider_account_id, provider_ref) DO UPDATE SET status = EXCLUDED.status`,
          [orgId, account.id, p.payoutRef, p.amount.minor.toString(), p.amount.currency, p.status, date],
        );
      }

      const mismatches = items.filter((i) => i.result !== 'matched');
      const stats = items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.result]: (acc[i.result] ?? 0) + 1 }), {});
      const run = await tx.one<{ id: string }>(
        `INSERT INTO reconciliation_runs (org_id, provider_account_id, report_date, status, stats) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [orgId, account.id, date, mismatches.length ? 'completed_with_mismatches' : 'completed', JSON.stringify(stats)],
      );
      for (const i of items) {
        await tx.query(`INSERT INTO reconciliation_items (run_id, org_id, provider_ref, attempt_id, result, details) VALUES ($1,$2,$3,$4,$5,$6)`, [
          run.id,
          orgId,
          i.providerRef,
          i.attemptId,
          i.result,
          JSON.stringify(i.details),
        ]);
      }
      if (mismatches.length) {
        await this.incidents.open(tx, {
          orgId,
          type: 'reconciliation_mismatch',
          severity: 'high',
          summary: `${mismatches.length} reconciliation mismatch(es) on ${date} for account ${account.id}`,
          details: { runId: run.id, stats },
          dedupeKey: `recon:${account.id}:${date}:${run.id}`,
        });
      }
      await this.audit.record(tx, { actor, orgId, action: 'reconciliation.run', targetType: 'provider_account', targetId: account.id, metadata: { date, stats, runId: run.id } });
      return { runId: run.id, date, status: mismatches.length ? 'completed_with_mismatches' : 'completed', stats, items };
    });
  }
}
