import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevelopersService } from '../src/modules/developers/developers.service';
import { connectMock, idemKey, ownerQuery, payerActs, registerMerchant, resetDb, Session, startApp, TestCtx, tokenOf } from './helpers';

describe('Clés API de test et clés réelles', () => {
  let ctx: TestCtx;
  let s: Session;
  let orgId: string;
  let testKey: string;
  const cfg = () => ctx.config as { PAYMENTS_LIVE_ENABLED: boolean; appEnv: string };

  /** Simule un environnement où les paiements réels sont ouverts (production + validation juridique). */
  async function asLive<T>(fn: () => Promise<T>): Promise<T> {
    const c = cfg();
    const before = { live: c.PAYMENTS_LIVE_ENABLED, env: c.appEnv };
    c.PAYMENTS_LIVE_ENABLED = true;
    c.appEnv = 'production';
    try {
      return await fn();
    } finally {
      c.PAYMENTS_LIVE_ENABLED = before.live;
      c.appEnv = before.env;
    }
  }

  const as = (key: string) => ({
    get: (p: string) => ctx.api().get(`/v1/orgs/${orgId}${p}`).set('Authorization', `Bearer ${key}`),
    post: (p: string, body: object, idem = idemKey()) => ctx.api().post(`/v1/orgs/${orgId}${p}`).set('Authorization', `Bearer ${key}`).set('Idempotency-Key', idem).send(body),
  });
  const scopes = ['requests:create', 'requests:read', 'requests:cancel', 'refunds:create'];

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    ({ s, orgId } = await registerMerchant(ctx, 'modes@dev.test', 'SaaS Modes'));
    await connectMock(s, orgId);
    const r = await s.post(`/v1/orgs/${orgId}/developers/api-keys`, { name: 'Test', scopes });
    expect(r.status).toBe(201);
    testKey = r.body.secret;
  });
  afterAll(async () => ctx.close());

  it('format et mode : vp_sk_test_ par défaut, mode visible dans la liste', async () => {
    expect(testKey).toMatch(/^vp_sk_test_[A-Za-z0-9_-]{43}$/);
    const list = (await s.get(`/v1/orgs/${orgId}/developers/api-keys`)).body as { mode: string; prefix: string }[];
    expect(list[0]).toMatchObject({ mode: 'test' });
    expect(list[0]?.prefix).toMatch(/^vp_sk_test_.{8}$/);
  });

  it('clé réelle refusée tant que les paiements réels sont fermés', async () => {
    expect((await s.get(`/v1/orgs/${orgId}/developers/settings`)).body).toEqual({ liveKeysAvailable: false });
    const r = await s.post(`/v1/orgs/${orgId}/developers/api-keys`, { name: 'Prod', scopes, mode: 'live' });
    expect(r.status).toBe(409);
    expect(await ownerQuery(`SELECT 1 FROM api_keys WHERE mode = 'live'`)).toHaveLength(0);
  });

  it('une clé de test crée des demandes sandbox', async () => {
    const r = await as(testKey).post('/payment-requests', { amount: '50', currency: 'MAD' });
    expect(r.status).toBe(201);
    expect(r.body.mode).toBe('sandbox');
  });

  it('cloisonnement : la clé de test ne voit pas le réel, la clé réelle ne voit pas le test', async () => {
    const sandboxReq = (await as(testKey).post('/payment-requests', { amount: '60', currency: 'MAD' })).body;
    const liveReq = (await as(testKey).post('/payment-requests', { amount: '70', currency: 'MAD' })).body;
    await ownerQuery(`UPDATE payment_requests SET mode = 'live' WHERE id = $1`, [liveReq.id]); // demande « réelle » simulée

    const liveKey = await asLive(async () => {
      expect((await s.get(`/v1/orgs/${orgId}/developers/settings`)).body).toEqual({ liveKeysAvailable: true });
      const k = await s.post(`/v1/orgs/${orgId}/developers/api-keys`, { name: 'Prod', scopes, mode: 'live' });
      expect(k.status).toBe(201);
      expect(k.body.secret).toMatch(/^vp_sk_live_/);
      return k.body.secret as string;
    });

    const t = as(testKey);
    const l = as(liveKey);
    expect((await t.get(`/payment-requests/${liveReq.id}`)).status).toBe(404);
    expect((await t.get(`/payment-requests/${sandboxReq.id}`)).status).toBe(200);
    expect((await l.get(`/payment-requests/${sandboxReq.id}`)).status).toBe(404);
    expect((await l.get(`/payment-requests/${liveReq.id}`)).status).toBe(200);
    expect((await t.post(`/payment-requests/${liveReq.id}/cancel`, {})).status).toBe(404);
    expect((await l.get(`/payment-requests/${sandboxReq.id}/qr.svg`)).status).toBe(404);

    const tList = (await t.get('/payment-requests')).body.data as { id: string; mode: string }[];
    expect(tList.every((r) => r.mode === 'sandbox')).toBe(true);
    expect(tList.map((r) => r.id)).not.toContain(liveReq.id);
    const lList = (await l.get('/payment-requests')).body.data as { id: string }[];
    expect(lList.map((r) => r.id)).toEqual([liveReq.id]);

    // La session Business voit tout.
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests/${liveReq.id}`)).status).toBe(200);

    // Hors environnement réel, la clé réelle ne peut pas créer de demande.
    expect((await l.post('/payment-requests', { amount: '80', currency: 'MAD' })).status).toBe(409);
    // En environnement réel, sans compte prestataire réel connecté : refus explicite.
    const noLive = await asLive(() => l.post('/payment-requests', { amount: '80', currency: 'MAD' }));
    expect(noLive.status).toBe(409);
    expect(JSON.stringify(noLive.body)).toMatch(/live payment provider account/);
  });

  it('remboursement et reçu : cloisonnés aussi', async () => {
    const pr = (await as(testKey).post('/payment-requests', { amount: '90', currency: 'MAD' })).body;
    const { attemptId } = await payerActs(ctx, tokenOf(pr.payUrl), 'succeed');
    await ownerQuery(`UPDATE payment_requests SET mode = 'live' WHERE id = $1`, [pr.id]);
    const r = await as(testKey).post('/refunds', { attemptId, reason: 'Erreur de commande' });
    expect(r.status).toBe(404);
    expect((await as(testKey).get(`/payments/${attemptId}/receipt.pdf`)).status).toBe(404);
  });

  it('même Idempotency-Key en test et en session : pas de rejeu croisé', async () => {
    const key = idemKey();
    const a = await as(testKey).post('/payment-requests', { amount: '11', currency: 'MAD' }, key);
    const b = await s.post(`/v1/orgs/${orgId}/payment-requests`, { amount: '11', currency: 'MAD' }, { 'Idempotency-Key': key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).not.toBe(a.body.id);
  });

  it('le tableau de bord agrégé n’est pas accessible par clé API', async () => {
    expect((await as(testKey).get('/dashboard')).status).toBe(403);
  });

  it('webhook : livemode indique le mode de la demande', async () => {
    const bodies: string[] = [];
    const server: Server = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        bodies.push(b);
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
      await s.post(`/v1/orgs/${orgId}/developers/webhooks`, { url, events: ['payment.succeeded'] });
      const pr = (await as(testKey).post('/payment-requests', { amount: '12', currency: 'MAD' })).body;
      await payerActs(ctx, tokenOf(pr.payUrl), 'succeed');
      await ctx.outbox.processBatch();
      for (let i = 0; i < 5; i++) await ctx.app.get(DevelopersService).deliverDue();
      const evt = bodies.map((b) => JSON.parse(b)).find((e) => e.data?.requestId === pr.id);
      expect(evt).toMatchObject({ type: 'payment.succeeded', livemode: false });
    } finally {
      server.close();
    }
  });

  it('ancien format vp_sk_… : toujours accepté, traité comme clé de test', async () => {
    const legacy = 'vp_sk_' + 'L'.repeat(43);
    const { createHash } = await import('node:crypto');
    const [owner] = await ownerQuery<{ created_by: string }>(`SELECT created_by FROM api_keys LIMIT 1`);
    await ownerQuery(`INSERT INTO api_keys (org_id, name, prefix, key_hash, scopes, created_by, mode) VALUES ($1,'Ancienne','vp_sk_LLLLLLLL',$2,$3,$4,'test')`, [
      orgId,
      createHash('sha256').update(legacy).digest(),
      ['requests:read'],
      owner?.created_by,
    ]);
    const r = await as(legacy).get('/payment-requests');
    expect(r.status).toBe(200);
    expect((r.body.data as { mode: string }[]).every((x) => x.mode === 'sandbox')).toBe(true);
  });
});
