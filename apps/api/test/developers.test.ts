import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../src/common/crypto';
import { isPrivateAddress, validateWebhookUrl } from '../src/common/safe-http';
import { DevelopersService } from '../src/modules/developers/developers.service';
import { connectMock, idemKey, ownerQuery, payerActs, registerMerchant, resetDb, Session, startApp, TestCtx, tokenOf } from './helpers';

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

function receiver(status = 200): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = status;
      res.end('ok');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, received })));
}

describe('API publique : clés API et webhooks sortants', () => {
  let ctx: TestCtx;
  let s: Session;
  let orgId: string;
  let dev: DevelopersService;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    dev = ctx.app.get(DevelopersService);
    ({ s, orgId } = await registerMerchant(ctx, 'dev@dev.test', 'Boutique API'));
    await connectMock(s, orgId);
  });
  afterAll(async () => ctx.close());

  const bearer = (key: string) => ({
    get: (p: string) => ctx.api().get(p).set('Authorization', `Bearer ${key}`),
    post: (p: string, body: object, h: Record<string, string> = {}) => ctx.api().post(p).set('Authorization', `Bearer ${key}`).set(h).send(body),
  });

  it('clé API : affichée une fois, stockée hachée, limitée à ses périmètres et à son organisation', async () => {
    const created = await s.post(`/v1/orgs/${orgId}/developers/api-keys`, { name: 'Site e-commerce', scopes: ['requests:create', 'requests:read'] });
    expect(created.status).toBe(201);
    const key = created.body.secret as string;
    expect(key).toMatch(/^vp_sk_/);
    const list = await s.get(`/v1/orgs/${orgId}/developers/api-keys`);
    expect(JSON.stringify(list.body)).not.toContain(key);
    const stored = await ownerQuery<{ key_hash: Buffer }>(`SELECT key_hash FROM api_keys WHERE id = $1`, [created.body.id]);
    expect(stored[0]?.key_hash.toString('utf8')).not.toContain('vp_sk_');

    const api = bearer(key);
    const req = await api.post(`/v1/orgs/${orgId}/payment-requests`, { amount: '149.90', currency: 'MAD', description: 'Commande #1042' }, { 'Idempotency-Key': idemKey() });
    expect(req.status).toBe(201);
    expect((await api.get(`/v1/orgs/${orgId}/payment-requests/${req.body.id}`)).status).toBe(200);
    // Audit : action attribuée à la clé API
    const audit = await ownerQuery<{ actor_type: string; metadata: { apiKeyId: string } }>(
      `SELECT actor_type, metadata FROM audit_log WHERE action = 'payment_request.created' AND target_id = $1`,
      [req.body.id],
    );
    expect(audit[0]).toMatchObject({ actor_type: 'api_key', metadata: { apiKeyId: created.body.id } });

    // Hors périmètre
    expect((await api.post(`/v1/orgs/${orgId}/refunds`, { attemptId: '00000000-0000-4000-8000-000000000000', reason: 'x' }, { 'Idempotency-Key': idemKey() })).status).toBe(403);
    expect((await api.get(`/v1/orgs/${orgId}/developers/api-keys`)).status).toBe(403); // une clé ne gère pas les clés
    expect((await api.get('/v1/auth/me')).status).toBe(403);
    expect((await api.get('/v1/admin/dashboard')).status).toBe(401);
    const other = await registerMerchant(ctx, 'other@dev.test');
    expect((await api.get(`/v1/orgs/${other.orgId}/payment-requests`)).status).toBe(404);

    // Révocation immédiate
    await ctx.api().delete(`/v1/orgs/${orgId}/developers/api-keys/${created.body.id}`).set('Cookie', s.cookie).set('x-vitpay-csrf', '1');
    expect((await api.get(`/v1/orgs/${orgId}/payment-requests`)).status).toBe(401);
    expect((await bearer('vp_sk_' + 'x'.repeat(43)).get(`/v1/orgs/${orgId}/payment-requests`)).status).toBe(401);
  });

  it('webhook sortant : paiement confirmé livré, signé HMAC, une seule fois', async () => {
    const r = await receiver(200);
    try {
      const ep = await s.post(`/v1/orgs/${orgId}/developers/webhooks`, { url: r.url, events: ['payment.succeeded'] });
      expect(ep.status).toBe(201);
      const secret = ep.body.secret as string;
      const k = (await s.post(`/v1/orgs/${orgId}/developers/api-keys`, { name: 'k2', scopes: ['requests:create'] })).body.secret;
      const pr = await bearer(k).post(`/v1/orgs/${orgId}/payment-requests`, { amount: '75', currency: 'MAD' }, { 'Idempotency-Key': idemKey() });
      await payerActs(ctx, tokenOf(pr.body.payUrl), 'succeed');
      await ctx.outbox.processBatch();
      await ctx.outbox.processBatch(); // rejeu : aucun doublon
      await dev.deliverDue();
      await dev.deliverDue();
      expect(r.received).toHaveLength(1);
      const got = r.received[0] as Received;
      const sig = String(got.headers['vitpay-signature']);
      const [, ts, v1] = /t=(\d+),v1=([0-9a-f]+)/.exec(sig) ?? [];
      expect(hmacSha256Hex(secret, `${ts}.${got.body}`)).toBe(v1);
      const evt = JSON.parse(got.body);
      expect(evt).toMatchObject({ type: 'payment.succeeded', data: { requestId: pr.body.id, amount: { amount: '7500', currency: 'MAD' } } });
      expect(got.headers['vitpay-event-id']).toBe(evt.id);
    } finally {
      r.server.close();
    }
  });

  it('webhook en échec : nouvelle tentative programmée', async () => {
    const r = await receiver(500);
    try {
      const ep = await s.post(`/v1/orgs/${orgId}/developers/webhooks`, { url: r.url, events: ['payment.succeeded'] });
      await s.post(`/v1/orgs/${orgId}/developers/webhooks/${ep.body.id}/test`);
      await dev.deliverDue();
      const d = await ownerQuery<{ status: string; attempts: number; last_status_code: number }>(`SELECT status, attempts, last_status_code FROM webhook_deliveries WHERE endpoint_id = $1`, [ep.body.id]);
      expect(d[0]).toMatchObject({ status: 'pending', attempts: 1, last_status_code: 500 });
    } finally {
      r.server.close();
    }
  });

  it('anti-SSRF : adresses privées refusées à l’enregistrement et à la connexion', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fd00::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '41.248.1.1', '2001:4860:4860::8888']) expect(isPrivateAddress(ip), ip).toBe(false);
    expect(() => validateWebhookUrl('http://example.com/hook', false)).toThrow(/HTTPS/);
    expect(() => validateWebhookUrl('https://169.254.169.254/latest/meta-data', false)).toThrow(/Private/);
    expect(() => validateWebhookUrl('https://user:pw@example.com', false)).toThrow(/Credentials/);

    // Instance « production-like » (adresses privées interdites) : un nom résolu vers 127.0.0.1 est bloqué à la connexion.
    const strict = await startApp({ PORT: '4559', PUBLIC_API_URL: 'http://127.0.0.1:4559', ALLOW_PRIVATE_WEBHOOK_URLS: 'false' });
    try {
      const m = await registerMerchant(strict, 'ssrf@dev.test');
      expect((await m.s.post(`/v1/orgs/${m.orgId}/developers/webhooks`, { url: 'http://127.0.0.1:9/x', events: ['payment.succeeded'] })).status).toBe(422);
      const ep = await m.s.post(`/v1/orgs/${m.orgId}/developers/webhooks`, { url: 'https://localhost:8443/x', events: ['payment.succeeded'] });
      expect(ep.status).toBe(201);
      await m.s.post(`/v1/orgs/${m.orgId}/developers/webhooks/${ep.body.id}/test`);
      await strict.app.get(DevelopersService).deliverDue();
      const d = await ownerQuery<{ last_error: string }>(`SELECT last_error FROM webhook_deliveries WHERE endpoint_id = $1`, [ep.body.id]);
      expect(d[0]?.last_error).toMatch(/Blocked private address/);
    } finally {
      await strict.close();
    }
  });
});
