import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { Db } from '../src/database/db.service';
import { PgThrottlerStorage } from '../src/modules/platform/pg-throttler.storage';
import { TEST_ENV } from './env';
import { ownerQuery, resetDb, startApp, TestCtx } from './helpers';

describe('limitation de débit partagée (PostgreSQL)', () => {
  let ctx: TestCtx;
  let other: Db;

  beforeAll(async () => {
    await resetDb();
    // Limitation ACTIVE (hors NODE_ENV=test) pour ce fichier.
    ctx = await startApp({ NODE_ENV: 'development' });
    other = new Db(loadConfig(TEST_ENV as unknown as NodeJS.ProcessEnv)); // seconde « instance » de l'API
  });
  afterAll(async () => {
    await other.onModuleDestroy();
    await ctx.close();
  });

  it('compteur commun à plusieurs instances, blocage puis remise à zéro après expiration', async () => {
    const a = new PgThrottlerStorage(ctx.db);
    const b = new PgThrottlerStorage(other);
    const key = `k-${Date.now()}`;
    expect((await a.increment(key, 1000, 3, 1000, 'default')).totalHits).toBe(1);
    expect((await b.increment(key, 1000, 3, 1000, 'default')).totalHits).toBe(2); // vu par l'autre instance
    expect((await a.increment(key, 1000, 3, 1000, 'default')).isBlocked).toBe(false);
    const blocked = await b.increment(key, 1000, 3, 1000, 'default');
    expect(blocked).toMatchObject({ totalHits: 4, isBlocked: true });
    expect(blocked.timeToBlockExpire).toBeGreaterThan(0);
    await ownerQuery(`UPDATE rate_limits SET expires_at = now() - interval '1 second', blocked_until = now() - interval '1 second' WHERE key = $1`, [`default:${key}`]);
    expect(await a.increment(key, 1000, 3, 1000, 'default')).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('incréments concurrents : aucun appel perdu', async () => {
    const s = new PgThrottlerStorage(ctx.db);
    const key = `c-${Date.now()}`;
    await Promise.all(Array.from({ length: 25 }, () => s.increment(key, 60_000, 1000, 60_000, 'default')));
    const row = await ownerQuery<{ hits: number }>(`SELECT hits FROM rate_limits WHERE key = $1`, [`default:${key}`]);
    expect(row[0]?.hits).toBe(25);
  });

  it('API : la limite de connexion (10/min) s’applique via le stockage partagé', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await ctx.api().post('/v1/auth/login').send({ email: 'nobody@rl.test', password: 'Wrong-Password-2026!' })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await ownerQuery(`SELECT 1 FROM rate_limits`)).length).toBeGreaterThan(0);
  });
});
