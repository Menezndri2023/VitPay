#!/usr/bin/env bash
# VITPAY PRODUCTION — contrôle AVANT l'ouverture des paiements réels (lecture seule, ne modifie rien).
# Usage : scripts/go-live-check.sh <référence du procès-verbal, ex. PV-2026-001>
# Tout doit être ✓ avant de poser PAYMENTS_LIVE_ENABLED=true (docs/PRODUCTION.md §5).
set -uo pipefail
cd "$(dirname "$0")/.."
REF="${1:?usage: go-live-check.sh <référence du procès-verbal, ex. PV-2026-001>}"
set -a; . ./.env; set +a
ok=0; ko=0
check() { if eval "$2"; then echo "  ✓ $1"; ok=$((ok+1)); else echo "  ✗ $1"; ko=$((ko+1)); fi; }
info() { echo "  · $1"; }
sql() { docker compose exec -T postgres psql -U postgres -d vitpay -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

echo "A. Décision juridique"
check "référence du procès-verbal au bon format ($REF)" '[[ "$REF" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{3,63}$ ]]'
check "COMPLIANCE.md : aucune ligne A à F encore « ☐ » (à cocher avec les références)" '! grep -E "^\| [A-F][0-9]+b? \|.*\| ☐ \|" ../../docs/COMPLIANCE.md >/dev/null'

echo "B. Plateforme (contrôles de déploiement, sans exception)"
check "verify.sh : tous les contrôles verts" 'scripts/verify.sh >/tmp/vitpay-verify.$$ 2>&1; r=$?; rm -f /tmp/vitpay-verify.$$; [ $r -eq 0 ]'
check "console admin limitée à des adresses précises (pas 0.0.0.0/0)" '[[ -n "${ADMIN_ALLOWED_IPS:-}" && "${ADMIN_ALLOWED_IPS}" != *"0.0.0.0/0"* && "${ADMIN_ALLOWED_IPS}" != *"::/0"* ]]'
check "test de restauration réussi depuis moins de 31 jours" '[[ -n "$(find backups -name .last-restore-test -mtime -31 2>/dev/null)" ]]'
check "sauvegarde quotidienne programmée (crontab)" 'crontab -l 2>/dev/null | grep -q "scripts/backup.sh"'
check "surveillance programmée (crontab)" 'crontab -l 2>/dev/null | grep -q "scripts/monitor.sh"'
check "e-mail d'expéditeur sur le domaine de production" '[[ "${EMAIL_FROM:-}" == *"@${PROD_DOMAIN}"* || "${EMAIL_FROM:-}" == *"@${SITE_DOMAIN:-none}"* ]]'

echo "C. Gouvernance (console admin)"
check "au moins 2 administrateurs avec MFA activée (contrôle à quatre yeux)" '[[ "$(sql "SELECT count(*) FROM users WHERE platform_role IS NOT NULL AND mfa_enabled AND status = '"'"'active'"'"'")" -ge 2 ]]'
check "un responsable conformité (validation KYB) avec MFA" '[[ "$(sql "SELECT count(*) FROM users WHERE platform_role IN ('"'"'compliance'"'"','"'"'super_admin'"'"') AND mfa_enabled AND status = '"'"'active'"'"'")" -ge 1 ]]'
check "aucun incident critique ouvert" '[[ "$(sql "SELECT count(*) FROM incidents WHERE status <> '"'"'resolved'"'"' AND severity = '"'"'critical'"'"'")" == 0 ]]'

echo "D. Commerçants pilotes (information)"
info "organisations au KYB vérifié : $(sql "SELECT count(*) FROM organizations WHERE kyb_status = 'verified' AND status = 'active'")"
info "comptes prestataires réels actifs : $(sql "SELECT count(*) FROM provider_accounts WHERE mode = 'live' AND status = 'active'") (connectables seulement APRÈS l'ouverture)"

echo
echo "Résultat : $ok contrôles réussis, $ko en échec."
if [ "$ko" -eq 0 ]; then
  cat <<EOF
Prêt. Pour ouvrir les paiements réels :
  1. dans .env : PAYMENTS_LIVE_ENABLED=true et LEGAL_SIGNOFF_REF=$REF
  2. scripts/deploy.sh <version>
  3. scripts/verify.sh doit afficher « paiements réels OUVERTS (procès-verbal $REF) »
EOF
else
  echo "Ouverture refusée tant que tous les contrôles ne sont pas verts."
  exit 1
fi
