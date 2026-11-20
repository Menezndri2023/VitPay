import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMock, createRequest, idemKey, ownerQuery, payerActs, registerMerchant, resetDb, Session, startApp, TestCtx, tokenOf } from './helpers';

describe('parcours de paiement de bout en bout (sandbox, prestataire simulé)', () => {
  let ctx: TestCtx;
  let s: Session;
  let orgId: string;
  let accountId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    ({ s, orgId } = await registerMerchant(ctx, 'owner@flow.test'));
    accountId = await connectMock(s, orgId);
  });
  afterAll(async () => ctx.close());

  it('refuse de créer une demande sans prestataire connecté', async () => {
    const other = await registerMerchant(ctx, 'noprovider@flow.test');
    const res = await other.s.post(`/v1/orgs/${other.orgId}/payment-requests`, { amount: '10', currency: 'MAD' }, { 'Idempotency-Key': idemKey() });
    expect(res.status).toBe(409);
  });

  it('exige une clé d’idempotence et rejoue la même réponse', async () => {
    const noKey = await s.post(`/v1/orgs/${orgId}/payment-requests`, { amount: '10', currency: 'MAD' });
    expect(noKey.status).toBe(400);
    const key = idemKey();
    const a = await s.post(`/v1/orgs/${orgId}/payment-requests`, { amount: '10', currency: 'MAD' }, { 'Idempotency-Key': key });
    const b = await s.post(`/v1/orgs/${orgId}/payment-requests`, { amount: '10', currency: 'MAD' }, { 'Idempotency-Key': key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.id).toBe(a.body.id);
    const c = await s.post(`/v1/orgs/${orgId}/payment-requests`, { amount: '11', currency: 'MAD' }, { 'Idempotency-Key': key });
    expect(c.status).toBe(422);
  });

  it('valide strictement les montants et devises', async () => {
    for (const amount of ['0', '-5', '1.001', 'abc', '1e3']) {
      const res = await s.post(`/v1/orgs/${orgId}/payment-requests`, { amount, currency: 'MAD' }, { 'Idempotency-Key': idemKey() });
      expect(res.status, amount).toBe(422);
    }
    const eur = await s.post(`/v1/orgs/${orgId}/payment-requests`, { amount: '10', currency: 'EUR' }, { 'Idempotency-Key': idemKey() });
    expect(eur.status).toBe(422); // devise prévue mais non activée
  });

  it('la page publique n’expose aucune donnée privée', async () => {
    const r = await createRequest(s, orgId, '500.00', { customerName: 'Client Secret', customerContact: '+212600000000' });
    const res = await ctx.api().get(`/v1/public/requests/${tokenOf(r.payUrl)}`);
    expect(res.status).toBe(200);
    expect(res.body.amount).toEqual({ minor: '50000', value: '500.00', currency: 'MAD' });
    expect(res.body.beneficiary.displayName).toBe('Boutique Test');
    expect(res.body.sandbox).toBe(true);
    const raw = JSON.stringify(res.body);
    for (const leak of ['Client Secret', '+212600000000', 'owner@flow.test', orgId]) expect(raw).not.toContain(leak);
    const unknown = await ctx.api().get('/v1/public/requests/AAAAAAAAAAAAAAAAAAAAAA');
    expect(unknown.status).toBe(404);
  });

  it('un retour navigateur ne confirme rien ; seule la preuve serveur compte', async () => {
    const r = await createRequest(s, orgId, '75.00');
    const token = tokenOf(r.payUrl);
    const start = await ctx.api().post(`/v1/public/requests/${token}/attempts`).send({ method: 'card' });
    expect(start.status).toBe(201);
    // Le payeur « revient » avec un paramètre forgé, sans payer.
    const status = await ctx.api().get(`/v1/public/requests/${token}/status?psp_status=succeeded`);
    expect(status.body.status).toBe('open');
    const detail = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(detail.body.status).toBe('open');
  });

  it('paiement refusé puis réussi : statut, ledger, reçu, notification', async () => {
    const r = await createRequest(s, orgId, '500.00');
    const token = tokenOf(r.payUrl);

    const declined = await payerActs(ctx, token, 'decline');
    let detail = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(detail.body.status).toBe('open');
    expect(detail.body.attempts.find((a: { id: string }) => a.id === declined.attemptId).status).toBe('failed');

    const ok = await payerActs(ctx, token, 'succeed');
    detail = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(detail.body.status).toBe('paid');
    expect(detail.body.displayStatus).toBe('paid');
    const attempt = detail.body.attempts.find((a: { id: string }) => a.id === ok.attemptId);
    expect(attempt.status).toBe('succeeded');
    expect(attempt.providerFee.minor).toBe('750'); // 1,5 % simulé
    expect(detail.body.receipt.number).toMatch(/^VPR-\d{4}-\d{7}$/);

    // Ledger : écriture équilibrée, créance prestataire = brut - frais
    const ledger = await s.get(`/v1/orgs/${orgId}/ledger/balances`);
    const bal = Object.fromEntries(ledger.body.balances.map((b: { code: string; balanceMinor: string }) => [b.code, b.balanceMinor]));
    expect(bal.gross_sales).toBe('50000');
    expect(bal.provider_fees).toBe('750');
    expect(bal.provider_receivable).toBe('49250');
    expect(ledger.body.trialBalance.every((t: { balanced: boolean }) => t.balanced)).toBe(true);

    // Reçus (espace commerçant et payeur)
    const pdf = await s.get(`/v1/orgs/${orgId}/payments/${ok.attemptId}/receipt.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const pub = await ctx.api().get(`/v1/public/requests/${token}/receipt.pdf`);
    expect(pub.status).toBe(200);

    // Une demande payée n'accepte plus de tentative
    const again = await ctx.api().post(`/v1/public/requests/${token}/attempts`).send({ method: 'card' });
    expect(again.status).toBe(409);

    // Notification via l'outbox
    await ctx.outbox.processBatch();
    const notifs = await s.get(`/v1/orgs/${orgId}/notifications`);
    expect(notifs.body.some((n: { type: string }) => n.type === 'payment.succeeded')).toBe(true);
  });

  it('un webhook rejoué ne crée jamais de seconde écriture', async () => {
    const r = await createRequest(s, orgId, '120.00');
    const { attemptId } = await payerActs(ctx, tokenOf(r.payUrl), 'succeed');
    const inbox = await ownerQuery<{ raw_body: string; headers: Record<string, string> }>(
      `SELECT raw_body, headers FROM webhook_inbox WHERE object_ref = (SELECT provider_ref FROM payment_attempts WHERE id = $1) AND status = 'processed'`,
      [attemptId],
    );
    expect(inbox.length).toBe(1);
    const row = inbox[0] as { raw_body: string; headers: Record<string, string> };
    for (let i = 0; i < 3; i++) {
      const res = await ctx
        .api()
        .post(`/webhooks/providers/mock/${accountId}`)
        .set('content-type', 'application/json')
        .set('x-mockpsp-signature', row.headers['x-mockpsp-signature'] as string)
        .send(row.raw_body);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('duplicate');
    }
    const entries = await ownerQuery(`SELECT 1 FROM journal_entries WHERE idempotency_key = $1`, [`payment.succeeded:${attemptId}`]);
    expect(entries.length).toBe(1);
  });

  it('3-D Secure : requires_action puis succès', async () => {
    const r = await createRequest(s, orgId, '42.00');
    const token = tokenOf(r.payUrl);
    const { attemptId, providerRef } = await payerActs(ctx, token, 'challenge');
    let d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.attempts.find((a: { id: string }) => a.id === attemptId).status).toBe('requires_action');
    await ctx.api().post(`/mock-psp/checkout/${providerRef}/succeed`);
    await ctx.psp.drain();
    d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.status).toBe('paid');
  });

  it('remboursements partiels plafonnés au montant payé', async () => {
    const r = await createRequest(s, orgId, '200.00');
    const { attemptId } = await payerActs(ctx, tokenOf(r.payUrl), 'succeed');
    const r1 = await s.post(`/v1/orgs/${orgId}/refunds`, { attemptId, amount: '50.00', reason: 'Article retourné' }, { 'Idempotency-Key': idemKey() });
    expect(r1.status).toBe(201);
    expect(r1.body.status).toBe('succeeded');
    const tooMuch = await s.post(`/v1/orgs/${orgId}/refunds`, { attemptId, amount: '150.01', reason: 'Trop' }, { 'Idempotency-Key': idemKey() });
    expect(tooMuch.status).toBe(409);
    const r2 = await s.post(`/v1/orgs/${orgId}/refunds`, { attemptId, amount: '150.00', reason: 'Solde' }, { 'Idempotency-Key': idemKey() });
    expect(r2.body.status).toBe('succeeded');
    await ctx.psp.drain();
    const d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.displayStatus).toBe('refunded');
    const entries = await ownerQuery(`SELECT 1 FROM journal_entries WHERE entry_type = 'refund.succeeded' AND reference_id = ANY($1)`, [[r1.body.id, r2.body.id]]);
    expect(entries.length).toBe(2);
  });

  it('litige ouvert puis perdu : écritures de réserve puis de perte', async () => {
    const r = await createRequest(s, orgId, '300.00');
    const { providerRef } = await payerActs(ctx, tokenOf(r.payUrl), 'succeed');
    const dispute = await ctx.api().post(`/mock-psp/simulate/payments/${providerRef}/dispute`);
    await ctx.psp.drain();
    let d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.displayStatus).toBe('disputed');
    await ctx.api().post(`/mock-psp/simulate/disputes/${dispute.body.id}/lost`);
    await ctx.psp.drain();
    d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.disputes[0].status).toBe('lost');
    const ledger = await s.get(`/v1/orgs/${orgId}/ledger/balances`);
    const bal = Object.fromEntries(ledger.body.balances.map((b: { code: string; balanceMinor: string }) => [b.code, b.balanceMinor]));
    expect(bal.chargeback_losses).toBe('30000');
    expect(bal.dispute_reserve).toBe('0');
  });

  it('annulation impossible pendant un paiement en cours, possible sinon', async () => {
    const r = await createRequest(s, orgId, '15.00');
    await ctx.api().post(`/v1/public/requests/${tokenOf(r.payUrl)}/attempts`).send({ method: 'card' });
    const blocked = await s.post(`/v1/orgs/${orgId}/payment-requests/${r.id}/cancel`, {});
    expect(blocked.status).toBe(409);
    const r2 = await createRequest(s, orgId, '15.00');
    const ok = await s.post(`/v1/orgs/${orgId}/payment-requests/${r2.id}/cancel`, { reason: 'Erreur de montant' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('cancelled');
  });

  it('export CSV protégé contre l’injection de formules', async () => {
    await createRequest(s, orgId, '9.00', { description: '=HYPERLINK("http://evil")' });
    const res = await s.get(`/v1/orgs/${orgId}/exports/payments.csv`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
});
