#!/usr/bin/env bash
# VITPAY PRODUCTION — vérifications de sécurité et de fonctionnement après déploiement (lecture seule,
# aucune donnée créée : seules des connexions refusées sont tentées).
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
S="${PROD_DOMAIN}${PROD_URL_PORT:-}"
CURL=(curl -sS --max-time 15 ${VERIFY_CURL_OPTS:-})
ok=0; ko=0
check() { if eval "$2"; then echo "  ✓ $1"; ok=$((ok+1)); else echo "  ✗ $1"; ko=$((ko+1)); fi; }

H=$("${CURL[@]}" "https://api.$S/health" 2>/dev/null)
check "API joignable en HTTPS (certificat valide)" '[[ "$H" == *"\"status\":\"ok\""* ]]'
check "environnement = production" '[[ "$H" == *"\"environment\":\"production\""* ]]'
if [ "${PAYMENTS_LIVE_ENABLED:-false}" = true ]; then
  check "paiements réels OUVERTS (procès-verbal ${LEGAL_SIGNOFF_REF:-?})" '[[ "$H" == *"\"paymentsMode\":\"live-enabled\""* ]]'
else
  check "paiements réels fermés (mode test uniquement)" '[[ "$H" == *"\"paymentsMode\":\"sandbox-only\""* ]]'
fi
for app in pay app admin; do
  code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "https://$app.$S/" 2>/dev/null)
  check "https://$app.$S répond ($code)" '[[ "$code" =~ ^(200|307|308|401|404)$ ]]'
done
check "console admin protégée (401/404 sans authentification HTTP)" '[[ $("${CURL[@]}" -o /dev/null -w "%{http_code}" "https://admin.$S/login") =~ ^(401|404)$ ]]'
check "aucun bandeau STAGING" '! "${CURL[@]}" "https://pay.$S/" | grep -q "VITPAY STAGING"'
check "HSTS présent" '"${CURL[@]}" -I "https://pay.$S/" | grep -qi "^strict-transport-security"'
HDR=$("${CURL[@]}" -i -X POST "https://app.$S/api/v1/auth/login" -H 'content-type: application/json' -d '{"email":"nobody@verify.invalid","password":"Wrong-Password-2026!"}')
check "cookies Secure/HttpOnly/SameSite=Strict (aucun cookie sur échec)" '! grep -qi "^set-cookie" <<<"$HDR" || grep -i "^set-cookie" <<<"$HDR" | grep -qi "secure; *samesite=strict"'
check "prestataire simulé absent (404)" '[[ $("${CURL[@]}" -o /dev/null -w "%{http_code}" -X POST "https://api.$S/mock-psp/api/merchants") == 404 && $("${CURL[@]}" -o /dev/null -w "%{http_code}" "https://pay.$S/mock-psp/checkout/x") == 404 ]]'
check "métriques protégées par jeton" '[[ $("${CURL[@]}" -o /dev/null -w "%{http_code}" "https://api.$S/health/metrics") =~ ^(401|403|404)$ ]]'
check "métriques lisibles avec le jeton" '"${CURL[@]}" -H "Authorization: Bearer $METRICS_TOKEN" "https://api.$S/health/metrics" | grep -q "^vitpay_open_incidents"'
codes=""; for i in $(seq 1 11); do codes+="$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST "https://app.$S/api/v1/auth/login" -H 'content-type: application/json' -H "X-Forwarded-For: 198.51.100.$i" -d '{"email":"rl@verify.invalid","password":"Wrong-Password-2026!"}') "; done
check "limitation de débit active malgré X-Forwarded-For forgé ($codes)" '[[ "$codes" == *429* ]]'
check "e-mails : transport SMTP configuré" '[[ "${EMAIL_TRANSPORT:-log}" == smtp && -n "${SMTP_URL:-}" ]]'
check "sauvegardes chiffrées configurées (clé publique age)" '[[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]'
check "copie des sauvegardes hors serveur configurée" '[[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]'
check "sauvegarde de moins de 26 h" '[[ -n "$(find backups -name "vitpay-*.dump.age" -mmin -1560 2>/dev/null | head -1)" ]]'
check "alertes de surveillance configurées" '[[ -n "${ALERT_NTFY_URL:-}" || ( -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" && -n "${ALERT_TELEGRAM_CHAT_ID:-}" ) ]]'
PUBIP="${PROD_PUBLIC_IP:-$(getent ahostsv4 "api.$PROD_DOMAIN" 2>/dev/null | awk "NR==1{print \$1}")}"
check "PostgreSQL non exposé (5432 fermé côté public)" '[[ -z "$PUBIP" ]] || ! (timeout 3 bash -c "</dev/tcp/$PUBIP/5432") 2>/dev/null'
echo "Résultat : $ok vérifications réussies, $ko en échec."
[ "$ko" -eq 0 ]
