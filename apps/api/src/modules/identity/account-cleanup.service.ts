import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config';
import { hmacSha256Hex, randomToken } from '../../common/crypto';
import { Db } from '../../database/db.service';
import { AuditService } from '../audit/audit.service';

export const UNVERIFIED_RETENTION_DAYS = 7;

/**
 * Décision produit du 11/11/2026 : un compte jamais vérifié est libéré après 7 jours, pour qu'une
 * adresse ne reste pas bloquée par un tiers qui l'aurait utilisée à l'inscription.
 *
 * « Libérer » plutôt que supprimer : le journal d'audit (chaîné, immuable) référence le compte et
 * son organisation. L'adresse et le nom sont effacés (empreinte HMAC de l'adresse conservée
 * dans l'audit ; les e-mails sortants, sessions et nom d'organisation sont expurgés), le mot de passe et la MFA rendus inutilisables, les sessions révoquées et
 * l'organisation fermée. Le vrai titulaire peut alors s'inscrire normalement.
 * Un compte ayant la moindre activité de paiement n'est jamais libéré automatiquement.
 */
@Injectable()
export class AccountCleanupService {
  private readonly logger = new Logger('AccountCleanup');

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async releaseUnverified(limit = 100): Promise<number> {
    const candidates = await this.db.system((tx) =>
      tx.query<{ id: string }>(
        `SELECT u.id FROM users u
          WHERE u.email_verified_at IS NULL AND u.platform_role IS NULL AND u.released_at IS NULL
            AND u.created_at < now() - make_interval(days => $1)
          ORDER BY u.created_at LIMIT $2`,
        [UNVERIFIED_RETENTION_DAYS, limit],
      ),
    );
    let released = 0;
    for (const c of candidates) {
      const ok = await this.db.system(async (tx) => {
        const u = await tx.maybeOne<{ id: string; email: string }>(
          `SELECT id, email FROM users WHERE id = $1 AND email_verified_at IS NULL AND platform_role IS NULL AND released_at IS NULL AND created_at < now() - make_interval(days => $2) FOR UPDATE`,
          [c.id, UNVERIFIED_RETENTION_DAYS],
        );
        if (!u) return false;
        // Organisations dont il est l'unique membre ; toute autre appartenance ou activité → on ne touche à rien.
        const orgs = await tx.query<{ org_id: string; members: string; requests: string }>(
          `SELECT m.org_id,
                  (SELECT count(*) FROM memberships m2 WHERE m2.org_id = m.org_id)::text AS members,
                  (SELECT count(*) FROM payment_requests pr WHERE pr.org_id = m.org_id)::text AS requests
             FROM memberships m WHERE m.user_id = $1`,
          [u.id],
        );
        if (orgs.some((o) => o.members !== '1' || o.requests !== '0')) {
          this.logger.warn({ msg: 'unverified account kept: has activity or shared organization', userId: u.id });
          return false;
        }
        const placeholder = `released+${u.id}@invalid.vitpay`;
        await tx.query(
          `UPDATE users SET email = $2, full_name = 'Compte non vérifié libéré', password_hash = $3, status = 'disabled',
                  mfa_enabled = false, mfa_secret_enc = NULL, mfa_last_step = NULL, released_at = now(), updated_at = now()
            WHERE id = $1`,
          [u.id, placeholder, `released$${randomToken(16)}`], // empreinte invalide : aucune connexion possible
        );
        // [R4-C5] Minimisation : sessions sans IP ni navigateur, e-mails sortants expurgés.
        await tx.query(`UPDATE sessions SET revoked_at = coalesce(revoked_at, now()), ip = NULL, user_agent = NULL WHERE user_id = $1`, [u.id]);
        await tx.query(
          `UPDATE outbound_emails SET to_address = $2, subject = '[expurgé]', text_body = NULL, html_body = NULL,
                  status = CASE WHEN status = 'queued' THEN 'failed' ELSE status END, last_error = coalesce(last_error, 'account_released')
            WHERE lower(to_address) = lower($1)`,
          [u.email, placeholder],
        );
        await tx.query(`UPDATE email_verifications SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [u.id]);
        await tx.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [u.id]);
        for (const o of orgs) {
          await tx.query(`UPDATE organizations SET status = 'closed', display_name = 'Organisation fermée', legal_name = NULL, updated_at = now() WHERE id = $1`, [o.org_id]);
        }
        await this.audit.record(tx, {
          actor: { type: 'system' },
          action: 'auth.unverified_account_released',
          targetType: 'user',
          targetId: u.id,
          // Empreinte à clé (HMAC) : non réversible par dictionnaire sans le secret serveur.
          metadata: { emailHmac: hmacSha256Hex(this.config.APP_ENCRYPTION_KEY, `released-email:${u.email.toLowerCase()}`), closedOrganizations: orgs.map((o) => o.org_id), retentionDays: UNVERIFIED_RETENTION_DAYS },
        });
        return true;
      });
      if (ok) released += 1;
    }
    return released;
  }
}
