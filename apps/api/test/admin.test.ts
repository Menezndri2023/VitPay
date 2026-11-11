import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/modules/identity/auth.service';
import { adminSession, registerEnrollmentToken, connectMock, createRequest, idemKey, login, ownerQuery, PASSWORD, payerActs, registerMerchant, resetDb, startApp, TestCtx, tokenOf } from './helpers';

describe('VITPAY ADMIN', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    const auth = ctx.app.get(AuthService);
    for (const [email, name, role] of [
      ['root@admin.test', 'Root', 'super_admin'],
      ['fin@admin.test', 'Finance', 'finance'],
      ['support@admin.test', 'Support', 'support'],
      ['auditor@admin.test', 'Auditeur', 'auditor'],
    ] as const) {
      registerEnrollmentToken(email, (await auth.createPlatformAdmin(email, PASSWORD, name, role)).enrollmentToken);
    }
  });
  afterAll(async () => ctx.close());

  it('un compte commerçant ne peut pas se connecter à l’admin', async () => {
    await registerMerchant(ctx, 'merchant@admin.test');
    const r = await ctx.api().post('/v1/admin/auth/login').send({ email: 'merchant@admin.test', password: PASSWORD });
    expect(r.status).toBe(401);
  });

  it('un compte Business existant ne peut jamais être promu administrateur (mot de passe et MFA d’un tiers)', async () => {
    await registerMerchant(ctx, 'ops@admin.test', 'Org squat', { verify: false });
    const auth = ctx.app.get(AuthService);
    await expect(auth.createPlatformAdmin('ops@admin.test', 'Other-Password-2026!', 'Ops', 'super_admin')).rejects.toThrow(/compte Business/);
    const row = await ownerQuery<{ platform_role: string | null }>(`SELECT platform_role FROM users WHERE email = 'ops@admin.test'`);
    expect(row[0]?.platform_role).toBeNull();
    expect((await ctx.api().post('/v1/admin/auth/login').send({ email: 'ops@admin.test', password: PASSWORD })).status).toBe(401);
  });

  it('MFA obligatoire : sans enrôlement, aucune route admin n’est accessible', async () => {
    const { s, body } = await login(ctx, 'support@admin.test', 'admin');
    expect(body.mfaEnrollmentRequired).toBe(true);
    const r = await s.get('/v1/admin/dashboard');
    expect(r.status).toBe(403);
    // Une session business ne donne pas accès à l'admin (cookies et audiences distincts)
    const m = await login(ctx, 'merchant@admin.test');
    expect((await m.s.get('/v1/admin/dashboard')).status).toBe(401);
  });

  it('permissions par rôle et masquage des données personnelles pour le support', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'kyb@admin.test', 'Société KYB');
    await s.post(`/v1/orgs/${orgId}/kyb`, { legalName: 'SOCIETE KYB SARL', ice: '001234567000089', rc: 'RC12345', address: '1 Bd Anfa, Casablanca' });
    const support = await adminSession(ctx, 'support@admin.test');
    const org = await support.get(`/v1/admin/organizations/${orgId}`);
    expect(org.status).toBe(200);
    expect(org.body.ice).not.toBe('001234567000089');
    expect((await support.post(`/v1/admin/organizations/${orgId}/suspend`, { reason: 'Test de permission' })).status).toBe(403);

    const root = await adminSession(ctx, 'root@admin.test');
    const full = await root.get(`/v1/admin/organizations/${orgId}`);
    expect(full.body.ice).toBe('001234567000089');
    const kyb = await root.post(`/v1/admin/organizations/${orgId}/kyb`, { decision: 'verified', reason: 'Documents conformes (test)' });
    expect(kyb.status).toBe(200);
  });

  it('principe des quatre yeux : modification des frais', async () => {
    const { orgId } = await registerMerchant(ctx, 'fees@admin.test', 'Org Frais');
    const root = await adminSession(ctx, 'root@admin.test');
    const fin = await adminSession(ctx, 'fin@admin.test');
    const req = await root.post('/v1/admin/approvals', { action: 'org.fee.update', targetId: orgId, payload: { vitpayFeeBps: 120 }, reason: 'Nouvelle grille tarifaire' });
    expect(req.status).toBe(201);
    const self = await root.post(`/v1/admin/approvals/${req.body.id}/decision`, { decision: 'approved', note: 'auto-validation' });
    expect(self.status).toBe(403);
    const other = await fin.post(`/v1/admin/approvals/${req.body.id}/decision`, { decision: 'approved', note: 'Validé finance' });
    expect(other.status).toBe(200);
    const org = await root.get(`/v1/admin/organizations/${orgId}`);
    expect(org.body.vitpayFeeBps).toBe(120);
  });

  it('suspension immédiate, réactivation sous quatre yeux', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'suspend@admin.test');
    await connectMock(s, orgId);
    const root = await adminSession(ctx, 'root@admin.test');
    const fin = await adminSession(ctx, 'fin@admin.test');
    expect((await root.post(`/v1/admin/organizations/${orgId}/suspend`, { reason: 'Activité suspecte (test)' })).status).toBe(200);
    const blocked = await s.post(`/v1/orgs/${orgId}/payment-requests`, { amount: '10', currency: 'MAD' }, { 'Idempotency-Key': 'suspend-key-0001' });
    expect(blocked.status).toBe(403);
    const ar = await root.post('/v1/admin/approvals', { action: 'org.reactivate', targetId: orgId, reason: 'Contrôle effectué' });
    expect(ar.status, JSON.stringify(ar.body)).toBe(201);
    const dec = await fin.post(`/v1/admin/approvals/${ar.body.id}/decision`, { decision: 'approved', note: 'Validé' });
    expect(dec.status, JSON.stringify(dec.body)).toBe(200);
    const ok = await s.post(`/v1/orgs/${orgId}/payment-requests`, { amount: '10', currency: 'MAD' }, { 'Idempotency-Key': 'suspend-key-0002' });
    expect(ok.status).toBe(201);
  });

  it('rapprochement : lignes concordantes réglées, écart détecté', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'recon@admin.test');
    const accountId = await connectMock(s, orgId);
    const r1 = await createRequest(s, orgId, '100.00');
    await payerActs(ctx, tokenOf(r1.payUrl), 'succeed');
    const r2 = await createRequest(s, orgId, '250.00');
    await payerActs(ctx, tokenOf(r2.payUrl), 'succeed');
    const fin = await adminSession(ctx, 'fin@admin.test');
    const today = new Date().toISOString().slice(0, 10);
    const run = await fin.post('/v1/admin/reconciliation/runs', { providerAccountId: accountId, date: today });
    expect(run.status).toBe(201);
    expect(run.body.status).toBe('completed');
    expect(run.body.stats.matched).toBe(2);
    const ledger = await s.get(`/v1/orgs/${orgId}/ledger/balances`);
    const bal = Object.fromEntries(ledger.body.balances.map((b: { code: string; balanceMinor: string }) => [b.code, b.balanceMinor]));
    expect(bal.provider_receivable).toBe('0');
    expect(bal.bank_settled).toBe(String(35000 - 150 - 375));
    // Rejouer le rapprochement est sans effet sur le ledger
    await fin.post('/v1/admin/reconciliation/runs', { providerAccountId: accountId, date: today });
    const again = await s.get(`/v1/orgs/${orgId}/ledger/balances`);
    expect(again.body.balances).toEqual(ledger.body.balances);
  });

  it('enrôlement MFA admin impossible avec le seul mot de passe (jeton d’invitation requis)', async () => {
    const { s } = await login(ctx, 'auditor@admin.test', 'admin');
    expect((await s.post('/v1/admin/auth/mfa/setup', {})).status).toBe(422);
    expect((await s.post('/v1/admin/auth/mfa/setup', { enrollmentToken: 'x'.repeat(32) })).status).toBe(403);
  });

  it('un auditeur ne voit pas les données personnelles dans le journal d’audit', async () => {
    const auditor = await adminSession(ctx, 'auditor@admin.test');
    const log = await auditor.get('/v1/admin/audit');
    expect(log.status).toBe(200);
    expect(JSON.stringify(log.body)).not.toContain('001234567000089');
  });

  it('approbations concurrentes : la seconde échoue si la valeur a changé', async () => {
    const { orgId } = await registerMerchant(ctx, 'stale@admin.test', 'Org Stale');
    const root = await adminSession(ctx, 'root@admin.test');
    const fin = await adminSession(ctx, 'fin@admin.test');
    const a1 = await root.post('/v1/admin/approvals', { action: 'org.fee.update', targetId: orgId, payload: { vitpayFeeBps: 100 }, reason: 'Grille A' });
    const a2 = await root.post('/v1/admin/approvals', { action: 'org.fee.update', targetId: orgId, payload: { vitpayFeeBps: 200 }, reason: 'Grille B' });
    expect((await fin.post(`/v1/admin/approvals/${a1.body.id}/decision`, { decision: 'approved', note: 'Validé' })).status).toBe(200);
    expect((await fin.post(`/v1/admin/approvals/${a2.body.id}/decision`, { decision: 'approved', note: 'Validé' })).status).toBe(409);
  });

  it('journal d’audit consultable et vérifiable', async () => {
    const root = await adminSession(ctx, 'root@admin.test');
    const log = await root.get('/v1/admin/audit?action=admin.');
    expect(log.status).toBe(200);
    expect(log.body.length).toBeGreaterThan(0);
    const v = await root.get('/v1/admin/audit/verify');
    expect(v.body.ok).toBe(true);
  });
});

describe('relevés de commissions (facturation hors flux)', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.close());

  it('émission, idempotence, PDF, annulation puis ré-émission, encaissement', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'billing@admin.test', 'Org Facturée');
    await connectMock(s, orgId);
    const root = await adminSession(ctx, 'root@admin.test');
    const fin = await adminSession(ctx, 'fin@admin.test');
    // Commission 2 % (validée à quatre yeux)
    const ar = await root.post('/v1/admin/approvals', { action: 'org.fee.update', targetId: orgId, payload: { vitpayFeeBps: 200 }, reason: 'Grille pilote' });
    await fin.post(`/v1/admin/approvals/${ar.body.id}/decision`, { decision: 'approved', note: 'Validé' });
    for (const amount of ['100.00', '250.00']) {
      const r = await createRequest(s, orgId, amount);
      await payerActs(ctx, tokenOf(r.payUrl), 'succeed');
    }
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
    const body = { periodStart: day, periodEnd: day, mode: 'sandbox', orgId };
    // Le support ne peut pas émettre
    expect((await (await adminSession(ctx, 'support@admin.test')).post('/v1/admin/billing/statements', body)).status).toBe(403);
    const issued = await fin.post('/v1/admin/billing/statements', body);
    expect(issued.status).toBe(201);
    expect(issued.body.issued).toHaveLength(1);
    const st = issued.body.issued[0];
    expect(st.fees.minor).toBe('700'); // 2 % de 350,00 MAD
    expect(st.number).toMatch(/^TEST-VPC-/);
    // Rejouer l'émission ne refacture rien
    expect((await fin.post('/v1/admin/billing/statements', body)).body.issued).toHaveLength(0);
    // Le commerçant voit son relevé (lecture seule) et le PDF
    const mine = await s.get(`/v1/orgs/${orgId}/billing/statements`);
    expect(mine.body.map((x: { id: string }) => x.id)).toContain(st.id);
    const pdf = await s.get(`/v1/orgs/${orgId}/billing/statements/${st.id}/statement.pdf`);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    // Annulation → les paiements redeviennent facturables
    expect((await fin.post(`/v1/admin/billing/statements/${st.id}/void`, { reason: 'Erreur de période' })).status).toBe(200);
    const again = await fin.post('/v1/admin/billing/statements', body);
    expect(again.body.issued[0].fees.minor).toBe('700');
    expect((await fin.post(`/v1/admin/billing/statements/${again.body.issued[0].id}/paid`, { reference: 'VIR-2026-0001' })).status).toBe(200);
    expect((await fin.post(`/v1/admin/billing/statements/${again.body.issued[0].id}/void`, { reason: 'Trop tard' })).status).toBe(409);
  });

  it('aucune commission sur la part remboursée ou perdue en litige ; avoir si déjà facturée', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'waiver@admin.test', 'Org Ristourne');
    await connectMock(s, orgId);
    const root = await adminSession(ctx, 'root@admin.test');
    const fin = await adminSession(ctx, 'fin@admin.test');
    const ar = await root.post('/v1/admin/approvals', { action: 'org.fee.update', targetId: orgId, payload: { vitpayFeeBps: 200 }, reason: 'Grille pilote' });
    await fin.post(`/v1/admin/approvals/${ar.body.id}/decision`, { decision: 'approved', note: 'Validé' });
    const pay = async (amount: string) => {
      const r = await createRequest(s, orgId, amount);
      return payerActs(ctx, tokenOf(r.payUrl), 'succeed');
    };
    const refund = async (attemptId: string, amount: string) => {
      const r = await s.post(`/v1/orgs/${orgId}/refunds`, { attemptId, amount, reason: 'Retour client' }, { 'Idempotency-Key': idemKey() });
      expect(r.body.status).toBe('succeeded');
      await ctx.psp.drain();
    };
    const p1 = await pay('100.00'); // remboursé à 25 % avant facturation → commission sur 75,00
    const p2 = await pay('200.00'); // litige ouvert → facturation reportée
    const p3 = await pay('50.00'); // facturé, puis remboursé intégralement → avoir
    await refund(p1.attemptId, '25.00');
    const dispute = await ctx.api().post(`/mock-psp/simulate/payments/${p2.providerRef}/dispute`);
    await ctx.psp.drain();

    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
    const body = { periodStart: day, periodEnd: day, mode: 'sandbox', orgId };
    const first = (await fin.post('/v1/admin/billing/statements', body)).body.issued;
    expect(first).toHaveLength(1);
    expect(first[0].fees.minor).toBe('250'); // 2 % × 75,00 + 2 % × 50,00 ; P2 reporté
    expect(first[0].lineCount).toBe(2);

    // Après facturation : remboursement total de P3 et litige perdu sur P2.
    await refund(p3.attemptId, '50.00');
    await ctx.api().post(`/mock-psp/simulate/disputes/${dispute.body.id}/lost`);
    await ctx.psp.drain();
    const second = (await fin.post('/v1/admin/billing/statements', body)).body.issued;
    expect(second).toHaveLength(1);
    expect(second[0].fees.minor).toBe('-100'); // avoir de la commission de P3 ; P2 n'est jamais facturé
    expect((await fin.post('/v1/admin/billing/statements', body)).body.issued).toHaveLength(0); // idempotent
    const pdf = await s.get(`/v1/orgs/${orgId}/billing/statements/${second[0].id}/statement.pdf`);
    expect(pdf.status).toBe(200);

    // Grand livre : commission annulée (25 % de P1, 100 % de P2 et P3), dette de commission = 150.
    const waived = await ownerQuery(`SELECT 1 FROM journal_entries WHERE entry_type = 'vitpay_fee.waived' AND org_id = $1`, [orgId]);
    expect(waived).toHaveLength(3);
    const ledger = await s.get(`/v1/orgs/${orgId}/ledger/balances`);
    const bal = Object.fromEntries(ledger.body.balances.map((b: { code: string; balanceMinor: string }) => [b.code, b.balanceMinor]));
    expect(bal.vitpay_fees).toBe('150');
    expect(bal.vitpay_fees_payable).toBe('150');
  });

  it('annulation d’un relevé compensé par un avoir, rattrapage des paiements reportés, émissions simultanées', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'waiver2@admin.test', 'Org Rattrapage');
    await connectMock(s, orgId);
    const root = await adminSession(ctx, 'root@admin.test');
    const fin = await adminSession(ctx, 'fin@admin.test');
    const ar = await root.post('/v1/admin/approvals', { action: 'org.fee.update', targetId: orgId, payload: { vitpayFeeBps: 200 }, reason: 'Grille pilote' });
    await fin.post(`/v1/admin/approvals/${ar.body.id}/decision`, { decision: 'approved', note: 'Validé' });
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date());
    const body = { periodStart: day, periodEnd: day, mode: 'sandbox', orgId };
    const billedNet = async () =>
      (await ownerQuery<{ n: string }>(`SELECT COALESCE(SUM(l.fee_minor),0)::text AS n FROM commission_statement_lines l WHERE l.org_id = $1 AND l.active`, [orgId]))[0]?.n;

    // [R4-C1] P (100,00, commission 200) facturé sur S1, remboursé à 25 % → avoir −50 sur S2 ; S1 annulé.
    const r = await createRequest(s, orgId, '100.00');
    const p = await payerActs(ctx, tokenOf(r.payUrl), 'succeed');
    const s1 = (await fin.post('/v1/admin/billing/statements', body)).body.issued[0];
    expect(s1.fees.minor).toBe('200');
    const rf = await s.post(`/v1/orgs/${orgId}/refunds`, { attemptId: p.attemptId, amount: '25.00', reason: 'Retour' }, { 'Idempotency-Key': idemKey() });
    expect(rf.body.status).toBe('succeeded');
    await ctx.psp.drain();
    const s2 = (await fin.post('/v1/admin/billing/statements', body)).body.issued[0];
    expect(s2.fees.minor).toBe('-50');
    await fin.post(`/v1/admin/billing/statements/${s1.id}/void`, { reason: 'Erreur' });
    const s3 = (await fin.post('/v1/admin/billing/statements', body)).body.issued[0];
    expect(s3.fees.minor).toBe('200'); // rétablit le dû : −50 + 200 = 150 = 2 % × 75,00
    expect(await billedNet()).toBe('150');

    // [R4-C2] Paiement reporté (litige ouvert) puis gagné : facturé à l'émission suivante, même période passée.
    const r2 = await createRequest(s, orgId, '300.00');
    const p2 = await payerActs(ctx, tokenOf(r2.payUrl), 'succeed');
    const dispute = await ctx.api().post(`/mock-psp/simulate/payments/${p2.providerRef}/dispute`);
    await ctx.psp.drain();
    expect((await fin.post('/v1/admin/billing/statements', body)).body.issued).toHaveLength(0);
    await ctx.api().post(`/mock-psp/simulate/disputes/${dispute.body.id}/won`);
    await ctx.psp.drain();
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca' }).format(new Date(Date.now() + 86_400_000));
    const late = (await fin.post('/v1/admin/billing/statements', { periodStart: tomorrow, periodEnd: tomorrow, mode: 'sandbox', orgId })).body.issued;
    expect(late[0].fees.minor).toBe('600');

    // [R4-P1] Émissions simultanées : l'écart n'est compté qu'une fois.
    const r3 = await createRequest(s, orgId, '50.00');
    await payerActs(ctx, tokenOf(r3.payUrl), 'succeed');
    const both = await Promise.all([fin.post('/v1/admin/billing/statements', body), fin.post('/v1/admin/billing/statements', body)]);
    expect(both.flatMap((b) => b.body.issued)).toHaveLength(1);
    expect(await billedNet()).toBe('850'); // 150 + 600 + 100
  });
});

describe('justificatifs KYB chiffrés', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await startApp();
  });
  afterAll(async () => ctx.close());

  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

  it('dépôt validé par le contenu, chiffré en base, consultation admin journalisée', async () => {
    const { s, orgId } = await registerMerchant(ctx, 'kybdocs@admin.test', 'Org Docs');
    const up = (buf: Buffer, name: string, kind = 'rc_extract') =>
      ctx.api().post(`/v1/orgs/${orgId}/kyb/documents`).set('Cookie', s.cookie).set('x-vitpay-csrf', '1').field('kind', kind).attach('file', buf, name);

    // Un exécutable renommé en .pdf est refusé (type réel vérifié)
    expect((await up(Buffer.from('MZ\x90\x00 fake exe'), 'extrait.pdf')).status).toBe(422);
    expect((await up(PDF, 'x.pdf', 'passport_photo')).status).toBe(422);
    const ok = await up(PDF, '../../etc/Extrait RC.pdf');
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ kind: 'rc_extract', mimeType: 'application/pdf', filename: 'Extrait RC.pdf', status: 'pending' });

    // Chiffré au repos : le contenu en clair n'apparaît pas en base
    const raw = await ownerQuery<{ content_enc: Buffer }>(`SELECT content_enc FROM kyb_documents WHERE id = $1`, [ok.body.id]);
    expect(raw[0]?.content_enc.includes(Buffer.from('%PDF'))).toBe(false);

    // Téléchargement par le commerçant : contenu identique
    const dl = await s.get(`/v1/orgs/${orgId}/kyb/documents/${ok.body.id}/download`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(Buffer.compare(dl.body as Buffer, PDF)).toBe(0);

    // Une autre organisation ne voit rien
    const other = await registerMerchant(ctx, 'kybother@admin.test');
    expect((await other.s.get(`/v1/orgs/${orgId}/kyb/documents`)).status).toBe(404);

    // Conformité : le support n'a pas accès ; root consulte → journalisé
    const support = await adminSession(ctx, 'support@admin.test');
    expect((await support.get(`/v1/admin/organizations/${orgId}/kyb/documents`)).status).toBe(403);
    const root = await adminSession(ctx, 'root@admin.test');
    expect((await root.get(`/v1/admin/kyb/documents/${ok.body.id}/download`)).status).toBe(200);
    const audit = await ownerQuery(`SELECT 1 FROM audit_log WHERE action = 'admin.kyb.document_viewed' AND target_id = $1`, [ok.body.id]);
    expect(audit.length).toBe(1);
    expect((await root.post(`/v1/admin/kyb/documents/${ok.body.id}/review`, { decision: 'accepted', note: 'Extrait conforme' })).status).toBe(200);
  });
});
