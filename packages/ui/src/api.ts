/** Client HTTP partagé. Les apps proxifient `/api/*` vers l'API VITPAY (même origine : cookies httpOnly). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-vitpay-csrf': '1' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: 'no-store',
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const p = (typeof data === 'object' && data) || {};
    throw new ApiError(res.status, (p as { code?: string }).code ?? 'error', (p as { title?: string }).title ?? res.statusText, (p as { details?: unknown }).details);
  }
  return data as T;
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `web-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface MoneyView {
  minor: string;
  value: string;
  currency: string;
}

/** Affichage localisé à partir de la chaîne décimale exacte fournie par l'API. */
export function formatMoney(m: MoneyView | null | undefined, locale = 'fr-MA'): string {
  if (!m) return '—';
  const decimals = m.value.includes('.') ? (m.value.split('.')[1]?.length ?? 0) : 0;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(
      m.value as unknown as number,
    );
  } catch {
    return `${m.value} ${m.currency}`;
  }
}

export function formatDate(iso: string | null | undefined, locale = 'fr-MA'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
