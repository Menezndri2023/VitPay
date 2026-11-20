#!/usr/bin/env bash
# VITPAY — test de fumée de bout en bout (sandbox) à travers les proxys Next.js.
# Prérequis : API (4710), Pay (3710) et Business (3711) démarrés, base seedée.
set -euo pipefail
BIZ=${BIZ:-http://localhost:3711}
PAY=${PAY:-http://localhost:3710}
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT
json() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
post() { curl -sf -b "$JAR" -c "$JAR" -H 'content-type: application/json' -H 'x-vitpay-csrf: 1' -H "Origin: $BIZ" "$@"; }

echo "1) connexion commerçant"
post -X POST "$BIZ/api/v1/auth/login" -d '{"email":"marchand@vitpay.test","password":"Demo-Password-2026!"}' >/dev/null
ORG=$(curl -sf -b "$JAR" "$BIZ/api/v1/auth/me" | json 'd["organizations"][0]["id"]')
echo "   organisation $ORG"

echo "2) création d'une demande de 500 MAD"
R=$(post -H "Idempotency-Key: smoke-$(date +%s)-$RANDOM" -X POST "$BIZ/api/v1/orgs/$ORG/payment-requests" -d '{"amount":"500","currency":"MAD","description":"Remboursement"}')
URL=$(echo "$R" | json 'd["payUrl"]'); TOKEN=${URL##*/r/}; RID=$(echo "$R" | json 'd["id"]')
echo "   $(echo "$R" | json 'd["reference"]') → $URL"

echo "3) page publique (aucune donnée privée)"
curl -sf "$PAY/api/v1/public/requests/$TOKEN" | json 'd["beneficiary"], d["amount"], d["status"], d["methods"]'
curl -sf -o /dev/null -w "   page HTML : %{http_code}\n" "$URL"

echo "4) le payeur démarre le paiement"
CO=$(curl -sf -H 'content-type: application/json' -X POST "$PAY/api/v1/public/requests/$TOKEN/attempts" -d '{"method":"card"}' | json 'd["checkoutUrl"]')
curl -sf -o /dev/null -w "   page prestataire : %{http_code}\n" "$CO"

echo "5) retour navigateur forgé (psp_status=succeeded) AVANT paiement"
curl -sf "$PAY/api/v1/public/requests/$TOKEN/status?psp_status=succeeded" | json '"   statut :", d["status"]'

echo "6) le payeur valide chez le prestataire simulé"
curl -s -o /dev/null -w "   redirection %{http_code} → %{redirect_url}\n" -X POST "$CO/succeed"
sleep 2
curl -sf "$PAY/api/v1/public/requests/$TOKEN/status" | json '"   statut :", d["status"], d["latestAttempt"]'

echo "7) grand livre"
curl -sf -b "$JAR" "$BIZ/api/v1/orgs/$ORG/ledger/balances" | json '{b["code"]:b["balanceMinor"] for b in d["balances"]}, "équilibré:", all(t["balanced"] for t in d["trialBalance"])'

echo "8) reçu PDF, QR code, notification"
curl -sf -o /dev/null -w "   reçu : %{http_code} %{content_type}\n" "$PAY/api/v1/public/requests/$TOKEN/receipt.pdf"
curl -sf -o /dev/null -w "   QR : %{http_code} %{content_type}\n" -b "$JAR" "$BIZ/api/v1/orgs/$ORG/payment-requests/$RID/qr.svg"
sleep 2
curl -sf -b "$JAR" "$BIZ/api/v1/orgs/$ORG/notifications" | json '"   " + d[0]["title"] + " — " + d[0]["body"]'

echo "9) CSRF : mutation sans en-tête dédié"
curl -s -o /dev/null -w "   HTTP %{http_code} (attendu 403)\n" -b "$JAR" -H 'content-type: application/json' -X PATCH "$BIZ/api/v1/orgs/$ORG" -d '{"displayName":"x"}'
echo "✓ parcours complet OK"
