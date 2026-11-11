import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { APP_CONFIG, AppConfig } from '../../config';
import { Db, Tx } from '../../database/db.service';

export interface EmailMessage {
  to: string;
  template: string;
  subject: string;
  text: string;
  html?: string;
  orgId?: string | null;
}

const MAX_ATTEMPTS = 8;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Gabarit HTML minimal et sobre (compatible clients mail), texte échappé. */
export function layout(title: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join('');
  const button = cta
    ? `<p style="margin:22px 0"><a href="${esc(cta.url)}" style="background:#0b2a5b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="fr"><body style="font-family:Arial,sans-serif;background:#f5f7fb;padding:24px;color:#0f1b2d">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dde4ee;border-radius:12px;padding:24px">
<div style="font-weight:800;font-size:20px;margin-bottom:16px">VIT<span style="color:#13b5a0">PAY</span></div>
<h1 style="font-size:18px;margin:0 0 14px">${esc(title)}</h1>${body}${button}
<p style="color:#5b6b82;font-size:12px;margin-top:24px">VITPAY ne vous demandera jamais votre code PIN, votre mot de passe bancaire ou un code OTP.<br>VITPAY — One platform. Every payment. · A VIT GLOBAL TECHNOLOGIES PRODUCT</p>
</div></body></html>`;
}

/**
 * E-mails transactionnels : mis en file dans la transaction métier, envoyés par le worker,
 * corps purgé après envoi. Transports : `log` (développement / tests) ou `smtp`.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger('Email');
  private readonly transporter: Transporter | null;
  /** Transport `log` : derniers messages envoyés (tests, développement). */
  readonly sentLog: EmailMessage[] = [];

  constructor(
    private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.transporter = config.EMAIL_TRANSPORT === 'smtp' && config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  }

  async queue(tx: Tx, m: EmailMessage): Promise<void> {
    await tx.query(
      `INSERT INTO outbound_emails (org_id, to_address, template, subject, text_body, html_body) VALUES ($1,$2,$3,$4,$5,$6)`,
      [m.orgId ?? null, m.to, m.template, m.subject, m.text, m.html ?? null],
    );
  }

  async processQueue(limit = 20): Promise<number> {
    const ids = await this.db.system((tx) =>
      tx.query<{ id: string }>(`SELECT id FROM outbound_emails WHERE status = 'queued' AND available_at <= now() ORDER BY created_at LIMIT $1`, [limit]),
    );
    let sent = 0;
    for (const { id } of ids) {
      await this.db.system(async (tx) => {
        const m = await tx.maybeOne<{ id: string; to_address: string; template: string; subject: string; text_body: string; html_body: string | null; attempts: number; org_id: string | null }>(
          `SELECT * FROM outbound_emails WHERE id = $1 AND status = 'queued' FOR UPDATE SKIP LOCKED`,
          [id],
        );
        if (!m) return;
        try {
          await this.deliver({ to: m.to_address, template: m.template, subject: m.subject, text: m.text_body, html: m.html_body ?? undefined, orgId: m.org_id });
          await tx.query(`UPDATE outbound_emails SET status = 'sent', sent_at = now(), attempts = attempts + 1, text_body = NULL, html_body = NULL WHERE id = $1`, [id]);
          sent += 1;
        } catch (e) {
          const failed = m.attempts + 1 >= MAX_ATTEMPTS;
          this.logger.warn({ msg: 'email delivery failed', id, template: m.template, err: (e as Error).message });
          await tx.query(
            `UPDATE outbound_emails SET attempts = attempts + 1, last_error = $2, status = $3,
               available_at = now() + make_interval(secs => $4),
               text_body = CASE WHEN $3 = 'failed' THEN NULL ELSE text_body END,
               html_body = CASE WHEN $3 = 'failed' THEN NULL ELSE html_body END
             WHERE id = $1`,
            [id, (e as Error).message.slice(0, 500), failed ? 'failed' : 'queued', Math.min(3600, 30 * 2 ** m.attempts)],
          );
        }
      });
    }
    return sent;
  }

  private async deliver(m: EmailMessage): Promise<void> {
    if (this.transporter) {
      await this.transporter.sendMail({ from: this.config.EMAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
      return;
    }
    // Transport `log` : jamais le contenu (liens à jeton) dans les journaux.
    this.logger.log({ msg: 'email (log transport)', template: m.template, to: m.to.replace(/^(.).*(@.*)$/, '$1***$2') });
    this.sentLog.push(m);
    if (this.sentLog.length > 200) this.sentLog.shift();
  }
}
