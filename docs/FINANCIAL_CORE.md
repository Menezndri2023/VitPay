# VITPAY — Cœur financier

## Principes (garantis par le code ET par la base)

| Règle | Mise en œuvre |
|---|---|
| Pas de flottants | `@vitpay/money` : `bigint` en unité mineure. L'API transporte des chaînes (`"50000"`, `"500.00"`) |
| Devise toujours explicite | Chaque montant porte sa devise. Toute opération entre devises lève une erreur |
| Exposants par devise | MAD, EUR, USD et GBP = 2 ; **XOF et XAF = 0** (table `currencies`) |
| Arrondi explicite | `HALF_EVEN` par défaut, `HALF_UP` pour la commission VITPAY |
| Double entrée équilibrée | Contrôle applicatif + trigger PostgreSQL **différé** : Σ débits = Σ crédits par devise, au moins 2 lignes |
| Immuabilité | `UPDATE`, `DELETE` et `TRUNCATE` révoqués pour `vitpay_app`, plus un trigger `forbid_mutation`. Correction par contre-passation uniquement |
| Idempotence | `journal_entries.idempotency_key UNIQUE`, clé dérivée de l'objet métier (`payment.succeeded:<attemptId>`) |
| Isolation | RLS par `org_id` sur les comptes, écritures et lignes |

## Ledger miroir (modèle A)

VITPAY **ne détient aucun fonds**. Le ledger décrit, pour chaque organisation, la situation chez son prestataire.

| Compte | Type | Sens |
|---|---|---|
| `provider_receivable` | actif | Encaissé par le prestataire, pas encore reversé |
| `bank_settled` | actif | Reversé sur le compte bancaire du commerçant (constaté au rapprochement) |
| `dispute_reserve` | actif | Montant retenu pendant un litige |
| `gross_sales` | produit | Ventes brutes confirmées |
| `refunds` | charge | Remboursements confirmés |
| `provider_fees` | charge | Frais du prestataire |
| `vitpay_fees` / `vitpay_fees_payable` | charge / dette | Commission VITPAY due (facturée séparément) |
| `chargeback_losses` | charge | Litiges perdus |

### Écritures ([`posting-rules.ts`](../apps/api/src/modules/ledger/posting-rules.ts))

| Événement | Débit | Crédit |
|---|---|---|
| Paiement confirmé (A, frais F, commission V) | provider_receivable A · provider_fees F · vitpay_fees V | gross_sales A · provider_receivable F · vitpay_fees_payable V |
| Remboursement confirmé R | refunds R | provider_receivable R |
| Litige ouvert D | dispute_reserve D | provider_receivable D |
| Litige gagné | provider_receivable D | dispute_reserve D |
| Litige perdu | chargeback_losses D | dispute_reserve D |
| Règlement constaté (net N) | bank_settled N | provider_receivable N |

Exemple : 500,00 MAD avec 1,5 % de frais donne `gross_sales` = 50000, `provider_fees` = 750 et `provider_receivable` = 49250. Après rapprochement, `bank_settled` = 49250 et `provider_receivable` = 0.

## Machines à états ([`state-machines.ts`](../apps/api/src/modules/payments/state-machines.ts))

La liste unique de statuts du cahier des charges est **éclatée par objet** (ADR-005).

```
PaymentRequest : open ──► paid | expired | cancelled        (expired/cancelled ──► paid = paiement tardif + incident)
PaymentAttempt : created ─► pending ─► requires_action ─► processing ─► authorized ─► captured ─► succeeded
                                  └──────────────► failed | cancelled | expired      (succeeded/failed/... terminaux)
Refund         : requested ─► pending ─► succeeded | failed
Dispute        : opened ─► evidence_submitted ─► won | lost
Settlement     : unsettled ─► settled
Payout         : payout_pending ─► paid_out | payout_failed   (observé, exécuté par le prestataire)
```

Les statuts **affichés** `partially_refunded`, `refunded` et `disputed` sont **dérivés** (`deriveDisplayStatus`) et ne sont jamais stockés.

Distinctions respectées :

- Demande ≠ tentative ≠ confirmation.
- Confirmation ≠ règlement : `succeeded` ne signifie pas que les fonds sont reversés. Seul `settled`, issu du rapport du prestataire, l'indique.
- Le reversement est observé, jamais exécuté par VITPAY.

## Confirmation d'un paiement

Un paiement est confirmé **uniquement** si toutes ces conditions sont remplies :

1. Un webhook arrive avec une signature HMAC valide (secret **du compte marchand**), un horodatage de moins de 5 minutes et une déduplication par `(compte, event_id)`.
2. VITPAY **relit l'objet** chez le prestataire (`getPayment`), serveur à serveur, avec les identifiants du marchand.
3. La référence externe (`attemptId`) et le **montant et la devise** correspondent exactement. Sinon : incident `amount_mismatch` critique, **aucune confirmation**.
4. La transition est autorisée par la machine à états. Sinon : incident `provider_state_conflict`.

La redirection navigateur (`?psp_status=…`) n'est **jamais** lue. Si un webhook est perdu, le job `sync-stale-attempts` et la page de statut interrogent le prestataire côté serveur.

## Anti-double paiement

- Index unique partiel : **une seule tentative active par demande**.
- `Idempotency-Key` obligatoire pour la création de demande et le remboursement.
- Une seconde tentative confirmée sur une demande déjà payée ouvre un incident `double_payment` **critique**. La réalité est enregistrée, pas masquée.
- Les remboursements sont plafonnés sous verrou de ligne (`FOR UPDATE` sur la tentative), y compris les remboursements en cours.

## Rapprochement ([`reconciliation.service.ts`](../apps/api/src/modules/reconciliation/reconciliation.service.ts))

Pour chaque ligne du rapport du prestataire, le résultat est `matched`, `missing_in_ledger`, `amount_mismatch` ou `fee_mismatch`. Les paiements VITPAY absents du rapport sont classés `missing_in_provider`.

- Seules les lignes `matched` passent en `settled` et génèrent l'écriture de règlement, de façon idempotente.
- Toute anomalie ouvre un incident.
- Rejouer un rapprochement n'a aucun effet sur le ledger (testé).

## Commission VITPAY (facturation hors flux)

La commission (`vitpay_fee_bps` par organisation, modifiable à quatre yeux) est calculée à la confirmation (`HALF_UP`) et inscrite au ledger miroir (`vitpay_fees` / `vitpay_fees_payable`). Elle est **facturée séparément** par des relevés de commissions :

- Un relevé couvre une période (jours calendaires de Casablanca), une organisation, une devise et un mode (sandbox ou live).
- Un paiement ne peut figurer que dans **un seul relevé actif** (index unique partiel) : réémettre la même période ne refacture rien.
- Statuts : `issued` → `paid` (référence du règlement reçu) ou `void`. L'annulation rend les paiements de nouveau facturables.
- Document **pro forma** tant que le format de facture et la TVA ne sont pas validés (COMPLIANCE E2).
- **À décider (produit et juridique)** : la commission est-elle due sur un paiement remboursé ou perdu en litige ? Aujourd'hui, elle est maintenue.

## Tests

- `packages/money` : 9 tests, dont des tests de propriétés (fast-check).
- `ledger.test.ts` : déséquilibre refusé par la base, immuabilité, 50 écritures identiques concurrentes produisant une seule écriture, 200 écritures concurrentes avec soldes exacts, RLS, contre-passation.
- `posting-rules.test.ts` : toutes les règles sont équilibrées (propriété).
- `security.test.ts` : succès tardif comptabilisé, remboursement bloqué après litige perdu, trigger inter-organisation.
- `payment-flow.test.ts` et `admin.test.ts` : flux complets, rejeu de webhook, remboursements, litiges, rapprochement.
