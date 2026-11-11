# VITPAY — Roadmap

| Phase | État au 10/11/2026 | Critère de sortie |
|---|---|---|
| 0 — Discovery | ◐ Rapport initial livré ([`RAPPORT_INITIAL_PHASE0.md`](RAPPORT_INITIAL_PHASE0.md)) ; modèle A choisi ; **juridique à lancer** | Avis juridique écrit (COMPLIANCE A–F) |
| 1 — Foundation | ☑ Monorepo, configuration validée, PostgreSQL + RLS, authentification + MFA, rôles, audit, CI | Tests verts |
| 2 — Financial core | ☑ Money, ledger, machines à états, idempotence, outbox et inbox, prestataire simulé, rapprochement | Revue indépendante ☑ (9 défauts corrigés, voir SECURITY.md) ; revue humaine ☐ |
| 3 — Admin | ☑ MVP : supervision, KYB, suspension, quatre yeux, incidents, webhooks, audit, rapprochement | |
| 4 — Parcours payeur | ☑ Page publique FR/AR/EN, statut, reçu | |
| 5 — Business Lite | ☑ Demandes, lien, QR, partage, remboursements, export CSV, équipe, points de vente, notifications in-app | Test utilisateur avec 5 commerçants ☐ |
| 6 — TPE (QR) | ☑ Caisse avec QR dynamique | Terminaux et NFC ⛔ (acquéreur certifié) |
| 7 — Prestataire réel n°1 | ☐ **Bloqué** : contrat et sandbox prestataire | Tests de contrat sur la sandbox du prestataire |
| 8 — Pilote | ☐ | Pentest, PRA, `LEGAL_SIGNOFF_REF` |
| 9 — International | ☐ | Analyse pays par pays |

## Backlog prioritaire (prochaines itérations)

1. Appels d'offres prestataires (CMI, NAPS, Payzone, établissement de paiement) et obtention d'une sandbox. **Chemin critique.**
2. Adaptateur du prestataire n°1 et tests de contrat.
3. Stockage chiffré des documents KYB ; invitations d'équipe par e-mail.
4. Canaux e-mail et SMS (fournisseurs à choisir) ; WhatsApp Business API (à étudier).
5. Observabilité : Sentry, OpenTelemetry, alertes sur les incidents critiques.
6. ☑ Tests e2e navigateur (Playwright) : parcours complet, RTL, caisse, admin, mobile.
7. Rotation des clés de chiffrement ; anti-rejeu TOTP ; limitation de débit distribuée.
8. ☑ Relevés de commissions VITPAY (hors flux, pro forma) — format de facture définitif après E2.
9. Infrastructure de déploiement (Terraform) selon le choix d'hébergement (CNDP).
