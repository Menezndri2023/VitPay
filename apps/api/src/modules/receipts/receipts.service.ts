import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Currency, Money } from '@vitpay/money';
import { Errors } from '../../common/errors';
import { Db, Tx } from '../../database/db.service';

interface ReceiptData {
  number: string;
  issued_at: Date;
  reference: string;
  description: string | null;
  amount_minor: string;
  currency: Currency;
  provider_code: string;
  provider_ref: string;
  succeeded_at: Date;
  display_name: string;
  mode: string;
}

const RECEIPT_SQL = `
  SELECT rc.number, rc.issued_at, pr.reference, pr.description, a.amount_minor, a.currency, a.provider_code, a.provider_ref,
         a.succeeded_at, o.display_name, pr.mode
    FROM receipts rc
    JOIN payment_attempts a ON a.id = rc.payment_attempt_id
    JOIN payment_requests pr ON pr.id = a.payment_request_id
    JOIN organizations o ON o.id = rc.org_id`;

/**
 * Reçu de paiement VITPAY : preuve que le prestataire a confirmé le paiement.
 * Ce n'est PAS une facture du commerçant (mention obligatoire sur le document).
 */
@Injectable()
export class ReceiptsService {
  constructor(private readonly db: Db) {}

  async forOrg(orgId: string, attemptId: string): Promise<Buffer> {
    const data = await this.db.forOrg(orgId, (tx) => this.load(tx, `${RECEIPT_SQL} WHERE rc.payment_attempt_id = $1`, [attemptId]));
    return this.render(data);
  }

  async forPublicToken(token: string): Promise<Buffer> {
    const data = await this.db.system((tx) =>
      this.load(tx, `${RECEIPT_SQL} WHERE pr.public_token = $1 AND a.status = 'succeeded' ORDER BY rc.issued_at LIMIT 1`, [token]),
    );
    return this.render(data);
  }

  private async load(tx: Tx, sql: string, params: unknown[]): Promise<ReceiptData> {
    const r = await tx.maybeOne<ReceiptData>(sql, params);
    if (!r) throw Errors.notFound('Receipt');
    return r;
  }

  private render(r: ReceiptData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5', margin: 40, info: { Title: `Reçu ${r.number}`, Author: 'VITPAY' } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const amount = Money.of(r.amount_minor, r.currency);
      doc.fontSize(20).fillColor('#0B3B8C').text('VITPAY', { continued: false });
      doc.fontSize(8).fillColor('#667085').text('One platform. Every payment. — A VIT GLOBAL TECHNOLOGIES PRODUCT');
      doc.moveDown(1.5);
      if (r.mode === 'sandbox') {
        doc.fontSize(10).fillColor('#B42318').text('ENVIRONNEMENT DE TEST — AUCUN PAIEMENT RÉEL', { align: 'center' });
        doc.moveDown();
      }
      doc.fontSize(14).fillColor('#101828').text('Reçu de paiement');
      doc.moveDown(0.5);
      const line = (k: string, v: string) => {
        doc.fontSize(9).fillColor('#667085').text(k);
        doc.fontSize(11).fillColor('#101828').text(v);
        doc.moveDown(0.4);
      };
      line('Numéro de reçu', r.number);
      line('Bénéficiaire', r.display_name);
      line('Montant', `${amount.toMajorString()} ${amount.currency}`);
      if (r.description) line('Motif', r.description);
      line('Référence de la demande', r.reference);
      line('Date de confirmation (UTC)', r.succeeded_at.toISOString().replace('T', ' ').slice(0, 19));
      line('Prestataire de paiement', r.provider_code);
      line('Référence prestataire', r.provider_ref);
      doc.moveDown();
      doc
        .fontSize(7.5)
        .fillColor('#667085')
        .text(
          'Ce reçu atteste que le prestataire de paiement a confirmé l’opération à VITPAY. Il ne constitue pas une facture du bénéficiaire. ' +
            'VITPAY est un service technologique de VIT GLOBAL TECHNOLOGIES GROUP S.A.R.L.A.U. ; les fonds sont traités exclusivement par le prestataire de paiement du bénéficiaire.',
        );
      doc.end();
    });
  }
}
