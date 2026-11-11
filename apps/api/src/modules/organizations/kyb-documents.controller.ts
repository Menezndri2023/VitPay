import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { Errors } from '../../common/errors';
import { ZodPipe } from '../../common/zod.pipe';
import { Auth, ForAudience, Org, RequireAdminPermission, RequireOrgPermission } from '../identity/decorators';
import { AuthContext, clientInfo, OrgContext, VitpayRequest } from '../identity/session';
import { KybDocumentsService, MAX_KYB_BYTES } from './kyb-documents.service';

const UUID = z.string().uuid();
interface UploadedBlob {
  originalname: string;
  buffer: Buffer;
  size: number;
}

function sendFile(res: Response, f: { content: Buffer; filename: string; mime: string }) {
  res
    .type(f.mime)
    .setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.filename)}"`)
    .setHeader('Cache-Control', 'no-store')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .send(f.content);
}

@Controller('v1/orgs/:orgId/kyb/documents')
export class OrgKybDocumentsController {
  constructor(private readonly docs: KybDocumentsService) {}

  @RequireOrgPermission('org:update')
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_KYB_BYTES, files: 1 } }))
  upload(@Org() org: OrgContext, @Auth() a: AuthContext, @UploadedFile() file: UploadedBlob | undefined, @Body('kind') kind: string, @Req() req: VitpayRequest) {
    if (!file) throw Errors.validation({ file: 'A file is required (multipart field "file")' });
    return this.docs.upload(org.orgId, { type: 'user', userId: a.userId, ...clientInfo(req) }, { kind, filename: file.originalname, content: file.buffer });
  }

  @RequireOrgPermission('org:update')
  @Get()
  list(@Org() org: OrgContext) {
    return this.docs.listForOrg(org.orgId);
  }

  @RequireOrgPermission('org:update')
  @Get(':id/download')
  async download(@Org() org: OrgContext, @Param('id', new ZodPipe(UUID)) id: string, @Res() res: Response) {
    sendFile(res, await this.docs.downloadForOrg(org.orgId, id));
  }
}

const Review = z.object({ decision: z.enum(['accepted', 'rejected']), note: z.string().trim().min(3).max(500) });

@ForAudience('admin')
@Controller('v1/admin')
export class AdminKybDocumentsController {
  constructor(private readonly docs: KybDocumentsService) {}

  @RequireAdminPermission('kyb:decide')
  @Get('organizations/:orgId/kyb/documents')
  list(@Param('orgId', new ZodPipe(UUID)) orgId: string) {
    return this.docs.listForAdmin(orgId);
  }

  @RequireAdminPermission('kyb:decide')
  @Get('kyb/documents/:id/download')
  async download(@Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Req() req: VitpayRequest, @Res() res: Response) {
    sendFile(res, await this.docs.downloadForAdmin({ type: 'admin', userId: a.userId, ...clientInfo(req) }, id));
  }

  @RequireAdminPermission('kyb:decide')
  @HttpCode(200)
  @Post('kyb/documents/:id/review')
  async review(@Auth() a: AuthContext, @Param('id', new ZodPipe(UUID)) id: string, @Body(new ZodPipe(Review)) b: z.infer<typeof Review>, @Req() req: VitpayRequest) {
    await this.docs.review({ type: 'admin', userId: a.userId, ...clientInfo(req) }, id, b.decision, b.note);
    return { ok: true };
  }
}
