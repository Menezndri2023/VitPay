# VITPAY — Parcours de paiement

## 1. Demande → lien → paiement → confirmation

```
Commerçant (Business)        API VITPAY                    Prestataire (compte du commerçant)        Payeur
      │ POST /payment-requests   │                                     │                                  │
      │ (Idempotency-Key) ──────►│ crée demande (open), jeton 128 bits │                                  │
      │◄──── lien + QR ──────────│                                     │                                  │
      │ partage WhatsApp/SMS/e-mail ─────────────────────────────────────────────────────────────────────►│
      │                          │◄──────── GET /public/requests/:token (montant, nom commercial) ────────│
      │                          │◄──────── POST /public/requests/:token/attempts {method} ───────────────│
      │                          │ tentative (created) ─ createPayment ►│                                  │
      │                          │◄────────── providerRef + checkoutUrl │                                  │
      │                          │──────────────── redirection vers la page hébergée du prestataire ──────►│
      │                          │                                     │◄──── carte / 3-D Secure ─────────│
      │                          │◄── webhook signé (HMAC, secret marchand)                                │
      │                          │ vérifie, stocke (inbox), relit getPayment ►│                            │
      │                          │ montant OK ⇒ succeeded, écriture ledger, reçu, outbox                   │
      │◄── notification ─────────│                                     │── retour navigateur ───────────►│
      │                          │◄──────── GET /status (relecture serveur si besoin) ────────────────────│
```

## 2. Cas limites gérés

| Cas | Comportement |
|---|---|
| Le payeur revient sans payer, ou avec `?psp_status=succeeded` | Statut inchangé : le paramètre n'est jamais lu |
| Webhook dupliqué ou rejoué | `duplicate`, aucun effet |
| Webhook à signature invalide ou trop ancien | 400, stocké `rejected`, incident |
| Webhook perdu | Relecture par la page de statut et par le job `sync-stale-attempts` |
| Montant différent chez le prestataire | Aucune confirmation, incident **critique** |
| Paiement refusé | Tentative `failed` ; le payeur peut réessayer (nouvelle tentative) |
| 3-D Secure | `requires_action`, puis `succeeded` ou `failed` |
| Double clic sur « Payer » | Une seule tentative active ; la page du prestataire est réutilisée |
| Paiement confirmé après expiration ou annulation | Demande `paid` et incident `payment_after_close` (remboursement à décider) |
| Deux tentatives confirmées | Incident `double_payment` critique |
| Tentative abandonnée plus de 30 min | `expired` localement ; un succès tardif ouvre un incident, il n'est jamais ignoré |
| Annulation pendant un paiement en cours | Refusée (409) |
| Prestataire indisponible | Tentative `failed` (`provider_unavailable`), message au payeur |

## 3. Caisse (module TPE, MVP)

Le caissier saisit le montant et une demande liée au point de vente est créée (validité 1 h). Un QR plein écran s'affiche, et l'écran affiche la confirmation dès réception de la preuve serveur. **Aucune lecture de carte ni saisie de PIN.**

## 4. Remboursement

`POST /refunds` avec `Idempotency-Key` déclenche, sous verrou, le contrôle du montant remboursable. Le remboursement est créé à l'état `requested`, puis l'appel au prestataire le fait passer en `pending`, `succeeded` ou `failed` (aussi via webhook). Une écriture n'est passée que pour un succès.

## 5. Ajouter un prestataire réel

1. Obtenir **la documentation officielle et l'accès sandbox** (règle 16 : ne rien supposer).
2. Créer `apps/api/src/modules/providers/<code>.provider.ts` qui implémente `PaymentProvider` :
   - `capabilities()` ne déclare **que** ce qui est vérifié et contractualisé ;
   - `verifyWebhook()` suit la méthode documentée (signature, horodatage, IP si documentée) ;
   - `getPayment()` et `getRefund()` sont la source de vérité ;
   - les statuts du prestataire sont mappés vers `ProviderPaymentStatus`, et **tout statut inconnu lève une erreur**.
3. L'enregistrer dans `ProviderRegistry`.
4. Écrire des tests de contrat sur le modèle de `payment-flow.test.ts`, en rejouant les webhooks de la sandbox du prestataire.
5. Faire réaliser une revue indépendante (sécurité et finance) avant toute utilisation `live`.

Le prestataire simulé ([`mock.provider.ts`](../apps/api/src/modules/providers/mock.provider.ts) et [`mock-psp/`](../apps/api/src/modules/mock-psp)) sert de modèle. Il ne prétend reproduire l'API d'aucun prestataire existant.
