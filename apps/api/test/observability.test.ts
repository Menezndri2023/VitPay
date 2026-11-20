import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redactPath } from '../src/common/observability';
import { startApp, TestCtx } from './helpers';

describe('observabilité', () => {
  let ctx: TestCtx;
  const TOKEN = 'metrics-token-for-tests-0123456789';

  beforeAll(async () => {
    ctx = await startApp({ METRICS_TOKEN: TOKEN });
  });
  afterAll(async () => ctx.close());

  it('les jetons et identifiants ne sont jamais journalisés', () => {
    expect(redactPath('/v1/public/requests/4kKWXgbSVmtIZXiNUjjHuw/status?psp_status=x')).toBe('/v1/public/requests/:token/status');
    expect(redactPath('/v1/orgs/27ee5ae7-b8da-45fd-8c37-42b704b4a8e9/payment-requests')).toBe('/v1/orgs/:id/payment-requests');
    expect(redactPath('/v1/auth/password/forgot')).toBe('/v1/auth/password/forgot');
  });

  it('identifiant de requête renvoyé et inclus dans les erreurs', async () => {
    const r = await ctx.api().get('/v1/public/requests/AAAAAAAAAAAAAAAAAAAAAA').set('x-request-id', 'support-ticket-1234');
    expect(r.status).toBe(404);
    expect(r.headers['x-request-id']).toBe('support-ticket-1234');
    expect(r.body.requestId).toBe('support-ticket-1234');
    const bad = await ctx.api().get('/health').set('x-request-id', '<script>');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('métriques protégées par jeton', async () => {
    expect((await ctx.api().get('/health/metrics')).status).toBe(404);
    expect((await ctx.api().get('/health/metrics').set('Authorization', 'Bearer wrong')).status).toBe(404);
    const m = await ctx.api().get('/health/metrics').set('Authorization', `Bearer ${TOKEN}`);
    expect(m.status).toBe(200);
    expect(m.text).toMatch(/vitpay_http_requests_total\{method="GET",status="4xx"\} \d+/);
    expect(m.text).toMatch(/vitpay_critical_incidents \d+/);
  });
});
