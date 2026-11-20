import { Controller, Get, Headers, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { metrics } from './common/observability';
import { SkipThrottle } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from './config';
import { Errors } from './common/errors';
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
      environment: this.config.appEnv,
      paymentsMode: this.config.PAYMENTS_LIVE_ENABLED && this.config.appEnv === 'production' ? 'live-enabled' : 'sandbox-only',
    };
  }

  /**
   * Métriques Prometheus (protégées par jeton, désactivées si METRICS_TOKEN est absent).
   * Indicateurs métier calculés à la demande : paiements, incidents ouverts, files en attente.
   */
  @Public()
  @SkipThrottle()
  @Get('metrics')
  async metrics(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    const token = this.config.METRICS_TOKEN;
    const given = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) throw Errors.notFound('Resource');
    const g = await this.db.system((tx) =>
      tx.one<{ open_incidents: string; critical_incidents: string; outbox_pending: string; emails_pending: string; webhooks_failed: string; deliveries_pending: string }>(
        `SELECT (SELECT count(*) FROM incidents WHERE status <> 'resolved')::text AS open_incidents,
                (SELECT count(*) FROM incidents WHERE status <> 'resolved' AND severity = 'critical')::text AS critical_incidents,
                (SELECT count(*) FROM outbox_events WHERE processed_at IS NULL)::text AS outbox_pending,
                (SELECT count(*) FROM outbound_emails WHERE status = 'queued')::text AS emails_pending,
                (SELECT count(*) FROM webhook_inbox WHERE status = 'failed')::text AS webhooks_failed,
                (SELECT count(*) FROM webhook_deliveries WHERE status = 'pending')::text AS deliveries_pending`,
      ),
    );
    const gauges = Object.entries(g)
      .map(([k, v]) => `vitpay_${k} ${v}`)
      .join('\n');
    res.type('text/plain; version=0.0.4').send(`${metrics.render()}${gauges}\n`);
  }
}
