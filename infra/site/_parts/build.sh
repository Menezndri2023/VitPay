#!/usr/bin/env bash
# Assemble les pages légales (en-tête + corps + pied communs). Usage : infra/site/_parts/build.sh
set -euo pipefail
cd "$(dirname "$0")"
for spec in "mentions-legales:Mentions légales" "conditions:Conditions générales" "remboursement:Politique de remboursement" "confidentialite:Politique de confidentialité"; do
  page="${spec%%:*}"; title="${spec#*:}"
  { sed "s/__TITLE__/$title/" head.html; cat "$page.body.html"; cat foot.html; } > "../$page.html"
done
