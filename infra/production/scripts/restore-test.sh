#!/usr/bin/env bash
# VITPAY PRODUCTION — test de restauration (PRA, COMPLIANCE F3). Lecture seule pour la production :
# la sauvegarde est restaurée dans un PostgreSQL JETABLE, puis contrôlée et détruite.
# Usage : scripts/restore-test.sh <fichier .dump.age> <fichier de clé privée age>
#   La clé privée est apportée pour l'occasion (clé USB, coffre) puis retirée : jamais laissée sur le serveur.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?usage: restore-test.sh <fichier .dump.age> <clé privée age>}"
KEY="${2:?usage: restore-test.sh <fichier .dump.age> <clé privée age>}"
NAME="vitpay-restore-test-$$"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB=vitpay --network none postgres:16-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
# Attente sur TCP : pendant l'initialisation, l'image démarre un serveur temporaire (socket local seul)
# qui répondrait à pg_isready avant de redémarrer.
ready=0; for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres -d vitpay >/dev/null 2>&1 && { ready=1; break; }; sleep 1; done
[ "$ready" = 1 ] || { echo "✗ PostgreSQL jetable non prêt" >&2; exit 1; }
PSQL=(docker exec -i "$NAME" psql -h 127.0.0.1 -U postgres -d vitpay -v ON_ERROR_STOP=1)
for r in vitpay_owner vitpay_app vitpay_system; do "${PSQL[@]}" -qc "CREATE ROLE $r" >/dev/null; done
age -d -i "$KEY" "$FILE" | docker exec -i "$NAME" pg_restore -h 127.0.0.1 -U postgres -d vitpay --no-owner --exit-on-error
"${PSQL[@]}" -tAc "SELECT 'demandes de paiement : ' || count(*) FROM payment_requests UNION ALL SELECT 'organisations : ' || count(*) FROM organizations UNION ALL SELECT 'écritures comptables : ' || count(*) FROM journal_entries UNION ALL SELECT 'journal d''audit : ' || count(*) FROM audit_log"
# Preuve datée pour le contrôle d'ouverture du réel (go-live-check.sh).
date -u +%FT%TZ > backups/.last-restore-test
echo "✓ restauration réussie (base jetable détruite)"
