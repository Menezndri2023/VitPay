import { randomUUID } from 'node:crypto';
import { VitPayConnectionError, VitPayError } from './errors';
import type {
  CreatePaymentRequestParams,
  CreateRefundParams,
  ListPaymentRequestsParams,
  Page,
  PaymentRequest,
  PaymentRequestDetail,
  Refund,
  RequestOptions,
} from './types';
import { constructEvent } from './webhooks';

export const SDK_VERSION = '0.1.0';
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

export interface VitPayOptions {
  /** Clé secrète `vp_sk_test_…` ou `vp_sk_live_…` (côté serveur uniquement). */
  apiKey: string;
  /** Identifiant de votre organisation (Business → Développeurs). */
  orgId: string;
  /** Adresse de l'API, ex. `https://api.staging.vitpay-ma.com`. */
  baseUrl: string;
  /** Délai maximal par requête (ms). Défaut : 30 000. */
  timeoutMs?: number;
  /** Nouvelles tentatives automatiques (coupure réseau, 429, 502-504). Défaut : 2. */
  maxRetries?: number;
  /** Implémentation fetch (tests, proxy). Défaut : fetch global de Node 18+. */
  fetch?: typeof fetch;
}

interface CallInit {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class VitPay {
  readonly mode: 'test' | 'live';
  readonly paymentRequests: PaymentRequests;
  readonly refunds: Refunds;
  readonly webhooks = { constructEvent };

  private readonly apiKey: string;
  private readonly orgId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: VitPayOptions) {
    if (!opts?.apiKey || !/^vp_sk_/.test(opts.apiKey)) throw new Error('VitPay: apiKey must be a secret key starting with vp_sk_');
    if (!opts.orgId) throw new Error('VitPay: orgId is required');
    if (!opts.baseUrl) throw new Error('VitPay: baseUrl is required (e.g. https://api.staging.vitpay-ma.com)');
    const base = new URL(opts.baseUrl);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
      throw new Error('VitPay: baseUrl must use HTTPS');
    }
    this.apiKey = opts.apiKey;
    this.mode = opts.apiKey.startsWith('vp_sk_live_') ? 'live' : 'test';
    this.orgId = opts.orgId;
    this.baseUrl = base.toString().replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 2);
    const f = opts.fetch ?? globalThis.fetch;
    if (!f) throw new Error('VitPay: global fetch is unavailable (Node 18+ required) — pass options.fetch');
    this.fetchImpl = f;
    this.paymentRequests = new PaymentRequests(this);
    this.refunds = new Refunds(this);
  }

  /** @internal */
  async call<T>(init: CallInit): Promise<T> {
    const url = new URL(`${this.baseUrl}/v1/orgs/${encodeURIComponent(this.orgId)}${init.path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      accept: 'application/json',
      'user-agent': `vitpay-node/${SDK_VERSION}`,
    };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey;
    // Un nouvel essai n'est sûr que pour une lecture ou une écriture idempotente (même clé).
    const retryable = init.method === 'GET' || Boolean(init.idempotencyKey);

    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: init.method,
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: ctrl.signal,
          redirect: 'error',
        });
      } catch (e) {
        clearTimeout(timer);
        if (retryable && attempt < this.maxRetries) {
          await sleep(this.backoff(attempt));
          continue;
        }
        throw new VitPayConnectionError(ctrl.signal.aborted ? 'Request to VITPAY timed out' : 'Could not reach VITPAY', e);
      }
      clearTimeout(timer);

      if (retryable && RETRY_STATUSES.has(res.status) && attempt < this.maxRetries) {
        const ra = Number(res.headers.get('retry-after'));
        await res.body?.cancel().catch(() => undefined);
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 10_000) : this.backoff(attempt));
        continue;
      }
      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        /* corps non JSON */
      }
      if (!res.ok) {
        const p = (json ?? {}) as { code?: string; title?: string; details?: Record<string, unknown>; requestId?: string };
        throw new VitPayError({
          status: res.status,
          code: p.code ?? `http_${res.status}`,
          message: p.title ?? `VITPAY API error (HTTP ${res.status})`,
          details: p.details,
          requestId: p.requestId ?? res.headers.get('x-request-id') ?? undefined,
        });
      }
      return json as T;
    }
  }

  private backoff(attempt: number): number {
    return Math.min(500 * 2 ** attempt, 4000) + Math.floor(Math.random() * 250);
  }
}

class PaymentRequests {
  constructor(private readonly c: VitPay) {}

  /** Crée une demande de paiement ; redirigez le client vers `payUrl`. */
  create(params: CreatePaymentRequestParams, opts: RequestOptions = {}): Promise<PaymentRequest> {
    return this.c.call({
      method: 'POST',
      path: '/payment-requests',
      body: { currency: 'MAD', ...params },
      idempotencyKey: opts.idempotencyKey ?? `sdk_${randomUUID()}`,
      timeoutMs: opts.timeoutMs,
    });
  }

  /** Relit une demande (statut faisant foi : `status === 'paid'`). */
  retrieve(id: string, opts: RequestOptions = {}): Promise<PaymentRequestDetail> {
    return this.c.call({ method: 'GET', path: `/payment-requests/${encodeURIComponent(id)}`, timeoutMs: opts.timeoutMs });
  }

  list(params: ListPaymentRequestsParams = {}, opts: RequestOptions = {}): Promise<Page<PaymentRequest>> {
    return this.c.call({ method: 'GET', path: '/payment-requests', query: { ...params }, timeoutMs: opts.timeoutMs });
  }

  /** Parcourt toutes les pages : `for await (const r of vitpay.paymentRequests.listAll()) …` */
  async *listAll(params: Omit<ListPaymentRequestsParams, 'before'> = {}): AsyncGenerator<PaymentRequest> {
    let before: string | undefined;
    do {
      const page = await this.list({ ...params, before });
      yield* page.data;
      before = page.nextCursor ?? undefined;
    } while (before);
  }

  cancel(id: string, reason?: string, opts: RequestOptions = {}): Promise<PaymentRequest> {
    return this.c.call({ method: 'POST', path: `/payment-requests/${encodeURIComponent(id)}/cancel`, body: reason ? { reason } : {}, timeoutMs: opts.timeoutMs });
  }
}

class Refunds {
  constructor(private readonly c: VitPay) {}

  create(params: CreateRefundParams, opts: RequestOptions = {}): Promise<Refund> {
    return this.c.call({
      method: 'POST',
      path: '/refunds',
      body: params,
      idempotencyKey: opts.idempotencyKey ?? `sdk_${randomUUID()}`,
      timeoutMs: opts.timeoutMs,
    });
  }
}
