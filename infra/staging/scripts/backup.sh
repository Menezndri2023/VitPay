#!/usr/bin/env bash
# VITPAY STAGING — sauvegarde PostgreSQL (format custom, vérifiée), rétention 14 fichiers.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups && chmod 700 backups
docker compose ps --status running postgres | grep -q postgres || { echo "postgres n'est pas démarré : aucune base à sauvegarder"; exit 0; }
FILE="backups/vitpay-$(date -u +%Y%m%dT%H%M%SZ).dump"
umask 077
docker compose exec -T postgres pg_dump -U postgres -d vitpay -Fc > "$FILE"
# Vérification : la sauvegarde doit être lisible et contenir le schéma attendu.
docker compose exec -T postgres pg_restore --list < "$FILE" | grep -q "TABLE public payment_requests" || { echo "✗ sauvegarde illisible : $FILE" >&2; exit 1; }
ls -1t backups/vitpay-*.dump | tail -n +15 | xargs -r rm --
echo "✓ sauvegarde vérifiée : $FILE ($(du -h "$FILE" | cut -f1))"
