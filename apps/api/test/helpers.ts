import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { authenticator } from 'otplib';
import { createApp } from '../src/bootstrap';
import { AppConfig, loadConfig } from '../src/config';
import { Db } from '../src/database/db.service';
import { MockPspService } from '../src/modules/mock-psp/mock-psp.service';
import { OutboxService } from '../src/modules/platform/outbox.service';
import { TEST_ENV } from './env';

export const PASSWORD = 'Test-Password-2026!';

export interface TestCtx {
  app: INestApplication;
  config: AppConfig;
  db: Db;
  psp: MockPspService;
  outbox: OutboxService;
  api: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function startApp(overrides: Record<string, string> = {}): Promise<TestCtx> {
  const config = loadConfig({ ...TEST_ENV, ...overrides } as NodeJS.ProcessEnv);
  const app = await createApp(config);
  await app.listen(config.PORT, '127.0.0.1');
  return {
    app,
    config,
    db: app.get(Db),
    psp: app.get(MockPspService),
    outbox: app.get(OutboxService),
    api: () => request(config.PUBLIC_API_URL),
    close: async () => {
      await app.get(MockPspService).drain();
      await app.close();
    },
  };
}

/** Vide toutes les tables (rôle propriétaire ; TRUNCATE n'est pas concerné par les triggers d'immuabilité). */
export async function resetDb(): Promise<void> {
  const c = new Client({ connectionString: TEST_ENV.DATABASE_OWNER_URL });
  await c.connect();
  try {
    const { rows } = await c.query<{ t: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables
        WHERE schemaname IN ('public','mock_psp') AND tablename NOT IN ('currencies','schema_migrations')`,
    );
    await c.query(`TRUNCATE ${rows.map((r) => r.t).join(', ')} RESTART IDENTITY CASCADE`);
  } finally {
    await c.end();
  }
}

export async function ownerQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: TEST_ENV.DATABASE_OWNER_URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

/** Agent HTTP avec cookie de session (espace Business). */
export class Session {
  constructor(
    private readonly ctx: TestCtx,
    readonly cookie: string,
  ) {}

  get(path: string) {
    return this.ctx.api().get(path).set('Cookie', this.cookie);
  }

  post(path: string, body?: object, headers: Record<string, string> = {}) {
    return this.ctx.api().post(path).set('Cookie', this.cookie).set('x-vitpay-csrf', '1').set(headers).send(body ?? {});
  }

  patch(path: string, body?: object) {
    return this.ctx.api().patch(path).set('Cookie', this.cookie).set('x-vitpay-csrf', '1').send(body ?? {});
  }
}

function cookieFrom(res: request.Response): string {
  const set = res.headers['set-cookie'] as unknown as string[] | undefined;
  if (!set?.length) throw new Error(`No cookie in response ${res.status} ${JSON.stringify(res.body)}`);
  return set.map((c) => c.split(';')[0]).join('; ');
}

/** Jeton du dernier lien de vérification mis en file pour cette adresse (e-mail non encore envoyé). */
export async function verificationToken(email: string): Promise<string> {
  const rows = await ownerQuery<{ text_body: string }>(
    `SELECT text_body FROM outbound_emails WHERE to_address = $1 AND template = 'email_verification' AND text_body IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    [email.toLowerCase()],
  );
  const token = rows[0]?.text_body.match(/verify-email\?token=([A-Za-z0-9_%-]+)/)?.[1];
  if (!token) throw new Error(`no verification email for ${email}`);
  return decodeURIComponent(token);
}

/** Inscription d'un commerçant ; par défaut, suit le lien de vérification reçu par e-mail. */
export async function registerMerchant(ctx: TestCtx, email: string, orgName = 'Boutique Test', opts: { verify?: boolean } = {}): Promise<{ s: Session; orgId: string }> {
  const res = await ctx.api().post('/v1/auth/register').send({ email, password: PASSWORD, fullName: 'Test Owner', organizationName: orgName });
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${JSON.stringify(res.body)}`);
  if (opts.verify !== false) {
    const v = await ctx.api().post('/v1/auth/email/verify').send({ token: await verificationToken(email) });
    if (v.status !== 200) throw new Error(`verify failed ${v.status} ${JSON.stringify(v.body)}`);
  }
  return { s: new Session(ctx, cookieFrom(res)), orgId: res.body.organizationId };
}

export async function login(ctx: TestCtx, email: string, audience: 'business' | 'admin' = 'business'): Promise<{ s: Session; body: Record<string, unknown> }> {
  const path = audience === 'admin' ? '/v1/admin/auth/login' : '/v1/auth/login';
  const res = await ctx.api().post(path).send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  return { s: new Session(ctx, cookieFrom(res)), body: res.body };
}

const mfaSecrets = new Map<string, string>();
const enrollTokens = new Map<string, string>();
const adminSessions = new Map<string, Session>();

/** Enregistre le jeton d'enrôlement MFA remis « hors bande » à un administrateur de test. */
export function registerEnrollmentToken(email: string, token: string | null): void {
  if (token) enrollTokens.set(email, token);
}

/**
 * Session admin complète : enrôlement MFA (jeton d'invitation) la première fois, puis réutilisation
 * de la session (un code TOTP déjà utilisé est refusé : anti-rejeu).
 */
export async function adminSession(ctx: TestCtx, email: string): Promise<Session> {
  const cached = adminSessions.get(email);
  if (cached) return cached;
  const { s, body } = await login(ctx, email, 'admin');
  if (body.mfaEnrollmentRequired) {
    const enrollmentToken = enrollTokens.get(email);
    const setup = await s.post('/v1/admin/auth/mfa/setup', { enrollmentToken });
    if (setup.status !== 200) throw new Error(`mfa setup failed ${JSON.stringify(setup.body)}`);
    mfaSecrets.set(email, setup.body.secret);
    const en = await s.post('/v1/admin/auth/mfa/enable', { code: authenticator.generate(setup.body.secret), enrollmentToken });
    if (en.status !== 200) throw new Error(`mfa enable failed ${JSON.stringify(en.body)}`);
  } else if (body.mfaRequired) {
    throw new Error(`no cached admin session for ${email}`);
  }
  adminSessions.set(email, s);
  return s;
}

export function mfaSecretOf(email: string): string | undefined {
  return mfaSecrets.get(email);
}

export async function connectMock(s: Session, orgId: string): Promise<string> {
  const res = await s.post(`/v1/orgs/${orgId}/providers`, { providerCode: 'mock', mode: 'sandbox' });
  if (res.status !== 201) throw new Error(`connect failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

let keyCounter = 0;
export function idemKey(): string {
  keyCounter += 1;
  return `test-key-${Date.now()}-${keyCounter}`;
}

export async function createRequest(s: Session, orgId: string, amount = '500.00', extra: object = {}) {
  const res = await s.post(`/v1/orgs/${orgId}/payment-requests`, { amount, currency: 'MAD', description: 'Remboursement', ...extra }, { 'Idempotency-Key': idemKey() });
  if (res.status !== 201) throw new Error(`create request failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; payUrl: string; reference: string; amount: { minor: string } };
}

export function tokenOf(payUrl: string): string {
  return payUrl.split('/r/')[1] as string;
}

/** Simule le payeur : démarre une tentative puis agit sur la page du prestataire simulé. */
export async function payerActs(ctx: TestCtx, token: string, action: 'succeed' | 'decline' | 'challenge' | 'cancel'): Promise<{ attemptId: string; providerRef: string }> {
  const start = await ctx.api().post(`/v1/public/requests/${token}/attempts`).send({ method: 'card' });
  if (start.status !== 201) throw new Error(`start attempt failed ${start.status} ${JSON.stringify(start.body)}`);
  const providerRef = String(start.body.checkoutUrl).split('/checkout/')[1] as string;
  const r = await ctx.api().post(`/mock-psp/checkout/${providerRef}/${action}`);
  if (r.status !== 303) throw new Error(`checkout action failed ${r.status}`);
  await ctx.psp.drain();
  return { attemptId: start.body.attemptId, providerRef };
}

export function totp(secret: string): string {
  return authenticator.generate(secret);
}
