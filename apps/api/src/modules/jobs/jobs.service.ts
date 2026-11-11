import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../config';
import { PaymentsService } from '../payments/payments.service';
import { DevelopersService } from '../developers/developers.service';
import { Db } from '../../database/db.service';
import { TerminalsService } from '../payments/terminals.service';
import { AccountCleanupService } from '../identity/account-cleanup.service';
import { EmailService } from '../email/email.service';
import { OutboxService } from '../platform/outbox.service';
import { WebhooksService } from '../webhooks/webhooks.service';

/**
 * Tâches de fond (ADR-007 : file de tâches PostgreSQL, SKIP LOCKED — pas de Redis au MVP).
 * Plusieurs instances peuvent tourner en parallèle sans double traitement.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsService,
    private readonly webhooks: WebhooksService,
    private readonly email: EmailService,
    private readonly developers: DevelopersService,
    private readonly cleanup: AccountCleanupService,
    private readonly db: Db,
    private readonly terminals: TerminalsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.WORKERS_ENABLED) return;
    this.every('outbox', 1_000, () => this.outbox.processBatch());
    this.every('webhook-retry', 30_000, () => this.webhooks.retryFailed());
    this.every('expire-requests', 60_000, () => this.payments.expireRequests());
    this.every('sync-stale-attempts', 60_000, () => this.payments.syncStaleAttempts());
    this.every('send-emails', 5_000, () => this.email.processQueue());
    this.every('deliver-webhooks', 3_000, () => this.developers.deliverDue());
    this.every('recover-terminal-attempts', 30_000, () => this.terminals.recoverPending());
    this.every('purge-rate-limits', 60_000, () => this.purgeRateLimits());
    this.every('release-unverified-accounts', 3_600_000, () => this.cleanup.releaseUnverified());
    this.logger.log('background jobs started');
  }

  /** [R6-3] Purge par lots des compteurs expirés (pas de verrou long, même sur un grand volume). */
  async purgeRateLimits(batch = 5_000): Promise<number> {
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const rows = await this.db.system((tx) =>
        tx.query(
          `DELETE FROM rate_limits WHERE ctid IN (
             SELECT ctid FROM rate_limits WHERE expires_at < now() AND (blocked_until IS NULL OR blocked_until < now()) LIMIT $1)
           RETURNING 1`,
          [batch],
        ),
      );
      total += rows.length;
      if (rows.length < batch) break;
    }
    return total;
  }

  private every(name: string, ms: number, fn: () => Promise<unknown>): void {
    const t = setInterval(() => {
      if (this.running.has(name)) return; // pas de chevauchement
      this.running.add(name);
      fn()
        .catch((e) => this.logger.error({ msg: 'job failed', job: name, err: (e as Error).message }))
        .finally(() => this.running.delete(name));
    }, ms);
    t.unref();
    this.timers.push(t);
  }

  onModuleDestroy(): void {
    this.timers.forEach(clearInterval);
  }
}
