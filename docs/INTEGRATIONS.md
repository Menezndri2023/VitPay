# VITPAY — préparation des futures intégrations bancaires et TPE

> **Aucune connexion bancaire ni aucun terminal réel n'est disponible.** Ce document décrit les points d'extension prêts dans le code et les conditions à réunir avant d'en écrire une implémentation. La détention d'un compte professionnel (Attijariwafa Bank) ne vaut ni contrat d'acquisition monétique, ni autorisation d'exploitation, ni agrément.

## 1. Points d'extension existants

| Besoin futur | Contrat dans le code | État |
|---|---|---|
| Paiement en ligne (page hébergée par un prestataire agréé) | [`PaymentProvider`](../apps/api/src/modules/providers/provider.interface.ts) | Implémenté par le **prestataire simulé** uniquement |
| Terminal de paiement (TPE, carte présente) | [`TerminalProvider`](../apps/api/src/modules/providers/terminal.interface.ts) | Interface seule, registre vide |
| Notifications du prestataire | `verifyWebhook` + relecture serveur (`getPayment`) | Prêt (signature, déduplication, rejeu sans effet) |
| Rapprochement | `getSettlementReport` + module de rapprochement | Prêt (net = brut − frais, écarts en incident) |
| Remboursements, litiges | `refund`, `getRefund`, `getDispute` | Prêts (plafonds, machines à états) |
| Suivi, incidents | Journal d'audit chaîné, incidents, métriques | Prêts |

Toute intégration réelle hérite automatiquement des protections du cœur : idempotence, machines à états, confirmation uniquement sur preuve serveur, ledger miroir, rapprochement, audit, verrou du mode réel (`PAYMENTS_LIVE_ENABLED` + `LEGAL_SIGNOFF_REF` + `APP_ENV=production`).

## 2. Ce qu'il faut obtenir AVANT d'écrire un adaptateur

1. **Contrat** avec le prestataire, l'acquéreur ou la banque, et qualification juridique (docs/COMPLIANCE.md, sections A, B, G).
2. **Documentation technique officielle** : API, formats de messages, signatures des notifications, environnements de test, codes de retour. Aucun protocole n'est supposé ou reconstitué.
3. **Accès sandbox** du prestataire, avec identifiants de test (jamais de production pour le développement).
4. **Périmètre PCI** confirmé par le prestataire (page hébergée : cible SAQ A ; terminaux : PCI PTS, CPoC ou MPoC selon le matériel).

## 3. Règles imposées à tout adaptateur

- Déclarer **uniquement** les capacités vérifiées dans la documentation et le contrat (`capabilities`).
- Les données de carte (PAN, CVV, piste, PIN) ne transitent **jamais** par VITPAY.
- Un paiement n'est confirmé qu'après **relecture serveur** chez le prestataire, montant et devise compris.
- Identifiants du commerçant chiffrés (AES-256-GCM, rotation de clé) ; jamais de secret dans le dépôt.
- Tests de contrat contre la sandbox du prestataire, puis revue indépendante, avant toute activation.

## 4. Prestataire simulé (sandbox et staging)

Scénarios disponibles sur la page de paiement simulée : succès, 3-D Secure, **confirmation différée (en attente)** puis confirmation ou refus de la banque, carte refusée, abandon. Remboursements partiels ou totaux, litiges (ouverts, gagnés, perdus), rapports de règlement. Tout est marqué « SANDBOX — AUCUN PAIEMENT RÉEL ».
