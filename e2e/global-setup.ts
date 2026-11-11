import { mkdirSync } from 'node:fs';
import { request } from '@playwright/test';

export const MERCHANT_STATE = `${__dirname}/.auth/merchant.json`;

/**
 * Une seule connexion du commerçant de démonstration pour toute la suite : la limitation de
 * débit (10 connexions/min par IP) s'applique aussi aux tests. Les tests dont l'objet est la
 * connexion elle-même continuent de se connecter par le formulaire.
 */
export default async function globalSetup(): Promise<void> {
  const BIZ = process.env.BIZ_URL ?? 'http://localhost:3711';
  const ctx = await request.newContext({ baseURL: BIZ });
  const res = await ctx.post('/api/v1/auth/login', {
    data: { email: 'marchand@vitpay.test', password: process.env.DEMO_PASSWORD ?? 'Demo-Password-2026!' },
    headers: { 'x-vitpay-csrf': '1' },
  });
  if (!res.ok()) throw new Error(`connexion du commerçant de démonstration impossible : ${res.status()}`);
  mkdirSync(`${__dirname}/.auth`, { recursive: true });
  await ctx.storageState({ path: MERCHANT_STATE });
  await ctx.dispose();
}
