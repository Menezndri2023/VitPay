import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockProvider } from '../src/modules/providers/mock.provider';
import { isTerminalProvider } from '../src/modules/providers/terminal.interface';
import { connectMock, createRequest, idemKey, ownerQuery, registerMerchant, resetDb, Session, startApp, TestCtx } from './helpers';

describe('TPE simulé : encaissement carte présente', () => {
  let ctx: TestCtx;
  let s: Session;
  let orgId: string;
  let terminalId: string;
  let simulatorUrl: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    ({ s, orgId } = await registerMerchant(ctx, 'tpe@tpe.test', 'Boutique TPE'));
    await connectMock(s, orgId);
  });
  afterAll(async () => ctx.close());

  const attemptOf = async (requestId: string) => (await s.get(`/v1/orgs/${orgId}/payment-requests/${requestId}`)).body.attempts.at(-1);
  /** Le client agit sur le terminal (écran du TPE simulé). */
  const onTerminal = async (providerRef: string, action: 'succeed' | 'decline' | 'cancel' | 'pending') => {
    const r = await ctx.api().post(`/mock-psp/checkout/${providerRef}/${action}`);
    expect(r.status).toBe(303);
    await ctx.psp.drain();
  };

  it('le prestataire simulé implémente l’interface TPE (et elle seule l’est)', () => {
    expect(isTerminalProvider(ctx.app.get(MockProvider))).toBe(true);
    expect(isTerminalProvider({ code: 'x', getPayment: () => null })).toBe(false);
  });

  it('enregistrement d’un TPE simulé (sandbox), visible et sans donnée sensible', async () => {
    const r = await s.post(`/v1/orgs/${orgId}/terminals/sandbox`, { label: 'Caisse 1' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ label: 'Caisse 1', providerCode: 'mock', status: 'active' });
    expect(r.body.terminalRef).toMatch(/^tml_/);
    terminalId = r.body.id;
    simulatorUrl = r.body.simulatorUrl;
    expect(simulatorUrl).toContain('/mock-psp/terminal/');
    const screen = await ctx.api().get(new URL(simulatorUrl).pathname);
    expect(screen.text).toContain('TPE SIMULÉ — SANDBOX, AUCUN PAIEMENT RÉEL');
    expect(screen.text).toContain('En attente d’un montant');
    expect((await s.get(`/v1/orgs/${orgId}/terminals`)).body.map((t: { id: string }) => t.id)).toEqual([terminalId]);
  });

  it('encaissement accepté sur le terminal : confirmation serveur, ledger, reçu, historique', async () => {
    const req = await createRequest(s, orgId, '64.50');
    const start = await s.post(`/v1/orgs/${orgId}/payment-requests/${req.id}/terminal-payment`, { terminalId });
    expect(start.status).toBe(202);
    let a = await attemptOf(req.id);
    expect(a).toMatchObject({ method: 'card_present', terminalId, status: 'pending' });
    // Le montant s'affiche sur le terminal
    expect((await ctx.api().get(new URL(simulatorUrl).pathname)).text).toContain('64,50');
    // Un second encaissement sur la même demande est refusé (une tentative active)
    expect((await s.post(`/v1/orgs/${orgId}/payment-requests/${req.id}/terminal-payment`, { terminalId })).body.code).toBe('attempt_in_progress');
    // Le payeur en ligne ne peut pas payer en parallèle
    const token = req.payUrl.split('/r/')[1];
    expect((await ctx.api().post(`/v1/public/requests/${token}/attempts`).send({ method: 'card' })).status).toBe(409);
    await onTerminal(a.providerRef, 'succeed');
    const d = await s.get(`/v1/orgs/${orgId}/payment-requests/${req.id}`);
    expect(d.body.status).toBe('paid');
    a = d.body.attempts.at(-1);
    expect(a.status).toBe('succeeded');
    expect(d.body.receipt).not.toBeNull();
    expect(await ownerQuery(`SELECT 1 FROM journal_entries WHERE entry_type = 'payment.succeeded' AND reference_id = $1`, [a.id])).toHaveLength(1);
    expect(d.body.events.map((e: { type: string }) => e.type)).toContain('payment_attempt.created');
    // Remboursement à distance d'un paiement carte présente
    const rf = await s.post(`/v1/orgs/${orgId}/refunds`, { attemptId: a.id, amount: '4.50', reason: 'Article manquant' }, { 'Idempotency-Key': idemKey() });
    expect(rf.body.status).toBe('succeeded');
  });

  it('terminal occupé : un seul encaissement affiché à la fois', async () => {
    const r1 = await createRequest(s, orgId, '10.00');
    const r2 = await createRequest(s, orgId, '11.00');
    expect((await s.post(`/v1/orgs/${orgId}/payment-requests/${r1.id}/terminal-payment`, { terminalId })).status).toBe(202);
    const busy = await s.post(`/v1/orgs/${orgId}/payment-requests/${r2.id}/terminal-payment`, { terminalId });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe('terminal_busy');
    expect((await attemptOf(r2.id))).toMatchObject({ status: 'failed', failureCode: 'terminal_busy' });
    // Annulation à distance libère le terminal
    const a1 = await attemptOf(r1.id);
    const c = await s.post(`/v1/orgs/${orgId}/terminal-payments/${a1.id}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('cancelled');
    expect((await attemptOf(r1.id)).status).toBe('cancelled');
    expect((await s.post(`/v1/orgs/${orgId}/payment-requests/${r2.id}/terminal-payment`, { terminalId })).status).toBe(202);
    await onTerminal((await attemptOf(r2.id)).providerRef, 'decline');
    const d2 = await s.get(`/v1/orgs/${orgId}/payment-requests/${r2.id}`);
    expect(d2.body.status).toBe('open'); // carte refusée : la demande reste payable
    expect(d2.body.attempts.at(-1).status).toBe('failed');
  });

  it('autorisation différée sur le terminal puis accordée', async () => {
    const r = await createRequest(s, orgId, '12.00');
    await s.post(`/v1/orgs/${orgId}/payment-requests/${r.id}/terminal-payment`, { terminalId });
    const a = await attemptOf(r.id);
    await onTerminal(a.providerRef, 'pending');
    expect((await attemptOf(r.id)).status).toBe('processing');
    await ctx.api().post(`/mock-psp/simulate/payments/${a.providerRef}/resolve/succeeded`);
    await ctx.psp.drain();
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`)).body.status).toBe('paid');
  });

  it('cloisonnement et droits : terminal d’une autre organisation, rôle lecture seule, terminal désactivé', async () => {
    const other = await registerMerchant(ctx, 'tpe2@tpe.test', 'Autre boutique');
    await connectMock(other.s, other.orgId);
    const r = await createRequest(other.s, other.orgId, '9.00');
    expect((await other.s.post(`/v1/orgs/${other.orgId}/payment-requests/${r.id}/terminal-payment`, { terminalId })).status).toBe(404);
    expect((await other.s.get(`/v1/orgs/${other.orgId}/terminals`)).body).toEqual([]);
    expect((await s.post(`/v1/orgs/${orgId}/terminals/sandbox`, { label: 'x' })).status).toBe(422);
    const t2 = (await s.post(`/v1/orgs/${orgId}/terminals/sandbox`, { label: 'Caisse 2' })).body;
    expect((await ctx.api().delete(`/v1/orgs/${orgId}/terminals/${t2.id}`).set('Cookie', s.cookie).set('x-vitpay-csrf', '1')).status).toBe(200);
    const r2 = await createRequest(s, orgId, '8.00');
    expect((await s.post(`/v1/orgs/${orgId}/payment-requests/${r2.id}/terminal-payment`, { terminalId: t2.id })).status).toBe(404);
  });

  it('erreur ambiguë du fournisseur : la tentative reste active (pas de second paiement), puis est réconciliée', async () => {
    const r = await createRequest(s, orgId, '15.00');
    const cfg = ctx.config as { MOCK_PSP_INTERNAL_URL?: string };
    const saved = cfg.MOCK_PSP_INTERNAL_URL;
    cfg.MOCK_PSP_INTERNAL_URL = 'http://127.0.0.1:1'; // fournisseur injoignable
    try {
      const res = await s.post(`/v1/orgs/${orgId}/payment-requests/${r.id}/terminal-payment`, { terminalId });
      expect(res.status).toBe(502);
    } finally {
      cfg.MOCK_PSP_INTERNAL_URL = saved;
    }
    const a = await attemptOf(r.id);
    expect(a).toMatchObject({ status: 'created', providerRef: null });
    // Pas de paiement en ligne parallèle tant que l'issue n'est pas connue
    expect((await ctx.api().post(`/v1/public/requests/${r.payUrl.split('/r/')[1]}/attempts`).send({ method: 'card' })).status).toBe(409);
    const { TerminalsService } = await import('../src/modules/payments/terminals.service');
    expect(await ctx.app.get(TerminalsService).recoverPending(20, 0)).toBe(1);
    const recovered = await attemptOf(r.id);
    expect(recovered.status).toBe('pending');
    expect(recovered.providerRef).toMatch(/^pay_/);
    await onTerminal(recovered.providerRef, 'succeed');
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`)).body.status).toBe('paid');
  });

  it('clés API : aucun accès aux terminaux ; URL du TPE simulé réservée aux rôles qui encaissent', async () => {
    const key = (await s.post(`/v1/orgs/${orgId}/developers/api-keys`, { name: 'Intégration', scopes: ['requests:create', 'requests:read'] })).body.secret as string;
    const r = await createRequest(s, orgId, '7.00');
    const viaKey = await ctx.api().post(`/v1/orgs/${orgId}/payment-requests/${r.id}/terminal-payment`).set('Authorization', `Bearer ${key}`).send({ terminalId });
    expect(viaKey.status).toBe(403);
    const listed = await ctx.api().get(`/v1/orgs/${orgId}/terminals`).set('Authorization', `Bearer ${key}`);
    expect(listed.body.every((t: { simulatorUrl: string | null }) => t.simulatorUrl === null)).toBe(true);
  });

  it('aucune donnée de carte : ni dans les tentatives, ni dans le journal d’audit', async () => {
    const leaks = await ownerQuery(`SELECT 1 FROM audit_log WHERE (after::text || coalesce(metadata::text,'')) ~ '\\d{13,19}'`);
    expect(leaks).toHaveLength(0);
  });
});
