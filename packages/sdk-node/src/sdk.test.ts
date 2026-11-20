import { describe, expect, it, vi } from 'vitest';
import { constructEvent, generateTestHeader, VitPay, VitPayConnectionError, VitPayError, VitPaySignatureError } from './index';

const KEY = 'vp_sk_test_' + 'a'.repeat(43);
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function client(fetchImpl: typeof fetch, extra: object = {}) {
  return new VitPay({ apiKey: KEY, orgId: 'org-1', baseUrl: 'https://api.example.test/', fetch: fetchImpl, ...extra });
}

describe('VitPay client', () => {
  it('valide la configuration', () => {
    expect(() => new VitPay({ apiKey: 'sk_x', orgId: 'o', baseUrl: 'https://a.test' })).toThrow(/vp_sk_/);
    expect(() => new VitPay({ apiKey: KEY, orgId: 'o', baseUrl: 'http://api.example.test' })).toThrow(/HTTPS/);
    expect(new VitPay({ apiKey: KEY, orgId: 'o', baseUrl: 'http://localhost:4710' }).mode).toBe('test');
    expect(new VitPay({ apiKey: 'vp_sk_live_' + 'b'.repeat(43), orgId: 'o', baseUrl: 'https://a.test' }).mode).toBe('live');
  });

  it('create : URL, en-têtes, devise par défaut et clé d’idempotence fournie', async () => {
    const f = vi.fn(async () => json(201, { id: 'r1', payUrl: 'https://pay/r/x' }));
    const r = await client(f as unknown as typeof fetch).paymentRequests.create({ amount: '10.00', metadata: { invoiceId: 'INV-1' } }, { idempotencyKey: 'facture-INV-1' });
    expect(r.id).toBe('r1');
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit & { headers: Record<string, string> }];
    expect(String(url)).toBe('https://api.example.test/v1/orgs/org-1/payment-requests');
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(init.headers['idempotency-key']).toBe('facture-INV-1');
    expect(JSON.parse(String(init.body))).toEqual({ currency: 'MAD', amount: '10.00', metadata: { invoiceId: 'INV-1' } });
  });

  it('nouvelle tentative sur 503 avec la MÊME clé d’idempotence', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(503, {}, { 'retry-after': '0' })).mockResolvedValueOnce(json(201, { id: 'r2' }));
    const r = await client(f as unknown as typeof fetch).paymentRequests.create({ amount: '5' });
    expect(r.id).toBe('r2');
    const keys = f.mock.calls.map((c) => (c[1] as { headers: Record<string, string> }).headers['idempotency-key']);
    expect(keys[0]).toMatch(/^sdk_/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('erreur API : VitPayError avec code, détails et requestId', async () => {
    const f = vi.fn(async () => json(422, { title: 'Invalid request', status: 422, code: 'validation_error', requestId: 'req_9', details: { amount: 'bad' } }));
    const e = await client(f as unknown as typeof fetch).paymentRequests.create({ amount: 'x' }).catch((x) => x);
    expect(e).toBeInstanceOf(VitPayError);
    expect(e).toMatchObject({ status: 422, code: 'validation_error', requestId: 'req_9', details: { amount: 'bad' } });
    expect(f).toHaveBeenCalledTimes(1); // pas de nouvel essai sur une erreur 4xx
  });

  it('annulation : jamais réessayée (pas d’idempotence)', async () => {
    const f = vi.fn(async () => json(503, {}));
    await expect(client(f as unknown as typeof fetch).paymentRequests.cancel('r1')).rejects.toBeInstanceOf(VitPayError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('coupure réseau : VitPayConnectionError après les nouvelles tentatives', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(client(f as unknown as typeof fetch, { maxRetries: 1 }).paymentRequests.retrieve('r1')).rejects.toBeInstanceOf(VitPayConnectionError);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('listAll : suit le curseur', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(200, { data: [{ id: 'a' }, { id: 'b' }], nextCursor: '2026-11-20T10:00:00.000Z' }))
      .mockResolvedValueOnce(json(200, { data: [{ id: 'c' }], nextCursor: null }));
    const ids: string[] = [];
    for await (const r of client(f as unknown as typeof fetch).paymentRequests.listAll({ status: 'paid' })) ids.push(r.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(String(f.mock.calls[1]?.[0])).toContain('before=2026-11-20T10%3A00%3A00.000Z');
    expect(String(f.mock.calls[1]?.[0])).toContain('status=paid');
  });
});

describe('webhooks.constructEvent', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', created: '2026-11-21T00:00:00Z', livemode: false, data: { requestId: 'r1' } });

  it('accepte une signature valide et renvoie l’événement', () => {
    expect(constructEvent(body, generateTestHeader(body, secret), secret).data).toEqual({ requestId: 'r1' });
    expect(constructEvent(Buffer.from(body), generateTestHeader(body, secret), secret).id).toBe('evt_1');
  });

  it('rotation : plusieurs v1, une seule doit correspondre', () => {
    const t = Math.floor(Date.now() / 1000);
    const good = generateTestHeader(body, secret, t).split(',')[1];
    expect(constructEvent(body, `t=${t},v1=${'0'.repeat(64)},${good}`, secret).id).toBe('evt_1');
    expect(constructEvent(body, generateTestHeader(body, 'whsec_old', t), [secret, 'whsec_old']).id).toBe('evt_1');
  });

  it('refuse corps modifié, mauvais secret, en-tête absent et rejeu', () => {
    const h = generateTestHeader(body, secret);
    expect(() => constructEvent(body.replace('r1', 'r2'), h, secret)).toThrow(VitPaySignatureError);
    expect(() => constructEvent(body, h, 'whsec_autre')).toThrow(/Invalid/);
    expect(() => constructEvent(body, undefined, secret)).toThrow(/Missing/);
    expect(() => constructEvent(body, 'v1=abc', secret)).toThrow(/Malformed/);
    const old = generateTestHeader(body, secret, Math.floor(Date.now() / 1000) - 3600);
    expect(() => constructEvent(body, old, secret)).toThrow(/tolerance/);
  });
});
