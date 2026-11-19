import { mkdirSync, writeFileSync } from 'node:fs';
import { request } from '@playwright/test';

export const MERCHANT_STATE = `${__dirname}/.auth/merchant.json`;
export const MERCHANT_CREDS = `${__dirname}/.auth/merchant-creds.json`;

/** Dernier jeton de vérification reçu par Mailpit pour cette adresse. */
async function verificationToken(mailpit: string, to: string): Promise<string> {
  const ctx = await request.newContext({ baseURL: mailpit });
  try {
    for (let i = 0; i < 30; i++) {
      const list = await (await ctx.get(`/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
      for (const m of list.messages ?? []) {
        const msg = await (await ctx.get(`/api/v1/message/${m.ID}`)).json();
        const token = String(msg.Text).match(/verify-email\?token=(\S+)/)?.[1];
        if (token) return decodeURIComponent(token);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    await ctx.dispose();
  }
  throw new Error(`aucun e-mail de vérification pour ${to}`);
}

/**
 * Une seule connexion du commerçant pour toute la suite : la limitation de débit
 * (10 connexions/min par IP) s'applique aussi aux tests.
 *
 * - Local : commerçant de démonstration (mot de passe connu du seed local).
 * - Staging (E2E_SIGNUP=1) : les mots de passe du seed sont aléatoires et ne doivent pas
 *   circuler ; la suite inscrit son propre commerçant, confirme l'adresse via Mailpit
 *   (MAILPIT_URL, tunnel SSH) et connecte le prestataire simulé.
 */
export default async function globalSetup(): Promise<void> {
  const BIZ = process.env.BIZ_URL ?? 'http://localhost:3711';
  const ctx = await request.newContext({ baseURL: BIZ, extraHTTPHeaders: { 'x-vitpay-csrf': '1' } });
  let email = 'marchand@vitpay.test';
  let password = process.env.DEMO_PASSWORD ?? 'Demo-Password-2026!';

  if (process.env.E2E_SIGNUP) {
    const mailpit = process.env.MAILPIT_URL;
    if (!mailpit) throw new Error('E2E_SIGNUP exige MAILPIT_URL');
    email = `e2e-suite-${Date.now()}@vitpay.test`;
    password = `E2e-${crypto.randomUUID()}-Aa1!`;
    const reg = await ctx.post('/api/v1/auth/register', {
      data: { email, password, fullName: 'Suite E2E', organizationName: 'Boutique E2E Casablanca' },
    });
    if (!reg.ok()) throw new Error(`inscription du commerçant de test impossible : ${reg.status()} ${await reg.text()}`);
    const ver = await ctx.post('/api/v1/auth/email/verify', { data: { token: await verificationToken(mailpit, email) } });
    if (!ver.ok()) throw new Error(`vérification de l'e-mail impossible : ${ver.status()}`);
  }

  const res = await ctx.post('/api/v1/auth/login', { data: { email, password } });
  if (!res.ok()) throw new Error(`connexion du commerçant ${email} impossible : ${res.status()}`);

  if (process.env.E2E_SIGNUP) {
    const me = await (await ctx.get('/api/v1/auth/me')).json();
    const prov = await ctx.post(`/api/v1/orgs/${me.organizations[0].id}/providers`, { data: { providerCode: 'mock', mode: 'sandbox' } });
    if (!prov.ok()) throw new Error(`connexion du prestataire simulé impossible : ${prov.status()} ${await prov.text()}`);
  }

  mkdirSync(`${__dirname}/.auth`, { recursive: true });
  await ctx.storageState({ path: MERCHANT_STATE });
  writeFileSync(MERCHANT_CREDS, JSON.stringify({ email, password }), { mode: 0o600 });
  await ctx.dispose();
}
