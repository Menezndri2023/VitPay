import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { metrics } from '../src/common/observability';
import { JobsService } from '../src/modules/jobs/jobs.service';
import { PgThrottlerStorage } from '../src/modules/platform/pg-throttler.storage';
import { TEST_ENV } from './env';
import { ownerQuery, resetDb, startApp, TestCtx } from './helpers';

const cfg = (over: Record<string, string> = {}) => loadConfig({ ...TEST_ENV, ...over } as unknown as NodeJS.ProcessEnv);

describe('limitation de débit partagée (PostgreSQL)', () => {
  let ctx: TestCtx;
  const storages: PgThrottlerStorage[] = [];
  const storage = (over: Record<string, string> = {}) => {
    const s = new PgThrottlerStorage(cfg(over));
    storages.push(s);
    return s;
  };

  beforeAll(async () => {
    await resetDb();
    // Limitation ACTIVE (hors NODE_ENV=test) ; proxy NON approuvé : l'IP est celle de la connexion.
    ctx = await startApp({ NODE_ENV: 'development', TRUST_PROXY: '10.255.255.0/24' });
  });
  afterAll(async () => {
    await Promise.all(storages.map((s) => s.onModuleDestroy()));
    await ctx.close();
  });

  it('compteur commun à deux instances ; blocage ; remise à zéro à l’expiration', async () => {
    const a = storage();
    const b = storage(); // seconde « instance » de l'API (autre pool)
    const key = `k-${Date.now()}`;
    expect((await a.increment(key, 1000, 3, 1000, 'default')).totalHits).toBe(1);
    expect((await b.increment(key, 1000, 3, 1000, 'default')).totalHits).toBe(2);
    expect((await a.increment(key, 1000, 3, 1000, 'default')).isBlocked).toBe(false);
    const blocked = await b.increment(key, 1000, 3, 1000, 'default');
    expect(blocked).toMatchObject({ totalHits: 4, isBlocked: true });
    expect(blocked.timeToBlockExpire).toBeGreaterThan(0);
    // Les 429 suivants sont servis par le cache local (la base n'est pas touchée)
    const before = (await ownerQuery<{ hits: number }>(`SELECT max(hits) AS hits FROM rate_limits`))[0]?.hits;
    expect((await b.increment(key, 1000, 3, 1000, 'default')).isBlocked).toBe(true);
    expect((await ownerQuery<{ hits: number }>(`SELECT max(hits) AS hits FROM rate_limits`))[0]?.hits).toBe(before);
    await ownerQuery(`UPDATE rate_limits SET expires_at = now() - interval '1 second', blocked_until = now() - interval '1 second'`);
    const c = storage(); // instance sans cache
    expect(await c.increment(key, 1000, 3, 1000, 'default')).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('fin de blocage avant la fin de fenêtre : le compteur repart de zéro ; sans durée de blocage : refus au-delà de la limite', async () => {
    const s = storage();
    const key = `b-${Date.now()}`;
    for (let i = 0; i < 3; i++) await s.increment(key, 60_000, 2, 1000, 'default');
    await ownerQuery(`UPDATE rate_limits SET blocked_until = now() - interval '1 second' WHERE blocked_until IS NOT NULL`);
    expect(await storage().increment(key, 60_000, 2, 1000, 'default')).toMatchObject({ totalHits: 1, isBlocked: false });

    const z = storage();
    const kz = `z-${Date.now()}`;
    await z.increment(kz, 60_000, 1, 0, 'default');
    expect((await z.increment(kz, 60_000, 1, 0, 'default')).isBlocked).toBe(true);
  });

  it('incréments concurrents : aucun appel perdu (dans la capacité du pool dédié)', async () => {
    const s = storage();
    const key = `c-${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 8 }, () => s.increment(key, 60_000, 1000, 60_000, 'default')));
    expect(results.map((r) => r.totalHits).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('cloisonnement : rôle applicatif sans accès à la table ; clés sans IP en clair ; arguments bornés', async () => {
    await expect(ctx.db.tx((tx) => tx.query('SELECT * FROM rate_limits'))).rejects.toThrow(/permission denied/);
    await expect(ctx.db.tx((tx) => tx.query(`UPDATE rate_limits SET hits = 0`))).rejects.toThrow(/permission denied/);
    const keys = await ownerQuery<{ key: string }>(`SELECT key FROM rate_limits`);
    expect(keys.every((k) => /^[0-9a-f]{48}$/.test(k.key))).toBe(true);
    await expect(ctx.db.tx((tx) => tx.query(`SELECT * FROM rate_limit_hit(repeat('x', 500), 1000, 1, 0)`))).rejects.toThrow(/invalid arguments/);
  });

  it('base indisponible : compteur local de repli — la limitation reste effective, l’erreur est comptée', async () => {
    const down = storage({ DATABASE_URL: 'postgres://vitpay_app:x@127.0.0.1:1/vitpay_test' });
    expect((await down.increment('k', 60_000, 2, 60_000, 'default')).isBlocked).toBe(false);
    expect((await down.increment('k', 60_000, 2, 60_000, 'default')).isBlocked).toBe(false);
    const third = await down.increment('k', 60_000, 2, 60_000, 'default');
    expect(third).toMatchObject({ totalHits: 3, isBlocked: true });
    expect(metrics.render()).toMatch(/vitpay_rate_limit_errors_total [1-9]/);
  });

  it('purge par lots des compteurs expirés', async () => {
    await ownerQuery(`UPDATE rate_limits SET expires_at = now() - interval '1 second', blocked_until = NULL`);
    const n = await ctx.app.get(JobsService).purgeRateLimits(2);
    expect(n).toBeGreaterThan(2);
    expect(await ownerQuery(`SELECT 1 FROM rate_limits WHERE expires_at < now()`)).toHaveLength(0);
  });

  it('API : limite de connexion (10/min) ; un X-Forwarded-For forgé ne donne pas de nouveau compteur', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await ctx
        .api()
        .post('/v1/auth/login')
        .set('X-Forwarded-For', `203.0.113.${i + 1}`) // ignoré : le proxy n'est pas approuvé
        .send({ email: 'nobody@rl.test', password: 'Wrong-Password-2026!' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
