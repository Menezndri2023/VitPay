import { createCipheriv, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decrypt, encrypt, Keyring } from '../src/common/crypto';
import { loadConfig } from '../src/config';
import { TEST_ENV } from './env';
import { ENCRYPTED_COLUMNS, KeyRotationService } from '../src/modules/security/key-rotation.service';
import { connectMock, createRequest, ownerQuery, payerActs, registerMerchant, resetDb, Session, startApp, TestCtx, tokenOf, totp } from './helpers';

const KEY_A = Buffer.alloc(32, 7); // clé de test/env.ts
const KEY_B = Buffer.alloc(32, 9);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

/** Ancien format v1 (sans identifiant de clé), tel qu'écrit avant la rotation. */
function legacyEncrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

describe('trousseau de clés', () => {
  it('identifie la clé, lit l’ancien format, refuse une clé inconnue', () => {
    const a = new Keyring(KEY_A);
    const ab = new Keyring(KEY_B, [KEY_A]);
    const v = encrypt('secret', a);
    expect(v.startsWith(`v2.${a.currentId}.`)).toBe(true);
    expect(decrypt(v, ab)).toBe('secret'); // ancienne clé encore acceptée en lecture
    expect(decrypt(legacyEncrypt('ancien', KEY_A), ab)).toBe('ancien');
    expect(() => decrypt(v, new Keyring(KEY_B))).toThrow(/Unknown encryption key/);
    expect(() => new Keyring(KEY_A, [KEY_A])).toThrow(/equals the current key/);
  });

  it('configuration stricte : une liste mal formée ne fait jamais disparaître une clé', () => {
    const a = KEY_A.toString('base64');
    const b = KEY_B.toString('base64');
    const c = Buffer.alloc(32, 5).toString('base64');
    const load = (prev: string) => loadConfig({ ...TEST_ENV, APP_ENCRYPTION_KEY: c, APP_ENCRYPTION_KEYS_PREVIOUS: prev } as NodeJS.ProcessEnv);
    for (const bad of [`${a} ${b}`, `${a};${b}`, `${a}${b}`, a.slice(0, -1), `${a},,${b}`, `${a},${a}`]) {
      expect(() => load(bad), bad.slice(0, 8)).toThrow(/APP_ENCRYPTION_KEYS_PREVIOUS/);
    }
    expect(load(`${a}, ${b}`).encryptionKey.all()).toHaveLength(3);
    expect(() => loadConfig({ ...TEST_ENV, APP_ENCRYPTION_KEY: a.slice(0, -1) } as NodeJS.ProcessEnv)).toThrow(/APP_ENCRYPTION_KEY/);
  });
});

describe('rotation de la clé de chiffrement', () => {
  let ctx: TestCtx;
  let s: Session;
  let orgId: string;
  let docId: string;
  let mfaSecret: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    ({ s, orgId } = await registerMerchant(ctx, 'rotation@keys.test', 'Org Rotation'));
    await connectMock(s, orgId);
    await s.post(`/v1/orgs/${orgId}/developers/webhooks`, { url: 'http://127.0.0.1:9/hook', events: ['payment.succeeded'] });
    const up = await ctx.api().post(`/v1/orgs/${orgId}/kyb/documents`).set('Cookie', s.cookie).set('x-vitpay-csrf', '1').field('kind', 'rc_extract').attach('file', PDF, 'rc.pdf');
    docId = up.body.id;
    mfaSecret = (await s.post('/v1/auth/mfa/setup')).body.secret;
    // Une valeur encore à l'ancien format (sans identifiant de clé)
    await ownerQuery(`UPDATE users SET mfa_secret_enc = $1 WHERE email = 'rotation@keys.test'`, [legacyEncrypt(mfaSecret, KEY_A)]);
    await ctx.close();
  });
  afterAll(async () => ctx.close());

  it('nouvelle clé + ancienne en lecture : service continu ; rechiffrement complet ; ancienne clé retirée', async () => {
    ctx = await startApp({ APP_ENCRYPTION_KEY: KEY_B.toString('base64'), APP_ENCRYPTION_KEYS_PREVIOUS: KEY_A.toString('base64') });
    const svc = ctx.app.get(KeyRotationService);
    const before = await svc.status();
    expect(Object.values(before).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(5); // identifiants, secret webhook prestataire, secret endpoint, MFA, KYB

    // Pendant la rotation : paiement (identifiants prestataire), MFA (ancien format), KYB lisibles
    const r1 = await createRequest(s, orgId, '20.00');
    await payerActs(ctx, tokenOf(r1.payUrl), 'succeed');
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests/${r1.id}`)).body.status).toBe('paid');

    // Une valeur illisible (clé inconnue) ne bloque pas la rotation des autres lignes
    const bad = await ownerQuery<{ id: string }>(
      `INSERT INTO webhook_endpoints (org_id, url, secret_enc, events, created_by, status)
       SELECT org_id, 'http://127.0.0.1:9/bad', $1, events, created_by, 'disabled' FROM webhook_endpoints LIMIT 1 RETURNING id`,
      [encrypt('x', new Keyring(Buffer.alloc(32, 3)))],
    );
    const done = await svc.reencryptAll(1); // lots d'une ligne : la reprise par lots est exercée
    expect(done['kyb_documents.content_enc']).toEqual({ reencrypted: 1, failed: 0 });
    expect(done['webhook_endpoints.secret_enc']).toEqual({ reencrypted: 1, failed: 1 });
    expect(Object.entries(await svc.status()).filter(([, n]) => n > 0)).toEqual([['webhook_endpoints.secret_enc', 1]]);
    expect(await ownerQuery(`SELECT 1 FROM audit_log WHERE action = 'security.keys_reencrypted'`)).toHaveLength(6); // une entrée par colonne
    await ownerQuery(`UPDATE webhook_endpoints SET secret_enc = $2 WHERE id = $1`, [bad[0]?.id, encrypt('x', new Keyring(KEY_B))]);
    expect(Object.values(await svc.status()).every((n) => n === 0)).toBe(true);
    await ctx.close();

    // Ancienne clé retirée : tout reste lisible avec la seule nouvelle clé
    ctx = await startApp({ APP_ENCRYPTION_KEY: KEY_B.toString('base64') });
    const r2 = await createRequest(s, orgId, '30.00');
    await payerActs(ctx, tokenOf(r2.payUrl), 'succeed');
    expect((await s.get(`/v1/orgs/${orgId}/payment-requests/${r2.id}`)).body.status).toBe('paid');
    const doc = await s
      .get(`/v1/orgs/${orgId}/kyb/documents/${docId}/download`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(doc.status).toBe(200);
    expect((doc.body as Buffer).equals(PDF)).toBe(true);
    expect((await s.post('/v1/auth/mfa/enable', { code: totp(mfaSecret) })).status).toBe(200);
  });

  it('garde : toute colonne chiffrée de la base est couverte par la rotation', async () => {
    const cols = await ownerQuery<{ t: string }>(
      `SELECT table_name || '.' || column_name AS t FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name LIKE '%\\_enc' ORDER BY 1`,
    );
    expect(cols.map((c) => c.t).sort()).toEqual(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}`).sort());
  });
});
