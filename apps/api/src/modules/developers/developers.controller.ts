import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, Org, RequireOrgPermission } from '../identity/decorators';
import { API_KEY_SCOPES } from '../identity/permissions';
import { actorOf, AuthContext, OrgContext, VitpayRequest } from '../identity/session';
import { DevelopersService, WEBHOOK_EVENTS } from './developers.service';

const UUID = z.string().uuid();
const CreateKey = z.object({ name: z.string().trim().min(2).max(60), scopes: z.array(z.string()).min(1).max(10) });
const CreateEndpoint = z.object({ url: z.string().max(500), events: z.array(z.string()).min(1).max(20) });

/** Gestion des intégrations (réservé aux sessions humaines owner/admin : une clé API ne peut pas créer de clé). */
@Controller('v1/orgs/:orgId/developers')
export class DevelopersController {
  constructor(private readonly dev: DevelopersService) {}

  @RequireOrgPermission('developers:manage')
  @Get('catalog')
  catalog() {
    return { scopes: API_KEY_SCOPES, events: WEBHOOK_EVENTS };
  }

  @RequireOrgPermission('developers:manage')
  @Get('api-keys')
  keys(@Org() org: OrgContext) {
    return this.dev.listKeys(org.orgId);
  }

  @RequireOrgPermission('developers:manage')
  @Post('api-keys')
  createKey(@Org() org: OrgContext, @Auth() a: AuthContext, @Body(new ZodPipe(CreateKey)) b: z.infer<typeof CreateKey>, @Req() req: VitpayRequest) {
    return this.dev.createKey(org.orgId, { type: 'user', ...actorOf(a, req) }, b);
  }

  @RequireOrgPermission('developers:manage')
  @Delete('api-keys/:id')
  async revokeKey(@Org() org: OrgContext, @Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Req() req: VitpayRequest) {
    await this.dev.revokeKey(org.orgId, { type: 'user', ...actorOf(a, req) }, id);
    return { ok: true };
  }

  @RequireOrgPermission('developers:manage')
  @Get('webhooks')
  endpoints(@Org() org: OrgContext) {
    return this.dev.listEndpoints(org.orgId);
  }

  @RequireOrgPermission('developers:manage')
  @Post('webhooks')
  createEndpoint(@Org() org: OrgContext, @Auth() a: AuthContext, @Body(new ZodPipe(CreateEndpoint)) b: z.infer<typeof CreateEndpoint>, @Req() req: VitpayRequest) {
    return this.dev.createEndpoint(org.orgId, { type: 'user', ...actorOf(a, req) }, b);
  }

  @RequireOrgPermission('developers:manage')
  @Delete('webhooks/:id')
  async disable(@Org() org: OrgContext, @Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Req() req: VitpayRequest) {
    await this.dev.disableEndpoint(org.orgId, { type: 'user', ...actorOf(a, req) }, id);
    return { ok: true };
  }

  @RequireOrgPermission('developers:manage')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post('webhooks/:id/test')
  test(@Org() org: OrgContext, @Param('id', new ZodPipe(UUID)) id: string) {
    return this.dev.sendTest(org.orgId, id);
  }
}
