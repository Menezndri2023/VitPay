import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectMock, createRequest, idemKey, ownerQuery, payerActs, registerMerchant, resetDb, Session, startApp, TestCtx, tokenOf } from './helpers';

describe('transactions : référence de commande, paiement en attente, historique', () => {
  let ctx: TestCtx;
  let s: Session;
  let orgId: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    ({ s, orgId } = await registerMerchant(ctx, 'tx@tx.test', 'Boutique Transactions'));
    await connectMock(s, orgId);
  });
  afterAll(async () => ctx.close());

  const create = (body: object, key = idemKey()) => s.post(`/v1/orgs/${orgId}/payment-requests`, { amount: '120.00', currency: 'MAD', ...body }, { 'Idempotency-Key': key });

  it('référence de commande : unique par organisation, rejeu idempotent, recherche, format contrôlé', async () => {
    const key = idemKey();
    const first = await create({ merchantReference: 'CMD-2026-0001' }, key);
    expect(first.status).toBe(201);
    expect(first.body.merchantReference).toBe('CMD-2026-0001');
    // Même clé d'idempotence : même réponse, pas de doublon
    const replay = await create({ merchantReference: 'CMD-2026-0001' }, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    // Autre clé, même commande : refusé (une commande = une demande = un encaissement possible)
    const dup = await create({ merchantReference: 'CMD-2026-0001' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('merchant_reference_exists');
    expect(dup.body.details).toMatchObject({ requestId: first.body.id });
    // Créations simultanées : une seule réussit
    const both = await Promise.all([create({ merchantReference: 'CMD-RACE' }), create({ merchantReference: 'CMD-RACE' })]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    // Une autre organisation peut utiliser la même référence
    const other = await registerMerchant(ctx, 'tx2@tx.test', 'Autre boutique');
    await connectMock(other.s, other.orgId);
    expect((await other.s.post(`/v1/orgs/${other.orgId}/payment-requests`, { amount: '5', currency: 'MAD', merchantReference: 'CMD-2026-0001' }, { 'Idempotency-Key': idemKey() })).status).toBe(201);
    // Recherche exacte
    const found = await s.get(`/v1/orgs/${orgId}/payment-requests?merchantReference=CMD-2026-0001`);
    expect(found.body.data.map((r: { id: string }) => r.id)).toEqual([first.body.id]);
    // Format contrôlé (pas d'espace, de chevron ni de longueur excessive ; préfixe VITPAY réservé)
    for (const bad of ['CMD 1', '<script>', 'x'.repeat(65), 'VP-ABCD1234', 'vp-1']) expect((await create({ merchantReference: bad })).status).toBe(422);
    // Insensible à la casse : cmd-2026-0001 est la même commande que CMD-2026-0001
    expect((await create({ merchantReference: 'cmd-2026-0001' })).body.code).toBe('merchant_reference_exists');
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests?merchantReference=cmd-2026-0001`)).body.data).toHaveLength(1);
  });

  it('la référence de commande figure dans les événements sortants', async () => {
    const r = await create({ merchantReference: 'CMD-WEBHOOK-1' });
    await payerActs(ctx, tokenOf(r.body.payUrl), 'succeed');
    const ev = await ownerQuery<{ payload: { merchantReference?: string } }>(`SELECT payload FROM outbox_events WHERE event_type = 'payment.succeeded' AND payload->>'requestId' = $1`, [r.body.id]);
    expect(ev[0]?.payload.merchantReference).toBe('CMD-WEBHOOK-1');
  });

  it('paiement en attente : reste « en cours », puis confirmé par notification différée du prestataire', async () => {
    const r = await createRequest(s, orgId, '80.00');
    const { attemptId, providerRef } = await payerActs(ctx, tokenOf(r.payUrl), 'pending');
    let d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.status).toBe('open');
    expect(d.body.attempts.find((a: { id: string }) => a.id === attemptId).status).toBe('processing');
    // La page payeur affiche le paiement comme en cours (aucune confirmation prématurée)
    const pub = await ctx.api().get(`/v1/public/requests/${tokenOf(r.payUrl)}/status`);
    expect(pub.body.status).toBe('open');
    expect(pub.body.latestAttempt.status).toBe('processing');
    // Réponse différée de la banque (simulée) → webhook → relecture serveur → payé
    expect((await ctx.api().post(`/mock-psp/simulate/payments/${providerRef}/resolve/succeeded`)).status).toBe(201);
    await ctx.psp.drain();
    d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.status).toBe('paid');
    // Plus de résolution possible une fois terminé
    expect((await ctx.api().post(`/mock-psp/simulate/payments/${providerRef}/resolve/failed`)).status).toBe(409);
    const entries = await ownerQuery(`SELECT 1 FROM journal_entries WHERE entry_type = 'payment.succeeded' AND reference_id = $1`, [attemptId]);
    expect(entries).toHaveLength(1);
  });

  it('paiement en cours de traitement bancaire : la demande n’expire pas, quelle que soit la durée', async () => {
    const r = await createRequest(s, orgId, '82.00');
    const { attemptId, providerRef } = await payerActs(ctx, tokenOf(r.payUrl), 'pending');
    await ownerQuery(`UPDATE payment_requests SET expires_at = now() - interval '1 hour' WHERE id = $1`, [r.id]);
    await ownerQuery(`UPDATE payment_attempts SET created_at = now() - interval '3 hours' WHERE id = $1`, [attemptId]);
    const { PaymentsService } = await import('../src/modules/payments/payments.service');
    await ctx.app.get(PaymentsService).expireRequests();
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`)).body.status).toBe('open');
    await ctx.api().post(`/mock-psp/simulate/payments/${providerRef}/resolve/succeeded`);
    await ctx.psp.drain();
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`)).body.status).toBe('paid');
    expect(await ownerQuery(`SELECT 1 FROM incidents WHERE type = 'payment_after_close' AND summary LIKE $1`, [`%${r.reference}%`])).toHaveLength(0);
  });

  it('anti-SSRF : hors local, le prestataire simulé ne notifie que l’endpoint VITPAY', async () => {
    const cfg = ctx.config as { appEnv: string };
    cfg.appEnv = 'staging';
    try {
      for (const url of ['http://169.254.169.254/latest/meta-data', 'http://mailpit:8025/api/v1/messages', `${ctx.config.PUBLIC_API_URL}/webhooks/providers/mock/x/../../admin`]) {
        expect((await ctx.api().post('/mock-psp/api/merchants').send({ webhookUrl: url })).status, url).toBe(422);
      }
      const ok = `${ctx.config.PUBLIC_API_URL}/webhooks/providers/mock/2b1c6f3e-1111-4222-8333-444455556666`;
      expect((await ctx.api().post('/mock-psp/api/merchants').send({ webhookUrl: ok })).status).toBe(201);
    } finally {
      cfg.appEnv = 'local';
    }
  });

  it('paiement en attente puis refusé par la banque : tentative échouée, demande toujours payable', async () => {
    const r = await createRequest(s, orgId, '81.00');
    const { attemptId, providerRef } = await payerActs(ctx, tokenOf(r.payUrl), 'pending');
    await ctx.api().post(`/mock-psp/simulate/payments/${providerRef}/resolve/failed`);
    await ctx.psp.drain();
    const d = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`);
    expect(d.body.status).toBe('open');
    expect(d.body.attempts.find((a: { id: string }) => a.id === attemptId)).toMatchObject({ status: 'failed', failureCode: 'issuer_declined' });
    // Nouvel essai possible : succès
    await payerActs(ctx, tokenOf(r.payUrl), 'succeed');
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`)).body.status).toBe('paid');
  });

  it('historique des événements : chronologique, transitions tracées, sans donnée technique, cloisonné', async () => {
    const r = await createRequest(s, orgId, '60.00');
    const { attemptId } = await payerActs(ctx, tokenOf(r.payUrl), 'succeed');
    const rf = await s.post(`/v1/orgs/${orgId}/refunds`, { attemptId, amount: '10.00', reason: 'Geste commercial' }, { 'Idempotency-Key': idemKey() });
    expect(rf.body.status).toBe('succeeded');
    await ctx.psp.drain();
    const ev = await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}/events`);
    expect(ev.status).toBe(200);
    const types = ev.body.events.map((e: { type: string }) => e.type);
    expect(types[0]).toBe('payment_request.created');
    expect(types).toEqual(expect.arrayContaining(['payment_attempt.created', 'payment_attempt.status_changed', 'refund.requested']));
    expect(ev.body.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'payment_attempt.status_changed', to: 'succeeded', object: { type: 'payment_attempt', id: attemptId } })]));
    const ats = ev.body.events.map((e: { at: string }) => e.at);
    expect([...ats].sort()).toEqual(ats);
    expect(JSON.stringify(ev.body)).not.toMatch(/"ip"|user_?agent|127\.0\.0\.1/i);
    // Aussi dans le détail
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`)).body.events.length).toBe(ev.body.events.length);
    // Une autre organisation n'y a pas accès
    const intruder = await registerMerchant(ctx, 'intrus@tx.test', 'Intrus');
    expect((await intruder.s.get(`/v1/orgs/${intruder.orgId}/payment-requests/${r.id}/events`)).status).toBe(404);
  });

  it('journal d’audit cloisonné : le rôle applicatif ne lit que son organisation ; chaîne intacte', async () => {
    const mine = await ctx.db.forOrg(orgId, (tx) => tx.query<{ org_id: string | null }>('SELECT DISTINCT org_id FROM audit_log'));
    expect(mine.map((r) => r.org_id)).toEqual([orgId]);
    const verify = await ownerQuery<{ n: string }>(`SELECT count(*)::text AS n FROM audit_log`);
    expect(Number(verify[0]?.n)).toBeGreaterThan(10);
    // [R7-9] Aucune insertion directe ; écriture pour une autre organisation refusée par la fonction
    await expect(ctx.db.forOrg(orgId, (tx) => tx.query(`INSERT INTO audit_log (actor_type, action, hash) VALUES ('system','forged','\\x00')`))).rejects.toThrow(/permission denied/);
    await expect(ctx.db.system((tx) => tx.query(`INSERT INTO audit_log (actor_type, action, hash) VALUES ('system','forged','\\x00')`))).rejects.toThrow(/permission denied/);
    const other = await registerMerchant(ctx, 'audit-other@tx.test', 'Autre org audit');
    await expect(
      ctx.db.forOrg(orgId, (tx) => tx.query(`SELECT audit_append(now(),'user',NULL,$1,'forged',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{}')`, [other.orgId])),
    ).rejects.toThrow(/organization mismatch/);
    // [R8-C1] Empreinte liée à la ligne : contenu canonique différent des colonnes, ou date antidatée → refusé
    const now = new Date().toISOString();
    const canon = (o: object) => JSON.stringify(o);
    const base = { occurredAt: now, actorType: 'system', actorUserId: null, orgId: null, action: 'x', targetType: null, targetId: null, reason: null, before: null, after: null, metadata: null };
    await expect(
      ctx.db.system((tx) => tx.query(`SELECT audit_append($1,'system',NULL,NULL,'payment.refunded',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$2)`, [now, canon(base)])),
    ).rejects.toThrow(/does not match the row/);
    const old = new Date(Date.now() - 3600_000).toISOString();
    await expect(
      ctx.db.system((tx) => tx.query(`SELECT audit_append($1,'system',NULL,NULL,'x',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$2)`, [old, canon({ ...base, occurredAt: old })])),
    ).rejects.toThrow(/current time/);
    const { AuditService } = await import('../src/modules/audit/audit.service');
    expect((await ctx.app.get(AuditService).verifyChain()).ok).toBe(true);
  });

  it('outil de simulation de l’espace Business : session du commerçant, tentative de SON organisation uniquement', async () => {
    const r = await createRequest(s, orgId, '33.00');
    const { attemptId } = await payerActs(ctx, tokenOf(r.payUrl), 'pending');
    const other = await registerMerchant(ctx, 'sim-intrus@tx.test', 'Intrus sim');
    expect((await other.s.post(`/v1/orgs/${other.orgId}/sandbox/attempts/${attemptId}/resolve`, { outcome: 'succeeded' })).status).toBe(404);
    expect((await ctx.api().post(`/v1/orgs/${orgId}/sandbox/attempts/${attemptId}/resolve`).send({ outcome: 'succeeded' })).status).toBe(401);
    expect((await s.post(`/v1/orgs/${orgId}/sandbox/attempts/${attemptId}/resolve`, { outcome: 'bogus' })).status).toBe(422);
    expect((await s.post(`/v1/orgs/${orgId}/sandbox/attempts/${attemptId}/resolve`, { outcome: 'succeeded' })).status).toBe(202);
    await ctx.psp.drain();
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests/${r.id}`)).body.status).toBe('paid');
    expect((await s.post(`/v1/orgs/${orgId}/sandbox/attempts/${attemptId}/resolve`, { outcome: 'failed' })).status).toBe(409);
  });

});
