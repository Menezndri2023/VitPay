import { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// L'exemple publié dans examples/saas-node, exécuté tel quel contre l'API.
import { createSaasApp } from '../../../examples/saas-node/app.mjs';
import { DevelopersService } from '../src/modules/developers/developers.service';
import { connectMock, payerActs, registerMerchant, resetDb, startApp, TestCtx, tokenOf } from './helpers';

describe('Exemple SaaS (examples/saas-node) : facture → paiement → webhook → facture payée', () => {
  let ctx: TestCtx;
  let saas: ReturnType<typeof createSaasApp>;
  let saasUrl: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    const { s, orgId } = await registerMerchant(ctx, 'exemple@dev.test', 'Exemple SaaS');
    await connectMock(s, orgId);
    const key = (await s.post(`/v1/orgs/${orgId}/developers/api-keys`, { name: 'Exemple', scopes: ['requests:create', 'requests:read'] })).body.secret;

    // L'URL publique de l'exemple doit être connue avant de créer le webhook : on réserve le port.
    let webhookSecret = '';
    saas = createSaasApp({ apiUrl: ctx.config.PUBLIC_API_URL, orgId, secretKey: key, get webhookSecret() { return webhookSecret; }, publicUrl: 'http://127.0.0.1:0' });
    await new Promise<void>((r) => saas.server.listen(0, '127.0.0.1', () => r()));
    saasUrl = `http://127.0.0.1:${(saas.server.address() as AddressInfo).port}`;
    const ep = await s.post(`/v1/orgs/${orgId}/developers/webhooks`, { url: `${saasUrl}/webhooks/vitpay`, events: ['payment.succeeded'] });
    expect(ep.status).toBe(201);
    webhookSecret = ep.body.secret;
  });
  afterAll(async () => {
    saas?.server.close();
    await ctx.close();
  });

  it('parcours complet', async () => {
    const app = request(saasUrl);
    expect((await app.get('/')).text).toContain('INV-2026-0001');

    // « Payer » → redirection vers la page de paiement VitPay
    const pay = await app.post('/invoices/INV-2026-0001/pay');
    expect(pay.status).toBe(303);
    const payUrl = pay.headers.location as string;
    expect(payUrl).toContain('/r/');
    // Double clic : même demande (clé d'idempotence stable)
    expect((await app.post('/invoices/INV-2026-0001/pay')).headers.location).toBe(payUrl);

    // Avant paiement : la page de retour ne confirme rien, même avec un lien forgé
    const requestId = saas.invoices.get('INV-2026-0001')!.paymentRequestId as string;
    expect((await app.get(`/merci?vitpay_request_id=${requestId}&vitpay_status=paid`)).text).toContain('en cours de confirmation');

    // Le client paie sur la page VitPay (prestataire simulé)
    await payerActs(ctx, tokenOf(payUrl), 'succeed');

    // Retour du client : relu chez VitPay → confirmé
    expect((await app.get(`/merci?vitpay_request_id=${requestId}`)).text).toContain('Merci, paiement reçu');

    // Webhook signé livré à l'exemple → facture payée
    expect(saas.invoices.get('INV-2026-0001')!.status).toBe('unpaid');
    await ctx.outbox.processBatch();
    await ctx.app.get(DevelopersService).deliverDue();
    expect(saas.invoices.get('INV-2026-0001')!.status).toBe('paid');
    expect((await app.get('/')).text).toContain('✅ payée');
    expect(saas.invoices.get('INV-2026-0002')!.status).toBe('unpaid');
  });

  it('webhook forgé (mauvaise signature) : refusé, facture inchangée', async () => {
    const body = JSON.stringify({ id: 'evt_x', type: 'payment.succeeded', livemode: false, created: new Date().toISOString(), data: { metadata: { invoiceId: 'INV-2026-0002' } } });
    const r = await request(saasUrl).post('/webhooks/vitpay').set('VitPay-Signature', `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`).send(body);
    expect(r.status).toBe(400);
    expect(saas.invoices.get('INV-2026-0002')!.status).toBe('unpaid');
  });
});
