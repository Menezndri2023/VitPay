import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Errors } from '../../common/errors';
import { Public } from '../identity/decorators';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks/providers')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @Post(':providerCode/:accountId')
  async receive(@Param('providerCode') providerCode: string, @Param('accountId') accountId: string, @Req() req: Request & { rawBody?: Buffer }) {
    if (!req.rawBody) throw Errors.badRequest('raw_body_missing', 'Raw body is required');
    return this.webhooks.receive(providerCode, accountId, req.rawBody, req.headers as Record<string, string | undefined>);
  }
}
