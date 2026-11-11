import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import { APP_CONFIG, AppConfig } from '../../config';
import { decrypt, encrypt, randomToken, sha256 } from '../../common/crypto';
import { AppError, Errors } from '../../common/errors';
import { Db } from '../../database/db.service';
import { AuditService } from '../audit/audit.service';
import { EmailVerificationService } from './email-verification.service';
import { dummyVerify, hashPassword, passwordPolicyError, verifyPassword } from './password';
import { OrgRole, PlatformRole } from './permissions';
import { Audience, AuthContext, SESSION_TTL_HOURS } from './session';

authenticator.options = { window: 1 };

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const MAX_MFA_FAILURES = 5;
const ENROLL_TOKEN_TTL_HOURS = 72;

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  platform_role: PlatformRole | null;
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  failed_login_count: number;
  locked_until: Date | null;
  status: 'active' | 'disabled';
  locale: string;
}

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  mfaRequired: boolean;
  mfaEnrollmentRequired: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly verification: EmailVerificationService,
  ) {}

  async register(
    input: { email: string; password: string; fullName: string; organizationName: string; organizationType: 'business' | 'personal'; locale?: 'fr' | 'ar' | 'en' },
    meta: ClientMeta,
  ): Promise<LoginResult & { orgId: string }> {
    const email = input.email.trim().toLowerCase();
    const policy = passwordPolicyError(input.password, email);
    if (policy) throw Errors.validation({ password: policy });
    const passwordHash = await hashPassword(input.password);
    const orgId = randomUUID();

    const userId = await this.db.tx(
      async (tx) => {
        const exists = await tx.maybeOne('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
        // Message générique : ne pas révéler l'existence d'un compte.
        if (exists) throw Errors.conflict('registration_failed', 'Registration could not be completed');
        const user = await tx.one<{ id: string }>(
          `INSERT INTO users (email, password_hash, full_name, locale) VALUES ($1,$2,$3,$4) RETURNING id`,
          [email, passwordHash, input.fullName.trim(), input.locale ?? 'fr'],
        );
        await tx.query(`INSERT INTO organizations (id, type, display_name) VALUES ($1,$2,$3)`, [
          orgId,
          input.organizationType,
          input.organizationName.trim(),
        ]);
        await tx.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,'owner')`, [orgId, user.id]);
        await tx.query(`INSERT INTO points_of_sale (org_id, name) VALUES ($1,'Principal')`, [orgId]);
        await this.audit.record(tx, {
          actor: { type: 'user', userId: user.id, ...meta },
          orgId,
          action: 'org.created',
          targetType: 'organization',
          targetId: orgId,
          after: { type: input.organizationType, displayName: input.organizationName },
        });
        return user.id;
      },
      { orgId },
    );

    // [R3-8] Jeton créé par le rôle système (le rôle applicatif n'écrit jamais de jeton de vérification).
    await this.db.system((tx) => this.verification.queue(tx, { id: userId, email, fullName: input.fullName.trim() }));
    const session = await this.createSession(userId, 'business', true, meta);
    return { ...session, orgId, mfaRequired: false, mfaEnrollmentRequired: false };
  }

  async login(input: { email: string; password: string }, audience: Audience, meta: ClientMeta): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const user = await this.db.system((tx) => tx.maybeOne<UserRow>('SELECT * FROM users WHERE lower(email) = $1', [email]));
    const invalid = new AppError('invalid_credentials', 401, 'Invalid email or password');

    if (!user) {
      await dummyVerify(input.password);
      throw invalid;
    }
    // Le mot de passe est toujours vérifié (temps constant) avant de révéler un verrouillage.
    const ok = await verifyPassword(user.password_hash, input.password);
    if (user.locked_until && user.locked_until > new Date()) {
      throw Errors.tooMany('Account temporarily locked after too many failed attempts');
    }
    if (!ok || user.status !== 'active' || (audience === 'admin' && !user.platform_role)) {
      await this.db.system(async (tx) => {
        // Incrément atomique : des tentatives concurrentes ne peuvent pas contourner le verrouillage.
        const r = await tx.one<{ failed_login_count: number }>(
          `UPDATE users SET failed_login_count = failed_login_count + $2 WHERE id = $1 RETURNING failed_login_count`,
          [user.id, ok ? 0 : 1],
        );
        const lock = r.failed_login_count >= MAX_FAILED_LOGINS;
        if (lock) {
          await tx.query(`UPDATE users SET failed_login_count = 0, locked_until = now() + make_interval(mins => $2) WHERE id = $1`, [user.id, LOCK_MINUTES]);
        }
        await this.audit.record(tx, {
          actor: { type: 'public', ...meta },
          action: lock ? 'auth.locked' : 'auth.login_failed',
          targetType: 'user',
          targetId: user.id,
          metadata: { audience },
        });
      });
      throw invalid;
    }

    await this.db.system((tx) => tx.query('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [user.id]));
    const mfaRequired = user.mfa_enabled;
    const mfaEnrollmentRequired = audience === 'admin' && !user.mfa_enabled;
    const session = await this.createSession(user.id, audience, !mfaRequired && !mfaEnrollmentRequired, meta);
    await this.db.system((tx) =>
      this.audit.record(tx, {
        actor: { type: audience === 'admin' ? 'admin' : 'user', userId: user.id, ...meta },
        action: 'auth.login',
        targetType: 'user',
        targetId: user.id,
        metadata: { audience, mfaRequired, mfaEnrollmentRequired },
      }),
    );
    return { ...session, mfaRequired, mfaEnrollmentRequired };
  }

  /** Session Business pour un utilisateur qui vient de prouver son identité (ex. invitation acceptée). */
  async issueBusinessSession(userId: string, meta: ClientMeta): Promise<LoginResult> {
    const s = await this.createSession(userId, 'business', true, meta);
    return { ...s, mfaRequired: false, mfaEnrollmentRequired: false };
  }

  private async createSession(userId: string, audience: Audience, mfaVerified: boolean, meta: ClientMeta) {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS[audience] * 3600_000);
    await this.db.system((tx) =>
      tx.query(
        `INSERT INTO sessions (user_id, token_hash, audience, mfa_verified, ip, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [userId, sha256(token), audience, mfaVerified, meta.ip, meta.userAgent, expiresAt],
      ),
    );
    return { token, expiresAt };
  }

  async resolveSession(token: string, audience: Audience): Promise<AuthContext | null> {
    if (!token || token.length > 100) return null;
    return this.db.system(async (tx) => {
      const row = await tx.maybeOne<{
        session_id: string;
        user_id: string;
        email: string;
        full_name: string;
        mfa_verified: boolean;
        mfa_enabled: boolean;
        platform_role: PlatformRole | null;
        email_verified: boolean;
      }>(
        `UPDATE sessions s SET last_seen_at = now()
           FROM users u
          WHERE s.token_hash = $1 AND s.audience = $2 AND s.revoked_at IS NULL AND s.expires_at > now()
            AND u.id = s.user_id AND u.status = 'active'
         RETURNING s.id AS session_id, u.id AS user_id, u.email, u.full_name, s.mfa_verified, u.mfa_enabled, u.platform_role,
                   (u.email_verified_at IS NOT NULL) AS email_verified`,
        [sha256(token), audience],
      );
      if (!row) return null;
      return {
        sessionId: row.session_id,
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name,
        audience,
        mfaVerified: row.mfa_verified,
        mfaEnabled: row.mfa_enabled,
        emailVerified: row.email_verified,
        platformRole: audience === 'admin' ? row.platform_role : null,
      };
    });
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.system((tx) => tx.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [sessionId]));
  }

  /**
   * Enrôlement MFA. Pour l'administration, un jeton d'invitation à usage unique (remis hors bande)
   * est exigé : un mot de passe divulgué ne suffit pas à lier son propre authentificateur.
   */
  async mfaSetup(auth: AuthContext, enrollmentToken?: string): Promise<{ secret: string; otpauthUrl: string }> {
    if (auth.mfaEnabled) throw Errors.invalidState('MFA already enabled');
    this.assertVerifiedForMfa(auth);
    if (auth.audience === 'admin') await this.assertEnrollmentToken(auth.userId, enrollmentToken);
    const secret = authenticator.generateSecret();
    await this.db.system((tx) =>
      tx.query('UPDATE users SET mfa_secret_enc = $2 WHERE id = $1 AND mfa_enabled = false', [auth.userId, encrypt(secret, this.config.encryptionKey)]),
    );
    return { secret, otpauthUrl: authenticator.keyuri(auth.email, 'VITPAY', secret) };
  }

  /** [R3-3] Un compte non vérifié ne peut pas lier d'authentificateur (verrouillage du vrai titulaire de l'adresse). */
  private assertVerifiedForMfa(auth: AuthContext): void {
    if (!auth.emailVerified) throw new AppError('email_not_verified', 403, 'Confirm your email address first');
  }

  private async assertEnrollmentToken(userId: string, token: string | undefined): Promise<void> {
    if (!token) throw Errors.forbidden('Enrollment token required');
    const ok = await this.db.system((tx) =>
      tx.maybeOne(`SELECT 1 FROM users WHERE id = $1 AND mfa_enroll_token_hash = $2 AND mfa_enroll_expires_at > now()`, [userId, sha256(token)]),
    );
    if (!ok) throw Errors.forbidden('Invalid or expired enrollment token');
  }

  /** Vérifie un code TOTP avec anti-rejeu (pas déjà utilisé refusé). Retourne le pas accepté ou null. */
  private acceptTotp(secret: string, code: string, lastStep: string | null): number | null {
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) return null;
    const step = Math.floor(Date.now() / 1000 / 30) + delta;
    if (lastStep !== null && step <= Number(lastStep)) return null;
    return step;
  }

  async mfaEnable(auth: AuthContext, code: string, meta: ClientMeta, enrollmentToken?: string): Promise<void> {
    this.assertVerifiedForMfa(auth);
    if (auth.audience === 'admin') await this.assertEnrollmentToken(auth.userId, enrollmentToken);
    await this.db.system(async (tx) => {
      const u = await tx.one<{ mfa_secret_enc: string | null; mfa_enabled: boolean; mfa_last_step: string | null }>(
        'SELECT mfa_secret_enc, mfa_enabled, mfa_last_step FROM users WHERE id = $1 FOR UPDATE',
        [auth.userId],
      );
      if (u.mfa_enabled) throw Errors.invalidState('MFA already enabled');
      if (!u.mfa_secret_enc) throw Errors.invalidState('Call MFA setup first');
      const step = this.acceptTotp(decrypt(u.mfa_secret_enc, this.config.encryptionKey), code, u.mfa_last_step);
      if (step === null) throw new AppError('invalid_mfa_code', 401, 'Invalid code');
      await tx.query(
        'UPDATE users SET mfa_enabled = true, mfa_last_step = $2, mfa_enroll_token_hash = NULL, mfa_enroll_expires_at = NULL WHERE id = $1',
        [auth.userId, step],
      );
      await tx.query('UPDATE sessions SET mfa_verified = true WHERE id = $1', [auth.sessionId]);
      // Les autres sessions ouvertes avant l'activation de la MFA sont révoquées.
      await tx.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL', [auth.userId, auth.sessionId]);
      await this.audit.record(tx, { actor: { type: auth.audience === 'admin' ? 'admin' : 'user', userId: auth.userId, ...meta }, action: 'auth.mfa_enabled', targetType: 'user', targetId: auth.userId });
    });
  }

  async mfaVerify(auth: AuthContext, code: string, meta: ClientMeta): Promise<void> {
    const ok = await this.db.system(async (tx) => {
      const u = await tx.one<{ mfa_secret_enc: string | null; mfa_enabled: boolean; mfa_last_step: string | null }>(
        'SELECT mfa_secret_enc, mfa_enabled, mfa_last_step FROM users WHERE id = $1 FOR UPDATE',
        [auth.userId],
      );
      if (!u.mfa_enabled || !u.mfa_secret_enc) throw Errors.invalidState('MFA not enabled');
      const step = this.acceptTotp(decrypt(u.mfa_secret_enc, this.config.encryptionKey), code, u.mfa_last_step);
      await this.audit.record(tx, {
        actor: { type: auth.audience === 'admin' ? 'admin' : 'user', userId: auth.userId, ...meta },
        action: step !== null ? 'auth.mfa_verified' : 'auth.mfa_failed',
        targetType: 'user',
        targetId: auth.userId,
      });
      if (step === null) {
        // Échecs comptés par session : au-delà de 5, la session est révoquée (anti force brute).
        const s = await tx.one<{ mfa_failures: number }>('UPDATE sessions SET mfa_failures = mfa_failures + 1 WHERE id = $1 RETURNING mfa_failures', [auth.sessionId]);
        if (s.mfa_failures >= MAX_MFA_FAILURES) await tx.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [auth.sessionId]);
        return false;
      }
      await tx.query('UPDATE users SET mfa_last_step = $2 WHERE id = $1', [auth.userId, step]);
      await tx.query('UPDATE sessions SET mfa_verified = true WHERE id = $1', [auth.sessionId]);
      return true;
    });
    if (!ok) throw new AppError('invalid_mfa_code', 401, 'Invalid code');
  }

  async me(auth: AuthContext) {
    const memberships = await this.db.system((tx) =>
      tx.query<{ org_id: string; role: OrgRole; display_name: string; type: string; status: string; kyb_status: string }>(
        `SELECT m.org_id, m.role, o.display_name, o.type, o.status, o.kyb_status
           FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $1 ORDER BY o.created_at`,
        [auth.userId],
      ),
    );
    return {
      user: { id: auth.userId, email: auth.email, fullName: auth.fullName, mfaEnabled: auth.mfaEnabled, emailVerified: auth.emailVerified, platformRole: auth.platformRole },
      session: { audience: auth.audience, mfaVerified: auth.mfaVerified },
      organizations: memberships.map((m) => ({ id: m.org_id, role: m.role, displayName: m.display_name, type: m.type, status: m.status, kybStatus: m.kyb_status })),
    };
  }

  /**
   * Utilisé par le seed et le CLI d'administration uniquement.
   * Retourne un jeton d'enrôlement MFA à usage unique, à remettre hors bande à l'administrateur.
   */
  async createPlatformAdmin(email: string, password: string, fullName: string, role: PlatformRole): Promise<{ userId: string; enrollmentToken: string | null }> {
    const policy = passwordPolicyError(password, email);
    if (policy) throw new Error(policy);
    const h = await hashPassword(password);
    const token = randomToken(24);
    return this.db.system(async (tx) => {
      // [R3-1] Jamais de promotion d'un compte existant non administrateur : un compte créé par
      // inscription libre (mot de passe et MFA choisis par un tiers) ne doit pas devenir admin.
      const existing = await tx.maybeOne<{ id: string; platform_role: PlatformRole | null }>(
        'SELECT id, platform_role FROM users WHERE lower(email) = $1 FOR UPDATE',
        [email.toLowerCase()],
      );
      if (existing && !existing.platform_role) {
        throw new Error(`${email} est déjà un compte Business : utilisez une adresse dédiée à l'administration`);
      }
      const u = existing
        ? await tx.one<{ id: string; mfa_enabled: boolean }>(`UPDATE users SET platform_role = $2 WHERE id = $1 RETURNING id, mfa_enabled`, [existing.id, role])
        : await tx.one<{ id: string; mfa_enabled: boolean }>(
            `INSERT INTO users (email, password_hash, full_name, platform_role, email_verified_at) VALUES ($1,$2,$3,$4, now()) RETURNING id, mfa_enabled`,
            [email.toLowerCase(), h, fullName, role],
          );
      let enrollmentToken: string | null = null;
      if (!u.mfa_enabled) {
        await tx.query(`UPDATE users SET mfa_enroll_token_hash = $2, mfa_enroll_expires_at = now() + make_interval(hours => $3) WHERE id = $1`, [
          u.id,
          sha256(token),
          ENROLL_TOKEN_TTL_HOURS,
        ]);
        enrollmentToken = token;
      }
      await this.audit.record(tx, { actor: { type: 'system' }, action: 'admin.created', targetType: 'user', targetId: u.id, after: { role } });
      return { userId: u.id, enrollmentToken };
    });
  }
}
