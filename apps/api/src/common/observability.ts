import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Observabilité minimale sans dépendance : identifiant de requête, journal d'accès JSON
 * (chemins expurgés des jetons), compteurs exposés au format Prometheus.
 * Sentry / OpenTelemetry : à brancher sur ces points d'extension (ROADMAP).
 */

const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Les segments ressemblant à des jetons (liens de paiement, invitations…) ne sont jamais journalisés. */
export function redactPath(path: string): string {
  return path
    .split('?')[0]!
    .split('/')
    .map((seg) => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ? ':id' : /^[A-Za-z0-9_-]{16,}$/.test(seg) && /\d/.test(seg) ? ':token' : seg))
    .join('/');
}

class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, { sum: number; count: number }>();

  inc(name: string, labels: Record<string, string> = {}, by = 1): void {
    const key = `${name}${formatLabels(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  observe(name: string, labels: Record<string, string>, seconds: number): void {
    const key = `${name}${formatLabels(labels)}`;
    const d = this.durations.get(key) ?? { sum: 0, count: 0 };
    d.sum += seconds;
    d.count += 1;
    this.durations.set(key, d);
  }

  render(): string {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, d] of this.durations) {
      const i = k.indexOf('{');
      const name = i === -1 ? k : k.slice(0, i);
      const labels = i === -1 ? '' : k.slice(i);
      lines.push(`${name}_sum${labels} ${d.sum.toFixed(6)}`, `${name}_count${labels} ${d.count}`);
    }
    return `${lines.sort().join('\n')}\n`;
  }
}

function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  return entries.length ? `{${entries.map(([k, v]) => `${k}="${v.replace(/["\\\n]/g, '_')}"`).join(',')}}` : '';
}

export const metrics = new Metrics();

export interface RequestWithId extends Request {
  requestId?: string;
}

export function requestContext(opts: { logRequests: boolean }) {
  return (req: RequestWithId, res: Response, next: NextFunction): void => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = redactPath(req.originalUrl ?? req.url);
      const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
      metrics.inc('vitpay_http_requests_total', { method: req.method, status: statusClass });
      metrics.observe('vitpay_http_request_duration_seconds', { method: req.method }, seconds);
      if (opts.logRequests && route !== '/health') {
        // JSON sur une ligne, sans corps, sans en-têtes, sans paramètres de requête.
        process.stdout.write(
          `${JSON.stringify({ level: res.statusCode >= 500 ? 'error' : 'info', msg: 'http', requestId: id, method: req.method, path: route, status: res.statusCode, ms: Math.round(seconds * 1000) })}\n`,
        );
      }
    });
    next();
  };
}
