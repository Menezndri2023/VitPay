#!/usr/bin/env bash
# VITPAY PRODUCTION — sauvegarde PostgreSQL chiffrée (age), vérifiée, copiée hors serveur (rclone).
#   - le fichier en clair n'est jamais écrit sur disque : pg_dump | age ;
#   - seule la clé PUBLIQUE est sur le serveur (BACKUP_AGE_RECIPIENT) : un serveur compromis ne
#     peut pas relire les sauvegardes ; la clé privée reste hors ligne chez le fondateur ;
#   - copie hors serveur si BACKUP_RCLONE_REMOTE est défini (ex. « scw:vitpay-backups/prod ») ;
#   - rétention locale : 14 fichiers.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
mkdir -p backups && chmod 700 backups
docker compose ps --status running postgres | grep postgres >/dev/null || { echo "postgres n'est pas démarré : aucune base à sauvegarder"; exit 0; }
[ -n "${BACKUP_AGE_RECIPIENT:-}" ] || { echo "✗ BACKUP_AGE_RECIPIENT absent de .env : sauvegarde en clair refusée (docs/PRODUCTION.md §4)" >&2; exit 1; }
command -v age >/dev/null || { echo "✗ age non installé (sudo apt-get install age)" >&2; exit 1; }
FILE="backups/vitpay-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
umask 077
# Vérification sur le flux, sans fichier en clair : une copie du flux part vers « pg_restore --list »
# par un tube nommé. pg_restore peut s'arrêter dès la table des matières lue : « warn-nopipe » évite
# que tee échoue alors (la copie chiffrée continue entière).
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
LIST="$TMP/list"; FIFO="$TMP/stream"; mkfifo -m 600 "$FIFO"
docker compose exec -T postgres pg_restore --list < "$FIFO" > "$LIST" & LPID=$!
docker compose exec -T postgres pg_dump -U postgres -d vitpay -Fc \
  | tee --output-error=warn-nopipe "$FIFO" \
  | age -r "$BACKUP_AGE_RECIPIENT" > "$FILE"
wait "$LPID" || true
grep -F "TABLE public payment_requests" "$LIST" >/dev/null || { echo "✗ sauvegarde incomplète : $FILE" >&2; rm -f "$FILE"; exit 1; }
[ -s "$FILE" ] || { echo "✗ sauvegarde vide : $FILE" >&2; exit 1; }
ls -1t backups/vitpay-*.dump.age | tail -n +15 | xargs -r rm --
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  command -v rclone >/dev/null || { echo "✗ rclone non installé (sudo apt-get install rclone)" >&2; exit 1; }
  rclone copy --no-traverse "$FILE" "$BACKUP_RCLONE_REMOTE/" || { echo "✗ copie hors serveur échouée : $FILE" >&2; exit 1; }
  echo "✓ sauvegarde chiffrée, vérifiée et copiée hors serveur : $FILE ($(du -h "$FILE" | cut -f1))"
else
  echo "⚠ sauvegarde chiffrée et vérifiée, mais SANS copie hors serveur (BACKUP_RCLONE_REMOTE vide) : $FILE"
fi
