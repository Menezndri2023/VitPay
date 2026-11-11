import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Currency, Money } from '@vitpay/money';
import { Errors } from '../../common/errors';
import { Db, isUniqueViolation } from '../../database/db.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { money } from '../payments/payments.service';

interface StatementRow {
  id: string;
  org_id: string;
  number: string;
  mode: 'sandbox' | 'live';
  period_start: Date | string;
  period_end: Date | string;
  currency: Currency;
  fees_minor: string;
  line_count: number;
  status: 'issued' | 'paid' | 'void';
  issued_at: Date;
  paid_at: Date | null;
  payment_reference: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  display_name?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Relevés de commissions VITPAY (modèle A) : la commission due sur les paiements confirmés
 * est facturée séparément, jamais prélevée sur les flux. Pro forma jusqu'à validation fiscale.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  view(r: StatementRow) {
    const d = (v: Date | string) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
    return {
      id: r.id,
      orgId: r.org_id,
      orgName: r.display_name,
      number: r.number,
      mode: r.mode,
      periodStart: d(r.period_start),
      periodEnd: d(r.period_end),
      fees: money(r.fees_minor, r.currency),
      lineCount: r.line_count,
      status: r.status,
      issuedAt: r.issued_at.toISOString(),
      paidAt: r.paid_at?.toISOString() ?? null,
      paymentReference: r.payment_reference,
      voidedAt: r.voided_at?.toISOString() ?? null,
      voidReason: r.void_reason,
    };
  }

  /**
   * Émet les relevés de la période pour une organisation (ou toutes) : paiements confirmés
   * (jour marocain) portant une commission > 0 et pas encore facturés. Idempotent par construction
   * (un paiement n'apparaît que dans un relevé actif).
   */
  async issue(actor: AuditActor & { userId: string }, input: { periodStart: string; periodEnd: string; mode: 'sandbox' | 'live'; orgId?: string }) {
    if (!DATE_RE.test(input.periodStart) || !DATE_RE.test(input.periodEnd) || input.periodEnd < input.periodStart) {
      throw Errors.validation({ period: 'periodStart/periodEnd must be YYYY-MM-DD with periodEnd >= periodStart' });
    }
    return this.db.system(async (tx) => {
      const groups = await tx.query<{ org_id: string; currency: Currency }>(
        `SELECT a.org_id, a.currency
           FROM payment_attempts a
           JOIN payment_requests pr ON pr.id = a.payment_request_id
          WHERE a.status = 'succeeded' AND a.vitpay_fee_minor > 0 AND pr.mode = $3
            AND (a.succeeded_at AT TIME ZONE 'Africa/Casablanca')::date BETWEEN $1::date AND $2::date
            AND ($4::uuid IS NULL OR a.org_id = $4)
            AND NOT EXISTS (SELECT 1 FROM commission_statement_lines l WHERE l.attempt_id = a.id AND l.active)
          GROUP BY a.org_id, a.currency`,
        [input.periodStart, input.periodEnd, input.mode, input.orgId ?? null],
      );
      const issued: ReturnType<BillingService['view']>[] = [];
      for (const g of groups) {
        const lines = await tx.query<{ id: string; vitpay_fee_minor: string }>(
          `SELECT a.id, a.vitpay_fee_minor FROM payment_attempts a JOIN payment_requests pr ON pr.id = a.payment_request_id
            WHERE a.org_id = $1 AND a.currency = $2 AND a.status = 'succeeded' AND a.vitpay_fee_minor > 0 AND pr.mode = $5
              AND (a.succeeded_at AT TIME ZONE 'Africa/Casablanca')::date BETWEEN $3::date AND $4::date
              AND NOT EXISTS (SELECT 1 FROM commission_statement_lines l WHERE l.attempt_id = a.id AND l.active)
            ORDER BY a.succeeded_at FOR UPDATE OF a`,
          [g.org_id, g.currency, input.periodStart, input.periodEnd, input.mode],
        );
        if (!lines.length) continue;
        const total = lines.reduce((s, l) => s.add(Money.of(l.vitpay_fee_minor, g.currency)), Money.zero(g.currency));
        const n = await tx.one<{ n: string }>(`SELECT nextval('commission_statement_seq')::text AS n`);
        const prefix = input.mode === 'sandbox' ? 'TEST-VPC' : 'VPC';
        const st = await tx.one<StatementRow>(
          `INSERT INTO commission_statements (org_id, number, mode, period_start, period_end, currency, fees_minor, line_count, status, issued_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'issued',$9) RETURNING *`,
          [g.org_id, `${prefix}-${input.periodEnd.slice(0, 4)}-${n.n.padStart(6, '0')}`, input.mode, input.periodStart, input.periodEnd, g.currency, total.minor.toString(), lines.length, actor.userId],
        );
        try {
          for (const l of lines) {
            await tx.query(`INSERT INTO commission_statement_lines (statement_id, org_id, attempt_id, fee_minor) VALUES ($1,$2,$3,$4)`, [st.id, g.org_id, l.id, l.vitpay_fee_minor]);
          }
        } catch (e) {
          if (isUniqueViolation(e)) throw Errors.conflict('already_billed', 'A payment was billed concurrently; retry');
          throw e;
        }
        await this.audit.record(tx, { actor, orgId: g.org_id, action: 'billing.statement_issued', targetType: 'commission_statement', targetId: st.id, after: { number: st.number, fees: total.toJSON(), lines: lines.length } });
        issued.push(this.view(st));
      }
      return { issued };
    });
  }

  async listAll(status?: string) {
    const rows = await this.db.system((tx) =>
      tx.query<StatementRow>(
        `SELECT s.*, o.display_name FROM commission_statements s JOIN organizations o ON o.id = s.org_id
          WHERE ($1::text IS NULL OR s.status = $1) ORDER BY s.issued_at DESC LIMIT 200`,
        [status ?? null],
      ),
    );
    return rows.map((r) => this.view(r));
  }

  async listForOrg(orgId: string) {
    const rows = await this.db.forOrg(orgId, (tx) => tx.query<StatementRow>('SELECT * FROM commission_statements ORDER BY issued_at DESC'));
    return rows.map((r) => this.view(r));
  }

  async markPaid(actor: AuditActor, id: string, reference: string) {
    await this.db.system(async (tx) => {
      const s = await tx.maybeOne<StatementRow>('SELECT * FROM commission_statements WHERE id = $1 FOR UPDATE', [id]);
      if (!s) throw Errors.notFound('Statement');
      if (s.status !== 'issued') throw Errors.invalidState(`Statement is ${s.status}`);
      await tx.query(`UPDATE commission_statements SET status = 'paid', paid_at = now(), payment_reference = $2 WHERE id = $1`, [id, reference]);
      await this.audit.record(tx, { actor, orgId: s.org_id, action: 'billing.statement_paid', targetType: 'commission_statement', targetId: id, metadata: { reference } });
    });
  }

  async void(actor: AuditActor, id: string, reason: string) {
    await this.db.system(async (tx) => {
      const s = await tx.maybeOne<StatementRow>('SELECT * FROM commission_statements WHERE id = $1 FOR UPDATE', [id]);
      if (!s) throw Errors.notFound('Statement');
      if (s.status !== 'issued') throw Errors.invalidState('Only issued (unpaid) statements can be voided');
      await tx.query(`UPDATE commission_statements SET status = 'void', voided_at = now(), void_reason = $2 WHERE id = $1`, [id, reason]);
      // Les paiements redeviennent facturables.
      await tx.query(`UPDATE commission_statement_lines SET active = false WHERE statement_id = $1`, [id]);
      await this.audit.record(tx, { actor, orgId: s.org_id, action: 'billing.statement_voided', targetType: 'commission_statement', targetId: id, reason });
    });
  }

  async pdfForOrg(orgId: string, id: string): Promise<Buffer> {
    const data = await this.db.forOrg(orgId, async (tx) => {
      const s = await tx.maybeOne<StatementRow>('SELECT s.*, o.display_name FROM commission_statements s JOIN organizations o ON o.id = s.org_id WHERE s.id = $1', [id]);
      if (!s) throw Errors.notFound('Statement');
      const lines = await tx.query<{ reference: string; succeeded_at: Date; amount_minor: string; fee_minor: string }>(
        `SELECT pr.reference, a.succeeded_at, a.amount_minor, l.fee_minor FROM commission_statement_lines l
           JOIN payment_attempts a ON a.id = l.attempt_id JOIN payment_requests pr ON pr.id = a.payment_request_id
          WHERE l.statement_id = $1 ORDER BY a.succeeded_at`,
        [id],
      );
      return { s, lines };
    });
    return this.render(data.s, data.lines);
  }

  private render(s: StatementRow, lines: { reference: string; succeeded_at: Date; amount_minor: string; fee_minor: string }[]): Promise<Buffer> {
    const v = this.view(s);
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Relevé ${s.number}`, Author: 'VITPAY' } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const fmt = (minor: string) => `${Money.of(minor, s.currency).toMajorString()} ${s.currency}`;

      doc.fontSize(20).fillColor('#0B3B8C').text('VITPAY');
      doc.fontSize(8).fillColor('#667085').text('VIT GLOBAL TECHNOLOGIES GROUP S.A.R.L.A.U. — mentions légales (RC, ICE, siège) à compléter');
      doc.moveDown();
      if (s.mode === 'sandbox') doc.fontSize(10).fillColor('#B42318').text('RELEVÉ DE TEST — SANS VALEUR', { align: 'center' }).moveDown(0.5);
      doc.fontSize(15).fillColor('#101828').text('Relevé de commissions (pro forma)');
      doc.fontSize(10).fillColor('#101828');
      doc.text(`Numéro : ${s.number}`);
      doc.text(`Client : ${s.display_name ?? ''}`);
      doc.text(`Période : du ${v.periodStart} au ${v.periodEnd}`);
      doc.text(`Statut : ${s.status}`);
      doc.moveDown();
      doc.fontSize(9).fillColor('#667085').text('Date (UTC)            Référence           Montant encaissé         Commission');
      doc.fillColor('#101828');
      for (const l of lines) {
        doc.text(`${l.succeeded_at.toISOString().slice(0, 16).replace('T', ' ')}     ${l.reference.padEnd(16)}    ${fmt(l.amount_minor).padStart(18)}    ${fmt(l.fee_minor).padStart(14)}`);
      }
      doc.moveDown();
      doc.fontSize(12).text(`Total commissions : ${fmt(s.fees_minor)}`, { align: 'right' });
      doc.moveDown(2);
      doc
        .fontSize(7.5)
        .fillColor('#667085')
        .text(
          'Document pro forma : le format de facture et le régime de TVA applicables sont en cours de validation. ' +
            'La commission VITPAY est facturée séparément : elle n’est jamais prélevée sur les fonds encaissés, qui sont traités et reversés par votre prestataire de paiement.',
        );
      doc.end();
    });
  }

}
