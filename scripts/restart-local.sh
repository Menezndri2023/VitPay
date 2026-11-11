#!/usr/bin/env bash
# Recompile et relance l'API et les trois apps (mode production locale) sur les ports VITPAY.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
LOGS=${LOGS:-$ROOT/.logs}
mkdir -p "$LOGS"
pkill -f "dist/src/main.js" 2>/dev/null || true
pkill -f "next start -p 371" 2>/dev/null || true
(cd "$ROOT/apps/api" && npx tsc -p tsconfig.build.json && nohup node --env-file=.env dist/src/main.js > "$LOGS/api.log" 2>&1 &)
for a in pay business admin; do
  port=$(grep -o 'start -p [0-9]*' "$ROOT/apps/$a/package.json" | awk '{print $3}')
  (cd "$ROOT/apps/$a" && NEXT_TELEMETRY_DISABLED=1 npx next build > "$LOGS/$a-build.log" 2>&1 && NEXT_TELEMETRY_DISABLED=1 nohup npx next start -p "$port" > "$LOGS/$a.log" 2>&1 &)
done
for _ in $(seq 1 60); do
  curl -sf -o /dev/null http://localhost:4710/health && curl -sf -o /dev/null http://localhost:3710/ \
    && curl -sf -o /dev/null http://localhost:3711/login && curl -sf -o /dev/null http://localhost:3712/login && { echo "✓ VITPAY prêt : API 4710 · Pay 3710 · Business 3711 · Admin 3712"; exit 0; }
  sleep 1
done
echo "✗ démarrage incomplet, voir $LOGS" >&2; exit 1
