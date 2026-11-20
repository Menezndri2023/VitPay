# Vidéos de démonstration narrées

Quatre parcours filmés sur le staging (1280×720), sous-titrés, avec une voix off française synchronisée sur chaque étape. Prérequis : macOS (`say`, voix « Thomas »), `ffmpeg`, Chrome, `npx playwright install ffmpeg`.

```bash
# Tunnel vers Mailpit (e-mails du staging)
ssh -i ~/.ssh/vitpay_staging_ed25519 -f -N -L 18025:127.0.0.1:8025 vitpay@185.183.55.236

cd e2e
export BIZ_URL=https://app.staging.vitpay-ma.com PAY_URL=https://pay.staging.vitpay-ma.com \
       ADMIN_URL=https://admin.staging.vitpay-ma.com MAILPIT_URL=http://localhost:18025 E2E_SIGNUP=1 \
       DEMO_OUT=/tmp/vitpay-demo PW_OUTPUT=/tmp/vitpay-demo-raw
npx playwright test -c playwright.demo.config.ts        # filme les parcours (environ 5 min)
demo/assemble.sh /tmp/vitpay-demo ~/Desktop/VitPay-videos   # MP4 par parcours + vidéo complète
```

Les textes de la voix off sont dans `parcours.spec.ts` (premier argument de chaque `n.step`). La voix et le débit se règlent avec `DEMO_VOICE` et `DEMO_RATE`.

Sans `E2E_SIGNUP`, la suite utilise le commerçant de démonstration local. Avec `E2E_SIGNUP=1`, elle inscrit ses propres comptes de test, car les mots de passe du seed staging ne circulent pas.
