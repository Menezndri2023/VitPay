import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, ForAudience, Org, RequireAdminPermission, RequireOrgPermission } from '../identity/decorators';
import { AuthContext, clientInfo, OrgContext, VitpayRequest } from '../identity/session';
import { BillingService } from './billing.service';

const UUID = z.string().uuid();
const Issue = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(['sandbox', 'live']).default('live'),
  orgId: UUID.optional(),
});
const Paid = z.object({ reference: z.string().trim().min(3).max(120) });
const Void = z.object({ reason: z.string().trim().min(5).max(500) });

@ForAudience('admin')
@Controller('v1/admin/billing/statements')
export class AdminBillingController {
  constructor(private readonly billing: BillingService) {}

  @RequireAdminPermission('billing:read')
  @Get()
  list(@Query('status', new ZodPipe(z.enum(['issued', 'paid', 'void']).optional())) status?: string) {
    return this.billing.listAll(status);
  }

  @RequireAdminPermission('billing:manage')
  @Post()
  issue(@Auth() a: AuthContext, @Body(new ZodPipe(Issue)) b: z.infer<typeof Issue>, @Req() req: VitpayRequest) {
    return this.billing.issue({ type: 'admin', userId: a.userId, ...clientInfo(req) }, b);
  }

  @RequireAdminPermission('billing:manage')
  @HttpCode(200)
  @Post(':id/paid')
  async paid(@Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Body(new ZodPipe(Paid)) b: z.infer<typeof Paid>, @Req() req: VitpayRequest) {
    await this.billing.markPaid({ type: 'admin', userId: a.userId, ...clientInfo(req) }, id, b.reference);
    return { ok: true };
  }

  @RequireAdminPermission('billing:manage')
  @HttpCode(200)
  @Post(':id/void')
  async void(@Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Body(new ZodPipe(Void)) b: z.infer<typeof Void>, @Req() req: VitpayRequest) {
    await this.billing.void({ type: 'admin', userId: a.userId, ...clientInfo(req) }, id, b.reason);
    return { ok: true };
  }
}

@Controller('v1/orgs/:orgId/billing/statements')
export class OrgBillingController {
  constructor(private readonly billing: BillingService) {}

  @RequireOrgPermission('billing:read')
  @Get()
  list(@Org() org: OrgContext) {
    return this.billing.listForOrg(org.orgId);
  }

  /** Avoirs en attente : commission déjà facturée puis annulée, imputée sur le prochain relevé. */
  @RequireOrgPermission('billing:read')
  @Get('pending-credits')
  credits(@Org() org: OrgContext) {
    return this.billing.pendingCredits(org.orgId);
  }

  @RequireOrgPermission('billing:read')
  @Get(':id/statement.pdf')
  async pdf(@Org() org: OrgContext, @Param('id', new ZodPipe(UUID)) id: string, @Res() res: Response) {
    const pdf = await this.billing.pdfForOrg(org.orgId, id);
    res.type('application/pdf').setHeader('Content-Disposition', `inline; filename="releve-${id}.pdf"`).send(pdf);
  }
}
