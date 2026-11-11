import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, ForAudience, RequireAdminPermission } from '../identity/decorators';
import { AuthContext, clientInfo, VitpayRequest } from '../identity/session';
import { AdminService } from './admin.service';

const UUID = z.string().uuid();
const Reason = z.object({ reason: z.string().trim().min(5).max(500) });
const Kyb = z.object({ decision: z.enum(['verified', 'rejected']), reason: z.string().trim().min(5).max(500) });
const Approval = z.object({
  action: z.enum(['org.fee.update', 'org.reactivate']),
  targetId: UUID,
  payload: z.record(z.string(), z.unknown()).default({}),
  reason: z.string().trim().min(5).max(500),
});
const Decision = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().min(3).max(500) });
const Note = z.object({ note: z.string().trim().min(3).max(1000) });
const Recon = z.object({ providerAccountId: UUID, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const Opt = z.string().max(100).optional();

@ForAudience('admin')
@Controller('v1/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @RequireAdminPermission('dashboard:read')
  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @RequireAdminPermission('orgs:read')
  @Get('organizations')
  orgs(@Auth() a: AuthContext, @Query('q', new ZodPipe(Opt)) q?: string, @Query('status', new ZodPipe(Opt)) status?: string) {
    return this.admin.listOrgs(a, q, status);
  }

  @RequireAdminPermission('orgs:read')
  @Get('organizations/:id')
  org(@Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string) {
    return this.admin.getOrg(a, id);
  }

  @RequireAdminPermission('orgs:suspend')
  @HttpCode(200)
  @Post('organizations/:id/suspend')
  async suspend(@Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Body(new ZodPipe(Reason)) b: z.infer<typeof Reason>, @Req() req: VitpayRequest) {
    await this.admin.suspendOrg(a, id, b.reason, clientInfo(req));
    return { ok: true };
  }

  @RequireAdminPermission('kyb:decide')
  @HttpCode(200)
  @Post('organizations/:id/kyb')
  async kyb(@Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Body(new ZodPipe(Kyb)) b: z.infer<typeof Kyb>, @Req() req: VitpayRequest) {
    await this.admin.decideKyb(a, id, b.decision, b.reason, clientInfo(req));
    return { ok: true };
  }

  @RequireAdminPermission('approvals:request')
  @Post('approvals')
  requestApproval(@Auth() a: AuthContext, @Body(new ZodPipe(Approval)) b: z.infer<typeof Approval>, @Req() req: VitpayRequest) {
    return this.admin.requestApproval(a, b, clientInfo(req));
  }

  @RequireAdminPermission('approvals:request')
  @Get('approvals')
  approvals(@Query('status', new ZodPipe(Opt)) status?: string) {
    return this.admin.listApprovals(status);
  }

  @RequireAdminPermission('approvals:decide')
  @HttpCode(200)
  @Post('approvals/:id/decision')
  async decide(@Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Body(new ZodPipe(Decision)) b: z.infer<typeof Decision>, @Req() req: VitpayRequest) {
    await this.admin.decideApproval(a, id, b.decision, b.note, clientInfo(req));
    return { ok: true };
  }

  @RequireAdminPermission('payments:read')
  @Get('payments')
  payments(@Query('q', new ZodPipe(Opt)) q?: string, @Query('status', new ZodPipe(Opt)) status?: string, @Query('orgId', new ZodPipe(UUID.optional())) orgId?: string) {
    return this.admin.payments({ q, status, orgId });
  }

  @RequireAdminPermission('audit:read')
  @Get('audit')
  audit(@Auth() a: AuthContext, @Query('orgId', new ZodPipe(UUID.optional())) orgId?: string, @Query('action', new ZodPipe(Opt)) action?: string, @Query('before', new ZodPipe(z.string().regex(/^\d+$/).optional())) before?: string) {
    return this.admin.auditLog(a, { orgId, action, before });
  }

  @RequireAdminPermission('audit:read')
  @Get('audit/verify')
  verifyAudit() {
    return this.admin.verifyAudit();
  }

  @RequireAdminPermission('incidents:read')
  @Get('incidents')
  incidents(@Query('status', new ZodPipe(Opt)) status?: string) {
    return this.admin.incidents(status);
  }

  @RequireAdminPermission('incidents:manage')
  @HttpCode(200)
  @Post('incidents/:id/resolve')
  async resolve(@Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Body(new ZodPipe(Note)) b: z.infer<typeof Note>, @Req() req: VitpayRequest) {
    await this.admin.resolveIncident(a, id, b.note, clientInfo(req));
    return { ok: true };
  }

  @RequireAdminPermission('webhooks:read')
  @Get('webhooks')
  webhooks(@Query('status', new ZodPipe(Opt)) status?: string) {
    return this.admin.listWebhooks(status);
  }

  @RequireAdminPermission('webhooks:replay')
  @HttpCode(200)
  @Post('webhooks/:id/replay')
  async replay(@Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Req() req: VitpayRequest) {
    await this.admin.replayWebhook(a, id, clientInfo(req));
    return { ok: true };
  }

  @RequireAdminPermission('reconciliation:run')
  @Get('provider-accounts')
  providerAccounts() {
    return this.admin.providerAccounts();
  }

  @RequireAdminPermission('reconciliation:run')
  @Get('reconciliation/runs')
  runs() {
    return this.admin.reconciliationRuns();
  }

  @RequireAdminPermission('reconciliation:run')
  @Post('reconciliation/runs')
  reconcile(@Auth() a: AuthContext, @Body(new ZodPipe(Recon)) b: z.infer<typeof Recon>, @Req() req: VitpayRequest) {
    return this.admin.runReconciliation(a, b.providerAccountId, b.date, clientInfo(req));
  }
}
