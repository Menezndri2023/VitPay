# Exemple : un SaaS qui encaisse ses factures avec VitPay

Un logiciel d'une centaine de lignes ([app.mjs](app.mjs)), sans framework, qui montre l'intégration complète :

1. **Liste des factures**, chacune avec un bouton « Payer ».
2. **Payer** : création d'une demande de paiement VitPay avec `merchantReference`, `successUrl`, `cancelUrl`, `metadata: { invoiceId }` et une clé d'idempotence stable (`facture-<id>`), puis redirection du client vers `payUrl`.
3. **Retour du client** sur `/merci` : la demande est **relue** chez VitPay. On ne se fie jamais à l'URL.
4. **Webhook** `/webhooks/vitpay` : vérification de la signature sur le corps brut, contrôle de `livemode`, déduplication sur l'identifiant d'événement, puis passage de la facture à « payée ».

Ce parcours est vérifié automatiquement contre l'API par `apps/api/test/example-saas.e2e.test.ts`.

## Lancer l'exemple

Prérequis :
- un compte sur l'espace Business VitPay, avec un prestataire de test connecté (Paramètres) ;
- une clé **Test** créée dans Développeurs ;
- un webhook vers `https://<adresse publique de l'exemple>/webhooks/vitpay`, avec l'événement `payment.succeeded`.

```bash
pnpm --filter @vitpay/node build
cd examples/saas-node
VITPAY_API_URL=https://api.staging.vitpay-ma.com \
VITPAY_ORG_ID=<identifiant d'organisation> \
VITPAY_SECRET_KEY=<clé vp_sk_test_…> \
VITPAY_WEBHOOK_SECRET=<secret whsec_…> \
PUBLIC_URL=https://<adresse publique> \
node server.mjs
```

Le webhook doit pouvoir joindre l'exemple depuis Internet. En local, utilisez un tunnel (par exemple `cloudflared tunnel --url http://localhost:3000`) et mettez son adresse dans `PUBLIC_URL` et dans le webhook.

## Pour votre logiciel

- Remplacez la `Map` en mémoire par votre base de données. Enregistrez `event.id` pour dédupliquer les webhooks, même après un redémarrage.
- Gardez la clé secrète et le secret de webhook **côté serveur**, dans vos variables d'environnement.
- En production, utilisez une clé `vp_sk_live_…`, et un secret de webhook propre à l'endpoint de production.
