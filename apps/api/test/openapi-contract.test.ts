import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_KEY_SCOPES } from '../src/modules/identity/permissions';
import { WEBHOOK_EVENTS } from '../src/modules/developers/developers.service';
import { connectMock, idemKey, payerActs, registerMerchant, resetDb, Session, startApp, TestCtx, tokenOf } from './helpers';

/** La spécification publiée doit décrire exactement ce que l'API renvoie. */
const spec = JSON.parse(readFileSync(join(__dirname, '../../../docs/openapi.json'), 'utf8'));
const schema = (n: string) => spec.components.schemas[n];
const props = (n: string) => Object.keys(schema(n).properties).sort();

describe('docs/openapi.json ↔ API', () => {
  let ctx: TestCtx;
  let s: Session;
  let orgId: string;
  let key: string;

  beforeAll(async () => {
    await resetDb();
    ctx = await startApp();
    ({ s, orgId } = await registerMerchant(ctx, 'oas@dev.test', 'Org OpenAPI'));
    await connectMock(s, orgId);
    key = (await s.post(`/v1/orgs/${orgId}/developers/api-keys`, { name: 'OAS', scopes: [...API_KEY_SCOPES] })).body.secret;
  });
  afterAll(async () => ctx.close());

  const api = () => ({
    get: (p: string) => ctx.api().get(`/v1/orgs/${orgId}${p}`).set('Authorization', `Bearer ${key}`),
    post: (p: string, b: object) => ctx.api().post(`/v1/orgs/${orgId}${p}`).set('Authorization', `Bearer ${key}`).set('Idempotency-Key', idemKey()).send(b),
  });

  it('PaymentRequest, PaymentRequestDetail, PaymentAttempt et Refund : mêmes champs que les réponses', async () => {
    const created = await api().post('/payment-requests', { amount: '30', metadata: { a: 'b' } });
    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual(props('PaymentRequest'));

    await payerActs(ctx, tokenOf(created.body.payUrl), 'succeed');
    const detail = (await api().get(`/payment-requests/${created.body.id}`)).body;
    const extra = Object.keys(schema('PaymentRequestDetail').allOf[1].properties);
    expect(Object.keys(detail).sort()).toEqual([...props('PaymentRequest'), ...extra].sort());
    expect(Object.keys(detail.attempts[0]).sort()).toEqual(props('PaymentAttempt'));

    const refund = await api().post('/refunds', { attemptId: detail.attempts[0].id, amount: '5', reason: 'Contrat OAS' });
    expect(refund.status).toBe(201);
    expect(Object.keys(refund.body).sort()).toEqual(props('Refund'));
  });

  it('champs acceptés à la création : ceux de la spécification', () => {
    expect(props('CreatePaymentRequest')).toEqual(
      ['amount', 'currency', 'merchantReference', 'description', 'customerName', 'customerContact', 'customerEmail', 'expiresInHours', 'successUrl', 'cancelUrl', 'metadata'].sort(),
    );
  });

  it('événements de webhook documentés = événements émis', () => {
    expect(schema('WebhookEvent').properties.type.enum).toEqual([...WEBHOOK_EVENTS, 'test']);
  });

  it('erreur : format Problem', async () => {
    const r = await api().post('/payment-requests', { amount: 'abc' });
    for (const k of schema('Problem').required) expect(r.body).toHaveProperty(k);
  });
});
