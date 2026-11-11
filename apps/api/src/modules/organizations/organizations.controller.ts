import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, Org, RequireOrgPermission } from '../identity/decorators';
import { AuthContext, clientInfo, OrgContext, VitpayRequest } from '../identity/session';
import { orgRolePermissions } from '../identity/permissions';
import { OrganizationsService } from './organizations.service';

const UpdateOrg = z.object({ displayName: z.string().trim().min(2).max(120).optional() });
const Kyb = z.object({
  legalName: z.string().trim().min(2).max(200),
  ice: z.string().trim().regex(/^\d{15}$/, 'ICE must have 15 digits'),
  rc: z.string().trim().min(1).max(50),
  address: z.string().trim().min(5).max(300),
});
const AddMember = z.object({ email: z.string().email(), role: z.enum(['admin', 'cashier', 'viewer']) });
const CreatePos = z.object({ name: z.string().trim().min(1).max(80) });
const ConnectProvider = z.object({
  providerCode: z.string().min(1).max(40),
  mode: z.enum(['sandbox', 'live']),
  label: z.string().max(80).optional(),
  credentials: z.record(z.string().max(500)).optional(),
  webhookSecret: z.string().max(500).optional(),
});

@Controller('v1/orgs/:orgId')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @RequireOrgPermission('org:read')
  @Get()
  async get(@Org() org: OrgContext) {
    return { ...(await this.orgs.get(org.orgId)), myRole: org.role, myPermissions: orgRolePermissions(org.role) };
  }

  @RequireOrgPermission('org:update')
  @Patch()
  async update(@Org() org: OrgContext, @Auth() a: AuthContext, @Body(new ZodPipe(UpdateOrg)) body: z.infer<typeof UpdateOrg>, @Req() req: VitpayRequest) {
    await this.orgs.update(org.orgId, a.userId, body, clientInfo(req));
    return this.orgs.get(org.orgId);
  }

  @RequireOrgPermission('org:update')
  @HttpCode(200)
  @Post('kyb')
  async kyb(@Org() org: OrgContext, @Auth() a: AuthContext, @Body(new ZodPipe(Kyb)) body: z.infer<typeof Kyb>, @Req() req: VitpayRequest) {
    await this.orgs.submitKyb(org.orgId, a.userId, body, clientInfo(req));
    return this.orgs.get(org.orgId);
  }

  @RequireOrgPermission('org:read')
  @Get('members')
  members(@Org() org: OrgContext) {
    return this.orgs.listMembers(org.orgId);
  }

  @RequireOrgPermission('members:manage')
  @Post('members')
  async addMember(@Org() org: OrgContext, @Auth() a: AuthContext, @Body(new ZodPipe(AddMember)) body: z.infer<typeof AddMember>, @Req() req: VitpayRequest) {
    await this.orgs.addMember(org.orgId, a.userId, body, clientInfo(req));
    return this.orgs.listMembers(org.orgId);
  }

  @RequireOrgPermission('members:manage')
  @Delete('members/:userId')
  async removeMember(@Org() org: OrgContext, @Auth() a: AuthContext, @Param('userId') userId: string, @Req() req: VitpayRequest) {
    await this.orgs.removeMember(org.orgId, a.userId, userId, clientInfo(req));
    return { ok: true };
  }

  @RequireOrgPermission('org:read')
  @Get('points-of-sale')
  pos(@Org() org: OrgContext) {
    return this.orgs.listPos(org.orgId);
  }

  @RequireOrgPermission('pos:manage')
  @Post('points-of-sale')
  createPos(@Org() org: OrgContext, @Auth() a: AuthContext, @Body(new ZodPipe(CreatePos)) body: z.infer<typeof CreatePos>, @Req() req: VitpayRequest) {
    return this.orgs.createPos(org.orgId, a.userId, body.name, clientInfo(req));
  }

  @RequireOrgPermission('org:read')
  @Get('providers')
  async providers(@Org() org: OrgContext) {
    return { available: this.orgs.availableProviders(), connected: await this.orgs.listProviderAccounts(org.orgId) };
  }

  @RequireOrgPermission('providers:manage')
  @Post('providers')
  connect(@Org() org: OrgContext, @Auth() a: AuthContext, @Body(new ZodPipe(ConnectProvider)) body: z.infer<typeof ConnectProvider>, @Req() req: VitpayRequest) {
    return this.orgs.connectProvider(org.orgId, a.userId, body, clientInfo(req));
  }

  @RequireOrgPermission('providers:manage')
  @Delete('providers/:accountId')
  async disconnect(@Org() org: OrgContext, @Auth() a: AuthContext, @Param('accountId') accountId: string, @Req() req: VitpayRequest) {
    await this.orgs.disableProviderAccount(org.orgId, a.userId, accountId, clientInfo(req));
    return { ok: true };
  }

  @RequireOrgPermission('org:read')
  @Get('notifications')
  notifications(@Org() org: OrgContext) {
    return this.orgs.notifications(org.orgId);
  }

  @RequireOrgPermission('org:read')
  @HttpCode(200)
  @Post('notifications/read')
  async markRead(@Org() org: OrgContext) {
    await this.orgs.markNotificationsRead(org.orgId);
    return { ok: true };
  }

  @RequireOrgPermission('org:update')
  @Get('audit')
  audit(@Org() org: OrgContext) {
    return this.orgs.auditLog(org.orgId);
  }
}
