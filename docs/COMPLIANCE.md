# VITPAY — Conformité et points à légaliser

> **Statut : le produit est construit en mode sandbox uniquement.**
> Aucune transaction réelle n'est possible tant que les points ci-dessous ne sont pas levés.
> Ce document est la **liste de travail à remettre au cabinet juridique**. Il ne constitue pas un avis juridique.

## 1. Modèle retenu : modèle A (prestataire technique)

Décision du fondateur (10/11/2026) : **modèle A**.

- Chaque commerçant signe **son propre contrat** avec un prestataire de paiement agréé (acquéreur, établissement de paiement).
- VITPAY se connecte à ce compte avec les identifiants du commerçant. Il crée les sessions de paiement, reçoit les confirmations et tient un **ledger miroir**.
- **Les fonds ne transitent jamais par VITPAY.** Le prestataire encaisse puis reverse directement au commerçant.
- La commission VITPAY est **facturée séparément**, sous forme d'abonnement ou de facture de commission. Elle n'est jamais prélevée sur les flux.

Ce que le code impose déjà pour rester dans ce périmètre :

| Garde-fou | Où |
|---|---|
| Mode `live` refusé tant que `PAYMENTS_LIVE_ENABLED=false` | [`provider-registry.ts`](../apps/api/src/modules/providers/provider-registry.ts), [`config.ts`](../apps/api/src/config.ts) |
| `PAYMENTS_LIVE_ENABLED=true` impossible sans `LEGAL_SIGNOFF_REF` (référence de l'avis juridique) | [`config.ts`](../apps/api/src/config.ts) |
| Prestataire simulé interdit en production | [`config.ts`](../apps/api/src/config.ts) |
| Compte `live` exige un KYB vérifié | [`organizations.service.ts`](../apps/api/src/modules/organizations/organizations.service.ts) |
| Aucun compte de cantonnement, solde, portefeuille, transfert ou retrait dans le modèle de données | Schéma ([`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md)) |
| Aucune donnée de carte, aucun PIN, mot de passe bancaire ni OTP ne transite par VITPAY : la page de paiement est hébergée par le prestataire | Parcours payeur ([`PAYMENT_FLOWS.md`](PAYMENT_FLOWS.md)) |
| Mention « ne constitue pas une facture » et « fonds traités par le prestataire » sur les reçus | [`receipts.service.ts`](../apps/api/src/modules/receipts/receipts.service.ts) |

## 2. Checklist juridique avant mise en production

Chaque ligne doit recevoir une **réponse écrite** (avocat, Bank Al-Maghrib, CNDP ou partenaire) **avant** l'activation du mode live. Statuts : ☐ à faire · ◐ en cours · ☑ levé (avec référence du document).

### A. Qualification de l'activité (Bank Al-Maghrib — loi 103-12)

| # | Question | Statut | Référence |
|---|---|---|---|
| A1 | Le modèle A (logiciel + redirection vers le prestataire du commerçant, aucun flux de fonds) est-il **hors du champ des services de paiement** ? | ☐ | |
| A2 | Le fait de **choisir le prestataire** (routage) et de recevoir les confirmations constitue-t-il une activité réglementée ? | ☐ | |
| A3 | La **facturation d'une commission proportionnelle** au volume encaissé change-t-elle la qualification ? Faut-il un forfait ou un abonnement ? | ☐ | |
| A4 | Faut-il une déclaration, une notification ou un échange préalable avec BAM pour un prestataire technique ? | ☐ | |
| A5 | Conditions d'un futur **modèle B** : mandataire ou agent d'établissement de paiement, apporteur d'affaires. Et d'un **modèle C** : agrément, capital minimum, gouvernance, délais. | ☐ | |

### B. Contrats

| # | Document | Statut |
|---|---|---|
| B1 | Contrat type **VITPAY ↔ commerçant** : CGU/CGV, SLA, responsabilité, limite « pas de détention de fonds », résiliation, sort des données | ☐ |
| B2 | Accord **VITPAY ↔ prestataire n°1** : accès API, autorisation d'agir pour le compte des commerçants, webhooks, rapports de règlement, sécurité | ☐ |
| B3 | Validation par le prestataire du **mode d'authentification** : clés API du commerçant stockées chiffrées par VITPAY, ou délégation OAuth si disponible | ☐ |
| B4 | **CGU payeur** (page publique) et mentions légales du site | ☐ |
| B5 | Mention de l'éditeur : VIT GLOBAL TECHNOLOGIES GROUP S.A.R.L.A.U. (RC, ICE, siège) sur les pages et reçus | ☐ |
| B6 | Politique de **remboursement et de litiges** : rôle de VITPAY, du commerçant et du prestataire | ☐ |

### C. Données personnelles (loi 09-08, CNDP)

| # | Point | Statut |
|---|---|---|
| C1 | Déclaration ou autorisation des traitements : comptes utilisateurs, payeurs, journaux, KYB | ☐ |
| C2 | **Lieu d'hébergement** : au Maroc, ou à l'étranger avec autorisation de transfert. Ce point conditionne le choix d'hébergeur (voir [`ARCHITECTURE.md`](ARCHITECTURE.md) §Déploiement) | ☐ |
| C3 | Durées de conservation : audit, transactions, KYB, sessions | ☐ |
| C4 | Politique de confidentialité, gestion des droits (accès, rectification, opposition) | ☐ |
| C5 | Contrats de sous-traitance : hébergeur, e-mail, SMS, monitoring | ☐ |

### D. LBC/FT (loi 43-05 modifiée, ANRF)

| # | Point | Statut |
|---|---|---|
| D1 | En modèle A, VITPAY est-il **assujetti** ? Sinon, quelles obligations contractuelles vis-à-vis du prestataire (remontée d'alertes) ? | ☐ |
| D2 | Niveau de KYB exigé avant d'activer un commerçant en live (aujourd'hui : raison sociale, ICE, RC, adresse ; documents à ajouter) | ☐ |
| D3 | Filtrage des sanctions : outil, listes, fréquence | ☐ |
| D4 | Plafonds par demande et par jour, et règles de détection (à paramétrer avec le prestataire) | ☐ |

### E. Change, fiscalité, consommateur

| # | Point | Statut |
|---|---|---|
| E1 | Office des Changes : encaissement en devises (EUR, USD…) et payeurs non-résidents. Le MAD seul est activé aujourd'hui | ☐ |
| E2 | Fiscalité des commissions VITPAY (TVA) et format des factures | ☐ |
| E3 | Statut du **reçu VITPAY** vis-à-vis de la facturation du commerçant | ☐ |
| E4 | Loi 31-08 : information sur les prix et frais affichés au payeur | ☐ |

### F. Sécurité et certification

| # | Point | Statut |
|---|---|---|
| F1 | Périmètre **PCI DSS 4.0.1** confirmé par le prestataire : page hébergée, sans saisie de carte chez VITPAY (cible de type SAQ A) | ☐ |
| F2 | **Test d'intrusion externe** sans vulnérabilité critique ou haute ouverte | ☐ |
| F3 | Plan de continuité et de reprise testé ; sauvegardes chiffrées testées | ☐ |
| F4 | Revue OWASP ASVS niveau 2 | ☐ |

### G. Pour plus tard (hors périmètre du modèle A)

- **VITPAY Personal** (paiements entre particuliers) : ⛔ nécessite un établissement de paiement ou un portefeuille partenaire (modèle B).
- **Virement instantané** : nécessite une banque partenaire offrant des API (notifications, relevés). Il n'existe pas de cadre public d'initiation par un tiers.
- **TPE carte, NFC, SoftPOS** : acquéreur et certifications PCI PTS/CPoC/MPoC requis.

## 3. Procédure d'activation du mode live

1. Toutes les lignes A à F sont ☑, avec la référence du document.
2. Le fondateur et le responsable conformité signent un **procès-verbal d'activation**. Sa référence devient `LEGAL_SIGNOFF_REF`.
3. Un adaptateur réel est développé à partir de la **documentation officielle du prestataire**, sans capacité supposée. Il est testé en sandbox prestataire, puis revu par un tiers.
4. La configuration de production passe `PAYMENTS_LIVE_ENABLED=true` et `LEGAL_SIGNOFF_REF=<référence>`.
5. **Pilote** limité : 10 à 30 commerçants, plafonds bas, rapprochement quotidien obligatoire.

## 4. Ce que VITPAY ne doit jamais faire (rappel)

- Encaisser des fonds sur un compte VITPAY, les conserver ou les reverser.
- Proposer un solde, un portefeuille, un transfert entre utilisateurs ou un retrait.
- Demander ou recevoir un PIN, un mot de passe bancaire, un OTP ou des données de carte.
- Afficher un paiement comme confirmé sans preuve serveur du prestataire.
- Communiquer « vos fonds sont en sécurité chez VITPAY » ou une formule équivalente.
