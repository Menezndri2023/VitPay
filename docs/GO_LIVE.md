# VITPAY — Plan de mise en production

> Objectif : que VitPay soit **installé, testé et prêt** en production, pour qu'il ne reste qu'à
> brancher les clés du prestataire et à poser la référence juridique le jour où les accords arrivent.
> Mis à jour le 20/11/2026. Manuel d'installation : [`PRODUCTION.md`](PRODUCTION.md). Statuts : ☑ fait · ◐ en cours · ☐ à faire · ⛔ dépend d'un tiers.

## Ce qui est prêt

| Domaine | État |
|---|---|
| Produit (espace Business, page de paiement FR/AR/EN, caisse QR, admin, reçus, remboursements, rapprochement) | ☑ |
| API publique : checkout SaaS, clés test et réelles, webhooks signés, OpenAPI, kit Node.js, exemple SaaS | ☑ |
| Garde-fous : paiements réels verrouillés sans `LEGAL_SIGNOFF_REF`, prestataire simulé interdit en production | ☑ |
| Staging public `*.staging.vitpay-ma.com` (16 vérifications automatiques) | ☑ |
| Site `vitpay-ma.com`, pages légales (brouillons), espace développeurs | ☑ |
| Connecteur YouCan Pay (mode test) | ◐ codé et déployé, non testé avec de vraies clés |

## Phase 1 — Production prête à démarrer (sans attendre les tiers)

Réalisable maintenant. La pile est rodée localement, puis installée le jour où l'hébergement est validé (C2).

| # | Travail | État |
|---|---|---|
| P1 | Pile `infra/production` : `APP_ENV=production`, sans prestataire simulé ni Mailpit, Caddy HTTPS, domaine configurable, console admin limitée par adresse IP | ☑ |
| P2 | Script de génération de configuration de production (secrets aléatoires, jamais versionnés) | ☑ |
| P3 | Création des administrateurs en production (`create-admin`, terminal interactif, MFA obligatoire, compte existant jamais modifié) | ☑ |
| P4 | Sauvegardes chiffrées (age, clé privée hors ligne) copiées **hors serveur** (rclone), restauration testée dans une base jetable | ☑ (destination hors serveur à choisir avec l'hébergeur) |
| P5 | Surveillance : `monitor.sh` (API, conteneurs, incidents, files, erreurs, disque, sauvegarde, certificat), alertes ntfy ou Telegram aux changements d'état, plus une sonde externe | ☑ canal ntfy configuré et testé (20/11/2026) ; sonde externe UptimeRobot active sur le staging et le site (ajouter `api.vitpay-ma.com/health` à l'installation) |
| P6 | Contrôle avant ouverture du réel : `go-live-check.sh <PV>` (conformité, plateforme, restauration, tâches programmées, gouvernance) | ☑ |
| P7 | Répétition complète en local de la pile de production | ☑ 18/19 vérifications (reste : SMTP, voir L3) |
| P8 | Fusion de la branche `feat/api-checkout-saas` et étiquette de version | ☑ `v1.0.0` (20/11/2026) |

## Phase 2 — Prestataire n°1 (YouCan Pay)

| # | Travail | État |
|---|---|---|
| Y1 | Identification d'entreprise chez YouCan Pay terminée | ⛔ fondateur |
| Y2 | Clés de **test** saisies dans le staging, paiements avec les cartes de test, vérification des 3 points ouverts (réponse de tokenisation, statuts v1, signature des webhooks) | ⛔ Y1 |
| Y3 | Remboursements YouCan (API v2) : codés d'après la documentation officielle, testés en mode test | ☐ |
| Y4 | Clés **réelles** : test d'un petit paiement réel sur le compte de VIT GLOBAL, puis remboursement | ⛔ Phase 3 |

En parallèle : CMI / Attijari Payment (dossier envoyé, kit d'intégration attendu) → adaptateur n°2.

## Phase 3 — Ouverture du réel

| # | Condition | État |
|---|---|---|
| L1 | Réponses écrites aux lignes A à F de [`COMPLIANCE.md`](COMPLIANCE.md) (avocat, BAM si nécessaire, CNDP) | ⛔ avocat / CNDP |
| L2 | Hébergement de production validé (C2), serveur commandé, DNS de production. **Domaine retenu (20/11/2026) : `vitpay-ma.com`** (`api.`, `pay.`, `app.`, `admin.`), en attendant la confirmation d'un `.ma` | ⛔ L1 |
| L3 | Envoi d'e-mails de production (Brevo ou autre) avec domaine authentifié (SPF, DKIM, DMARC) | ⛔ fondateur |
| L4 | Test d'intrusion externe (F2) | ☐ à commander |
| L5 | Procès-verbal d'activation signé → `LEGAL_SIGNOFF_REF` ; `PAYMENTS_LIVE_ENABLED=true` | ⛔ L1–L4 |
| L6 | Pilote : 10 à 30 commerçants, plafonds bas, rapprochement quotidien | ☐ |

**Le jour J** (une fois L1 à L5 levés) : installation de la pile de production (P1–P7, environ une demi-journée), clés live du prestataire saisies par le commerçant, pré-vol P6 vert, ouverture.
