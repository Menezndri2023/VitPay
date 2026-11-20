import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { merchantReturnUrl } from '../src/modules/payments/payments.service';
import { DevelopersService } from '../src/modules/developers/developers.service';
import { connectMock, idemKey, payerActs, registerMerchant, resetDb, Session, startApp, TestCtx, tokenOf } from './helpers';

function receiver(): Promise<{ server: Server; url: string; bodies: string[] }> {
  const bodies: string[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      bodies.push(body);
      res.end('ok');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`, bodies })));
}

describe('Intégration SaaS : URL de retour, métadonnées et e-mail client', () => {
  let ctx: TestCtx;
  let s: Session;
  let orgId: string;
  let key: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    ({ s, orgId } = await registerMerchant(ctx, 'saas@dev.test', 'Logiciel SaaS'));
    await connectMock(s, orgId);
    key = (await s.post(`/v1/orgs/${orgId}/developers/api-keys`, { name: 'SaaS', scopes: ['requests:create', 'requests:read'] })).body.secret;
  });
  afterAll(async () => ctx.close());

  const create = (body: object) =>
    ctx.api().post(`/v1/orgs/${orgId}/payment-requests`).set('Authorization', `Bearer ${key}`).set('Idempotency-Key', idemKey()).send({ amount: '199', currency: 'MAD', ...body });

  const checkout = {
    successUrl: 'https://app.example.com/billing/success?plan=pro',
    cancelUrl: 'https://app.example.com/billing/cancel',
    customerEmail: 'Client@Example.com',
    metadata: { invoiceId: 'INV-2026-0042', customerId: 'cus_81' },
  };

  it('enregistre et renvoie les champs de checkout', async () => {
    const r = await create({ merchantReference: 'INV-2026-0042', ...checkout });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      successUrl: checkout.successUrl,
      cancelUrl: checkout.cancelUrl,
      customerEmail: 'client@example.com',
      metadata: checkout.metadata,
    });
    const got = await ctx.api().get(`/v1/orgs/${orgId}/payment-requests/${r.body.id}`).set('Authorization', `Bearer ${key}`);
    expect(got.body.metadata).toEqual(checkout.metadata);
  });

  it('refuse les URL de retour et métadonnées invalides', async () => {
    expect((await create({ successUrl: 'ftp://example.com/x' })).status).toBe(422);
    expect((await create({ successUrl: 'https://user:pass@example.com/' })).status).toBe(422);
    expect((await create({ cancelUrl: 'https://example.com/#frag' })).status).toBe(422);
    expect((await create({ successUrl: 'javascript:alert(1)' })).status).toBe(422);
    expect((await create({ customerEmail: 'pas-un-email' })).status).toBe(422);
    expect((await create({ metadata: { 'clé invalide': 'x' } })).status).toBe(422);
    expect((await create({ metadata: { a: 'x'.repeat(501) } })).status).toBe(422);
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v']));
    expect((await create({ metadata: many })).status).toBe(422);
    expect((await create({ metadata: { n: 12 } })).status).toBe(422);
  });

  it('page payeur : retour « annuler » tant que la demande est ouverte, retour « succès » une fois payée', async () => {
    const r = await create(checkout);
    const token = tokenOf(r.body.payUrl);
    const before = (await ctx.api().get(`/v1/public/requests/${token}`)).body;
    const cancel = new URL(before.returnUrl);
    expect(`${cancel.origin}${cancel.pathname}`).toBe(checkout.cancelUrl);
    expect(cancel.searchParams.get('vitpay_status')).toBe('open');
    // Aucune donnée privée du commerçant dans la vue publique.
    expect(JSON.stringify(before)).not.toContain('INV-2026-0042');
    expect(JSON.stringify(before)).not.toContain('client@example.com');

    await payerActs(ctx, token, 'succeed');
    const after = (await ctx.api().get(`/v1/public/requests/${token}`)).body;
    const success = new URL(after.returnUrl);
    expect(success.searchParams.get('plan')).toBe('pro'); // paramètres du commerçant conservés
    expect(success.searchParams.get('vitpay_request_id')).toBe(r.body.id);
    expect(success.searchParams.get('vitpay_reference')).toBe(r.body.reference);
    expect(success.searchParams.get('vitpay_status')).toBe('paid');
  });

  it('sans URL de retour, aucun lien de retour', async () => {
    const r = await create({});
    expect((await ctx.api().get(`/v1/public/requests/${tokenOf(r.body.payUrl)}`)).body.returnUrl).toBeNull();
  });

  it('webhook : les métadonnées et la référence de commande sont renvoyées', async () => {
    const rcv = await receiver();
    try {
      await s.post(`/v1/orgs/${orgId}/developers/webhooks`, { url: rcv.url, events: ['payment.succeeded'] });
      const r = await create({ merchantReference: 'INV-2026-0099', metadata: { invoiceId: 'INV-2026-0099', tenant: 'acme' } });
      await payerActs(ctx, tokenOf(r.body.payUrl), 'succeed');
      await ctx.outbox.processBatch();
      // Une livraison par endpoint et par lot : on vide la file (les paiements précédents passent aussi).
      for (let i = 0; i < 5; i++) await ctx.app.get(DevelopersService).deliverDue();
      const evt = rcv.bodies.map((b) => JSON.parse(b)).find((e) => e.data?.requestId === r.body.id);
      expect(evt).toMatchObject({
        type: 'payment.succeeded',
        data: { requestId: r.body.id, merchantReference: 'INV-2026-0099', metadata: { invoiceId: 'INV-2026-0099', tenant: 'acme' } },
      });
    } finally {
      rcv.server.close();
    }
  });
});

describe('merchantReturnUrl', () => {
  const base = { id: 'req-1', reference: 'VP-ABC', success_url: 'https://a.test/ok?x=1', cancel_url: null };
  it('succès vers successUrl, sinon cancelUrl', () => {
    expect(merchantReturnUrl(base, 'paid')).toBe('https://a.test/ok?x=1&vitpay_request_id=req-1&vitpay_reference=VP-ABC&vitpay_status=paid');
    expect(merchantReturnUrl(base, 'expired')).toBeNull();
  });
});
