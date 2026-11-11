import { Injectable, Logger } from '@nestjs/common';
import { Errors } from '../../common/errors';
import { Db } from '../../database/db.service';
import { PaymentsService } from '../payments/payments.service';
import { RefundsService } from '../payments/refunds.service';
import { IncidentsService } from '../platform/incidents.service';
import { ProviderAccountRow, ProviderRegistry } from '../providers/provider-registry';
import { WebhookVerificationError } from '../providers/provider.interface';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTEMPTS = 10;
const SAFE_HEADERS = ['content-type', 'user-agent', 'x-mockpsp-signature'];

/**
 * Inbox des webhooks prestataires.
 * 1. Authentification (signature, horodatage) avec le secret du compte marchand (modèle A).
 * 2. Stockage brut AVANT traitement, dédupliqué par (compte, id d'événement).
 * 3. Traitement : relecture de l'objet chez le prestataire (getPayment/getRefund/getDispute).
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks');

  constructor(
    private readonly db: Db,
    private readonly providers: ProviderRegistry,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly incidents: IncidentsService,
  ) {}

  async receive(providerCode: string, accountId: string, rawBody: Buffer, headers: Record<string, string | undefined>): Promise<{ status: 'accepted' | 'duplicate' }> {
    if (!UUID_RE.test(accountId)) throw Errors.notFound('Endpoint');
    const account = await this.db.system((tx) =>
      tx.maybeOne<ProviderAccountRow>('SELECT * FROM provider_accounts WHERE id = $1 AND provider_code = $2', [accountId, providerCode]),
    );
    if (!account) throw Errors.notFound('Endpoint');
    const provider = this.providers.get(providerCode);
    const storedHeaders = Object.fromEntries(SAFE_HEADERS.filter((h) => headers[h]).map((h) => [h, headers[h]]));

    let event;
    try {
      event = provider.verifyWebhook(this.providers.context(account), rawBody, headers);
    } catch (e) {
      const reason = e instanceof WebhookVerificationError ? e.message : 'verification error';
      await this.db.system(async (tx) => {
        await tx.query(
          `INSERT INTO webhook_inbox (provider_code, provider_account_id, org_id, headers, raw_body, signature_valid, status, error)
           VALUES ($1,$2,$3,$4,$5,false,'rejected',$6)`,
          [providerCode, account.id, account.org_id, JSON.stringify(storedHeaders), rawBody.toString('utf8').slice(0, 65536), reason],
        );
        await this.incidents.open(tx, {
          orgId: account.org_id,
          type: 'webhook_rejected',
          severity: 'medium',
          summary: `Webhook rejected for account ${account.id}: ${reason}`,
          dedupeKey: `webhook_rejected:${account.id}:${new Date().toISOString().slice(0, 13)}`,
        });
      });
      throw Errors.badRequest('invalid_signature', 'Webhook signature verification failed');
    }

    const inserted = await this.db.system((tx) =>
      tx.maybeOne<{ id: string }>(
        `INSERT INTO webhook_inbox (provider_code, provider_account_id, org_id, provider_event_id, event_type, object_ref, headers, raw_body, signature_valid, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,'received')
         ON CONFLICT (provider_account_id, provider_event_id) DO NOTHING RETURNING id`,
        [providerCode, account.id, account.org_id, event.eventId, event.type, event.objectRef, JSON.stringify(storedHeaders), rawBody.toString('utf8')],
      ),
    );
    if (!inserted) return { status: 'duplicate' };
    // Traitement immédiat ; en cas d'échec, le worker réessaiera (l'événement est déjà persisté).
    await this.process(inserted.id).catch(() => undefined);
    return { status: 'accepted' };
  }

  async process(inboxId: string): Promise<void> {
    const row = await this.db.system((tx) =>
      tx.maybeOne<{ id: string; provider_code: string; provider_account_id: string; event_type: string; object_ref: string; status: string; org_id: string }>(
        `SELECT id, provider_code, provider_account_id, event_type, object_ref, status, org_id FROM webhook_inbox WHERE id = $1 AND signature_valid`,
        [inboxId],
      ),
    );
    if (!row || row.status === 'processed') return;
    try {
      const account = await this.db.system((tx) => this.providers.loadAccount(tx, row.provider_account_id));
      const provider = this.providers.get(row.provider_code);
      const ctx = this.providers.context(account);
      const actor = { type: 'provider' as const };
      switch (row.event_type) {
        case 'payment.updated':
          await this.payments.applyProviderPayment(account, await provider.getPayment(ctx, row.object_ref), actor);
          break;
        case 'refund.updated':
          await this.refunds.applyProviderRefund(account, await provider.getRefund(ctx, row.object_ref), actor);
          break;
        case 'dispute.updated':
          await this.refunds.applyProviderDispute(account, await provider.getDispute(ctx, row.object_ref), actor);
          break;
        default:
          throw new Error(`Unsupported event type ${row.event_type}`);
      }
      await this.db.system((tx) => tx.query(`UPDATE webhook_inbox SET status = 'processed', processed_at = now(), attempts = attempts + 1, error = NULL WHERE id = $1`, [row.id]));
    } catch (e) {
      this.logger.warn({ msg: 'webhook processing failed', inboxId, err: (e as Error).message });
      await this.db.system(async (tx) => {
        const r = await tx.one<{ attempts: number }>(
          `UPDATE webhook_inbox SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1 RETURNING attempts`,
          [row.id, (e as Error).message.slice(0, 1000)],
        );
        if (r.attempts >= MAX_ATTEMPTS) {
          await this.incidents.open(tx, { orgId: row.org_id, type: 'webhook_processing_failed', severity: 'high', summary: `Webhook ${row.id} failed ${r.attempts} times`, dedupeKey: `webhook_failed:${row.id}` });
        }
      });
      throw e;
    }
  }

  async retryFailed(limit = 20): Promise<number> {
    const rows = await this.db.system((tx) =>
      tx.query<{ id: string }>(
        `SELECT id FROM webhook_inbox WHERE status IN ('failed','received') AND signature_valid AND attempts < $1
            AND received_at < now() - interval '10 seconds' ORDER BY received_at LIMIT $2`,
        [MAX_ATTEMPTS, limit],
      ),
    );
    for (const r of rows) await this.process(r.id).catch(() => undefined);
    return rows.length;
  }
}
