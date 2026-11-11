import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Currency, Money } from '@vitpay/money';
import { Errors } from '../../common/errors';
import { Db, isUniqueViolation, Tx } from '../../database/db.service';
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

/** Aucun remboursement en cours ni litige ouvert : le montant dû est définitif. */
const SETTLED = `NOT EXISTS (SELECT 1 FROM refunds r WHERE r.payment_attempt_id = a.id AND r.status IN ('requested','pending'))
  AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.payment_attempt_id = a.id AND d.status IN ('opened','evidence_submitted'))`;
/** Total net déjà facturé pour le paiement (débits − avoirs des relevés non annulés). */
const BILLED = `(SELECT COALESCE(SUM(l.fee_minor),0) FROM commission_statement_lines l WHERE l.attempt_id = a.id AND l.active)`;
/** Commission nette due (après annulation sur la part remboursée ou perdue en litige). */
const DUE = `(COALESCE(a.vitpay_fee_minor,0) - a.vitpay_fee_waived_minor)`;
/**
 * [R4-C1/C2] Paiement à régulariser : confirmé au plus tard en fin de période, montant définitif,
 * et écart entre dû et facturé non nul. L'écart est facturé (> 0) ou crédité (< 0) : rattrapage
 * automatique des paiements reportés et cohérence garantie après l'annulation d'un relevé.
 */
const TO_BILL = `a.status = 'succeeded' AND a.vitpay_fee_minor IS NOT NULL
  AND (a.succeeded_at AT TIME ZONE 'Africa/Casablanca')::date <= $PERIOD_END::date
  AND ${SETTLED}
  AND ${DUE} <> ${BILLED}`;

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
   * Émet les relevés arrêtés à la fin de période pour une organisation (ou toutes).
   * Pour chaque paiement confirmé au plus tard ce jour-là (jour marocain) et dont le montant est
   * définitif (aucun remboursement en cours, aucun litige ouvert), l'écart entre la commission
   * NETTE due et le total déjà facturé (relevés non annulés) devient une ligne : débit si positif,
   * avoir si négatif. Les paiements reportés sont rattrapés au relevé suivant ; l'annulation d'un
   * relevé est corrigée automatiquement ; réémettre ne produit rien (écart nul).
   */
  async issue(actor: AuditActor & { userId: string }, input: { periodStart: string; periodEnd: string; mode: 'sandbox' | 'live'; orgId?: string }) {
    if (!DATE_RE.test(input.periodStart) || !DATE_RE.test(input.periodEnd) || input.periodEnd < input.periodStart) {
      throw Errors.validation({ period: 'periodStart/periodEnd must be YYYY-MM-DD with periodEnd >= periodStart' });
    }
    // Une transaction PAR organisation et devise : pas de verrou global, un conflit n'annule pas les autres relevés.
    const groups = await this.db.system((tx) =>
      tx.query<{ org_id: string; currency: Currency }>(
        `SELECT DISTINCT a.org_id, a.currency FROM payment_attempts a JOIN payment_requests pr ON pr.id = a.payment_request_id
          WHERE ${TO_BILL.replace('$PERIOD_END', '$1')} AND pr.mode = $2 AND ($3::uuid IS NULL OR a.org_id = $3)`,
        [input.periodEnd, input.mode, input.orgId ?? null],
      ),
    );
    const issued: ReturnType<BillingService['view']>[] = [];
    const conflicts: string[] = [];
    // [R5-5] Solde créditeur reporté : signalé à la finance (distinct de « rien à facturer »).
    const deferred: { orgId: string; credit: ReturnType<typeof money> }[] = [];
    for (const g of groups) {
      try {
        const st = await this.db.system((tx) => this.issueOne(tx, actor, input, g, (net) => deferred.push({ orgId: g.org_id, credit: money(net.negate().minor.toString(), g.currency) })));
        if (st) issued.push(st);
      } catch (e) {
        if (isUniqueViolation(e)) conflicts.push(g.org_id);
        else throw e;
      }
    }
    return { issued, conflicts, deferred };
  }

  private async issueOne(
    tx: Tx,
    actor: AuditActor & { userId: string },
    input: { periodStart: string; periodEnd: string; mode: 'sandbox' | 'live' },
    g: { org_id: string; currency: Currency },
    onDeferred: (net: Money) => void = () => undefined,
  ): Promise<ReturnType<BillingService['view']> | null> {
    // [R4-P1] Un seul calcul à la fois par organisation, devise et mode : deux émissions simultanées
    // ne peuvent pas compter deux fois le même écart (les requêtes suivantes voient l'état validé).
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('billing:' || $1 || ':' || $2 || ':' || $3))`, [g.org_id, g.currency, input.mode]);
    const lines = await tx.query<{ id: string; diff_minor: string }>(
      `SELECT a.id, (${DUE} - ${BILLED})::text AS diff_minor
         FROM payment_attempts a JOIN payment_requests pr ON pr.id = a.payment_request_id
        WHERE a.org_id = $1 AND a.currency = $2 AND pr.mode = $4 AND ${TO_BILL.replace('$PERIOD_END', '$3')}
        ORDER BY a.succeeded_at FOR UPDATE OF a`,
      [g.org_id, g.currency, input.periodEnd, input.mode],
    );
    if (!lines.length) return null;
    const charges = lines.filter((l) => !l.diff_minor.startsWith('-'));
    const credits = lines.filter((l) => l.diff_minor.startsWith('-'));
    const total = lines.reduce((sum, l) => sum.add(Money.of(l.diff_minor, g.currency)), Money.zero(g.currency));
    // Modèle A : VITPAY ne verse jamais de fonds. Un solde créditeur (avoir) n'est pas émis en relevé
    // négatif : les lignes restent en attente et s'imputent sur le prochain relevé positif.
    if (total.compare(Money.zero(g.currency)) <= 0) {
      if (total.isNegative()) onDeferred(total);
      return null;
    }
    const n = await tx.one<{ n: string }>(`SELECT nextval('commission_statement_seq')::text AS n`);
    const prefix = input.mode === 'sandbox' ? 'TEST-VPC' : 'VPC';
    const st = await tx.one<StatementRow>(
      `INSERT INTO commission_statements (org_id, number, mode, period_start, period_end, currency, fees_minor, line_count, status, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'issued',$9) RETURNING *`,
      [g.org_id, `${prefix}-${input.periodEnd.slice(0, 4)}-${n.n.padStart(6, '0')}`, input.mode, input.periodStart, input.periodEnd, g.currency, total.minor.toString(), charges.length + credits.length, actor.userId],
    );
    for (const l of lines) {
      await tx.query(`INSERT INTO commission_statement_lines (statement_id, org_id, attempt_id, fee_minor, kind) VALUES ($1,$2,$3,$4,$5)`, [
        st.id,
        g.org_id,
        l.id,
        l.diff_minor,
        l.diff_minor.startsWith('-') ? 'credit' : 'charge',
      ]);
    }
    await this.audit.record(tx, {
      actor,
      orgId: g.org_id,
      action: 'billing.statement_issued',
      targetType: 'commission_statement',
      targetId: st.id,
      after: { number: st.number, fees: total.toJSON(), charges: charges.length, credits: credits.length },
    });
    return this.view(st);
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

  /**
   * [R5-6] Avoir en attente d'imputation, NET des commissions pas encore facturées (position réelle
   * du commerçant), par devise et mode ; affiché seulement s'il est en sa faveur.
   */
  async pendingCredits(orgId: string) {
    const rows = await this.db.forOrg(orgId, (tx) =>
      tx.query<{ currency: Currency; mode: string; net_minor: string }>(
        `SELECT a.currency, pr.mode, SUM(${DUE} - ${BILLED})::text AS net_minor
           FROM payment_attempts a JOIN payment_requests pr ON pr.id = a.payment_request_id
          WHERE a.org_id = $1 AND a.status = 'succeeded' AND a.vitpay_fee_minor IS NOT NULL AND ${SETTLED} AND ${DUE} <> ${BILLED}
          GROUP BY a.currency, pr.mode
         HAVING SUM(${DUE} - ${BILLED}) < 0`,
        [orgId],
      ),
    );
    return rows.map((r) => ({ mode: r.mode, credit: money(r.net_minor.replace('-', ''), r.currency) }));
  }

  async markPaid(actor: AuditActor, id: string, reference: string) {
    await this.db.system(async (tx) => {
      const s = await tx.maybeOne<StatementRow>('SELECT * FROM commission_statements WHERE id = $1 FOR UPDATE', [id]);
      if (!s) throw Errors.notFound('Statement');
      if (s.status !== 'issued') throw Errors.invalidState(`Statement is ${s.status}`);
      if (String(s.fees_minor).startsWith('-')) throw Errors.invalidState('A credit statement cannot be marked as paid');
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
      const lines = await tx.query<{ reference: string; succeeded_at: Date; amount_minor: string; fee_minor: string; kind: string }>(
        `SELECT pr.reference, a.succeeded_at, a.amount_minor, l.fee_minor, l.kind FROM commission_statement_lines l
           JOIN payment_attempts a ON a.id = l.attempt_id JOIN payment_requests pr ON pr.id = a.payment_request_id
          WHERE l.statement_id = $1 ORDER BY a.succeeded_at`,
        [id],
      );
      return { s, lines };
    });
    return this.render(data.s, data.lines);
  }

  private render(s: StatementRow, lines: { reference: string; succeeded_at: Date; amount_minor: string; fee_minor: string; kind: string }[]): Promise<Buffer> {
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
        const label = l.kind === 'credit' ? `${l.reference} (avoir)` : l.reference;
        doc.text(`${l.succeeded_at.toISOString().slice(0, 16).replace('T', ' ')}     ${label.padEnd(16)}    ${fmt(l.amount_minor).padStart(18)}    ${fmt(l.fee_minor).padStart(14)}`);
      }
      doc.moveDown();
      const negative = s.fees_minor.startsWith('-');
      doc.fontSize(12).text(negative ? `Avoir en votre faveur : ${fmt(s.fees_minor.slice(1))}` : `Total commissions : ${fmt(s.fees_minor)}`, { align: 'right' });
      doc.moveDown(2);
      doc
        .fontSize(7.5)
        .fillColor('#667085')
        .text(
          'Document pro forma : le format de facture et le régime de TVA applicables sont en cours de validation. ' +
            'Aucune commission n’est due sur la part remboursée ou perdue en litige ; une commission déjà facturée fait l’objet d’un avoir. ' +
            'La commission VITPAY est facturée séparément : elle n’est jamais prélevée sur les fonds encaissés, qui sont traités et reversés par votre prestataire de paiement.',
        );
      doc.end();
    });
  }

}
