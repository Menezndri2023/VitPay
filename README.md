# VITPAY

**One platform. Every payment.** — A VIT GLOBAL TECHNOLOGIES PRODUCT
Propriété de VIT GLOBAL TECHNOLOGIES GROUP S.A.R.L.A.U. Tous droits réservés.

VITPAY est une plateforme d'encaissement par lien et QR code : un bénéficiaire saisit un montant, VITPAY génère un lien ou un QR, le payeur règle chez un **prestataire de paiement agréé**, et VITPAY confirme le paiement **uniquement sur preuve serveur**.

> ⚠️ **Mode sandbox uniquement.** Modèle opérationnel A : VITPAY ne détient jamais de fonds. Le mode réel est verrouillé dans le code jusqu'à la levée des points juridiques listés dans [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md).

## Contenu du dépôt

| Chemin | Rôle |
|---|---|
| [`apps/api`](apps/api) | API NestJS : moteur de paiement, ledger, webhooks, admin, prestataire simulé |
| [`apps/pay`](apps/pay) | Page de paiement publique (FR/AR/EN, RTL) |
| [`apps/business`](apps/business) | Espace VITPAY Business : demandes, caisse QR (module TPE), remboursements, équipe |
| [`apps/admin`](apps/admin) | VITPAY ADMIN : supervision interne VIT GLOBAL |
| [`packages/money`](packages/money) | Type monétaire strict (`bigint`, devise obligatoire) |
| [`packages/ui`](packages/ui) | Design system, i18n, client API |
| [`docs/`](docs) | Rapport initial, architecture, conformité, finance, sécurité, API, schéma, ADR |

## Démarrage local

Prérequis : Node 22+, pnpm, Docker.

```bash
pnpm install
docker compose up -d postgres                 # PostgreSQL 16 sur le port 5433
cp apps/api/.env.example apps/api/.env        # puis remplacer APP_ENCRYPTION_KEY : openssl rand -base64 32
pnpm --filter @vitpay/money build
pnpm db:migrate
pnpm db:seed                                  # comptes de démonstration (sandbox)

pnpm dev:api        # http://localhost:4710
pnpm dev:pay        # http://localhost:3710
pnpm dev:business   # http://localhost:3711
pnpm dev:admin      # http://localhost:3712
```

Comptes de démonstration (mot de passe `Demo-Password-2026!`) :

- Commerçant : `marchand@vitpay.test`, déjà relié au prestataire simulé.
- Administrateurs : `superadmin@vitpay.test`, `finance@vitpay.test`, `compliance@vitpay.test`. La MFA est obligatoire. À la première connexion, saisir le **jeton d'enrôlement** affiché par `pnpm db:seed` (usage unique, 72 h), puis scanner le QR avec une application TOTP. Il faut deux administrateurs distincts pour les validations à quatre yeux.

Pour essayer : Business → *Nouvelle demande* → ouvrir le lien → *Payer par carte* → page du **prestataire simulé** → *Payer — scénario succès*. La demande passe à « Payée », le reçu est disponible et l'écriture apparaît au ledger.

### Pile complète en conteneurs (sandbox)

```bash
export APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d --build
# API 4710 · Pay 3710 · Business 3711 · Admin 3712 · e-mails capturés : http://localhost:8025 (Mailpit)
```

## Tests

```bash
pnpm --filter @vitpay/money test     # 9 tests (dont tests de propriétés)
pnpm --filter @vitpay/api test       # 77 tests (unitaires + intégration sur PostgreSQL réel)
./scripts/smoke.sh                   # parcours complet via les apps démarrées (API)
MAILPIT_URL=http://localhost:8025 pnpm --filter @vitpay/e2e test   # 9 tests navigateur (Playwright + Chrome)
```

## Documentation

[Rapport initial](docs/RAPPORT_INITIAL_PHASE0.md) · [PRD](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Cœur financier](docs/FINANCIAL_CORE.md) · [Parcours de paiement](docs/PAYMENT_FLOWS.md) · [API](docs/API_SPECIFICATION.md) · [Schéma](docs/DATABASE_SCHEMA.md) · [Sécurité](docs/SECURITY.md) · [**Conformité et points à légaliser**](docs/COMPLIANCE.md) · [Guide d'intégration (API, webhooks)](docs/DEVELOPERS.md) · [Roadmap](docs/ROADMAP.md) · [Agents](docs/AGENTS.md) · [Décisions (ADR)](docs/DECISIONS.md)
