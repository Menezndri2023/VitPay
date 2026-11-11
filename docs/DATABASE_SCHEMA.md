# VITPAY — Schéma de base de données

Migrations SQL versionnées dans [`apps/api/migrations`](../apps/api/migrations), avec checksum. **Une migration appliquée ne peut pas être modifiée.**

| Migration | Contenu |
|---|---|
| `001_foundation` | `currencies`, `users`, `sessions`, `organizations`, `memberships`, `points_of_sale`, `audit_log`, `idempotency_keys`, `outbox_events`, `notifications`, `approval_requests`, `incidents` |
| `002_payments` | `provider_accounts`, `payment_requests`, `payment_attempts`, `refunds`, `disputes`, `payouts`, `receipts`, `webhook_inbox`, `reconciliation_runs`, `reconciliation_items` |
| `003_ledger` | `ledger_accounts`, `journal_entries`, `postings` + triggers d'équilibre (différés), de cohérence et d'immuabilité |
| `004_mock_psp` | Schéma `mock_psp` : prestataire simulé, séparé, représentant un système externe |
| `005_security` | RLS sur toutes les tables métier, droits de `vitpay_app` (révocation d'UPDATE et DELETE sur les tables immuables) |
| `006_review_hardening` | Corrections de la revue : trigger ledger SECURITY DEFINER, unicités scopées, anti-rejeu MFA, jeton d'enrôlement admin |
| `007_system_role` | Rôle `vitpay_system`, politiques sans contournement, moindre privilège, RLS sur `incidents` et `outbox_events` |

## Relations principales

```
organizations 1─n memberships n─1 users
organizations 1─n points_of_sale
organizations 1─n provider_accounts        (identifiants chiffrés, modèle A)
organizations 1─n payment_requests 1─n payment_attempts 1─n refunds
                                              │          1─n disputes
                                              └─ 1─1 receipts
organizations 1─n ledger_accounts 1─n postings n─1 journal_entries
provider_accounts 1─n webhook_inbox · payouts · reconciliation_runs 1─n reconciliation_items
```

## Contraintes notables

- `payment_attempts_one_active_uq` : une seule tentative active par demande.
- `payment_attempts (provider_code, provider_ref) UNIQUE`.
- `webhook_inbox (provider_account_id, provider_event_id) UNIQUE` : déduplication.
- `journal_entries.idempotency_key UNIQUE` ; `postings.amount_minor > 0`.
- `approval_requests.four_eyes CHECK (decided_by <> requested_by)`.
- `incidents.dedupe_key UNIQUE`.
- Les montants sont toujours `bigint` + `currency char(3) REFERENCES currencies`.

## Rôles

| Rôle | Usage |
|---|---|
| `vitpay_owner` | Migrations uniquement |
| `vitpay_app` | Requêtes d'une organisation : RLS stricte, **aucun moyen de contournement** ; pas d'UPDATE ni DELETE sur `journal_entries`, `postings`, `audit_log`, `users`, `incidents` ; aucun accès à `sessions`, `idempotency_keys`, `webhook_inbox`, `approval_requests`, `mock_psp` |
| `vitpay_system` | Chemins transverses justifiés (authentification, page publique, webhooks, admin, workers) : `BYPASSRLS`, identifiants distincts, mêmes interdictions d'immuabilité |

`audit_log` (chaîne de hash globale) et `users` ne sont pas sous RLS : l'accès Business y est filtré explicitement par organisation. `sessions`, `idempotency_keys`, `webhook_inbox` et `approval_requests` ne sont accessibles qu'au rôle système.
