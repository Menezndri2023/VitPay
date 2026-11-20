# VITPAY — Production : installation et exploitation

> Pile : [`infra/production`](../infra/production). Plan d'ensemble : [`GO_LIVE.md`](GO_LIVE.md).
> Les paiements réels sont **fermés** par défaut : ils ne s'ouvrent qu'à l'étape 5, après le procès-verbal d'activation.

## Différences avec le staging

| | Staging | Production |
|---|---|---|
| `APP_ENV` | `staging` | `production` (l'API refuse de démarrer si une protection manque) |
| Prestataire simulé | activé | **interdit** |
| E-mails | capturés (Mailpit) | **envoyés** par SMTP (Brevo ou équivalent) |
| Paiements réels | interdits sans exception | fermés, ouverts par `PAYMENTS_LIVE_ENABLED=true` + `LEGAL_SIGNOFF_REF` |
| Comptes | seed de démonstration | **aucun seed** ; administrateurs créés un par un (`create-admin`) |
| Sauvegardes | locales | **chiffrées** (age) et copiées **hors serveur** (rclone) |
| Déploiement | branche | **étiquette de version** (`v1.0.0`) uniquement |
| Console admin | authentification HTTP | + liste d'adresses IP autorisées |

## 1. Serveur

Prérequis : Ubuntu 24.04 LTS, 4 vCPU, 8 Go de RAM, 80 Go de SSD, chez l'hébergeur validé (COMPLIANCE C2).

```bash
# Depuis le poste du fondateur (clé SSH déjà installée sur root)
VITPAY_BRANCH=main ssh root@<ip> 'bash -s' < infra/staging/scripts/bootstrap-server.sh
ssh vitpay@<ip> 'sudo apt-get install -y age rclone'
```

Le script de préparation est commun au staging. Il crée l'utilisateur `vitpay`, désactive root et les mots de passe SSH, ouvre seulement les ports 22, 80 et 443, active les mises à jour automatiques et fail2ban, et installe Docker.

DNS (enregistrements A **sans proxy**) : `api`, `pay`, `app`, `admin`, plus la racine si le site vitrine est servi par ce serveur.

## 2. Configuration

```bash
cd ~/VitPay/infra/production
scripts/generate-env.sh <domaine> <e-mail-alertes-certificats> [domaine-du-site]
```

Le mot de passe de l'authentification HTTP de la console admin s'affiche **une seule fois** : rangez-le dans un gestionnaire de mots de passe. Complétez ensuite `.env` :

| Variable | Valeur |
|---|---|
| `EMAIL_TRANSPORT`, `SMTP_URL`, `EMAIL_FROM` | `smtp`, `smtp://<identifiant>:<clé>@smtp-relay.brevo.com:587`, `VitPay <no-reply@<domaine>>`. Domaine authentifié chez le fournisseur (SPF, DKIM, DMARC) |
| `ADMIN_ALLOWED_IPS` | adresses autorisées pour la console admin, entre apostrophes, ex. `'41.x.x.x/32'` |
| `BACKUP_AGE_RECIPIENT` | clé **publique** age (`age1…`), voir §4 |
| `BACKUP_RCLONE_REMOTE` | destination hors serveur, ex. `scw:vitpay-backups/prod` (`rclone config` au préalable) |

## 3. Premier démarrage

```bash
git tag -l                              # versions disponibles
scripts/deploy.sh v1.0.0                # sauvegarde, construction, migration, démarrage, vérifications
docker compose run --rm create-admin fondateur@<domaine> "Prénom Nom" super_admin
docker compose run --rm create-admin conformite@<domaine> "Prénom Nom" compliance
docker compose run --rm create-admin finance@<domaine> "Prénom Nom" finance
```

- `create-admin` affiche **une seule fois** le mot de passe et le jeton d'activation MFA. La MFA est obligatoire dès la première connexion.
- Le contrôle à quatre yeux exige au moins **deux** administrateurs distincts.
- `scripts/verify.sh` doit afficher **0 en échec**. Avant l'ouverture au public, les lignes « e-mails », « sauvegardes » et « hors serveur » doivent aussi passer.

## 4. Sauvegardes et reprise (COMPLIANCE F3)

- **Clé de chiffrement** : sur le poste du fondateur, `age-keygen -o vitpay-backup.key`. La ligne `# public key: age1…` va dans `BACKUP_AGE_RECIPIENT`. Le fichier `vitpay-backup.key` reste **hors ligne** (clé USB et coffre), jamais sur le serveur. Sans lui, aucune sauvegarde n'est lisible.
- **Quotidienne** : `crontab -e` → `15 2 * * * cd ~/VitPay/infra/production && scripts/backup.sh >> backups/cron.log 2>&1`
- **Avant chaque déploiement** : automatique (`deploy.sh`).
- **Test de restauration, mensuel et avant l'ouverture** : `scripts/restore-test.sh backups/<fichier>.dump.age <clé privée>`. La restauration se fait dans une base jetable, détruite ensuite. Retirez la clé privée du serveur juste après.

## 5. Ouverture des paiements réels

À ne faire **qu'après** levée de toutes les lignes A à F de [`COMPLIANCE.md`](COMPLIANCE.md) :

1. Procès-verbal d'activation signé : sa référence (ex. `PV-2026-001`) devient `LEGAL_SIGNOFF_REF`.
2. Dans `.env` : `PAYMENTS_LIVE_ENABLED=true` et `LEGAL_SIGNOFF_REF=PV-2026-001`, puis `scripts/deploy.sh <version>`.
3. `scripts/verify.sh` affiche « paiements réels OUVERTS (procès-verbal PV-2026-001) ».
4. Pour chaque commerçant pilote : KYB vérifié par la conformité dans la console admin, puis connexion de **son** compte prestataire en mode réel dans Business → Paramètres, puis création de sa clé `vp_sk_live_…`.
5. Premier paiement réel de faible montant sur le compte de VIT GLOBAL TECHNOLOGIES GROUP, suivi de son remboursement. Contrôlez le rapprochement le lendemain.

Retour arrière immédiat : `PAYMENTS_LIVE_ENABLED=false` puis `docker compose up -d api worker`. Les nouvelles demandes repassent en test. Les paiements réels déjà confirmés restent consultables.

## 6. Exploitation courante

| Action | Commande |
|---|---|
| Mise à jour | `git fetch --tags && scripts/deploy.sh v1.x.y` |
| État | `docker compose ps` · `scripts/verify.sh` |
| Journaux | `docker compose logs --since 1h api worker` (expurgés des jetons) |
| Métriques | `curl -H "Authorization: Bearer $METRICS_TOKEN" https://api.<domaine>/health/metrics` |
| Rotation de la clé de chiffrement | [`SECURITY.md`](SECURITY.md) (rotation `APP_ENCRYPTION_KEY`) |
| Nouvel administrateur | `docker compose run --rm create-admin …` |

## 7. Répétition locale

Avant toute commande de serveur, la même pile se lance sur un poste, avec les certificats de l'autorité locale de Caddy :

```bash
cd infra/production
scripts/generate-env.sh prod.localhost ops@exemple.ma
sed -i '' 's/^PROD_URL_PORT=$/PROD_URL_PORT=:28443/; s/^CADDY_GLOBAL_EXTRA=$/CADDY_GLOBAL_EXTRA=local_certs/' .env
docker compose -f docker-compose.yml -f docker-compose.rehearsal.yml up -d --build
VERIFY_CURL_OPTS=-k scripts/verify.sh
```

Ne lancez pas `deploy.sh` sur un poste de développement : il change la version extraite du dépôt.
