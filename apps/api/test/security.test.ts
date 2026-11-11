import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '../src/common/crypto';
import { AuditService } from '../src/modules/audit/audit.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { connectMock, createRequest, idemKey, login, ownerQuery, PASSWORD, payerActs, registerMerchant, resetDb, startApp, TestCtx, tokenOf, totp } from './helpers';

describe('sécurité et isolation', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
  });
  afterAll(async () => ctx.close());

  it('isolation multi-tenant : un membre de A reçoit 404 sur les ressources de B', async () => {
    const a = await registerMerchant(ctx, 'a@iso.test', 'Org A');
    const b = await registerMerchant(ctx, 'b@iso.test', 'Org B');
    await connectMock(b.s, b.orgId);
    const reqB = await createRequest(b.s, b.orgId);
    expect((await a.s.get(`/v1/orgs/${b.orgId}`)).status).toBe(404);
    expect((await a.s.get(`/v1/orgs/${b.orgId}/payment-requests`)).status).toBe(404);
    expect((await a.s.get(`/v1/orgs/${a.orgId}/payment-requests/${reqB.id}`)).status).toBe(404);
    // RLS : même une requête applicative non filtrée ne voit que l'organisation courante.
    const rows = await ctx.db.forOrg(a.orgId, (tx) => tx.query('SELECT id FROM payment_requests'));
    expect(rows.length).toBe(0);
  });

  it('le rôle applicatif ne peut pas contourner la RLS ni lire les tables de plateforme (simulation d’injection SQL)', async () => {
    const a = await registerMerchant(ctx, 'inj-a@iso.test', 'Org Inj A');
    const b = await registerMerchant(ctx, 'inj-b@iso.test', 'Org Inj B');
    const seen = await ctx.db.forOrg(a.orgId, async (tx) => {
      // Ce que pourrait tenter une injection : réactiver l'ancien interrupteur ou changer d'organisation… dans la même requête.
      await tx.query(`SELECT set_config('app.rls_bypass', 'on', true)`);
      return tx.query<{ id: string }>('SELECT id FROM organizations');
    });
    expect(seen.map((r) => r.id)).toEqual([a.orgId]);
    expect(seen.map((r) => r.id)).not.toContain(b.orgId);
    await expect(ctx.db.forOrg(a.orgId, (tx) => tx.query('SELECT token_hash FROM sessions'))).rejects.toThrow(/permission denied/);
    await expect(ctx.db.forOrg(a.orgId, (tx) => tx.query('SELECT * FROM mock_psp.merchants'))).rejects.toThrow(/permission denied/);
    await expect(ctx.db.forOrg(a.orgId, (tx) => tx.query(`UPDATE users SET platform_role = 'super_admin'`))).rejects.toThrow(/permission denied/);
  });

  it('rôles : un caissier ne peut ni rembourser ni gérer les prestataires', async () => {
    const owner = await registerMerchant(ctx, 'owner@roles.test');
    await ctx.api().post('/v1/auth/register').send({ email: 'cashier@roles.test', password: PASSWORD, fullName: 'Caissier', organizationName: 'Perso' });
    await owner.s.post(`/v1/orgs/${owner.orgId}/members`, { email: 'cashier@roles.test', role: 'cashier' });
    const cashier = (await login(ctx, 'cashier@roles.test')).s;
    expect((await cashier.get(`/v1/orgs/${owner.orgId}/payment-requests`)).status).toBe(200);
    const refund = await cashier.post(`/v1/orgs/${owner.orgId}/refunds`, { attemptId: '00000000-0000-4000-8000-000000000000', reason: 'test' }, { 'Idempotency-Key': idemKey() });
    expect(refund.status).toBe(403);
    expect((await cashier.post(`/v1/orgs/${owner.orgId}/providers`, { providerCode: 'mock', mode: 'sandbox' })).status).toBe(403);
  });

  it('CSRF : mutation par cookie sans en-tête dédié ou depuis une origine inconnue → 403', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'csrf@test.test');
    const cookie = s.cookie;
    const noHeader = await ctx.api().patch(`/v1/orgs/${orgId}`).set('Cookie', cookie).send({ displayName: 'Pirate' });
    expect(noHeader.status).toBe(403);
    const badOrigin = await ctx.api().patch(`/v1/orgs/${orgId}`).set('Cookie', cookie).set('x-vitpay-csrf', '1').set('Origin', 'https://evil.example').send({ displayName: 'Pirate' });
    expect(badOrigin.status).toBe(403);
  });

  it('authentification : identifiants invalides génériques et verrouillage après 5 échecs', async () => {
    await registerMerchant(ctx, 'lock@test.test');
    for (let i = 0; i < 5; i++) {
      const r = await ctx.api().post('/v1/auth/login').send({ email: 'lock@test.test', password: 'wrong-password-123' });
      expect(r.status).toBe(401);
    }
    const locked = await ctx.api().post('/v1/auth/login').send({ email: 'lock@test.test', password: PASSWORD });
    expect(locked.status).toBe(429);
    const unknown = await ctx.api().post('/v1/auth/login').send({ email: 'nobody@test.test', password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.title).toBe('Invalid email or password');
  });

  it('verrouillage robuste aux tentatives concurrentes', async () => {
    await registerMerchant(ctx, 'race@test.test');
    await Promise.all(Array.from({ length: 8 }, () => ctx.api().post('/v1/auth/login').send({ email: 'race@test.test', password: 'wrong-password-123' })));
    const r = await ctx.api().post('/v1/auth/login').send({ email: 'race@test.test', password: PASSWORD });
    expect(r.status).toBe(429);
  });

  it('MFA : un code déjà utilisé est refusé (anti-rejeu) et 5 échecs révoquent la session', async () => {
    const { s } = await registerMerchant(ctx, 'mfa@test.test');
    const setup = await s.post('/v1/auth/mfa/setup');
    const code = totp(setup.body.secret);
    expect((await s.post('/v1/auth/mfa/enable', { code })).status).toBe(200);
    const { s: s2, body } = await login(ctx, 'mfa@test.test');
    expect(body.mfaRequired).toBe(true);
    expect((await s2.post('/v1/auth/mfa/verify', { code })).status).toBe(401); // rejeu
    for (let i = 0; i < 4; i++) await s2.post('/v1/auth/mfa/verify', { code: '000000' });
    expect((await s2.get('/v1/auth/me')).status).toBe(401); // session révoquée
  });

  it('politique de mot de passe', async () => {
    const r = await ctx.api().post('/v1/auth/register').send({ email: 'weak@test.test', password: 'short', fullName: 'Weak', organizationName: 'Weak' });
    expect(r.status).toBe(422);
  });

  it('webhook : signature invalide ou horodatage trop ancien → rejet journalisé', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'wh@test.test');
    const accountId = await connectMock(s, orgId);
    const body = JSON.stringify({ id: 'evt_forged', type: 'payment.updated', data: { object_id: 'pay_x' } });
    const bad = await ctx.api().post(`/webhooks/providers/mock/${accountId}`).set('content-type', 'application/json').set('x-mockpsp-signature', `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`).send(body);
    expect(bad.status).toBe(400);
    const oldTs = Math.floor(Date.now() / 1000) - 3600;
    const old = await ctx.api().post(`/webhooks/providers/mock/${accountId}`).set('content-type', 'application/json').set('x-mockpsp-signature', `t=${oldTs},v1=${hmacSha256Hex('whatever', `${oldTs}.${body}`)}`).send(body);
    expect(old.status).toBe(400);
    const rejected = await ownerQuery(`SELECT 1 FROM webhook_inbox WHERE provider_account_id = $1 AND status = 'rejected'`, [accountId]);
    expect(rejected.length).toBe(2);
  });

  it('montant divergent chez le prestataire → jamais confirmé, incident critique', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'mismatch@test.test');
    await connectMock(s, orgId);
    const r = await createRequest(s, orgId, '100.00');
    const start = await ctx.api().post(`/v1/public/requests/${tokenOf(r.payUrl)}/attempts`).send({ method: 'card' });
    const ref = String(start.body.checkoutUrl).split('/checkout/')[1];
    // Le « prestataire » rapporte un autre montant (falsification simulée côté prestataire).
    await ownerQuery(`UPDATE mock_psp.payments SET amount_minor = 1000 WHERE id = $1`, [ref]);
    await ctx.api().post(`/mock-psp/checkout/${ref}/succeed`);
    await ctx.psp.drain();
    const d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.status).toBe('open');
    const inc = await ownerQuery<{ severity: string }>(`SELECT severity FROM incidents WHERE org_id = $1 AND type = 'amount_mismatch'`, [orgId]);
    expect(inc[0]?.severity).toBe('critical');
  });

  it('webhook perdu : la synchronisation serveur rattrape le statut', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'lost@test.test');
    await connectMock(s, orgId);
    const r = await createRequest(s, orgId, '60.00');
    const start = await ctx.api().post(`/v1/public/requests/${tokenOf(r.payUrl)}/attempts`).send({ method: 'card' });
    const ref = String(start.body.checkoutUrl).split('/checkout/')[1];
    // Paiement réussi chez le prestataire SANS webhook livré.
    await ownerQuery(`UPDATE mock_psp.payments SET status = 'succeeded', succeeded_at = now() WHERE id = $1`, [ref]);
    await ctx.app.get(PaymentsService).syncAttempt(start.body.attemptId);
    const d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.status).toBe('paid');
  });

  it('succès tardif après échec local : le paiement réel est comptabilisé et un incident est ouvert', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'late@test.test');
    await connectMock(s, orgId);
    const r = await createRequest(s, orgId, '80.00');
    const start = await ctx.api().post(`/v1/public/requests/${tokenOf(r.payUrl)}/attempts`).send({ method: 'card' });
    const ref = String(start.body.checkoutUrl).split('/checkout/')[1];
    await ownerQuery(`UPDATE payment_attempts SET status = 'expired' WHERE id = $1`, [start.body.attemptId]);
    await ctx.api().post(`/mock-psp/checkout/${ref}/succeed`);
    await ctx.psp.drain();
    const d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.status).toBe('paid');
    const e = await ownerQuery(`SELECT 1 FROM journal_entries WHERE idempotency_key = $1`, [`payment.succeeded:${start.body.attemptId}`]);
    expect(e.length).toBe(1);
    const inc = await ownerQuery(`SELECT 1 FROM incidents WHERE dedupe_key = $1`, [`late_success:${start.body.attemptId}`]);
    expect(inc.length).toBe(1);
  });

  it('remboursement impossible sur un montant déjà perdu en litige', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'lostdispute@test.test');
    await connectMock(s, orgId);
    const r = await createRequest(s, orgId, '90.00');
    const { attemptId, providerRef } = await payerActs(ctx, tokenOf(r.payUrl), 'succeed');
    const dp = await ctx.api().post(`/mock-psp/simulate/payments/${providerRef}/dispute`);
    await ctx.psp.drain();
    await ctx.api().post(`/mock-psp/simulate/disputes/${dp.body.id}/lost`);
    await ctx.psp.drain();
    const refund = await s.post(`/v1/orgs/${orgId}/refunds`, { attemptId, reason: 'Double remboursement' }, { 'Idempotency-Key': idemKey() });
    expect(refund.status).toBe(409);
  });

  it('garde-fou réglementaire : aucun compte live tant que la validation légale n’est pas faite', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'live@test.test');
    const res = await s.post(`/v1/orgs/${orgId}/providers`, { providerCode: 'mock', mode: 'live', credentials: { apiKey: 'x' }, webhookSecret: 'y' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('live_payments_disabled');
  });

  it('configuration : le mode live exige une référence de validation juridique', async () => {
    await expect(startApp({ PAYMENTS_LIVE_ENABLED: 'true', PORT: '4556' })).rejects.toThrow(/LEGAL_SIGNOFF_REF/);
    await expect(startApp({ NODE_ENV: 'production', COOKIE_SECURE: 'true', PORT: '4557' })).rejects.toThrow(/Mock PSP is forbidden/);
  });

  it('journal d’audit : chaîne de hash vérifiable et altération détectée', async () => {
    const audit = ctx.app.get(AuditService);
    expect((await audit.verifyChain()).ok).toBe(true);
    // Altération par un super-utilisateur qui contourne les triggers.
    await ownerQuery(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable`);
    await ownerQuery(`UPDATE audit_log SET action = 'tampered' WHERE id = (SELECT min(id) + 1 FROM audit_log)`);
    await ownerQuery(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable`);
    const v = await audit.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).not.toBeNull();
  });

  it('les identifiants prestataires sont chiffrés en base', async () => {
    const rows = await ownerQuery<{ credentials_enc: string }>(`SELECT credentials_enc FROM provider_accounts LIMIT 1`);
    expect(rows[0]?.credentials_enc.startsWith('v1.')).toBe(true);
    expect(rows[0]?.credentials_enc).not.toContain('sk_test_');
  });
});
