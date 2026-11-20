import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Errors } from '../../common/errors';
import { AdminPermission, OrgPermission } from './permissions';
import { Audience, AuthContext, OrgContext, VitpayRequest } from './session';

export const META_PUBLIC = 'vitpay:public';
export const META_AUDIENCE = 'vitpay:audience';
export const META_ORG_PERMISSION = 'vitpay:org_permission';
export const META_ADMIN_PERMISSION = 'vitpay:admin_permission';
export const META_ALLOW_PENDING_MFA = 'vitpay:allow_pending_mfa';
export const META_ALLOW_SUSPENDED = 'vitpay:allow_suspended';

/** Route publique (pas d'authentification). */
export const Public = () => SetMetadata(META_PUBLIC, true);
/** Audience de session attendue (cookie distinct). Par défaut : business. */
export const ForAudience = (a: Audience) => SetMetadata(META_AUDIENCE, a);
/** Route scopée `/orgs/:orgId/...` exigeant une permission d'organisation. */
export const RequireOrgPermission = (p: OrgPermission) => SetMetadata(META_ORG_PERMISSION, p);
/** Route VITPAY ADMIN exigeant une permission plateforme. */
export const RequireAdminPermission = (p: AdminPermission) => SetMetadata(META_ADMIN_PERMISSION, p);
/** Route accessible avant la validation MFA (enrôlement, vérification, déconnexion). */
export const AllowPendingMfa = () => SetMetadata(META_ALLOW_PENDING_MFA, true);
/** Route accessible même si l'organisation est suspendue (lecture). */
export const AllowSuspendedOrg = () => SetMetadata(META_ALLOW_SUSPENDED, true);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<VitpayRequest>();
  if (!req.auth) throw Errors.unauthorized();
  return req.auth;
});

export const Org = createParamDecorator((_: unknown, ctx: ExecutionContext): OrgContext => {
  const req = ctx.switchToHttp().getRequest<VitpayRequest>();
  if (!req.org) throw Errors.forbidden('Organization context missing');
  return req.org;
});
