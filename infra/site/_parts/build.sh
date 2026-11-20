#!/usr/bin/env bash
# Assemble les pages (en-tête + corps + pied communs) et publie la spécification OpenAPI.
# Usage : infra/site/_parts/build.sh
set -euo pipefail
cd "$(dirname "$0")"
for spec in "mentions-legales:Mentions légales:doc" "conditions:Conditions générales:doc" "remboursement:Politique de remboursement:doc" \
            "confidentialite:Politique de confidentialité:doc" "developpeurs:Développeurs — API et intégration:doc wide"; do
  IFS=: read -r page title cls <<< "$spec"
  { sed -e "s/__TITLE__/$title/" -e "s/__MAINCLASS__/$cls/" head.html; cat "$page.body.html"; cat foot.html; } > "../$page.html"
done
# Source unique : docs/openapi.json (vérifiée contre l'API par apps/api/test/openapi-contract.test.ts).
cp ../../../docs/openapi.json ../openapi.json
