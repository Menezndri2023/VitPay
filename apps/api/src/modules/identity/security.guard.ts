import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, AppConfig } from '../../config';
import { Errors } from '../../common/errors';
import { Db } from '../../database/db.service';
import { AuthService } from './auth.service';
import {
  META_ADMIN_PERMISSION,
  META_ALLOW_PENDING_MFA,
  META_ALLOW_SUSPENDED,
  META_AUDIENCE,
  META_ORG_PERMISSION,
  META_PUBLIC,
} from './decorators';
import { AdminPermission, OrgPermission, OrgRole, orgRoleHas, platformRoleHas } from './permissions';
import { Audience, COOKIE_NAMES, VitpayRequest } from './session';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-vitpay-csrf';

/**
 * Garde unique, appliquée à TOUTES les routes (deny by default) :
 * authentification → CSRF → MFA → permissions plateforme ou organisation.
 */
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    if (this.meta<boolean>(META_PUBLIC, ctx)) return true;

    const req = ctx.switchToHttp().getRequest<VitpayRequest>();
    const audience = this.meta<Audience>(META_AUDIENCE, ctx) ?? 'business';
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAMES[audience]];
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const token = bearer ?? cookieToken;
    if (!token) throw Errors.unauthorized();

    // CSRF : une session portée par cookie exige un en-tête personnalisé (non envoyable
    // cross-site sans preflight CORS) et une origine autorisée.
    if (!bearer && !SAFE_METHODS.has(req.method)) {
      if (req.headers[CSRF_HEADER] !== '1') throw Errors.forbidden('CSRF header missing');
      const origin = req.headers.origin;
      if (origin && !this.config.allowedOrigins.includes(origin)) throw Errors.forbidden('Origin not allowed');
    }

    const auth = await this.auth.resolveSession(token, audience);
    if (!auth) throw Errors.unauthorized('Session expired or invalid');
    req.auth = auth;

    if (!auth.mfaVerified && !this.meta<boolean>(META_ALLOW_PENDING_MFA, ctx)) {
      throw Errors.forbidden(audience === 'admin' && !auth.mfaEnabled ? 'MFA enrollment required' : 'MFA verification required');
    }

    const adminPerm = this.meta<AdminPermission>(META_ADMIN_PERMISSION, ctx);
    if (adminPerm) {
      if (audience !== 'admin' || !auth.platformRole || !platformRoleHas(auth.platformRole, adminPerm)) {
        throw Errors.forbidden(`Missing permission ${adminPerm}`);
      }
    }

    const orgPerm = this.meta<OrgPermission>(META_ORG_PERMISSION, ctx);
    if (orgPerm) {
      const orgId = (req.params as Record<string, string>).orgId;
      if (!orgId || !UUID_RE.test(orgId)) throw Errors.notFound('Organization');
      const m = await this.db.tx(
        (tx) =>
          tx.maybeOne<{ role: OrgRole; status: string }>(
            `SELECT m.role, o.status FROM memberships m JOIN organizations o ON o.id = m.org_id
              WHERE m.org_id = $1 AND m.user_id = $2`,
            [orgId, auth.userId],
          ),
        { orgId },
      );
      // 404 plutôt que 403 : ne pas révéler l'existence d'une organisation tierce.
      if (!m) throw Errors.notFound('Organization');
      if (!orgRoleHas(m.role, orgPerm)) throw Errors.forbidden(`Missing permission ${orgPerm}`);
      if (m.status !== 'active' && !SAFE_METHODS.has(req.method) && !this.meta<boolean>(META_ALLOW_SUSPENDED, ctx)) {
        throw Errors.forbidden('Organization is suspended');
      }
      req.org = { orgId, role: m.role };
    }

    return true;
  }
}
