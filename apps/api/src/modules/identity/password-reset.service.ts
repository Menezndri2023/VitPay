import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config';
import { randomToken, sha256 } from '../../common/crypto';
import { AppError, Errors } from '../../common/errors';
import { Db } from '../../database/db.service';
import { AuditService } from '../audit/audit.service';
import { EmailService, layout } from '../email/email.service';
import { ClientMeta } from './auth.service';
import { hashPassword, passwordPolicyError } from './password';

const RESET_TTL_MINUTES = 30;

/**
 * Mot de passe oublié (espace Business uniquement ; les comptes d'administration sont
 * réinitialisés par un Super Admin). Réponse identique que le compte existe ou non.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async request(emailInput: string, meta: ClientMeta): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    await this.db.system(async (tx) => {
      const u = await tx.maybeOne<{ id: string; full_name: string; email: string }>(
        `SELECT id, full_name, email FROM users WHERE lower(email) = $1 AND status = 'active' AND platform_role IS NULL`,
        [email],
      );
      if (!u) return;
      // Plafond par compte (en plus de la limitation par IP) : 3 demandes par heure.
      const recent = await tx.one<{ n: string }>(`SELECT count(*)::text AS n FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [u.id]);
      if (Number(recent.n) >= 3) return;
      // Une seule demande active : les précédentes sont invalidées.
      await tx.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [u.id]);
      const token = randomToken(32);
      await tx.query(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1,$2, now() + make_interval(mins => $3))`, [
        u.id,
        sha256(token),
        RESET_TTL_MINUTES,
      ]);
      const url = `${this.config.BUSINESS_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await this.email.queue(tx, {
        to: u.email,
        template: 'password_reset',
        subject: 'Réinitialisation de votre mot de passe VITPAY',
        text: `Bonjour ${u.full_name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable ${RESET_TTL_MINUTES} minutes) :\n${url}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.`,
        html: layout('Réinitialisation du mot de passe', [`Bonjour ${u.full_name},`, `Ce lien est valable ${RESET_TTL_MINUTES} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`], {
          label: 'Choisir un nouveau mot de passe',
          url,
        }),
      });
      await this.audit.record(tx, { actor: { type: 'public', ...meta }, action: 'auth.password_reset_requested', targetType: 'user', targetId: u.id });
    });
  }

  async reset(token: string, password: string, meta: ClientMeta): Promise<void> {
    const pwHashPromise = (async () => {
      const row = await this.db.system((tx) =>
        tx.maybeOne<{ email: string }>(
          `SELECT u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = $1`,
          [sha256(token)],
        ),
      );
      if (row) {
        const policy = passwordPolicyError(password, row.email);
        if (policy) throw Errors.validation({ password: policy });
      }
      return hashPassword(password);
    })();
    const hash = await pwHashPromise;
    await this.db.system(async (tx) => {
      const r = await tx.maybeOne<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [sha256(token)],
      );
      if (!r) throw new AppError('invalid_token', 400, 'Invalid or expired link');
      await tx.query(`UPDATE password_resets SET used_at = now() WHERE id = $1`, [r.id]);
      // [R3-3] Compte jamais vérifié : la MFA éventuelle a pu être posée par un tiers ; elle est retirée.
      await tx.query(
        `UPDATE users SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_last_step = NULL WHERE id = $1 AND email_verified_at IS NULL AND platform_role IS NULL`,
        [r.user_id],
      );
      // Le lien reçu par e-mail prouve aussi la possession de l'adresse.
      await tx.query(`UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL,
                   email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = $1`, [r.user_id, hash]);
      // Toutes les sessions existantes sont révoquées.
      await tx.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [r.user_id]);
      await this.audit.record(tx, { actor: { type: 'public', ...meta }, action: 'auth.password_reset', targetType: 'user', targetId: r.user_id });
    });
  }
}
