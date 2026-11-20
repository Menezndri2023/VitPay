import { Inject, Injectable, Logger } from '@nestjs/common';
import { Money } from '@vitpay/money';
import { APP_CONFIG, AppConfig } from '../../config';
import { AppError, Errors } from '../../common/errors';
import { Db, isUniqueViolation } from '../../database/db.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { ProviderAccountRow, ProviderRegistry } from '../providers/provider-registry';
import { isTerminalProvider, TerminalProvider } from '../providers/terminal.interface';
import { PaymentAttemptRow, PaymentRequestRow, PaymentsService } from './payments.service';
import { ACTIVE_ATTEMPT_STATUSES, PaymentAttemptMachine } from './state-machines';

interface TerminalRow {
  id: string;
  org_id: string;
  provider_account_id: string;
  provider_code: string;
  terminal_ref: string;
  label: string;
  pos_id: string | null;
  status: 'active' | 'disabled';
  created_at: Date;
}

/**
 * Encaissements sur terminal de paiement (TPE, carte présente).
 * Mêmes garanties que les paiements en ligne : une tentative active par demande, appel au
 * fournisseur HORS transaction, confirmation uniquement par relecture serveur
 * (PaymentsService.applyProviderPayment, déclenché par notification ou synchronisation).
 * Seul fournisseur disponible : le TPE SIMULÉ (sandbox).
 */
@Injectable()
export class TerminalsService {
  private readonly logger = new Logger('Terminals');

  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly providers: ProviderRegistry,
    private readonly payments: PaymentsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** `withSimulator` : URL du TPE simulé (capacité d'encaisser en sandbox) seulement pour qui peut encaisser. */
  view(t: TerminalRow, withSimulator = true) {
    const p = withSimulator ? this.terminalProviderOrNull(t.provider_code) : null;
    return {
      id: t.id,
      label: t.label,
      providerCode: t.provider_code,
      terminalRef: t.terminal_ref,
      posId: t.pos_id,
      status: t.status,
      createdAt: t.created_at.toISOString(),
      // Écran du terminal simulé (sandbox uniquement ; un terminal réel n'a pas d'URL).
      simulatorUrl: p?.simulatorUrl ? p.simulatorUrl(t.terminal_ref) : null,
    };
  }

  private terminalProviderOrNull(code: string): TerminalProvider | null {
    try {
      const p = this.providers.get(code);
      return isTerminalProvider(p) ? p : null;
    } catch {
      return null;
    }
  }

  async list(orgId: string, withSimulator: boolean) {
    const rows = await this.db.forOrg(orgId, (tx) => tx.query<TerminalRow>('SELECT * FROM terminals ORDER BY created_at'));
    return rows.map((r) => this.view(r, withSimulator));
  }

  /** Sandbox : crée un TPE simulé chez le prestataire simulé et l'enregistre. */
  async createSandboxTerminal(orgId: string, actor: AuditActor, input: { label: string; posId?: string }) {
    const account = await this.db.forOrg(orgId, async (tx) => {
      if (input.posId) {
        const pos = await tx.maybeOne("SELECT 1 FROM points_of_sale WHERE id = $1 AND status = 'active'", [input.posId]);
        if (!pos) throw Errors.validation({ posId: 'Unknown point of sale' });
      }
      return tx.maybeOne<ProviderAccountRow>(
        `SELECT * FROM provider_accounts WHERE status = 'active' AND mode = 'sandbox' AND provider_code = 'mock' ORDER BY priority, created_at LIMIT 1`,
      );
    });
    if (!account) throw Errors.invalidState('Connect the sandbox provider first');
    const provider = this.terminalProviderOrNull(account.provider_code);
    if (!provider?.provisionSandboxTerminal) throw Errors.invalidState('This provider does not offer simulated terminals');
    const t = await provider.provisionSandboxTerminal(this.providers.context(account), input.label);
    return this.db.forOrg(orgId, async (tx) => {
      const row = await tx.one<TerminalRow>(
        `INSERT INTO terminals (org_id, provider_account_id, provider_code, terminal_ref, label, pos_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [orgId, account.id, account.provider_code, t.terminalRef, input.label, input.posId ?? null],
      );
      await this.audit.record(tx, { actor, orgId, action: 'terminal.registered', targetType: 'terminal', targetId: row.id, after: { label: row.label, providerCode: row.provider_code, mode: 'sandbox' } });
      return this.view(row);
    });
  }

  async disable(orgId: string, actor: AuditActor, id: string) {
    await this.db.forOrg(orgId, async (tx) => {
      const r = await tx.query(`UPDATE terminals SET status = 'disabled' WHERE id = $1 AND status = 'active' RETURNING id`, [id]);
      if (!r.length) throw Errors.notFound('Terminal');
      await this.audit.record(tx, { actor, orgId, action: 'terminal.disabled', targetType: 'terminal', targetId: id });
    });
  }

  /** Envoie le montant d'une demande au terminal. Le résultat arrive par notification du fournisseur. */
  async startPayment(orgId: string, actor: AuditActor, requestId: string, terminalId: string) {
    const prepared = await this.db.forOrg(orgId, async (tx) => {
      const r = await tx.maybeOne<PaymentRequestRow>('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [requestId]);
      if (!r) throw Errors.notFound('Payment request');
      if (r.status !== 'open' || r.expires_at <= new Date()) throw Errors.invalidState('This payment request is no longer payable', { status: r.status });
      const org = await tx.one<{ status: string }>('SELECT status FROM organizations WHERE id = $1', [orgId]);
      if (org.status !== 'active') throw Errors.forbidden('Organization is not active');
      const t = await tx.maybeOne<TerminalRow>("SELECT * FROM terminals WHERE id = $1 AND status = 'active'", [terminalId]);
      if (!t) throw Errors.notFound('Terminal');
      const account = await tx.maybeOne<ProviderAccountRow>("SELECT * FROM provider_accounts WHERE id = $1 AND status = 'active'", [t.provider_account_id]);
      if (!account) throw Errors.invalidState('The provider account of this terminal is not active');
      // Le terminal doit relever du même mode que la demande (jamais un terminal réel pour une demande de test, et inversement).
      if (account.mode !== r.mode) throw Errors.invalidState(`This terminal is ${account.mode}, the request is ${r.mode}`);
      if (!this.terminalProviderOrNull(account.provider_code)) throw Errors.invalidState('This provider does not support terminals');
      const active = await tx.maybeOne('SELECT 1 FROM payment_attempts WHERE payment_request_id = $1 AND status = ANY($2)', [r.id, ACTIVE_ATTEMPT_STATUSES]);
      if (active) throw Errors.conflict('attempt_in_progress', 'A payment attempt is already in progress for this request');
      let attempt: PaymentAttemptRow;
      try {
        attempt = await tx.one<PaymentAttemptRow>(
          `INSERT INTO payment_attempts (org_id, payment_request_id, provider_account_id, provider_code, method, status, amount_minor, currency, terminal_id)
           VALUES ($1,$2,$3,$4,'card_present','created',$5,$6,$7) RETURNING *`,
          [orgId, r.id, account.id, account.provider_code, r.amount_minor, r.currency, t.id],
        );
      } catch (e) {
        if (isUniqueViolation(e, 'payment_attempts_one_active_uq')) throw Errors.conflict('attempt_in_progress', 'A payment attempt is already in progress for this request');
        throw e;
      }
      await this.audit.record(tx, {
        actor,
        orgId,
        action: 'payment_attempt.created',
        targetType: 'payment_attempt',
        targetId: attempt.id,
        metadata: { providerCode: account.provider_code, method: 'card_present', terminalId: t.id },
      });
      return { request: r, attempt, account, terminal: t };
    });

    const { request, attempt, account, terminal } = prepared;
    await this.pushToTerminal(attempt, account, terminal, request);
    return { attemptId: attempt.id, terminal: this.view(terminal) };
  }

  /**
   * Envoi au terminal (idempotent : clé = identifiant de la tentative). [R8-P1] Seul un refus
   * DÉFINITIF du fournisseur clôt la tentative ; sur erreur ambiguë (délai, erreur serveur), le
   * montant peut être affiché sur le terminal : la tentative reste active (aucun second paiement
   * possible) et la récupération (recoverPending) la réconcilie.
   */
  private async pushToTerminal(attempt: PaymentAttemptRow, account: ProviderAccountRow, terminal: TerminalRow, request: PaymentRequestRow): Promise<void> {
    const provider = this.terminalProviderOrNull(account.provider_code) as TerminalProvider;
    try {
      const p = await provider.createTerminalPayment(this.providers.context(account), {
        attemptId: attempt.id,
        terminalRef: terminal.terminal_ref,
        amount: Money.of(request.amount_minor, request.currency),
        label: (request.description ?? request.reference).slice(0, 40),
      });
      await this.db.forOrg(attempt.org_id, async (tx) => {
        const cur = await tx.one<PaymentAttemptRow>('SELECT * FROM payment_attempts WHERE id = $1 FOR UPDATE', [attempt.id]);
        const next = cur.status === 'created' && PaymentAttemptMachine.canTransition('created', p.status) ? p.status : cur.status;
        await tx.query(`UPDATE payment_attempts SET provider_ref = $2, status = $3, version = version + 1, updated_at = now() WHERE id = $1`, [attempt.id, p.providerRef, next]);
      });
    } catch (e) {
      const definitive = e instanceof AppError && e.status >= 400 && e.status < 500 && e.code !== 'too_many_requests';
      this.logger.warn({ msg: 'terminal payment push failed', attemptId: attempt.id, definitive, err: (e as Error).message });
      if (!definitive) throw Errors.provider('The terminal could not be confirmed yet: VITPAY is checking its state. Do not charge again.');
      await this.db.forOrg(attempt.org_id, (tx) =>
        tx.query(
          `UPDATE payment_attempts SET status = 'failed', failure_code = $2, failure_message = $3, version = version + 1, updated_at = now() WHERE id = $1 AND status = 'created'`,
          [attempt.id, e instanceof AppError && e.code === 'terminal_busy' ? 'terminal_busy' : 'terminal_rejected', (e as Error).message.slice(0, 500)],
        ),
      );
      throw e;
    }
  }

  /**
   * [R8-C2] Récupération des encaissements terminal restés « created » sans référence fournisseur
   * (plantage ou erreur entre l'envoi et l'enregistrement) : nouvel envoi idempotent, qui renvoie
   * la même référence, puis relecture de l'état. Tâche de fond.
   */
  async recoverPending(limit = 20, olderThanSeconds = 60): Promise<number> {
    const rows = await this.db.system((tx) =>
      tx.query<PaymentAttemptRow>(
        `SELECT * FROM payment_attempts WHERE method = 'card_present' AND status = 'created' AND provider_ref IS NULL
           AND created_at < now() - make_interval(secs => $2) ORDER BY created_at LIMIT $1`,
        [limit, olderThanSeconds],
      ),
    );
    let n = 0;
    for (const a of rows) {
      try {
        const { account, terminal, request } = await this.db.system(async (tx) => ({
          account: await tx.one<ProviderAccountRow>('SELECT * FROM provider_accounts WHERE id = $1', [a.provider_account_id]),
          terminal: await tx.one<TerminalRow>('SELECT * FROM terminals WHERE id = $1', [a.terminal_id]),
          request: await tx.one<PaymentRequestRow>('SELECT * FROM payment_requests WHERE id = $1', [a.payment_request_id]),
        }));
        await this.pushToTerminal(a, account, terminal, request);
        await this.payments.syncAttempt(a.id);
        n += 1;
      } catch (e) {
        this.logger.warn({ msg: 'terminal attempt recovery failed', attemptId: a.id, err: (e as Error).message });
      }
    }
    return n;
  }

  /** Annule à distance un encaissement encore affiché sur le terminal, puis relit l'état. */
  async cancelPayment(orgId: string, actor: AuditActor, attemptId: string) {
    const { attempt, account } = await this.db.forOrg(orgId, async (tx) => {
      const a = await tx.maybeOne<PaymentAttemptRow & { method: string }>('SELECT * FROM payment_attempts WHERE id = $1', [attemptId]);
      if (!a || a.method !== 'card_present') throw Errors.notFound('Terminal payment');
      if (!a.provider_ref) throw Errors.invalidState('VITPAY is still checking this terminal payment; try again in a minute');
      const acc = await tx.one<ProviderAccountRow>('SELECT * FROM provider_accounts WHERE id = $1', [a.provider_account_id]);
      await this.audit.record(tx, { actor, orgId, action: 'payment_attempt.cancel_requested', targetType: 'payment_attempt', targetId: a.id });
      return { attempt: a, account: acc };
    });
    const provider = this.terminalProviderOrNull(account.provider_code);
    if (!provider?.cancelTerminalPayment) throw Errors.invalidState('This terminal does not support remote cancellation');
    const p = await provider.cancelTerminalPayment(this.providers.context(account), attempt.provider_ref as string);
    // La relecture serveur fait foi (le client a pu présenter sa carte entre-temps).
    await this.payments.applyProviderPayment(account, p, actor);
    return { status: p.status };
  }
}
