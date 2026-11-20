#!/usr/bin/env bash
# VITPAY PRODUCTION — surveillance interne (cron toutes les 5 minutes), alertes au fondateur.
#   */5 * * * * cd ~/VitPay/infra/production && scripts/monitor.sh >> backups/monitor.log 2>&1
#
# Alerte à l'APPARITION d'un problème puis à son RETOUR À LA NORMALE (pas de répétition toutes les
# 5 minutes), vers ntfy (ALERT_NTFY_URL) et/ou Telegram (ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID).
# Un serveur arrêté ne peut pas donner l'alerte : compléter par une surveillance EXTERNE de
# https://api.<domaine>/health (docs/PRODUCTION.md §6).
# Options : --test (envoie une alerte de test) · --dry-run (affiche sans envoyer ni mémoriser)
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
MODE="${1:-}"
S="${PROD_DOMAIN}${PROD_URL_PORT:-}"
CURL=(curl -sS --max-time 15 ${VERIFY_CURL_OPTS:-})
STATE="backups/.monitor-state"
mkdir -p backups && chmod 700 backups
HOST="$(hostname -s 2>/dev/null || echo serveur)"

notify() {
  # Titre en ASCII : un en-tête HTTP ne transporte pas l’UTF-8 de façon fiable (le corps, si).
  local title="$1" body="$2" sent=0
  if [ "$MODE" = --dry-run ]; then printf '[dry-run] %s\n%s\n' "$title" "$body"; return 0; fi
  if [ -n "${ALERT_NTFY_URL:-}" ]; then
    "${CURL[@]}" -o /dev/null -H "Title: $title" -H "Priority: high" -H "Tags: rotating_light" -d "$body" "$ALERT_NTFY_URL" && sent=1
  fi
  if [ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]; then
    "${CURL[@]}" -o /dev/null --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT_ID}" --data-urlencode "text=${title}
${body}" "https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage" && sent=1
  fi
  [ "$sent" = 1 ] || echo "⚠ aucune alerte envoyée (ALERT_NTFY_URL / ALERT_TELEGRAM_* non configurés) : $title" >&2
}

if [ "$MODE" = --test ]; then
  notify "VitPay ($HOST) : alerte de test" "La surveillance de production fonctionne. $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  exit 0
fi

problems=()
fail() { problems+=("$1"); }

# 1. API joignable par Internet (HTTPS, certificat, base de données)
H=$("${CURL[@]}" "https://api.$S/health" 2>/dev/null)
[[ "$H" == *'"status":"ok"'* ]] || fail "API injoignable ou en erreur (https://api.$S/health)"

# 2. Conteneurs démarrés et sains
for svc in postgres api worker pay business admin caddy; do
  st=$(docker compose ps --format '{{.Status}}' "$svc" 2>/dev/null | head -1)
  [[ "$st" == Up* && "$st" != *unhealthy* ]] || fail "conteneur $svc : ${st:-arrêté}"
done

# 3. Indicateurs métier (métriques protégées)
M=$("${CURL[@]}" -H "Authorization: Bearer $METRICS_TOKEN" "https://api.$S/health/metrics" 2>/dev/null)
g() { awk -v k="vitpay_$1" '$1==k {print int($2)}' <<<"$M"; }
if [ -n "$M" ]; then
  [ "$(g critical_incidents)" -eq 0 ] 2>/dev/null || fail "incident CRITIQUE ouvert ($(g critical_incidents)) : console admin → Incidents"
  [ "$(g outbox_pending)" -lt 200 ] 2>/dev/null || fail "file d'événements en retard ($(g outbox_pending) en attente) : le worker traite-t-il ?"
  [ "$(g emails_pending)" -lt 50 ] 2>/dev/null || fail "e-mails bloqués ($(g emails_pending) en attente) : vérifier le SMTP"
  [ "$(g deliveries_pending)" -lt 500 ] 2>/dev/null || fail "webhooks commerçants en retard ($(g deliveries_pending))"
  [ "$(g webhooks_failed)" -lt 10 ] 2>/dev/null || fail "notifications prestataire en échec ($(g webhooks_failed))"
else
  fail "métriques illisibles (METRICS_TOKEN ?)"
fi

# 4. Erreurs serveur récentes (réponses 5xx et erreurs applicatives, journaux expurgés)
errors=$(docker compose logs --since 5m api worker 2>/dev/null | grep -c '"level":"error"')
[ "${errors:-0}" -lt 5 ] || fail "$errors erreurs serveur en 5 minutes (docker compose logs --since 10m api worker)"

# 5. Disque, sauvegarde, certificat
disk=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
[ "${disk:-0}" -lt 85 ] || fail "disque plein à ${disk} %"
[ -n "$(find backups -name 'vitpay-*.dump.age' -mmin -1560 2>/dev/null | head -1)" ] || fail "aucune sauvegarde depuis plus de 26 h"
port="${PROD_URL_PORT#:}"; port="${port:-443}"
end=$(echo | openssl s_client -connect "api.${PROD_DOMAIN}:${port}" -servername "api.$PROD_DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$end" ]; then
  days=$(( ( $(date -d "$end" +%s 2>/dev/null || date -j -f '%b %e %T %Y %Z' "$end" +%s) - $(date +%s) ) / 86400 ))
  [ "$days" -ge 14 ] || fail "certificat HTTPS expirant dans $days jours"
fi

# Alerte uniquement sur changement d'état
now=$(printf '%s\n' "${problems[@]:-}" | sed '/^$/d' | sort)
before=$(cat "$STATE" 2>/dev/null || true)
if [ "$now" != "$before" ]; then
  if [ -n "$now" ]; then
    notify "VitPay ($HOST) : ${#problems[@]} probleme(s)" "$now"
  else
    notify "VitPay ($HOST) : retour a la normale" "Tous les contrôles sont de nouveau verts."
  fi
  [ "$MODE" = --dry-run ] || printf '%s' "$now" > "$STATE"
fi
echo "$(date -u +%FT%TZ) ${#problems[@]} problème(s)${now:+ : $(tr '\n' ';' <<<"$now")}"
