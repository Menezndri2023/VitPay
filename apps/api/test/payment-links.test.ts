import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMock, ownerQuery, payerActs, registerMerchant, resetDb, Session, startApp, TestCtx } from './helpers';

describe('liens de paiement réutilisables', () => {
  let ctx: TestCtx;
  let s: Session;
  let orgId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    ({ s, orgId } = await registerMerchant(ctx, 'links@vitpay.test', 'Cabinet Liens'));
    await connectMock(s, orgId);
  });
  afterAll(async () => ctx.close());

  const tokenOfLink = (url: string) => url.split('/l/')[1] as string;

  it('montant fixe : chaque client obtient sa propre demande, rattachée au lien, dans le mode du lien', async () => {
    const c = await s.post(`/v1/orgs/${orgId}/payment-links`, { title: 'Consultation', amount: '300.00' });
    expect(c.status).toBe(201);
    expect(c.body.mode).toBe('sandbox');
    expect(c.body.url).toMatch(/\/l\/[A-Za-z0-9_-]{16,}$/);
    const token = tokenOfLink(c.body.url);

    const view = await ctx.api().get(`/v1/public/links/${token}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ title: 'Consultation', amount: { value: '300.00' }, sandbox: true, active: true, beneficiary: { displayName: 'Cabinet Liens' } });
    expect(view.body.id).toBeUndefined();

    // Un montant envoyé par le client est ignoré pour un lien à montant fixe.
    const a = await ctx.api().post(`/v1/public/links/${token}/requests`).send({ amount: '1.00' });
    const b = await ctx.api().post(`/v1/public/links/${token}/requests`).send({});
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.token).not.toBe(b.body.token);
    await payerActs(ctx, a.body.token, 'succeed');

    const rows = await ownerQuery<{ amount_minor: string; payment_link_id: string; mode: string }>(
      `SELECT amount_minor::text, payment_link_id::text, mode FROM payment_requests WHERE public_token = ANY($1)`,
      [[a.body.token, b.body.token]],
    );
    expect(rows.map((r) => r.amount_minor)).toEqual(['30000', '30000']);
    expect(rows.every((r) => r.payment_link_id === c.body.id && r.mode === 'sandbox')).toBe(true);

    const list = await s.get(`/v1/orgs/${orgId}/payment-links`);
    const link = list.body.find((l: { id: string }) => l.id === c.body.id);
    expect(link.paidCount).toBe(1);
    expect(link.paidTotal.value).toBe('300.00');

    const qr = await s.get(`/v1/orgs/${orgId}/payment-links/${c.body.id}/qr.svg`);
    expect(qr.status).toBe(200);
    expect(qr.headers['content-type']).toContain('image/svg+xml');
  });

  it('montant libre : saisi par le client, obligatoire et positif', async () => {
    const c = await s.post(`/v1/orgs/${orgId}/payment-links`, { title: 'Don libre' });
    expect(c.body.amount).toBeNull();
    const token = tokenOfLink(c.body.url);
    expect((await ctx.api().post(`/v1/public/links/${token}/requests`).send({})).status).toBe(422);
    expect((await ctx.api().post(`/v1/public/links/${token}/requests`).send({ amount: '0' })).status).toBe(422);
    const ok = await ctx.api().post(`/v1/public/links/${token}/requests`).send({ amount: '35,50' });
    expect(ok.status).toBe(201);
    const pub = await ctx.api().get(`/v1/public/requests/${ok.body.token}`);
    expect(pub.body.amount.value).toBe('35.50');
    expect(pub.body.description).toBe('Don libre');
  });

  it('lien désactivé : plus aucune demande ; invisible des autres organisations', async () => {
    const c = await s.post(`/v1/orgs/${orgId}/payment-links`, { title: 'Ancien tarif', amount: '50' });
    const token = tokenOfLink(c.body.url);
    expect((await s.post(`/v1/orgs/${orgId}/payment-links/${c.body.id}/disable`, {})).status).toBe(200);
    expect((await ctx.api().get(`/v1/public/links/${token}`)).body.active).toBe(false);
    expect((await ctx.api().post(`/v1/public/links/${token}/requests`).send({})).status).toBe(409);
    expect((await s.post(`/v1/orgs/${orgId}/payment-links/${c.body.id}/disable`, {})).status).toBe(404);

    const other = await registerMerchant(ctx, 'other-links@vitpay.test', 'Autre boutique');
    const list = await other.s.get(`/v1/orgs/${other.orgId}/payment-links`);
    expect(list.body).toEqual([]);
    expect((await other.s.post(`/v1/orgs/${other.orgId}/payment-links/${c.body.id}/disable`, {})).status).toBe(404);
    expect((await ctx.api().get('/v1/public/links/inconnu-inconnu-inconnu')).status).toBe(404);
  });
});
