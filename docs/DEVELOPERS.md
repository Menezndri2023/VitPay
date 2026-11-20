# VITPAY — Guide d'intégration (API publique Business)

Intégrez VITPAY à votre site ou à votre logiciel : créez des demandes de paiement, redirigez vos clients vers la page de paiement et recevez les confirmations par webhook.

> **Sandbox.** Tant que la validation juridique n'est pas finalisée, seuls les paiements de test (prestataire simulé) sont possibles.

## 1. Authentification

Dans **Business → Développeurs**, un propriétaire ou un administrateur crée une clé API. Elle n'est **affichée qu'une seule fois** et VITPAY n'en conserve que l'empreinte.

```
Authorization: Bearer vp_sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Mode test et mode réel

| Clé | Demandes créées | Ce que la clé peut lire |
|---|---|---|
| `vp_sk_test_…` | En **sandbox** : paiements de test, aucun débit réel (cartes de test du prestataire) | Uniquement les demandes de test |
| `vp_sk_live_…` | **Réelles**, sur votre compte prestataire réel | Uniquement les demandes réelles |

- Développez et testez avec la clé de test, puis remplacez-la par la clé réelle : **le code ne change pas**.
- Une demande de l'autre mode répond `404` : une clé de test ne peut ni lire, ni annuler, ni rembourser un paiement réel.
- Les clés réelles ne sont proposées qu'à l'ouverture des paiements réels. Avant, leur création répond `409`.
- Les clés créées avant le 21/11/2026 (`vp_sk_…` sans mode) restent valides et sont des clés de test.
- `Idempotency-Key` : les espaces de test et réel sont séparés.

Règles d'utilisation :

- Une clé ne donne accès **qu'à son organisation** et qu'à ses **périmètres** : `requests:create`, `requests:read`, `requests:cancel`, `refunds:create`.
- Une clé ne peut pas gérer les clés ni les webhooks, ni accéder au compte utilisateur ou à l'administration.
- Les actions effectuées avec une clé sont journalisées avec l'identifiant de la clé.
- La révocation prend effet immédiatement.
- Côté serveur uniquement : ne mettez **jamais** une clé dans une application mobile ou du JavaScript côté navigateur.

## 2. Créer une demande de paiement

```bash
curl -X POST "$VITPAY_API/v1/orgs/$ORG_ID/payment-requests" \
  -H "Authorization: Bearer $VITPAY_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: commande-1042" \
  -d '{"amount":"149.90","currency":"MAD","description":"Commande #1042","expiresInHours":24}'
```

La réponse est `201` et contient notamment `id`, `reference`, `status: "open"`, `amount` et **`payUrl`**. Redirigez votre client vers `payUrl`, ou affichez-le en QR code.

- **Idempotence** : l'en-tête `Idempotency-Key` est obligatoire. Rejouer la même requête avec la même clé renvoie la même demande (en-tête `Idempotent-Replayed: true`) : en cas de coupure réseau, réessayez sans risque de doublon.
- **Montants** : chaîne décimale (`"149.90"`), jamais un nombre flottant.

### Intégration à un logiciel (SaaS, e-commerce)

Champs facultatifs pour rattacher le paiement à votre facture et ramener le client chez vous :

| Champ | Rôle |
|---|---|
| `merchantReference` | Votre n° de commande ou de facture (unique dans votre organisation, 1 à 64 caractères). |
| `successUrl` | Page de votre site où le client revient **après un paiement confirmé** (redirection automatique après 5 s). |
| `cancelUrl` | Page où le client revient s'il **abandonne**, ou si la demande a expiré ou été annulée. |
| `customerEmail` | E-mail du client (visible par vous uniquement, jamais sur la page publique). |
| `metadata` | Jusqu'à 20 paires clé/valeur texte (clé : 1 à 40 caractères `A-Z a-z 0-9 _ . -`, valeur : 500 caractères au plus). Renvoyées telles quelles dans les webhooks. |

```bash
curl -X POST "$VITPAY_API/v1/orgs/$ORG_ID/payment-requests" \
  -H "Authorization: Bearer $VITPAY_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: facture-INV-2026-0042" \
  -d '{"amount":"199.00","currency":"MAD","description":"Abonnement Pro – décembre",
       "merchantReference":"INV-2026-0042","customerEmail":"client@exemple.ma",
       "successUrl":"https://app.exemple.ma/facturation/merci",
       "cancelUrl":"https://app.exemple.ma/facturation",
       "metadata":{"invoiceId":"INV-2026-0042","customerId":"cus_81"}}'
```

Au retour, VITPAY ajoute à votre URL : `vitpay_request_id`, `vitpay_reference` et `vitpay_status` (`paid`, `open`, `expired`, `cancelled`). Vos propres paramètres sont conservés.

> ⚠️ **Ces paramètres sont indicatifs.** N'activez jamais un service sur la seule foi de l'URL de retour : n'importe qui peut la saisir. Confirmez par le webhook `payment.succeeded` ou par `GET …/payment-requests/{vitpay_request_id}` (`status: "paid"`).

Règles : URL absolue en **HTTPS**, sans identifiants (`user:pass@`) ni fragment (`#`), 2048 caractères au plus.

Les autres opérations sont décrites dans [`API_SPECIFICATION.md`](API_SPECIFICATION.md) : consultation (`GET …/payment-requests/:id`), annulation et remboursement.

## 3. Webhooks

Dans **Business → Développeurs → Webhooks**, ajoutez une URL **HTTPS** et choisissez les événements :

`payment.succeeded`, `payment.failed`, `refund.succeeded`, `refund.failed`, `dispute.opened`, `dispute.won`, `dispute.lost`.

Le secret de signature (`whsec_…`) n'est affiché qu'une fois. Chaque requête reçue a cette forme :

```
POST /webhooks/vitpay
Content-Type: application/json
VitPay-Event-Id: evt_123
VitPay-Signature: t=1731250000,v1=5f2b…

{"id":"evt_123","type":"payment.succeeded","created":"2026-11-10T16:42:00.000Z","livemode":false,
 "data":{"objectType":"payment_attempt","objectId":"…","requestId":"…","merchantReference":"INV-2026-0042",
         "metadata":{"invoiceId":"INV-2026-0042","customerId":"cus_81"},"amount":{"amount":"14990","currency":"MAD"}}}
```

### Vérifier la signature (Node.js)

```js
import crypto from 'node:crypto';

export function verifyVitpay(rawBody, header, secret, toleranceSec = 300) {
  const parts = header.split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  // Pendant une rotation de secret, l'en-tête contient plusieurs valeurs v1 : une seule doit correspondre.
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false; // anti-rejeu
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'), 'hex');
  return signatures.some((v1) => {
    const got = Buffer.from(v1, 'hex');
    return got.length === expected.length && crypto.timingSafeEqual(expected, got);
  });
}
```

### Changer le secret (rotation)

> ⚠️ **Changement du 11/11/2026 pour les intégrations existantes.** L'en-tête peut désormais contenir **plusieurs** valeurs `v1`. Un code qui ne lit qu'une seule valeur (par ex. `Object.fromEntries(header.split(','))`, qui garde la dernière) échouera pendant une rotation. Mettez à jour votre vérification avec l'extrait ci-dessus **avant** de changer le secret.

**Développeurs → Webhooks → Changer le secret** (ou `POST /v1/orgs/:orgId/developers/webhooks/:id/rotate-secret`, body `{"overlapHours": 24}`) :

- Le nouveau secret est affiché une seule fois et signe immédiatement.
- Pendant la période de recouvrement (24 h par défaut, 168 h au plus), chaque requête porte **deux** valeurs `v1` : une avec le nouveau secret, une avec l'ancien. Déployez le nouveau secret côté serveur pendant cette fenêtre, sans interruption.
- En cas de fuite, utilisez `overlapHours: 0` : l'ancien secret cesse immédiatement de signer.

Bonnes pratiques :

- Vérifiez la signature sur le **corps brut**, avant tout parsing JSON.
- Répondez `2xx` rapidement, puis traitez de façon asynchrone.
- La livraison est **au moins une fois** : dédupliquez sur `VitPay-Event-Id`.
- En cas d'échec (réponse autre que `2xx` ou délai dépassé), VITPAY réessaie avec un délai croissant, jusqu'à 10 tentatives. Les redirections ne sont pas suivies.
- Le champ `livemode` (`true` / `false`) indique si l'événement concerne un paiement réel. **Ignorez les événements `livemode: false` dans votre environnement de production.**
- Pour une décision critique (expédier une commande), vous pouvez relire la demande via `GET …/payment-requests/:id` : `status: "paid"`.
- Le bouton **Tester** envoie un événement `test`.

## 4. Sécurité côté VITPAY

- Les webhooks ne sont envoyés qu'à des adresses publiques. Les adresses privées, locales ou de métadonnées cloud sont refusées, et le contrôle se fait à la connexion (protection contre le DNS rebinding).
- HTTPS est obligatoire en production.
