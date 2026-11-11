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

0. ☑ API publique Business (clés API) et webhooks sortants signés — [`DEVELOPERS.md`](DEVELOPERS.md).

1. Appels d'offres prestataires (CMI, NAPS, Payzone, établissement de paiement) et obtention d'une sandbox. **Chemin critique.**
2. Adaptateur du prestataire n°1 et tests de contrat.
3. ☑ Stockage chiffré des justificatifs KYB ; ☑ invitations d'équipe par e-mail ; ☑ mot de passe oublié.
4. ☑ Canal e-mail (SMTP, file + reprise ; fournisseur de production à choisir) ; SMS (fournisseur à choisir) ; WhatsApp Business API (à étudier).
4b. ☑ Images Docker (API, worker, apps) et pile sandbox conteneurisée.
5. ◐ Observabilité : ☑ identifiant de requête (réponses d'erreur incluses), journaux d'accès JSON expurgés, métriques Prometheus protégées (`/health/metrics`, gauges incidents critiques et files) ; ☐ Sentry, OpenTelemetry, règles d'alerte (dépendent de l'hébergement).
6. ☑ Tests e2e navigateur (Playwright) : parcours complet, RTL, caisse, admin, mobile.
7. ☑ Rotation de la clé de chiffrement ; ☑ rotation des secrets de webhooks ; ☑ anti-rejeu TOTP ; ☐ limitation de débit distribuée ; ☑ vérification de l'e-mail à l'inscription.
8. ☑ Relevés de commissions VITPAY (hors flux, pro forma) — format de facture définitif après E2.
9. Infrastructure de déploiement (Terraform) selon le choix d'hébergement (CNDP).
