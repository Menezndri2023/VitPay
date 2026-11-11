# VITPAY — PRD (MVP « Business Lite », modèle A)

**Vision** : permettre à toute entreprise ou indépendant de demander un paiement en un geste (montant, lien, QR) et d'obtenir une preuve fiable de son règlement. VITPAY — One platform. Every payment.

## Utilisateurs

| Persona | Besoin | Produit |
|---|---|---|
| Indépendant, vendeur social | Être payé avant d'expédier, preuve de paiement | Business |
| Commerce avec caisse | Encaisser sans TPE carte | Business : caisse QR |
| PME multi-employés | Rôles, suivi, export comptable | Business |
| Payeur | Payer vite, en sécurité, dans sa langue | Page publique |
| Équipe VIT GLOBAL | Superviser, contrôler, auditer | Admin |

## Exigences fonctionnelles du MVP (toutes livrées en sandbox)

1. Inscription et connexion sécurisées, MFA (obligatoire en admin).
2. Organisation, équipe (owner/admin/cashier/viewer), points de vente, KYB (déclaratif).
3. Connexion du compte prestataire du commerçant (modèle A).
4. Demande de paiement en MAD : motif, validité, lien, QR, partage WhatsApp, SMS et e-mail.
5. Page publique FR/AR/EN (RTL) : bénéficiaire, montant, motif, choix du moyen de paiement, redirection vers le prestataire.
6. Confirmation **uniquement par preuve serveur** ; page de statut ; reçu PDF.
7. Historique, filtres, détail, annulation, remboursement total ou partiel, litiges.
8. Caisse QR plein écran avec confirmation en direct.
9. Tableau de bord, notifications in-app, export CSV.
10. Admin : tableau de bord, organisations (masquage PII), KYB, suspension, quatre yeux, transactions, incidents, webhooks (rejeu), rapprochement, audit vérifiable.

## Hors MVP

Personal en production · portefeuille et soldes · virement instantané · TPE carte et NFC · récurrent · multi-devises · application native · espagnol (voir [`ROADMAP.md`](ROADMAP.md) et [`COMPLIANCE.md`](COMPLIANCE.md)).

## Indicateurs du pilote

Taux de demandes payées, délai entre création et paiement, taux d'échec des tentatives, incidents critiques (cible 0 non traité sous 24 h), écarts de rapprochement (cible 0), NPS des commerçants.
