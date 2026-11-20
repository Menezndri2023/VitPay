import { Injectable, Logger } from '@nestjs/common';
import { Tx } from '../../database/db.service';

export type IncidentType =
  | 'double_payment'
  | 'payment_after_close'
  | 'provider_state_conflict'
  | 'amount_mismatch'
  | 'webhook_rejected'
  | 'webhook_processing_failed'
  | 'reconciliation_mismatch'
  | 'refund_failed';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger('Incidents');

  /** Ouvre un incident (dédupliqué par dedupeKey) dans la transaction fournie. */
  async open(
    tx: Tx,
    i: { orgId: string | null; type: IncidentType; severity: Severity; summary: string; details?: unknown; dedupeKey?: string },
  ): Promise<void> {
    this.logger.warn({ msg: 'incident', type: i.type, severity: i.severity, orgId: i.orgId, summary: i.summary });
    await tx.query(
      `INSERT INTO incidents (org_id, type, severity, summary, details, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING`,
      [i.orgId, i.type, i.severity, i.summary, JSON.stringify(i.details ?? {}), i.dedupeKey ?? null],
    );
  }
}
