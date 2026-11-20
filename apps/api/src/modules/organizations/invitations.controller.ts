import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../../config';
import { Errors } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService } from '../identity/auth.service';
import { Auth, Org, Public, RequireOrgPermission } from '../identity/decorators';
import { AuthContext, clientInfo, COOKIE_NAMES, OrgContext, VitpayRequest } from '../identity/session';
import { InvitationsService } from './invitations.service';

const Invite = z.object({ email: z.string().email().max(254), role: z.enum(['admin', 'cashier', 'viewer']) });
const Register = z.object({ fullName: z.string().trim().min(2).max(120), password: z.string().min(1).max(128) });
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;
const token = (t: string) => {
  if (!TOKEN_RE.test(t)) throw Errors.notFound('Invitation');
  return t;
};

@Controller('v1/orgs/:orgId/invitations')
export class OrgInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @RequireOrgPermission('members:manage')
  @Get()
  list(@Org() org: OrgContext) {
    return this.invitations.list(org.orgId);
  }

  @RequireOrgPermission('members:manage')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  invite(@Org() org: OrgContext, @Auth() a: AuthContext, @Body(new ZodPipe(Invite)) b: z.infer<typeof Invite>, @Req() req: VitpayRequest) {
    return this.invitations.invite(org.orgId, { userId: a.userId, ...clientInfo(req) }, b);
  }

  @RequireOrgPermission('members:manage')
  @Delete(':id')
  async revoke(@Org() org: OrgContext, @Auth() a: AuthContext, @Param('id', new ZodPipe(z.string().uuid())) id: string, @Req() req: VitpayRequest) {
    await this.invitations.revoke(org.orgId, { userId: a.userId, ...clientInfo(req) }, id);
    return { ok: true };
  }
}

@Controller('v1/invitations')
export class PublicInvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  view(@Param('token') t: string) {
    return this.invitations.view(token(t));
  }

  /** Utilisateur déjà connecté (même e-mail que l'invitation). */
  @HttpCode(200)
  @Post(':token/accept')
  accept(@Param('token') t: string, @Auth() a: AuthContext, @Req() req: VitpayRequest) {
    return this.invitations.acceptAsUser(token(t), { userId: a.userId, email: a.email, ...clientInfo(req) });
  }

  /** Nouveau compte créé à partir de l'invitation (pas d'organisation propre). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':token/register')
  async register(@Param('token') t: string, @Body(new ZodPipe(Register)) b: z.infer<typeof Register>, @Req() req: VitpayRequest, @Res({ passthrough: true }) res: Response) {
    const meta = clientInfo(req);
    const r = await this.invitations.acceptWithRegistration(token(t), b, meta);
    const session = await this.auth.issueBusinessSession(r.userId, meta);
    res.cookie(COOKIE_NAMES.business, session.token, { httpOnly: true, secure: this.config.COOKIE_SECURE, sameSite: 'strict', path: '/', expires: session.expiresAt });
    return { organizationId: r.orgId };
  }
}
