import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmailService } from '../src/modules/email/email.service';
import { connectMock, createRequest, login, ownerQuery, PASSWORD, payerActs, registerMerchant, resetDb, Session, startApp, TestCtx, tokenOf } from './helpers';

describe('e-mails, mot de passe oublié, invitations', () => {
  let ctx: TestCtx;
  let email: EmailService;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    email = ctx.app.get(EmailService);
  });
  afterAll(async () => ctx.close());

  const lastLink = (to: string, re: RegExp): string => {
    const m = [...email.sentLog].reverse().find((x) => x.to === to);
    const link = m?.text.match(re)?.[1];
    if (!link) throw new Error(`no email/link for ${to}`);
    return link;
  };

  it('mot de passe oublié : réponse identique, lien à usage unique, sessions révoquées', async () => {
    const { s } = await registerMerchant(ctx, 'forgot@acc.test');
    expect((await ctx.api().post('/v1/auth/password/forgot').send({ email: 'nobody@acc.test' })).status).toBe(202);
    expect((await ctx.api().post('/v1/auth/password/forgot').send({ email: 'forgot@acc.test' })).status).toBe(202);
    // Traitement asynchrone (temps de réponse constant) : on attend la mise en file.
    for (let i = 0; i < 50 && !email.sentLog.some((m) => m.to === 'forgot@acc.test'); i++) {
      await new Promise((r) => setTimeout(r, 50));
      await email.processQueue();
    }
    const token = lastLink('forgot@acc.test', /reset-password\?token=([A-Za-z0-9_%-]+)/);
    expect(email.sentLog.some((m) => m.to === 'nobody@acc.test')).toBe(false);
    // Le corps de l'e-mail (lien à jeton) est purgé après envoi
    const stored = await ownerQuery<{ text_body: string | null; status: string }>(`SELECT text_body, status FROM outbound_emails WHERE to_address = 'forgot@acc.test'`);
    expect(stored[0]).toEqual({ text_body: null, status: 'sent' });

    const weak = await ctx.api().post('/v1/auth/password/reset').send({ token: decodeURIComponent(token), password: 'short' });
    expect(weak.status).toBe(422);
    const ok = await ctx.api().post('/v1/auth/password/reset').send({ token: decodeURIComponent(token), password: 'New-Password-2026!' });
    expect(ok.status).toBe(200);
    expect((await s.get('/v1/auth/me')).status).toBe(401); // ancienne session révoquée
    expect((await ctx.api().post('/v1/auth/password/reset').send({ token: decodeURIComponent(token), password: 'Another-Password-2026!' })).status).toBe(400);
    expect((await ctx.api().post('/v1/auth/login').send({ email: 'forgot@acc.test', password: 'New-Password-2026!' })).status).toBe(200);
  });

  it('invitation : nouveau collaborateur, compte créé sans organisation propre, rôle appliqué', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'boss@acc.test', 'Org Invitante');
    const inv = await s.post(`/v1/orgs/${orgId}/invitations`, { email: 'Caissier@Acc.test', role: 'cashier' });
    expect(inv.status).toBe(201);
    expect((await s.post(`/v1/orgs/${orgId}/invitations`, { email: 'caissier@acc.test', role: 'viewer' })).status).toBe(409);
    await email.processQueue();
    const token = lastLink('caissier@acc.test', /\/invite\/([A-Za-z0-9_-]+)/);

    const view = await ctx.api().get(`/v1/invitations/${token}`);
    expect(view.body).toMatchObject({ organization: 'Org Invitante', role: 'cashier', accountExists: false });
    const reg = await ctx.api().post(`/v1/invitations/${token}/register`).send({ fullName: 'Caissier Test', password: PASSWORD });
    expect(reg.status).toBe(201);
    const cashier = new Session(ctx, (reg.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; '));
    const me = await cashier.get('/v1/auth/me');
    expect(me.body.organizations).toEqual([expect.objectContaining({ id: orgId, role: 'cashier' })]);
    // Lien consommé
    expect((await ctx.api().get(`/v1/invitations/${token}`)).status).toBe(404);
  });

  it('une invitation expirée n’empêche pas de réinviter ; e-mail sans lien injecté', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'boss3@acc.test', 'Visitez www.evil-bank.com https://evil.example');
    await s.post(`/v1/orgs/${orgId}/invitations`, { email: 'late@acc.test', role: 'viewer' });
    await ownerQuery(`UPDATE org_invitations SET expires_at = now() - interval '1 minute' WHERE lower(email) = 'late@acc.test'`);
    expect((await s.post(`/v1/orgs/${orgId}/invitations`, { email: 'late@acc.test', role: 'viewer' })).status).toBe(201);
    await email.processQueue();
    const m = [...email.sentLog].reverse().find((x) => x.to === 'late@acc.test');
    expect(m?.subject).not.toMatch(/evil/);
    expect(m?.text).not.toMatch(/evil/);
  });

  it('invitation d’un compte existant : acceptation réservée au bon e-mail', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'boss2@acc.test', 'Org Deux');
    await registerMerchant(ctx, 'existing@acc.test', 'Sa propre org');
    await registerMerchant(ctx, 'intruder@acc.test', 'Org intrus');
    await s.post(`/v1/orgs/${orgId}/invitations`, { email: 'existing@acc.test', role: 'viewer' });
    await email.processQueue();
    const token = lastLink('existing@acc.test', /\/invite\/([A-Za-z0-9_-]+)/);
    expect((await ctx.api().post(`/v1/invitations/${token}/register`).send({ fullName: 'Xavier', password: PASSWORD })).status).toBe(409);
    const intruder = (await login(ctx, 'intruder@acc.test')).s;
    expect((await intruder.post(`/v1/invitations/${token}/accept`)).status).toBe(403);
    const existing = (await login(ctx, 'existing@acc.test')).s;
    expect((await existing.post(`/v1/invitations/${token}/accept`)).status).toBe(200);
    const me = await existing.get('/v1/auth/me');
    expect(me.body.organizations.map((o: { id: string }) => o.id)).toContain(orgId);
  });

  it('paiement reçu : notification et e-mail au propriétaire', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'notify@acc.test');
    await connectMock(s, orgId);
    const r = await createRequest(s, orgId, '42.00');
    await payerActs(ctx, tokenOf(r.payUrl), 'succeed');
    await ctx.outbox.processBatch();
    await email.processQueue();
    const m = [...email.sentLog].reverse().find((x) => x.to === 'notify@acc.test' && x.template === 'payment.succeeded');
    expect(m?.text).toContain('42,00');
  });
});
