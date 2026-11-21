import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Money } from '@vitpay/money';
import { WebhookVerificationError, type ProviderAccountContext } from './provider.interface';
import { mapYouCanRefundStatus, mapYouCanStatus, parseRefund, parseTransaction, YouCanPayProvider } from './youcanpay.provider';
import type { AppConfig } from '../../config';

const PRI = 'pri_sandbox_00000000-test-0000-0000-000000000000';
const account: ProviderAccountContext = {
  accountId: 'acc',
  orgId: 'org',
  mode: 'sandbox',
  credentials: { publicKey: 'pub_sandbox_x', privateKey: PRI },
  webhookSecret: PRI,
};
const p = new YouCanPayProvider();
const sign = (body: string, key = PRI) => createHmac('sha256', key).update(body).digest('hex');
const event = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: 'evt_1', event_name: 'transaction.paid', sandbox: true, payload: { transaction: { id: 'tx_1', status: 1 } }, ...over });

afterEach(() => vi.unstubAllGlobals());

describe('YouCanPayProvider — webhooks', () => {
  it('accepte une signature HMAC-SHA256 du corps brut (clé privée)', () => {
    const body = event();
    const ev = p.verifyWebhook(account, Buffer.from(body), { 'x-youcanpay-signature': sign(body) });
    expect(ev).toMatchObject({ eventId: 'evt_1', type: 'payment.updated', objectRef: 'tx_1' });
  });

  it('refuse une signature absente, fausse ou calculée avec une autre clé', () => {
    const body = event();
    expect(() => p.verifyWebhook(account, Buffer.from(body), {})).toThrow(WebhookVerificationError);
    expect(() => p.verifyWebhook(account, Buffer.from(body), { 'x-youcanpay-signature': 'deadbeef' })).toThrow(WebhookVerificationError);
    expect(() => p.verifyWebhook(account, Buffer.from(body), { 'x-youcanpay-signature': sign(body, 'pri_autre') })).toThrow(WebhookVerificationError);
  });

  it('refuse un corps modifié après signature', () => {
    const body = event();
    expect(() => p.verifyWebhook(account, Buffer.from(body.replace('tx_1', 'tx_2')), { 'x-youcanpay-signature': sign(body) })).toThrow('Invalid signature');
  });

  it('refuse un événement réel sur un compte de test', () => {
    const body = event({ sandbox: false });
    expect(() => p.verifyWebhook(account, Buffer.from(body), { 'x-youcanpay-signature': sign(body) })).toThrow('Sandbox flag');
  });

  it('refuse un événement non pris en charge', () => {
    const body = event({ event_name: 'refund.created' });
    expect(() => p.verifyWebhook(account, Buffer.from(body), { 'x-youcanpay-signature': sign(body) })).toThrow('Unsupported event');
  });
});

describe('YouCanPayProvider — transactions', () => {
  it('lit une transaction v1 (montant en unités) et v2 (objet monétaire)', () => {
    const v1 = parseTransaction({ id: 'tx_1', order_id: 'att', status: 1, amount: '150.00', currency: 'MAD' }, 'tx_1');
    expect(v1.status).toBe('succeeded');
    expect(v1.externalRef).toBe('att');
    expect(v1.amount.equals(Money.of(15000n, 'MAD'))).toBe(true);
    const v2 = parseTransaction({ id: 'tx_1', order_id: 'att', status: 'failed', amount: { amount: '150.00', currency: 'MAD' } }, 'tx_1');
    expect(v2.status).toBe('failed');
  });

  it('ne confirme jamais sur un statut ou un identifiant inattendu', () => {
    expect(() => mapYouCanStatus('refunded')).toThrow();
    expect(() => mapYouCanStatus(7)).toThrow();
    expect(() => parseTransaction({ id: 'tx_X', status: 1, amount: '1.00', currency: 'MAD' }, 'tx_1')).toThrow('id mismatch');
  });

  it('crée la session : montant en centimes, page hébergée YouCan Pay en sandbox', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: { id: 'tok_abcdef123' }, transaction_id: 'tx_9' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const s = await p.createPayment(account, { attemptId: 'att', amount: Money.of(15000n, 'MAD'), description: 'Test', returnUrl: 'https://pay.example/r/t/status', customerIp: '1.2.3.4' });
    expect(s).toEqual({ providerRef: 'tx_9', checkoutUrl: 'https://youcanpay.com/sandbox/payment-form/tok_abcdef123?lang=fr', status: 'pending' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { body: string }];
    expect(url).toBe('https://youcanpay.com/sandbox/api/tokenize');
    expect(JSON.parse(init.body)).toMatchObject({ amount: '15000', currency: 'MAD', order_id: 'att', customer_ip: '1.2.3.4' });
  });

  it('valide le format des clés selon le mode', () => {
    expect(() => p.validateCredentials('sandbox', { publicKey: 'pub_sandbox_a', privateKey: 'pri_sandbox_b' })).not.toThrow();
    expect(() => p.validateCredentials('sandbox', { publicKey: 'pub_a', privateKey: 'pri_b' })).toThrow();
    expect(() => p.validateCredentials('live', { publicKey: 'pub_sandbox_a', privateKey: 'pri_sandbox_b' })).toThrow();
  });
});

describe('YouCanPayProvider — remboursements (API v2, comptes réels)', () => {
  const live: ProviderAccountContext = { ...account, mode: 'live', credentials: { publicKey: 'pub_live', privateKey: 'pri_live_key' }, webhookSecret: 'pri_live_key' };
  const enabled = new YouCanPayProvider({ YOUCAN_REFUNDS_ENABLED: true } as AppConfig);
  const refundJson = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ object: 'v2.refund', id: 'rf_1', transaction_id: 'tx_1', amount: { amount: '60.00', currency: 'MAD', localized: 'MAD 60.00' }, status: 'pending', ...over });

  it('fermés par défaut, et toujours fermés en sandbox (la v2 refuse les clés sandbox)', async () => {
    expect(p.refundsAvailable('live')).toBe(false);
    expect(enabled.refundsAvailable('sandbox')).toBe(false);
    expect(enabled.refundsAvailable('live')).toBe(true);
    await expect(p.refund(live, { providerRef: 'tx_1', amount: Money.of(6000n, 'MAD'), refundId: 'r1' })).rejects.toThrow(/not enabled/);
  });

  it('envoie le formulaire documenté (unités mineures, motif, note VITPAY) avec la clé privée en Basic', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(refundJson(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await enabled.refund(live, { providerRef: 'tx_1', amount: Money.of(6000n, 'MAD'), refundId: 'r1' });
    expect(r).toMatchObject({ providerRefundRef: 'rf_1', status: 'pending' });
    expect(r.amount.minor).toBe(6000n);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { body: URLSearchParams; headers: Record<string, string> }];
    expect(url).toBe('https://youcanpay.com/api/v2/refunds');
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(init.body)).toEqual({ transaction_id: 'tx_1', amount: '6000', reason: 'requested-by-customer', note: 'VITPAY r1' });
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from('pri_live_key:').toString('base64')}`);
  });

  it('refus du prestataire : erreur explicite ; relecture du statut par GET /api/v2/refunds/{id}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Exceeds available balance' }), { status: 422 })));
    await expect(enabled.refund(live, { providerRef: 'tx_1', amount: Money.of(6000n, 'MAD'), refundId: 'r1' })).rejects.toThrow(/Exceeds available balance/);
    const fetchMock = vi.fn().mockResolvedValue(new Response(refundJson({ status: 'succeeded' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await enabled.getRefund(live, 'rf_1')).status).toBe('succeeded');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://youcanpay.com/api/v2/refunds/rf_1');
  });

  it('statuts documentés uniquement ; transaction et montant contrôlés', () => {
    expect(mapYouCanRefundStatus('canceled')).toBe('failed');
    expect(mapYouCanRefundStatus('failed')).toBe('failed');
    expect(() => mapYouCanRefundStatus('done')).toThrow();
    expect(() => parseRefund(JSON.parse(refundJson()), 'tx_autre', 'MAD')).toThrow(/mismatch/);
    expect(() => parseRefund(JSON.parse(refundJson({ amount: { amount: 'abc', currency: 'MAD' } })), 'tx_1', 'MAD')).toThrow();
  });
});
