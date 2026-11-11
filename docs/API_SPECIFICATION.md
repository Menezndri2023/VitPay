# VITPAY — Spécification de l'API (v1)

- **Base** : `http://localhost:4710` en local (via les apps : `/api/...`).
- **Format** : JSON. Montants `{ "minor": "50000", "value": "500.00", "currency": "MAD" }`. Dates ISO 8601 UTC.
- **Erreurs** : `application/problem+json` (RFC 9457) `{ type, title, status, code, details? }`.
- **Authentification** : cookie de session (`vp_session` / `vp_admin_session`) ou `Authorization: Bearer <jeton>`. Avec un cookie, les mutations exigent `x-vitpay-csrf: 1`.
- **Idempotence** : en-tête `Idempotency-Key` (8 à 128 caractères) **obligatoire** sur les créations marquées 🔑. Un rejeu renvoie la même réponse avec `Idempotent-Replayed: true` ; la même clé avec un autre corps renvoie 422.

## Authentification
| Méthode | Route | Description |
|---|---|---|
| POST | `/v1/auth/register` | `{email, password, fullName, organizationName, organizationType}` → crée l'utilisateur, l'organisation et le rôle owner |
| POST | `/v1/auth/login` | `{email, password}` → `{mfaRequired}` |
| POST | `/v1/auth/mfa/verify` · `/mfa/setup` · `/mfa/enable` | TOTP |
| POST | `/v1/auth/logout` | |
| POST | `/v1/auth/password/forgot` | `{email}` → 202 dans tous les cas (pas d'énumération) |
| POST | `/v1/auth/password/reset` | `{token, password}` → révoque toutes les sessions |
| GET | `/v1/auth/me` | Utilisateur, session, organisations |
| POST | `/v1/admin/auth/login` · `/mfa/setup` · `/mfa/enable` · `/mfa/verify` · `/logout` · GET `/me` | Audience admin (MFA obligatoire) |

## Business — `/v1/orgs/:orgId` (permission entre parenthèses)
| Méthode | Route | |
|---|---|---|
| GET / PATCH | `` | Organisation (`org:read` / `org:update`) |
| POST | `/kyb` | `{legalName, ice(15 chiffres), rc, address}` (`org:update`) |
| GET / POST / DELETE | `/members`, `/members/:userId` | (`members:manage`) |
| GET / POST | `/points-of-sale` | (`pos:manage`) |
| GET / POST / DELETE | `/invitations`, `/invitations/:id` | Invitations par e-mail (`members:manage`) |
| GET / POST / DELETE | `/providers`, `/providers/:accountId` | Comptes prestataires (`providers:manage`) |
| POST 🔑 | `/payment-requests` | `{amount:"500.00", currency, description?, customerName?, customerContact?, expiresInHours?, posId?}` |
| GET | `/payment-requests?status=&q=&before=&limit=&posId=` | Pagination par curseur (`nextCursor`) |
| GET | `/payment-requests/:id` | Détail : tentatives, remboursements, litiges, reçu, `displayStatus` |
| GET | `/payment-requests/:id/qr.svg` | QR code |
| POST | `/payment-requests/:id/cancel` | (`requests:cancel`) |
| POST 🔑 | `/refunds` | `{attemptId, amount?, reason}` (`refunds:create`) |
| GET | `/payments/:attemptId/receipt.pdf` | Reçu |
| GET | `/ledger/balances` | Soldes et balance (`ledger:read`) |
| GET | `/dashboard` | Indicateurs sur 30 jours |
| GET | `/exports/payments.csv?from=&to=` | (`exports:read`) |
| GET / POST | `/notifications`, `/notifications/read` | |
| GET | `/audit` | Journal de l'organisation (`org:update`) |
| GET | `/billing/statements`, `/billing/statements/:id/statement.pdf` | Relevés de commissions VITPAY (`billing:read`) |

## Public (payeur) — sans authentification, limité en débit
| Méthode | Route | |
|---|---|---|
| GET | `/v1/public/requests/:token` | Nom commercial, montant, motif, statut, méthodes |
| POST | `/v1/public/requests/:token/attempts` | `{method:"card"}` → `{checkoutUrl, attemptId}` |
| GET | `/v1/public/requests/:token/status` | Statut (relecture serveur si une tentative est en cours) |
| GET | `/v1/public/requests/:token/receipt.pdf` | Reçu (si payé) |

## Invitations (public)
`GET /v1/invitations/:token` · `POST /v1/invitations/:token/accept` (session Business, même e-mail) · `POST /v1/invitations/:token/register {fullName, password}`.

## Webhooks prestataires
`POST /webhooks/providers/:providerCode/:accountId` : un endpoint par compte marchand (modèle A). Réponses : 200 `{status: accepted|duplicate}`, 400 si la signature est invalide.

## Admin — `/v1/admin` (audience admin + MFA)
`GET dashboard` · `GET organizations[?q&status]` · `GET organizations/:id` · `POST organizations/:id/suspend {reason}` · `POST organizations/:id/kyb {decision, reason}` · `POST approvals {action, targetId, payload, reason}` · `GET approvals` · `POST approvals/:id/decision {decision, note}` · `GET payments[?q&status&orgId]` · `GET audit[?orgId&action&before]` · `GET audit/verify` · `GET incidents` · `POST incidents/:id/resolve {note}` · `GET webhooks` · `POST webhooks/:id/replay` · `GET provider-accounts` · `GET|POST reconciliation/runs {providerAccountId, date}` · `GET|POST billing/statements {periodStart, periodEnd, mode, orgId?}` · `POST billing/statements/:id/paid {reference}` · `POST billing/statements/:id/void {reason}`.

## Prestataire simulé (sandbox uniquement) — `/mock-psp`
`POST api/merchants` · `POST api/payments` · `GET api/payments/:id` · `POST api/payments/:id/refunds` · `GET api/refunds/:id` · `GET api/disputes/:id` · `GET api/settlements?date=` · `GET checkout/:id` · `POST checkout/:id/{succeed|decline|challenge|cancel}` · `POST simulate/payments/:id/dispute` · `POST simulate/disputes/:id/{won|lost}`.

## Santé
`GET /health` → `{status, paymentsMode: "sandbox-only" | "live-enabled"}`.
