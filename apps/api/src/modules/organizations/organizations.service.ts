import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config';
import { encrypt } from '../../common/crypto';
import { Errors } from '../../common/errors';
import { Db, isUniqueViolation } from '../../database/db.service';
import { AuditService } from '../audit/audit.service';
import { ClientMeta } from '../identity/auth.service';
import { OrgRole } from '../identity/permissions';
import { ProviderRegistry } from '../providers/provider-registry';
import { ProviderMode } from '../providers/provider.interface';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly providers: ProviderRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async get(orgId: string) {
    return this.db.forOrg(orgId, async (tx) => {
      const o = await tx.maybeOne<Record<string, unknown>>(
        `SELECT id, type, display_name, legal_name, ice, rc, address, country, default_currency, status, kyb_status,
                kyb_submitted_at, kyb_decided_at, vitpay_fee_bps, created_at FROM organizations WHERE id = $1`,
        [orgId],
      );
      if (!o) throw Errors.notFound('Organization');
      return toCamel(o);
    });
  }

  async update(orgId: string, userId: string, patch: { displayName?: string }, meta: ClientMeta) {
    return this.db.forOrg(orgId, async (tx) => {
      const before = await tx.one<{ display_name: string }>('SELECT display_name FROM organizations WHERE id = $1', [orgId]);
      if (patch.displayName) {
        await tx.query('UPDATE organizations SET display_name = $2, updated_at = now() WHERE id = $1', [orgId, patch.displayName]);
      }
      await this.audit.record(tx, {
        actor: { type: 'user', userId, ...meta },
        orgId,
        action: 'org.updated',
        targetType: 'organization',
        targetId: orgId,
        before: { displayName: before.display_name },
        after: patch,
      });
    });
  }

  /** Soumission KYB : informations légales. La décision appartient à la conformité (Admin) et/ou au prestataire. */
  async submitKyb(orgId: string, userId: string, input: { legalName: string; ice: string; rc: string; address: string }, meta: ClientMeta) {
    return this.db.forOrg(orgId, async (tx) => {
      const o = await tx.one<{ kyb_status: string; type: string }>('SELECT kyb_status, type FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);
      if (o.kyb_status === 'verified') throw Errors.invalidState('KYB already verified; contact support to change legal details');
      await tx.query(
        `UPDATE organizations SET legal_name = $2, ice = $3, rc = $4, address = $5, kyb_status = 'submitted',
           kyb_submitted_at = now(), updated_at = now() WHERE id = $1`,
        [orgId, input.legalName, input.ice, input.rc, input.address],
      );
      await this.audit.record(tx, { actor: { type: 'user', userId, ...meta }, orgId, action: 'kyb.submitted', targetType: 'organization', targetId: orgId, metadata: { fields: Object.keys(input) } });
    });
  }

  async listMembers(orgId: string) {
    return this.db.tx(
      (tx) =>
        tx.query<{ user_id: string; email: string; full_name: string; role: OrgRole; created_at: Date }>(
          `SELECT m.user_id, u.email, u.full_name, m.role, m.created_at
             FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY m.created_at`,
          [orgId],
        ),
      { orgId },
    ).then((rows) => rows.map(toCamel));
  }

  /** Ajoute un collaborateur existant (invitation par e-mail : phase ultérieure). */
  async addMember(orgId: string, actorId: string, input: { email: string; role: Exclude<OrgRole, 'owner'> }, meta: ClientMeta) {
    return this.db.tx(
      async (tx) => {
        const u = await tx.maybeOne<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1) AND platform_role IS NULL', [input.email]);
        if (!u) throw Errors.notFound('User');
        try {
          await tx.query('INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,$3)', [orgId, u.id, input.role]);
        } catch (e) {
          if (isUniqueViolation(e)) throw Errors.conflict('already_member', 'User is already a member');
          throw e;
        }
        await this.audit.record(tx, { actor: { type: 'user', userId: actorId, ...meta }, orgId, action: 'member.added', targetType: 'user', targetId: u.id, after: { role: input.role } });
      },
      { orgId },
    );
  }

  async removeMember(orgId: string, actorId: string, userId: string, meta: ClientMeta) {
    return this.db.forOrg(orgId, async (tx) => {
      const m = await tx.maybeOne<{ role: OrgRole }>('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
      if (!m) throw Errors.notFound('Member');
      if (m.role === 'owner') throw Errors.invalidState('The owner cannot be removed');
      await tx.query('DELETE FROM memberships WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
      await this.audit.record(tx, { actor: { type: 'user', userId: actorId, ...meta }, orgId, action: 'member.removed', targetType: 'user', targetId: userId, before: { role: m.role } });
    });
  }

  async listPos(orgId: string) {
    return this.db.forOrg(orgId, (tx) => tx.query('SELECT id, name, status, created_at FROM points_of_sale ORDER BY created_at')).then((r) => r.map(toCamel));
  }

  async createPos(orgId: string, actorId: string, name: string, meta: ClientMeta) {
    return this.db.forOrg(orgId, async (tx) => {
      const p = await tx.one<{ id: string }>('INSERT INTO points_of_sale (org_id, name) VALUES ($1,$2) RETURNING id', [orgId, name]);
      await this.audit.record(tx, { actor: { type: 'user', userId: actorId, ...meta }, orgId, action: 'pos.created', targetType: 'pos', targetId: p.id, after: { name } });
      return p;
    });
  }

  async listProviderAccounts(orgId: string) {
    const rows = await this.db.forOrg(orgId, (tx) =>
      tx.query(`SELECT id, provider_code, mode, label, priority, status, created_at FROM provider_accounts ORDER BY priority, created_at`),
    );
    return rows.map(toCamel);
  }

  availableProviders() {
    return this.providers.list().map((p) => ({ code: p.code, displayName: p.displayName, modes: p.supportedModes, capabilities: p.capabilities() }));
  }

  /**
   * Modèle A : le commerçant connecte SON compte prestataire.
   * - sandbox + prestataire simulé : compte de test provisionné automatiquement ;
   * - live : identifiants fournis par le commerçant, refusé tant que le garde-fou légal est actif.
   */
  async connectProvider(
    orgId: string,
    actorId: string,
    input: { providerCode: string; mode: ProviderMode; label?: string; credentials?: Record<string, string>; webhookSecret?: string },
    meta: ClientMeta,
  ) {
    // Garde-fou réglementaire en premier : aucun compte live tant que la validation légale n'est pas faite.
    this.providers.assertModeAllowed(input.mode);
    const provider = this.providers.get(input.providerCode);
    if (!provider.supportedModes.includes(input.mode)) throw Errors.badRequest('mode_not_supported', `Provider does not support ${input.mode}`);
    if (input.mode === 'live') {
      const org = await this.db.forOrg(orgId, (tx) => tx.one<{ kyb_status: string }>('SELECT kyb_status FROM organizations WHERE id = $1', [orgId]));
      if (org.kyb_status !== 'verified') throw Errors.invalidState('KYB must be verified before connecting a live account');
    }

    const accountId = (await this.db.forOrg(orgId, (tx) => tx.one<{ id: string }>('SELECT gen_random_uuid() AS id'))).id;
    let credentials = input.credentials;
    let webhookSecret = input.webhookSecret;
    if (!credentials || !webhookSecret) {
      if (input.mode !== 'sandbox' || !provider.provisionSandboxAccount) {
        throw Errors.validation({ credentials: 'Provider credentials and webhook secret are required' });
      }
      const prov = await provider.provisionSandboxAccount({ orgId, webhookUrl: this.providers.webhookUrl(provider.code, accountId) });
      credentials = prov.credentials;
      webhookSecret = prov.webhookSecret;
    }

    try {
      return await this.db.forOrg(orgId, async (tx) => {
        await tx.query(
          `INSERT INTO provider_accounts (id, org_id, provider_code, mode, label, credentials_enc, webhook_secret_enc)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            accountId,
            orgId,
            provider.code,
            input.mode,
            input.label ?? `${provider.displayName} (${input.mode})`,
            encrypt(JSON.stringify(credentials), this.config.encryptionKey),
            encrypt(webhookSecret as string, this.config.encryptionKey),
          ],
        );
        // Les identifiants ne sont JAMAIS journalisés.
        await this.audit.record(tx, {
          actor: { type: 'user', userId: actorId, ...meta },
          orgId,
          action: 'provider_account.connected',
          targetType: 'provider_account',
          targetId: accountId,
          after: { providerCode: provider.code, mode: input.mode },
        });
        return { id: accountId, webhookUrl: this.providers.webhookUrl(provider.code, accountId) };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw Errors.conflict('provider_already_connected', 'This provider is already connected for this mode');
      throw e;
    }
  }

  async disableProviderAccount(orgId: string, actorId: string, accountId: string, meta: ClientMeta) {
    return this.db.forOrg(orgId, async (tx) => {
      const r = await tx.query(`UPDATE provider_accounts SET status = 'disabled' WHERE id = $1 RETURNING id`, [accountId]);
      if (!r.length) throw Errors.notFound('Provider account');
      await this.audit.record(tx, { actor: { type: 'user', userId: actorId, ...meta }, orgId, action: 'provider_account.disabled', targetType: 'provider_account', targetId: accountId });
    });
  }

  async notifications(orgId: string) {
    const rows = await this.db.forOrg(orgId, (tx) =>
      tx.query('SELECT id, type, title, body, data, read_at, created_at FROM notifications ORDER BY created_at DESC LIMIT 50'),
    );
    return rows.map(toCamel);
  }

  async markNotificationsRead(orgId: string) {
    await this.db.forOrg(orgId, (tx) => tx.query('UPDATE notifications SET read_at = now() WHERE read_at IS NULL'));
  }

  async auditLog(orgId: string) {
    // audit_log n'est pas sous RLS : filtrage explicite par organisation.
    const rows = await this.db.forOrg(orgId, (tx) =>
      tx.query(
        `SELECT id, occurred_at, actor_type, actor_user_id, action, target_type, target_id, reason
           FROM audit_log WHERE org_id = $1 ORDER BY id DESC LIMIT 100`,
        [orgId],
      ),
    );
    return rows.map(toCamel);
  }
}

export function toCamel<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v instanceof Date ? v.toISOString() : v;
  return out;
}
