# @vitpay/node

Kit officiel VITPAY pour Node.js (18 ou plus récent, sans dépendance). Il permet de créer des demandes de paiement, de les relire, de les annuler, de rembourser et de vérifier les webhooks.

> À utiliser **côté serveur uniquement**. Une clé `vp_sk_…` ne doit jamais apparaître dans un navigateur ou une application mobile.

## Installation

```bash
npm install @vitpay/node
```

## Configuration

```js
import { VitPay } from '@vitpay/node';

const vitpay = new VitPay({
  apiKey: process.env.VITPAY_SECRET_KEY,   // vp_sk_test_… puis vp_sk_live_…
  orgId: process.env.VITPAY_ORG_ID,        // Business → Développeurs
  baseUrl: process.env.VITPAY_API_URL,     // ex. https://api.staging.vitpay-ma.com
});
```

`vitpay.mode` vaut `'test'` ou `'live'` selon la clé. Pour passer en réel, il suffit de changer la clé : le code reste le même.

## Encaisser une facture

```js
const request = await vitpay.paymentRequests.create(
  {
    amount: '199.00',                       // toujours une chaîne décimale
    description: 'Abonnement Pro – décembre',
    merchantReference: invoice.number,
    customerEmail: customer.email,
    successUrl: 'https://app.exemple.ma/facturation/merci',
    cancelUrl: 'https://app.exemple.ma/facturation',
    metadata: { invoiceId: invoice.id, customerId: customer.id },
  },
  { idempotencyKey: `facture-${invoice.id}` },  // stable : aucun doublon en cas de nouvel essai
);

res.redirect(303, request.payUrl);
```

## Confirmer le paiement (webhook)

Vérifiez la signature sur le **corps brut**, avant tout parsing JSON.

```js
import express from 'express';
import { VitPaySignatureError } from '@vitpay/node';

app.post('/webhooks/vitpay', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = vitpay.webhooks.constructEvent(req.body, req.headers['vitpay-signature'], process.env.VITPAY_WEBHOOK_SECRET);
  } catch (e) {
    if (e instanceof VitPaySignatureError) return res.sendStatus(400);
    throw e;
  }
  if (event.livemode !== (vitpay.mode === 'live')) return res.sendStatus(200); // autre mode : ignoré

  // La livraison est « au moins une fois » : dédupliquez sur event.id.
  if (event.type === 'payment.succeeded') {
    await markInvoicePaid(event.data.metadata.invoiceId, event.id);
  }
  res.sendStatus(200);
});
```

Pendant une rotation du secret, passez les deux secrets : `constructEvent(body, header, [nouveau, ancien])`.

La page de retour `successUrl` reçoit `vitpay_request_id`. Pour l'afficher, relisez la demande avec `retrieve`. N'activez **jamais** un service sur la seule foi de l'URL de retour.

```js
const r = await vitpay.paymentRequests.retrieve(req.query.vitpay_request_id);
if (r.status === 'paid') { /* … */ }
```

## Autres opérations

```js
await vitpay.paymentRequests.list({ status: 'paid', limit: 50 });
for await (const r of vitpay.paymentRequests.listAll({ status: 'paid' })) { /* toutes les pages */ }
await vitpay.paymentRequests.cancel(id, 'Commande annulée');
await vitpay.refunds.create({ attemptId, amount: '49.00', reason: 'Geste commercial' }, { idempotencyKey: `remb-${id}` });
```

## Erreurs

| Classe | Quand | Que faire |
|---|---|---|
| `VitPayError` | Réponse d'erreur de l'API (`status`, `code`, `details`, `requestId`) | Corriger la requête. Communiquez `requestId` au support. |
| `VitPayConnectionError` | Coupure réseau ou délai dépassé | Réessayer avec **la même** clé d'idempotence |
| `VitPaySignatureError` | Webhook non authentique ou trop ancien | Répondre `400` |

Le kit réessaie automatiquement, 2 fois par défaut (`maxRetries`), en cas de coupure réseau ou de réponse 429, 502, 503 ou 504. Il ne le fait que pour les lectures et les écritures portant une clé d'idempotence. Une annulation n'est jamais réessayée automatiquement.

## Tests automatisés

```js
import { generateTestHeader } from '@vitpay/node';
const header = generateTestHeader(JSON.stringify(event), 'whsec_test');
```
