import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { IdempotencyService } from './idempotency.service';
import { IncidentsService } from './incidents.service';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  providers: [AuditService, IdempotencyService, OutboxService, IncidentsService],
  exports: [AuditService, IdempotencyService, OutboxService, IncidentsService],
})
export class PlatformModule {}
