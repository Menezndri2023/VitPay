#!/usr/bin/env bash
# VITPAY PRODUCTION — génère infra/production/.env SUR LE SERVEUR (secrets indépendants, jamais versionnés).
#
# Usage : scripts/generate-env.sh <domaine> <e-mail-ACME> [domaine-du-site]
#   <domaine>          ex. vitpay-ma.com → api., pay., app., admin.<domaine> (enregistrements A, sans proxy)
#   <e-mail-ACME>      adresse de contact Let's Encrypt (expiration des certificats)
#   [domaine-du-site]  site vitrine servi par ce serveur (par défaut : aucun)
#
# Paiements réels FERMÉS : PAYMENTS_LIVE_ENABLED=false. Ils ne s'ouvrent qu'en suivant docs/PRODUCTION.md §5.
# E-mails : à compléter (SMTP_URL, EMAIL_FROM) avant l'ouverture au public ; en attendant, journal seulement.
# Affiche UNE SEULE FOIS l'identifiant de l'authentification HTTP de la console admin.
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN="${1:?usage: generate-env.sh <domaine> <e-mail-ACME> [domaine-du-site]}"
ACME="${2:?usage: generate-env.sh <domaine> <e-mail-ACME> [domaine-du-site]}"
SITE="${3:-}"
re_domain='^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'
[[ "$DOMAIN" =~ $re_domain ]] || { echo "domaine invalide : $DOMAIN" >&2; exit 1; }
[[ -z "$SITE" || "$SITE" =~ $re_domain ]] || { echo "domaine du site invalide : $SITE" >&2; exit 1; }
[[ "$ACME" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$ ]] || { echo "e-mail ACME invalide" >&2; exit 1; }
[ -e .env ] && { echo ".env existe déjà : refus d'écraser des secrets en service" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl requis" >&2; exit 1; }
rnd() { openssl rand -hex 32; }
ADMIN_USER="vitpay-admin"
ADMIN_PW="$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)"
ADMIN_HASH="$(docker run --rm caddy:2.8-alpine caddy hash-password --plaintext "$ADMIN_PW")"
umask 077
cat > .env <<ENV
# VITPAY PRODUCTION — généré le $(date -u +%Y-%m-%dT%H:%M:%SZ).
# NE PAS VERSIONNER. NE PAS COPIER HORS DU SERVEUR (sauf coffre-fort hors ligne du fondateur).
PROD_DOMAIN=${DOMAIN}
PROD_URL_PORT=
SITE_DOMAIN=${SITE:-vitrine.localhost}
ACME_EMAIL=${ACME}
CADDY_GLOBAL_EXTRA=

# Base de données (rôles séparés : propriétaire, application sous RLS, système)
PG_SUPERUSER_PASSWORD=$(rnd)
PG_OWNER_PASSWORD=$(rnd)
PG_APP_PASSWORD=$(rnd)
PG_SYSTEM_PASSWORD=$(rnd)

# Chiffrement des identifiants prestataires et secrets MFA (rotation : docs/SECURITY.md)
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
APP_ENCRYPTION_KEYS_PREVIOUS=
METRICS_TOKEN=$(rnd)

# Console admin : authentification HTTP + adresses autorisées (ex. « 41.x.x.x/32 2a01:…/64 »)
ADMIN_BASIC_AUTH_USER=${ADMIN_USER}
ADMIN_BASIC_AUTH_HASH='${ADMIN_HASH}'
ADMIN_ALLOWED_IPS='0.0.0.0/0 ::/0'

# E-mails transactionnels (inscription, invitations, mot de passe oublié)
# Exemple Brevo : EMAIL_TRANSPORT=smtp, SMTP_URL=smtp://<identifiant>:<clé>@smtp-relay.brevo.com:587
EMAIL_TRANSPORT=log
SMTP_URL=
EMAIL_FROM='VitPay <no-reply@${DOMAIN}>'

# Paiements réels : FERMÉS. Ouverture uniquement selon docs/PRODUCTION.md §5 (procès-verbal signé).
PAYMENTS_LIVE_ENABLED=false
LEGAL_SIGNOFF_REF=

# Alertes de surveillance (docs/PRODUCTION.md §6) : ntfy (ex. https://ntfy.sh/<sujet-secret>) et/ou Telegram
ALERT_NTFY_URL=
ALERT_TELEGRAM_BOT_TOKEN=
ALERT_TELEGRAM_CHAT_ID=

# Sauvegardes chiffrées hors serveur (docs/PRODUCTION.md §4)
BACKUP_AGE_RECIPIENT=
BACKUP_RCLONE_REMOTE=
ENV
chmod 600 .env
echo "✓ .env créé (droits 600). Domaine : api|pay|app|admin.${DOMAIN}${SITE:+ · site : ${SITE}}"
echo "  Console admin — authentification HTTP (à conserver dans un gestionnaire de mots de passe) :"
echo "    utilisateur : ${ADMIN_USER}"
echo "    mot de passe : ${ADMIN_PW}"
echo "  À compléter avant l'ouverture : SMTP (e-mails), ADMIN_ALLOWED_IPS, sauvegardes hors serveur."
