import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Le kit est testé depuis ses sources : ce test garantit que kit et API restent compatibles.
import { constructEvent, VitPay, VitPayError } from '../../../packages/sdk-node/src';
import { DevelopersService } from '../src/modules/developers/developers.service';
import { connectMock, payerActs, registerMerchant, resetDb, Session, startApp, TestCtx, tokenOf } from './helpers';

describe('Kit @vitpay/node contre l’API réelle', () => {
  let ctx: TestCtx;
  let s: Session;
  let orgId: string;
  let vitpay: VitPay;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    ({ s, orgId } = await registerMerchant(ctx, 'sdk@dev.test', 'SaaS SDK'));
    await connectMock(s, orgId);
    const key = (await s.post(`/v1/orgs/${orgId}/developers/api-keys`, { name: 'SDK', scopes: ['requests:create', 'requests:read', 'requests:cancel', 'refunds:create'] })).body.secret;
    vitpay = new VitPay({ apiKey: key, orgId, baseUrl: ctx.config.PUBLIC_API_URL, maxRetries: 0 });
  });
  afterAll(async () => ctx.close());

  it('parcours complet : création, paiement, relecture, webhook vérifié, remboursement', async () => {
    const received: { body: string; sig: string }[] = [];
    const server: Server = createServer((req: IncomingMessage, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        received.push({ body: b, sig: String(req.headers['vitpay-signature']) });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const ep = await s.post(`/v1/orgs/${orgId}/developers/webhooks`, { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, events: ['payment.succeeded'] });

      const created = await vitpay.paymentRequests.create(
        { amount: '249.00', merchantReference: 'INV-SDK-1', successUrl: 'http://localhost:3000/merci', metadata: { invoiceId: 'INV-SDK-1' } },
        { idempotencyKey: 'facture-INV-SDK-1' },
      );
      expect(created).toMatchObject({ status: 'open', mode: 'sandbox', amount: { minor: '24900' }, metadata: { invoiceId: 'INV-SDK-1' } });
      // Même clé d'idempotence : même demande.
      expect((await vitpay.paymentRequests.create({ amount: '249.00', merchantReference: 'INV-SDK-1', successUrl: 'http://localhost:3000/merci', metadata: { invoiceId: 'INV-SDK-1' } }, { idempotencyKey: 'facture-INV-SDK-1' })).id).toBe(created.id);

      await payerActs(ctx, tokenOf(created.payUrl), 'succeed');
      const detail = await vitpay.paymentRequests.retrieve(created.id);
      expect(detail.status).toBe('paid');

      await ctx.outbox.processBatch();
      for (let i = 0; i < 3; i++) await ctx.app.get(DevelopersService).deliverDue();
      const got = received.find((r) => r.body.includes(created.id));
      expect(got).toBeDefined();
      const evt = constructEvent<{ requestId: string; metadata: Record<string, string> }>(got!.body, got!.sig, ep.body.secret);
      expect(evt).toMatchObject({ type: 'payment.succeeded', livemode: false, data: { requestId: created.id, metadata: { invoiceId: 'INV-SDK-1' } } });

      const attemptId = detail.attempts.find((a) => a.status === 'succeeded')!.id;
      const refund = await vitpay.refunds.create({ attemptId, amount: '49.00', reason: 'Geste commercial' });
      expect(refund.amount.minor).toBe('4900');
    } finally {
      server.close();
    }
  });

  it('liste et parcours de pages', async () => {
    for (let i = 0; i < 3; i++) await vitpay.paymentRequests.create({ amount: `${10 + i}` });
    const page = await vitpay.paymentRequests.list({ limit: 2 });
    expect(page.data).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const all: string[] = [];
    for await (const r of vitpay.paymentRequests.listAll({ limit: 2 })) all.push(r.id);
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(new Set(all).size).toBe(all.length);
  });

  it('annulation et erreurs typées', async () => {
    const r = await vitpay.paymentRequests.create({ amount: '15' });
    expect((await vitpay.paymentRequests.cancel(r.id, 'Commande annulée')).status).toBe('cancelled');
    const bad = await vitpay.paymentRequests.create({ amount: '15', successUrl: 'ftp://x' }).catch((e) => e);
    expect(bad).toBeInstanceOf(VitPayError);
    expect(bad).toMatchObject({ status: 422, code: 'validation_error' });
    expect(bad.requestId).toBeTruthy();
    const missing = await vitpay.paymentRequests.retrieve('00000000-0000-4000-8000-000000000000').catch((e) => e);
    expect(missing).toMatchObject({ status: 404, code: 'not_found' });
  });
});
