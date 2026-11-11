import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config';
import { randomToken, sha256 } from '../../common/crypto';
import { AppError, Errors } from '../../common/errors';
import { Db, isUniqueViolation } from '../../database/db.service';
import { AuditService } from '../audit/audit.service';
import { EmailService, layout } from '../email/email.service';
import { ClientMeta } from '../identity/auth.service';
import { hashPassword, passwordPolicyError } from '../identity/password';
import { OrgRole } from '../identity/permissions';
import { assertTeamGrowthAllowed, toCamel } from './organizations.service';

const INVITE_TTL_DAYS = 7;
const MAX_INVITES_PER_DAY = 20;

/** Texte contrôlé par l'utilisateur inséré dans un e-mail : sans URL, sans retour ligne, longueur bornée (anti-hameçonnage). */
function mailSafe(v: string, max = 60): string {
  return v
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/(https?:\/\/|www\.)\S*/gi, '[lien retiré]')
    .replace(/\b[a-z0-9-]+\.(com|ma|net|org|io|co|info|xyz|me|app)\b/gi, '[lien retiré]')
    .trim()
    .slice(0, max);
}
const ROLE_LABEL: Record<string, string> = { admin: 'administrateur', cashier: 'caissier', viewer: 'lecture seule' };

interface InvitationRow {
  id: string;
  org_id: string;
  email: string;
  role: Exclude<OrgRole, 'owner'>;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  display_name?: string;
}

/** Invitations d'équipe par e-mail (lien à usage unique, 7 jours). */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async invite(orgId: string, actor: { userId: string } & ClientMeta, input: { email: string; role: Exclude<OrgRole, 'owner'> }) {
    const email = input.email.trim().toLowerCase();
    const token = randomToken(32);
    try {
      return await this.db.forOrg(orgId, async (tx) => {
        const already = await tx.maybeOne(`SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE lower(u.email) = $1`, [email]);
        if (already) throw Errors.conflict('already_member', 'This person is already a member');
        const sent = await tx.one<{ n: string }>(`SELECT count(*)::text AS n FROM org_invitations WHERE created_at > now() - interval '1 day'`);
        if (Number(sent.n) >= MAX_INVITES_PER_DAY) throw Errors.tooMany('Daily invitation limit reached');
        // Une invitation expirée ne doit pas bloquer une nouvelle invitation.
        await tx.query(
          `UPDATE org_invitations SET revoked_at = now() WHERE lower(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now()`,
          [email],
        );
        // Décision produit du 11/11/2026 (ADR-012) : en mode réel, pas d'équipe avant un KYB vérifié.
        await assertTeamGrowthAllowed(tx, orgId, this.config.PAYMENTS_LIVE_ENABLED);
        const orgRow = await tx.one<{ display_name: string }>('SELECT display_name FROM organizations WHERE id = $1', [orgId]);
        const inviterRow = await tx.one<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [actor.userId]);
        const org = { display_name: mailSafe(orgRow.display_name) };
        const inviter = { full_name: mailSafe(inviterRow.full_name, 40) };
        const inv = await tx.one<{ id: string }>(
          `INSERT INTO org_invitations (org_id, email, role, token_hash, invited_by, expires_at)
           VALUES ($1,$2,$3,$4,$5, now() + make_interval(days => $6)) RETURNING id`,
          [orgId, email, input.role, sha256(token), actor.userId, INVITE_TTL_DAYS],
        );
        const url = `${this.config.BUSINESS_APP_URL}/invite/${encodeURIComponent(token)}`;
        await this.email.queue(tx, {
          orgId,
          to: email,
          template: 'org_invitation',
          subject: `${inviter.full_name} vous invite à rejoindre ${org.display_name} sur VITPAY`,
          text: `${inviter.full_name} vous invite à rejoindre « ${org.display_name} » sur VITPAY en tant que ${ROLE_LABEL[input.role]}.\n\nAccepter l'invitation (valable ${INVITE_TTL_DAYS} jours) :\n${url}`,
          html: layout(`Invitation à rejoindre ${org.display_name}`, [`${inviter.full_name} vous invite à rejoindre « ${org.display_name} » sur VITPAY en tant que ${ROLE_LABEL[input.role]}.`, `Ce lien est valable ${INVITE_TTL_DAYS} jours.`], {
            label: 'Accepter l’invitation',
            url,
          }),
        });
        await this.audit.record(tx, { actor: { type: 'user', ...actor }, orgId, action: 'member.invited', targetType: 'invitation', targetId: inv.id, after: { role: input.role } });
        return { id: inv.id };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw Errors.conflict('invitation_pending', 'An invitation is already pending for this email');
      throw e;
    }
  }

  async list(orgId: string) {
    const rows = await this.db.forOrg(orgId, (tx) =>
      tx.query<Record<string, unknown>>(
        `SELECT id, email, role, expires_at, accepted_at, revoked_at, created_at FROM org_invitations
          WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`,
      ),
    );
    return rows.map(toCamel);
  }

  async revoke(orgId: string, actor: { userId: string } & ClientMeta, id: string) {
    await this.db.forOrg(orgId, async (tx) => {
      const r = await tx.query(`UPDATE org_invitations SET revoked_at = now() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`, [id]);
      if (!r.length) throw Errors.notFound('Invitation');
      await this.audit.record(tx, { actor: { type: 'user', ...actor }, orgId, action: 'member.invitation_revoked', targetType: 'invitation', targetId: id });
    });
  }

  private async findValid(token: string): Promise<InvitationRow & { user_exists: boolean }> {
    const r = await this.db.system((tx) =>
      tx.maybeOne<InvitationRow & { user_exists: boolean }>(
        `SELECT i.*, o.display_name, EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(i.email)) AS user_exists
           FROM org_invitations i JOIN organizations o ON o.id = i.org_id
          WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
        [sha256(token)],
      ),
    );
    if (!r) throw new AppError('invalid_invitation', 404, 'Invitation not found or expired');
    return r;
  }

  /** Vue publique de l'invitation (le destinataire connaît déjà son adresse). */
  async view(token: string) {
    const r = await this.findValid(token);
    return { organization: r.display_name, role: r.role, email: r.email, accountExists: r.user_exists, expiresAt: r.expires_at.toISOString() };
  }

  /** Acceptation par un utilisateur connecté dont l'e-mail correspond. */
  async acceptAsUser(token: string, user: { userId: string; email: string } & ClientMeta): Promise<{ orgId: string }> {
    const inv = await this.findValid(token);
    if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw Errors.forbidden('This invitation was sent to another email address');
    await this.consume(inv, user.userId, user);
    return { orgId: inv.org_id };
  }

  /** Acceptation avec création de compte (sans organisation propre). Retourne l'id utilisateur. */
  async acceptWithRegistration(token: string, input: { fullName: string; password: string }, meta: ClientMeta): Promise<{ userId: string; orgId: string }> {
    const inv = await this.findValid(token);
    if (inv.user_exists) throw Errors.conflict('account_exists', 'An account already exists for this email; sign in to accept');
    const policy = passwordPolicyError(input.password, inv.email);
    if (policy) throw Errors.validation({ password: policy });
    // Contrôle anticipé (revérifié dans consume) : pas de compte créé si l'adhésion sera refusée.
    await this.db.system((tx) => assertTeamGrowthAllowed(tx, inv.org_id, this.config.PAYMENTS_LIVE_ENABLED));
    const hash = await hashPassword(input.password);
    const userId = await this.db.system(async (tx) => {
      // Le lien d'invitation, reçu sur cette adresse, vaut vérification de l'e-mail.
      const u = await tx.one<{ id: string }>(`INSERT INTO users (email, password_hash, full_name, email_verified_at) VALUES ($1,$2,$3, now()) RETURNING id`, [inv.email, hash, input.fullName.trim()]);
      return u.id;
    });
    await this.consume(inv, userId, meta);
    return { userId, orgId: inv.org_id };
  }

  private async consume(inv: InvitationRow, userId: string, meta: ClientMeta): Promise<void> {
    await this.db.system(async (tx) => {
      const r = await tx.query(
        `UPDATE org_invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING id`,
        [inv.id, userId],
      );
      if (!r.length) throw new AppError('invalid_invitation', 404, 'Invitation not found or expired');
      // [R4-C4] Revérifié à l'acceptation : une invitation émise avant le passage en réel (ou avant un
      // KYB rejeté, une suspension) ne contourne pas la règle.
      await assertTeamGrowthAllowed(tx, inv.org_id, this.config.PAYMENTS_LIVE_ENABLED);
      await tx.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [inv.org_id, userId, inv.role]);
      // [R3-4] Le lien d'invitation, reçu sur cette adresse, vaut vérification de l'e-mail.
      await tx.query(`UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1`, [userId]);
      await this.audit.record(tx, { actor: { type: 'user', userId, ...meta }, orgId: inv.org_id, action: 'member.joined', targetType: 'user', targetId: userId, after: { role: inv.role, invitationId: inv.id } });
    });
  }
}
