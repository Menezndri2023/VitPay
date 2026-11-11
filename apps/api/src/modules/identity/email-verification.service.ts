import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config';
import { randomToken, sha256 } from '../../common/crypto';
import { AppError, Errors } from '../../common/errors';
import { Db, Tx } from '../../database/db.service';
import { AuditService } from '../audit/audit.service';
import { EmailService, layout } from '../email/email.service';
import { ClientMeta } from './auth.service';

const VERIFY_TTL_HOURS = 48;
const MAX_SENDS_PER_HOUR = 3;

/**
 * Vérification de l'adresse e-mail des comptes créés par inscription libre.
 * Tant qu'elle n'est pas faite, les opérations sensibles (prestataires, équipe, intégrations,
 * dossier KYB) sont refusées : voir EMAIL_VERIFIED_PERMISSIONS dans le garde de sécurité.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Met en file le lien de vérification, dans la transaction appelante. */
  async queue(tx: Tx, user: { id: string; email: string; fullName: string }): Promise<void> {
    // Une seule demande active : les précédentes sont invalidées.
    await tx.query(`UPDATE email_verifications SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
    const token = randomToken(32);
    await tx.query(`INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES ($1,$2, now() + make_interval(hours => $3))`, [
      user.id,
      sha256(token),
      VERIFY_TTL_HOURS,
    ]);
    const url = `${this.config.BUSINESS_APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    await this.email.queue(tx, {
      to: user.email,
      template: 'email_verification',
      subject: 'Confirmez votre adresse e-mail VITPAY',
      text: `Bonjour ${user.fullName},\n\nPour confirmer votre adresse e-mail, ouvrez ce lien (valable ${VERIFY_TTL_HOURS} heures) :\n${url}\n\nSi vous n'avez pas créé de compte VITPAY, ignorez ce message : aucune opération ne sera possible sans cette confirmation.`,
      html: layout('Confirmez votre adresse e-mail', [`Bonjour ${user.fullName},`, `Ce lien est valable ${VERIFY_TTL_HOURS} heures. Si vous n'avez pas créé de compte VITPAY, ignorez ce message.`], {
        label: 'Confirmer mon adresse',
        url,
      }),
    });
  }

  /** Renvoi à la demande de l'utilisateur connecté (plafonné par compte). */
  async resend(user: { userId: string }, meta: ClientMeta): Promise<void> {
    await this.db.system(async (tx) => {
      const u = await tx.one<{ id: string; email: string; full_name: string; email_verified_at: Date | null }>(
        `SELECT id, email, full_name, email_verified_at FROM users WHERE id = $1 FOR UPDATE`,
        [user.userId],
      );
      if (u.email_verified_at) throw Errors.invalidState('Email already verified');
      const recent = await tx.one<{ n: string }>(`SELECT count(*)::text AS n FROM email_verifications WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [u.id]);
      if (Number(recent.n) >= MAX_SENDS_PER_HOUR) throw Errors.tooMany('Too many verification emails; try again later');
      await this.queue(tx, { id: u.id, email: u.email, fullName: u.full_name });
      await this.audit.record(tx, { actor: { type: 'user', userId: u.id, ...meta }, action: 'auth.email_verification_sent', targetType: 'user', targetId: u.id });
    });
  }

  /** Consomme le jeton : le lien prouve la possession de la boîte aux lettres. Pas de session requise. */
  async verify(token: string, meta: ClientMeta): Promise<void> {
    await this.db.system(async (tx) => {
      const r = await tx.maybeOne<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM email_verifications WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [sha256(token)],
      );
      if (!r) throw new AppError('invalid_token', 400, 'Invalid or expired link');
      await tx.query(`UPDATE email_verifications SET used_at = now() WHERE id = $1`, [r.id]);
      await tx.query(`UPDATE users SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = $1`, [r.user_id]);
      await this.audit.record(tx, { actor: { type: 'public', ...meta }, action: 'auth.email_verified', targetType: 'user', targetId: r.user_id });
    });
  }
}
