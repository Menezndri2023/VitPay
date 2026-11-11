#!/usr/bin/env bash
# VITPAY STAGING — génère infra/staging/.env sur le SERVEUR (secrets indépendants, jamais versionnés).
# Usage : scripts/generate-env.sh <ip-publique-du-vps>
# Affiche UNE SEULE FOIS l'identifiant de l'authentification HTTP de la console admin.
set -euo pipefail
cd "$(dirname "$0")/.."
IP="${1:?usage: generate-env.sh <ip-publique>}"
[[ "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "IPv4 attendue" >&2; exit 1; }
[ -e .env ] && { echo ".env existe déjà : refus d'écraser des secrets en service" >&2; exit 1; }
rnd() { openssl rand -hex 32; }
ADMIN_USER="vitpay-admin"
ADMIN_PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)"
ADMIN_HASH="$(docker run --rm caddy:2.8-alpine caddy hash-password --plaintext "$ADMIN_PW")"
umask 077
cat > .env <<ENV
# Généré le $(date -u +%Y-%m-%dT%H:%M:%SZ) — NE PAS VERSIONNER, NE PAS COPIER HORS DU SERVEUR.
STAGING_DOMAIN_SUFFIX=${IP//./-}.sslip.io
STAGING_URL_PORT=
PG_SUPERUSER_PASSWORD=$(rnd)
PG_OWNER_PASSWORD=$(rnd)
PG_APP_PASSWORD=$(rnd)
PG_SYSTEM_PASSWORD=$(rnd)
APP_ENCRYPTION_KEY=$(openssl rand -base64 32)
APP_ENCRYPTION_KEYS_PREVIOUS=
METRICS_TOKEN=$(rnd)
ADMIN_BASIC_AUTH_USER=${ADMIN_USER}
ADMIN_BASIC_AUTH_HASH='${ADMIN_HASH}'
CADDY_GLOBAL_EXTRA=
ENV
chmod 600 .env
echo "✓ .env créé (droits 600). Domaine : *.${IP//./-}.sslip.io"
echo "  Console admin — authentification HTTP (à conserver dans un gestionnaire de mots de passe) :"
echo "    utilisateur : ${ADMIN_USER}"
echo "    mot de passe : ${ADMIN_PW}"
