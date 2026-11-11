import { Injectable, Logger } from '@nestjs/common';
import { Db, Tx } from '../../database/db.service';

export interface OutboxEvent<P = Record<string, unknown>> {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  orgId: string | null;
  payload: P;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

/**
 * Outbox transactionnelle : les événements sont écrits dans la même transaction que
 * le changement d'état, puis délivrés « au moins une fois » par le worker.
 * Les consommateurs DOIVENT être idempotents.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger('Outbox');
  private readonly handlers = new Map<string, OutboxHandler[]>();

  constructor(private readonly db: Db) {}

  async publish(tx: Tx, e: Omit<OutboxEvent, 'id'>): Promise<void> {
    await tx.query(
      `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, org_id, payload) VALUES ($1,$2,$3,$4,$5)`,
      [e.eventType, e.aggregateType, e.aggregateId, e.orgId, JSON.stringify(e.payload)],
    );
  }

  subscribe(eventType: string, handler: OutboxHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  /** Traite un lot d'événements. Retourne le nombre d'événements traités. */
  async processBatch(limit = 50): Promise<number> {
    return this.db.system(async (tx) => {
      const rows = await tx.query<{
        id: string;
        event_type: string;
        aggregate_type: string;
        aggregate_id: string;
        org_id: string | null;
        payload: Record<string, unknown>;
        attempts: number;
      }>(
        `SELECT id, event_type, aggregate_type, aggregate_id, org_id, payload, attempts
           FROM outbox_events
          WHERE processed_at IS NULL AND available_at <= now()
          ORDER BY id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit],
      );
      for (const r of rows) {
        const event: OutboxEvent = {
          id: r.id,
          eventType: r.event_type,
          aggregateType: r.aggregate_type,
          aggregateId: r.aggregate_id,
          orgId: r.org_id,
          payload: r.payload,
        };
        try {
          for (const h of this.handlers.get(r.event_type) ?? []) await h(event);
          await tx.query('UPDATE outbox_events SET processed_at = now(), attempts = attempts + 1 WHERE id = $1', [r.id]);
        } catch (err) {
          const backoffSec = Math.min(3600, 2 ** Math.min(r.attempts + 1, 12));
          this.logger.warn({ msg: 'outbox handler failed', id: r.id, type: r.event_type, err: (err as Error).message });
          await tx.query(
            `UPDATE outbox_events SET attempts = attempts + 1, last_error = $2,
               available_at = now() + make_interval(secs => $3) WHERE id = $1`,
            [r.id, (err as Error).message.slice(0, 1000), backoffSec],
          );
        }
      }
      return rows.length;
    });
  }
}
