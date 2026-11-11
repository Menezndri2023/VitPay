#!/usr/bin/env bash
# VITPAY STAGING — (re)déploiement : sauvegarde, version figée, construction, migration, vérifications.
# Usage : scripts/deploy.sh [git-ref]   (défaut : origin/feat/mvp-model-a)
set -euo pipefail
cd "$(dirname "$0")/.."
REF="${1:-origin/feat/mvp-model-a}"
[ -f .env ] || { echo "infra/staging/.env manquant : lancer scripts/generate-env.sh <ip>" >&2; exit 1; }
git -C ../.. diff --quiet || { echo "modifications locales non commitées sur le serveur : refus" >&2; exit 1; }
echo "1/5 Sauvegarde de la base (avant toute modification)"; scripts/backup.sh
echo "2/5 Version"; git -C ../.. fetch --quiet origin && git -C ../.. checkout --quiet --detach "$REF" && git -C ../.. log --oneline -1
echo "3/5 Construction des images"; docker compose build --pull
echo "4/5 Migration puis démarrage"; docker compose up -d --remove-orphans
for _ in $(seq 1 90); do docker compose ps api | grep -q "Up" && break; sleep 2; done
echo "5/5 Vérifications"; scripts/verify.sh
