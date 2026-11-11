# VITPAY — Architecture

## Vue d'ensemble

```
                         ┌──────────────── apps/api (NestJS, monolithe modulaire) ────────────────┐
  apps/pay  (3710) ─┐    │ identity · organizations · payments · refunds · ledger · webhooks       │
  apps/business(3711)├─►/api/* (rewrite)─►│ reconciliation · receipts · notifications · admin · jobs │──► PostgreSQL 16
  apps/admin (3712) ─┘    │ providers/ (PaymentProvider + adaptateurs) · mock-psp (sandbox)         │    (source de vérité)
                         └───────────────────────────────▲─────────────────────────────────────────┘
                                                         │ HTTPS + webhooks signés
                                              Prestataire agréé (compte du commerçant)
```

- **Un seul backend**, avec des modules aux frontières nettes (`apps/api/src/modules/*`). Un module n'accède aux tables d'un autre que par son service.
- **Trois frontends Next.js** partageant `@vitpay/ui` (design system, i18n FR/AR/EN avec RTL, client API).
- Les frontends proxifient `/api/*` vers l'API. On reste donc sur la même origine : cookies `httpOnly` + `SameSite=Strict`, sans CORS navigateur.
- **PostgreSQL** est l'unique base. Le ledger, l'audit, l'outbox, l'inbox des webhooks et la file de tâches y résident (pas de Redis au MVP, ADR-007).

## Modules backend

| Module | Rôle |
|---|---|
| `identity` | Inscription, connexion (argon2id), sessions opaques hachées, MFA TOTP, garde de sécurité unique (authentification, CSRF, MFA, permissions) |
| `organizations` | Organisations (Personal = organisation à un membre), membres et rôles, points de vente, KYB, comptes prestataires |
| `payments` | Demandes, tentatives, orchestration, application des statuts du prestataire, remboursements, litiges |
| `providers` | Interface `PaymentProvider`, registre, adaptateur du prestataire simulé |
| `mock-psp` | Prestataire **simulé** (sandbox) : API, page hébergée, webhooks HMAC, rapports de règlement |
| `webhooks` | Inbox : vérification, stockage brut, déduplication, traitement, rejeu |
| `ledger` | Double entrée, plan de comptes, règles comptables, soldes, balance |
| `reconciliation` | Rapprochement rapport prestataire ↔ ledger |
| `receipts` | Reçus PDF |
| `notifications` | Consommateur outbox → notifications in-app |
| `platform` | Audit chaîné, idempotence, outbox, incidents |
| `admin` | VITPAY ADMIN : supervision, KYB, suspension, quatre yeux, incidents, webhooks, audit |
| `jobs` | Outbox, relance des webhooks, expiration des demandes, synchronisation des tentatives |

## Multi-tenant

- Chaque table métier porte `org_id` et une **politique RLS**. Le rôle `vitpay_app` n'a pas `BYPASSRLS`.
- `Db.forOrg(orgId)` positionne `app.org_id` pour la transaction.
- `Db.system()` (bypass) est réservé à des chemins justifiés : authentification, page publique, webhooks, admin, jobs.
- La garde vérifie l'appartenance avant toute route `/v1/orgs/:orgId/...`. Elle renvoie **404** pour une organisation tierce.

## Sécurité applicative (résumé, détail dans [`SECURITY.md`](SECURITY.md))

- Deux audiences de session distinctes : `vp_session` (Business) et `vp_admin_session` (Admin). L'admin exige la MFA.
- Protection CSRF : en-tête `x-vitpay-csrf` et liste blanche d'`Origin`.
- Helmet (CSP stricte), limitation de débit, corps JSON limité à 100 ko, validation Zod partout, erreurs au format RFC 9457 sans fuite interne.

## Déploiement cible (à valider : CNDP, budget)

- Conteneurs : `api` (×2), `worker` (même image, `WORKERS_ENABLED=true`), puis `pay`, `business` et `admin`.
- PostgreSQL managé avec réplica, PITR et sauvegardes chiffrées. **Admin derrière VPN ou zero-trust.**
- Domaines séparés : `pay.`, `business.` et `admin.`.
- Secrets dans un gestionnaire (aucun dans le dépôt) et rotation de `APP_ENCRYPTION_KEY` (plan à écrire).
- Observabilité : `x-request-id` propagé (renvoyé dans chaque erreur pour le support), journaux d'accès JSON sans jetons ni corps, métriques Prometheus sur `/health/metrics` (jeton `METRICS_TOKEN`). Alerte recommandée : `vitpay_critical_incidents > 0`. Sentry et OpenTelemetry restent à brancher selon l'hébergeur.
- Le choix entre hébergement au Maroc et à l'étranger dépend de la ligne C2 de [`COMPLIANCE.md`](COMPLIANCE.md).

## Évolutions prévues

- Second prestataire ; webhooks sortants et API publique Business.
- Stockage documentaire KYB chiffré ; e-mail, SMS et WhatsApp (fournisseurs à choisir).
- Application mobile React Native (Personal/Business) **après** validation de la PWA.
- Terminaux Android (Kotlin) uniquement avec un acquéreur certifié.
- Personal en production uniquement en modèle B (établissement partenaire).
