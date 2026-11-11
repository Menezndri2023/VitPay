import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from './config';
import { Db } from './database/db.service';
import { Public } from './modules/identity/decorators';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @SkipThrottle()
  @Get()
  async health() {
    await this.db.pool.query('SELECT 1');
    return {
      status: 'ok',
      service: 'vitpay-api',
      paymentsMode: this.config.PAYMENTS_LIVE_ENABLED ? 'live-enabled' : 'sandbox-only',
    };
  }
}
