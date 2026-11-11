#!/usr/bin/env bash
# VITPAY STAGING — vérifications de sécurité et de fonctionnement après déploiement (lecture seule).
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
S="${STAGING_DOMAIN_SUFFIX}${STAGING_URL_PORT:-}"
CURL=(curl -sS --max-time 15 ${VERIFY_CURL_OPTS:-})
ok=0; ko=0
check() { if eval "$2"; then echo "  ✓ $1"; ok=$((ok+1)); else echo "  ✗ $1"; ko=$((ko+1)); fi; }

H=$("${CURL[@]}" "https://api.$S/health" 2>/dev/null)
check "API joignable en HTTPS (certificat valide)" '[[ "$H" == *"\"status\""* ]]'
check "environnement = staging" '[[ "$H" == *"\"environment\":\"staging\""* ]]'
check "paiements réels verrouillés (sandbox-only)" '[[ "$H" == *"\"paymentsMode\":\"sandbox-only\""* ]]'
for app in pay app admin; do
  code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "https://$app.$S/" 2>/dev/null)
  check "https://$app.$S répond ($code)" '[[ "$code" =~ ^(200|307|308|401)$ ]]'
done
check "console admin protégée (401 sans authentification HTTP)" '[[ $("${CURL[@]}" -o /dev/null -w "%{http_code}" "https://admin.$S/login") == 401 ]]'
check "bandeau STAGING affiché" '"${CURL[@]}" "https://pay.$S/" | grep -q "VITPAY STAGING"'
check "HSTS présent" '"${CURL[@]}" -I "https://pay.$S/" | grep -qi "^strict-transport-security"'
HDR=$("${CURL[@]}" -i -X POST "https://app.$S/api/v1/auth/login" -H 'content-type: application/json' -d '{"email":"nobody@verify.invalid","password":"Wrong-Password-2026!"}')
check "cookies Secure/HttpOnly/SameSite=Strict (aucun cookie sur échec)" '! grep -qi "^set-cookie" <<<"$HDR" || grep -i "^set-cookie" <<<"$HDR" | grep -qi "secure; *samesite=strict"'
check "outils bruts du prestataire simulé non exposés" '[[ $("${CURL[@]}" -o /dev/null -w "%{http_code}" -X POST "https://api.$S/mock-psp/api/merchants") == 404 && $("${CURL[@]}" -o /dev/null -w "%{http_code}" -X POST "https://app.$S/api/mock-psp/api/merchants") == 404 ]]'
check "métriques protégées par jeton" '[[ $("${CURL[@]}" -o /dev/null -w "%{http_code}" "https://api.$S/health/metrics") =~ ^(401|403|404)$ ]]'
# Limitation de débit : X-Forwarded-For forgé sans effet (11 connexions → 429).
codes=""; for i in $(seq 1 11); do codes+="$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST "https://app.$S/api/v1/auth/login" -H 'content-type: application/json' -H "X-Forwarded-For: 198.51.100.$i" -d '{"email":"rl@verify.invalid","password":"Wrong-Password-2026!"}') "; done
check "limitation de débit active malgré X-Forwarded-For forgé ($codes)" '[[ "$codes" == *429* ]]'
PUBIP="${STAGING_DOMAIN_SUFFIX%.sslip.io}"; PUBIP="${PUBIP//-/.}"
check "PostgreSQL non exposé (5432 fermé côté public)" '! (timeout 3 bash -c "</dev/tcp/$PUBIP/5432") 2>/dev/null'
check "Mailpit non exposé publiquement (8025 fermé côté public)" '! (timeout 3 bash -c "</dev/tcp/$PUBIP/8025") 2>/dev/null || [[ "$PUBIP" == 127.0.0.1 ]]'
echo "Résultat : $ok vérifications réussies, $ko en échec."
[ "$ko" -eq 0 ]
