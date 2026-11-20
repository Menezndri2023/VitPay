#!/usr/bin/env bash
# VITPAY PRODUCTION — (re)déploiement : sauvegarde, version figée, construction, migration, vérifications.
# Usage : scripts/deploy.sh <git-ref>   (une ÉTIQUETTE de version, ex. v1.0.0 — jamais une branche mouvante)
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${1:?usage: deploy.sh <étiquette de version, ex. v1.0.0>}"
[ -f .env ] || { echo "infra/production/.env manquant : lancer scripts/generate-env.sh" >&2; exit 1; }
git -C ../.. diff --quiet || { echo "modifications locales non commitées sur le serveur : refus" >&2; exit 1; }
set -a; . ./.env; set +a
if [ "${PAYMENTS_LIVE_ENABLED:-false}" = true ] && [ -z "${LEGAL_SIGNOFF_REF:-}" ]; then
  echo "PAYMENTS_LIVE_ENABLED=true sans LEGAL_SIGNOFF_REF : refus (docs/PRODUCTION.md §5)" >&2; exit 1
fi
echo "1/5 Sauvegarde de la base (avant toute modification)"; scripts/backup.sh
echo "2/5 Version"
git -C ../.. fetch --quiet --tags origin
if [ "${ALLOW_UNTAGGED_REF:-}" != 1 ] && ! git -C ../.. rev-parse -q --verify "refs/tags/$REF" >/dev/null; then
  echo "« $REF » n'est pas une étiquette de version : refus (ALLOW_UNTAGGED_REF=1 pour une répétition)" >&2; exit 1
fi
git -C ../.. checkout --quiet --detach "$REF" && git -C ../.. log --oneline -1
echo "3/5 Construction des images"; docker compose build --pull
echo "4/5 Migration puis démarrage"; docker compose up -d --remove-orphans
# Le Caddyfile est monté fichier par fichier : après un checkout, le conteneur voit encore l'ancien.
docker compose restart caddy >/dev/null
for _ in $(seq 1 90); do docker compose ps api | grep "(healthy)" >/dev/null && break; sleep 2; done
S="${PROD_DOMAIN}${PROD_URL_PORT:-}"
for h in api. pay. app. admin.; do
  for _ in $(seq 1 60); do curl -sS -o /dev/null --max-time 5 ${VERIFY_CURL_OPTS:-} "https://$h$S/" 2>/dev/null && break; sleep 3; done
done
echo "5/5 Vérifications"; scripts/verify.sh
