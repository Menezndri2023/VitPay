# VITPAY — Rapport initial (Phase 0 : Discovery et faisabilité)

> **VITPAY — One platform. Every payment.**
> A VIT GLOBAL TECHNOLOGIES PRODUCT — Propriété de VIT GLOBAL TECHNOLOGIES GROUP S.A.R.L.A.U.

| Champ | Valeur |
|---|---|
| Version | 0.1 — brouillon pour validation fondateur |
| Date | 10/11/2026 |
| Statut | Document de travail. **Aucune affirmation juridique de ce rapport ne vaut avis juridique.** |
| Destinataire | Fondateur / direction de VIT GLOBAL TECHNOLOGIES GROUP |

### Légende des statuts

| Étiquette | Signification |
|---|---|
| ✅ **VALIDÉ** | Imposé par le cahier des charges ou fait vérifié ; pas de débat nécessaire |
| 🟢 **RECOMMANDÉ** | Position de l'équipe ; à appliquer sauf objection du fondateur |
| 🔍 **À ÉTUDIER** | Hypothèse plausible, travail d'analyse nécessaire |
| 🤝 **À CONFIRMER (PARTENAIRE)** | Dépend des capacités ou contrats d'un tiers (banque, PSP, acquéreur) |
| ⛔ **BLOQUÉ** | Impossible en l'état sans agrément, partenaire ou levée d'une contrainte technique |

---

## 1. Résumé exécutif

**Ce qu'il faut retenir en dix points :**

1. **La question n°1 de VITPAY n'est pas technique, elle est réglementaire.** Encaisser des fonds pour le compte de tiers, les conserver ou les reverser est une activité de *service de paiement* réservée au Maroc aux établissements agréés par Bank Al-Maghrib (loi bancaire n° 103-12, qui a créé la catégorie des « établissements de paiement »). Une S.A.R.L.A.U. technologique ne peut pas le faire seule. ⛔ tant que le modèle n'est pas choisi.
2. **Trois modèles opérationnels sont possibles** (détail §4) : **(A)** prestataire technique pur — chaque commerçant a son propre contrat d'encaissement, VITPAY orchestre ; **(B)** partenariat avec un établissement de paiement ou acquéreur agréé qui porte la relation financière ; **(C)** agrément propre de VITPAY comme établissement de paiement. **Recommandation : démarrer en A, négocier B en parallèle, envisager C seulement après traction.** 🟢
3. **VITPAY PERSONAL est le produit le plus difficile, pas le plus simple.** Un particulier ne peut en principe pas devenir « commerçant accepteur » de cartes, et recevoir de l'argent entre particuliers relève du transfert de fonds ou du porte-monnaie électronique, donc d'un établissement agréé. ⛔ sans partenaire agréé (portefeuille mobile, établissement de paiement).
4. **Le virement instantané existe au Maroc** (opérationnel depuis le 1er juin 2023 via le GSIMT, sous l'égide de Bank Al-Maghrib, et ouvert aux établissements de paiement depuis 2025). Mais **aucune API publique d'initiation de paiement par un tiers** n'est connue à ce jour : il n'existe pas d'équivalent marocain de la DSP2 « open banking ». Une confirmation automatique, vérifiable côté serveur, d'un virement est donc 🤝 à obtenir auprès d'une banque partenaire. Ce n'est pas acquis.
5. **GeniusPay n'est pas adapté au MVP marocain.** Les sources publiques le présentent comme un orchestrateur tourné vers l'Afrique de l'Ouest (Wave, Orange Money, MTN, Moov, cartes via Paystack), aux débuts commerciaux récents. Il reste un candidat 🔍 pour la phase UEMOA/CEMAC (XOF/XAF), pas pour le Maroc.
6. **Stripe n'est pas disponible pour les entités immatriculées au Maroc.** Les candidats réalistes sont les acteurs locaux : CMI, NAPS, M2T, Payzone, YouCan Pay et des établissements de paiement adossés aux banques. Leurs capacités (API, webhooks, multi-commerçant, sous-comptes) sont toutes 🤝.
7. **MVP recommandé : « VITPAY Business Lite » plutôt que les trois produits.** Il s'adresse aux indépendants, auto-entrepreneurs et PME (y compris les vendeurs sur Instagram et WhatsApp), avec demande de paiement, lien, QR, page de paiement publique, confirmation par webhook vérifié, reçu, historique et administration minimale. L'interface est web d'abord, sous forme de PWA, sans application native au MVP. 🟢
8. **La liste des statuts du cahier des charges mélange plusieurs objets** (demande, tentative, règlement, reversement, litige). Utiliser une liste unique produirait des bugs financiers. Nous proposons **cinq machines à états distinctes** (§7). 🟢
9. **Le ledger à double entrée est indispensable, même sans détention de fonds.** En modèle A/B, ce sera un *ledger miroir* : il trace ce que le PSP détient et doit à chaque commerçant, les frais et les remboursements, et il sert au rapprochement. ✅
10. **Le périmètre demandé (3 produits, admin, 6 devises, 4 langues, mobile natif, 11 agents) est trop large pour un premier lancement.** Si tout est construit en parallèle, le produit sortira tard, avec une dette importante, et sans partenaire signé. Nous recommandons de couper fortement le périmètre (§12).

**Décision immédiate attendue du fondateur :** choisir le modèle opérationnel de départ (A/B/C) et mandater un cabinet juridique spécialisé en droit bancaire marocain (§14).

---

## 2. Vision et positionnement

### 2.1 Vision reformulée

> VITPAY permet à toute personne ou entreprise de **demander un paiement en un geste** (un montant, un lien, un QR) et d'**obtenir une preuve fiable** qu'il a été réglé, quel que soit le moyen de paiement utilisé par le payeur.

VITPAY se positionne comme une **couche d'orchestration et d'expérience** au-dessus des infrastructures de paiement agréées : acquéreurs, établissements de paiement et banques. Ce n'est **pas** une banque, **pas** un portefeuille et **pas** un acquéreur, du moins tant qu'un agrément ou un partenariat ne le permet pas. ✅

### 2.2 Proposition de valeur

| Pour qui | Problème | Ce que VITPAY apporte |
|---|---|---|
| Vendeur social (Instagram, WhatsApp) | Paiement à la livraison (cash), retours, impayés | Lien de paiement avant expédition, preuve de paiement |
| Indépendant, prestataire de service | Factures payées en retard, relances manuelles | Demande par lien et QR, statut en temps réel, reçu |
| PME multi-points de vente | Encaissements dispersés, rapprochement manuel | Tableau de bord unifié, exports, rapprochement |
| Commerce physique | Coût et complexité du TPE carte | QR d'encaissement affiché ou généré à la caisse |
| Particulier | Se faire rembourser par un proche | (Ultérieur, via un partenaire agréé) |

### 2.3 Différenciation : à prouver

Les « liens de paiement » existent déjà chez plusieurs PSP marocains (à vérifier un par un). La différenciation de VITPAY doit venir de : **(1)** l'agnosticisme fournisseur (plusieurs PSP, un seul tableau de bord), **(2)** l'expérience mobile et WhatsApp native, **(3)** la gestion multi-points de vente et multi-employés, **(4)** le rapprochement et le reporting. 🔍 Ce positionnement doit être validé par des entretiens clients avant le développement.

---

## 3. Analyse du marché marocain

> ⚠️ Cette section repose sur des informations publiques partielles. Elle **doit** être complétée par une étude terrain (entretiens, données BAM, rapport annuel du CMI).

### 3.1 Constats

- **Le cash domine encore**, et le paiement à la livraison est la norme dans l'e-commerce et le social commerce. 🔍 Les chiffres sont à sourcer (rapports annuels BAM et CMI).
- **Le paiement en ligne par carte progresse.** Le marché de l'acquisition, longtemps quasi-monopolistique (CMI), s'ouvre à la concurrence sous l'impulsion de BAM et du Conseil de la concurrence. ✅ (presse, voir sources)
- **Le virement instantané a été adopté** : environ 16,3 millions d'opérations en 2024 selon le rapport BAM cité par la presse. ✅ (presse)
- **Le plafond d'interchange domestique devrait être abaissé à 0,50 % au 1er octobre 2026**, d'après la presse. 🔍 Le texte BAM est à vérifier. Cela réduit le coût d'acceptation carte et rend les liens de paiement carte plus compétitifs.
- **Les établissements de paiement agréés sont peu nombreux** : environ 16 fin 2023 selon une source de 2025. On y trouve notamment Wafacash, Cash Plus, M2T, NAPS, Barid Cash et Lana Cash (CIH). ✅ (presse ; la liste officielle est à obtenir auprès de BAM)

### 3.2 Concurrents et alternatives (à cartographier précisément)

| Catégorie | Exemples | Menace / opportunité |
|---|---|---|
| Acquéreurs, passerelles | CMI, NAPS, Payzone, M2T, Maroc Telecommerce | Partenaires potentiels **et** concurrents (liens de paiement natifs) |
| Solutions e-commerce | YouCan Pay | Concurrent direct sur le segment des petits vendeurs |
| Portefeuilles mobiles, EP | Lana Cash, Cash Plus, Wafacash, Barid Cash, offres bancaires | Partenaires naturels pour VITPAY Personal |
| Banques | Applications bancaires avec virement instantané | Substitut pour le paiement entre particuliers |
| Alternative informelle | Cash, virement manuel avec capture d'écran | Le vrai concurrent, gratuit |

🔍 **Livrable à produire :** une fiche par concurrent couvrant les tarifs, l'existence d'un lien de paiement, d'un QR, d'une API, les délais de reversement et les conditions d'ouverture.

### 3.3 Cas d'usage prioritaires

| Priorité | Cas d'usage | Produit | Faisabilité réglementaire |
|---|---|---|---|
| P1 | Commerçant ou indépendant qui envoie un lien de paiement par carte | Business | 🟢 en modèle A/B |
| P1 | QR affiché en boutique, le client paie par carte sur son téléphone | Business (module TPE) | 🟢 en modèle A/B |
| P2 | PME multi-points de vente avec plusieurs employés | Business | 🟢 |
| P2 | Paiement par virement avec référence et rapprochement | Business | 🤝 (accès aux relevés bancaires) |
| P3 | Particulier qui demande de l'argent à un proche | Personal | ⛔ sans partenaire agréé |
| P3 | Paiements récurrents | Business | 🤝 (tokenisation carte chez le PSP) |
| P4 | TPE carte, NFC, SoftPOS | TPE | ⛔ sans acquéreur et certifications |

### 3.4 Principaux risques business

1. **Dépendance aux partenaires.** Sans PSP signé, il n'y a pas de produit. Les acquéreurs peuvent aussi copier la fonctionnalité.
2. **Marge faible.** La commission VITPAY s'ajoute à celle du PSP. Elle doit se justifier par la valeur logicielle (abonnement), pas uniquement par un pourcentage.
3. **Adoption.** Changer l'habitude du paiement à la livraison demande de la confiance. La marque, la transparence et la preuve de paiement sont centrales.
4. **Fraude.** Les liens de paiement sont un vecteur d'hameçonnage (faux liens). Il faut prévoir l'anti-phishing dès le départ : domaine unique, affichage vérifié du bénéficiaire, signalement.

---

## 4. Analyse réglementaire et risques

> ⚠️ **Avertissement :** les éléments ci-dessous sont des hypothèses de travail fondées sur la connaissance générale du cadre marocain. Ils **doivent** être confirmés par un avocat spécialisé et, si nécessaire, par un échange préalable avec Bank Al-Maghrib.

### 4.1 Textes et autorités à étudier

| Domaine | Référence (à vérifier dans sa version en vigueur) | Statut |
|---|---|---|
| Services de paiement, établissements de paiement | Loi n° 103-12 relative aux établissements de crédit et organismes assimilés, circulaires BAM d'application | 🔍 |
| Moyens et systèmes de paiement | Circulaires et directives BAM (monétique, virement instantané, paiement mobile) | 🔍 |
| Données personnelles | Loi n° 09-08 et CNDP (déclarations ou autorisations, **transfert de données hors du Maroc**) | 🔍 |
| LBC/FT | Loi n° 43-05 modifiée (notamment par la loi 12-18), ANRF, listes de sanctions | 🔍 |
| Change | Office des Changes (encaissements en devises, non-résidents, flux transfrontaliers) | 🔍 |
| Consommateur | Loi n° 31-08 (information sur les prix, frais) | 🔍 |
| Cartes | Règles des réseaux, PCI DSS v4.0.1 | ✅ (selon le périmètre) |
| Facturation électronique, fiscalité | DGI (reçus, TVA sur les commissions) | 🔍 |

### 4.2 Cartographie des activités

| Activité | VITPAY seul (société technologique) | Statut |
|---|---|---|
| Logiciel de création de demandes, liens et QR | Possible | 🟢 |
| Page de paiement qui **redirige** vers un PSP agréé (VITPAY ne voit pas les données de carte) | Possible si le contrat est au nom du commerçant ou du partenaire | 🟢 |
| Tableau de bord, reporting, rapprochement sur données PSP | Possible | 🟢 |
| Encaisser sur **un compte VITPAY** puis reverser aux commerçants | **Service de paiement** : agrément ou partenaire requis | ⛔ |
| Portefeuille, solde utilisateur, transfert entre utilisateurs | **Monnaie électronique ou compte de paiement** : agrément requis | ⛔ |
| Initier un virement depuis le compte du payeur | Pas de cadre public d'initiation par un tiers connu ; contrat bancaire nécessaire | ⛔ / 🤝 |
| Lire des cartes, saisir un code PIN (TPE, SoftPOS) | Certifications (PCI PTS/CPoC/MPoC), acquéreur, réseau | ⛔ |
| KYC/KYB des commerçants | Possible techniquement ; la **responsabilité réglementaire** revient au partenaire agréé | 🤝 |
| Commission prélevée sur la transaction | Dépend du modèle : en A, facturation séparée ; en B, *split* par le partenaire | 🤝 |
| Encaissement en devises (EUR/USD) pour des marchands marocains | Office des Changes et capacités de l'acquéreur (multidevise CMI annoncé) | 🤝 |

### 4.3 Les trois modèles opérationnels

| | **A — Prestataire technique** | **B — Partenaire agréé** | **C — Agrément propre** |
|---|---|---|---|
| Principe | Le commerçant signe avec le PSP ; VITPAY se connecte avec ses identifiants ou sa délégation | Un EP ou acquéreur agréé porte les fonds et le KYC ; VITPAY est le distributeur et la plateforme (mandataire, apporteur, marque blanche : à qualifier) | VITPAY devient établissement de paiement |
| Délai | Court (dépend de l'onboarding PSP) | Moyen (négociation 3 à 9 mois, à estimer) | Long (instruction BAM, capital, gouvernance, contrôle interne) |
| Fonds | Jamais chez VITPAY | Chez le partenaire | Chez VITPAY (cantonnement) |
| Personal (entre particuliers) | ⛔ | 🤝 possible si le partenaire est un portefeuille | Possible |
| Onboarding commerçant | Lent (contrat PSP par commerçant) | Rapide (sous-commerçants) | Rapide |
| Revenus VITPAY | Abonnement SaaS, frais facturés séparément | Partage de commission | Commission complète |
| Risque réglementaire | Faible | Moyen (contrat bien rédigé) | Élevé |
| **Recommandation** | **🟢 Démarrer ici** | **🟢 Négocier en parallèle** | 🔍 Après traction |

**Point de vigilance majeur :** en modèle A, onboarder un petit vendeur reste lent, car il doit obtenir son propre contrat d'acceptation. La valeur de VITPAY pour les tout petits commerçants dépend donc fortement du modèle B, c'est-à-dire d'un partenaire qui accepte d'agir comme *payment facilitator* pour des sous-commerçants. 🤝

### 4.4 Risques réglementaires et de conformité

| Risque | Gravité | Mitigation |
|---|---|---|
| Exercice illégal d'une activité de paiement (encaisser sur un compte VITPAY) | **Critique** | Interdiction technique et contractuelle en MVP ; avis juridique écrit |
| Transfert de données hors du Maroc sans autorisation CNDP | Élevée | Choix d'hébergement (§13), déclarations CNDP |
| Le lien de paiement utilisé pour du blanchiment ou de la fraude | Élevée | Plafonds, KYB, détection, journal d'audit, procédure de signalement via le partenaire |
| Faux liens VITPAY (hameçonnage) | Élevée | Domaine unique, pas de collecte de données sensibles, affichage vérifié du bénéficiaire |
| Communication marketing trompeuse (« nous gardons votre argent en sécurité ») | Moyenne | Charte de communication validée par le juridique |
| Dépendance à un seul PSP | Moyenne | Couche d'abstraction des fournisseurs, deuxième PSP en phase 7 |

### 4.5 Informations à confirmer (liste de questions pour l'avocat et pour BAM)

1. Le modèle A (redirection vers le PSP du commerçant, sans flux de fonds) est-il hors du champ des services de paiement ?
2. Quelles formes de partenariat le modèle B admet-il (mandataire ou agent d'EP, apporteur d'affaires, marque blanche) ? Quelles obligations en découlent pour VITPAY ?
3. Conditions d'agrément d'un EP : capital minimum, fonds propres, dirigeants, contrôle interne, délai d'instruction.
4. Un particulier peut-il recevoir un paiement par carte via un EP partenaire ? Avec quels plafonds et quel KYC ?
5. Un tiers peut-il accéder au virement instantané, en initiation ou en notification ? Quelles banques proposent des API corporate (relevés, notifications) ?
6. Hébergement : un hébergement hors du Maroc est-il possible (autorisation CNDP de transfert), ou faut-il imposer un hébergeur marocain ?
7. Fiscalité des commissions et format des reçus (un reçu VITPAY n'est **pas** une facture du commerçant).

---

## 5. Étude des prestataires de paiement

> Aucune capacité n'est considérée comme acquise. Chaque cellule « ? » doit être remplie à partir de la documentation technique et du contrat **signé**.

### 5.1 Grille d'évaluation (à appliquer à chaque candidat)

Couverture Maroc · cartes marocaines et internationales · devises de règlement · page de paiement hébergée (pour réduire le périmètre PCI) · API de création de session · **webhooks signés** · API de consultation de statut · remboursement total ou partiel · multi-commerçants et sous-comptes · *split* de commission · délai et frais de reversement · environnement sandbox · tokenisation et paiements récurrents · QR · fichiers de rapprochement · SLA · tarifs · durée d'onboarding · exigences KYB.

### 5.2 Candidats

| Candidat | Positionnement public | Pertinence MVP Maroc | Statut |
|---|---|---|---|
| **CMI** | Acteur historique de l'acquisition et de la passerelle e-commerce, multidevise annoncé | Élevée | 🤝 |
| **NAPS** | Établissement de paiement agréé, acquisition, TPE | Élevée (aussi pour la phase TPE) | 🤝 |
| **M2T** | Établissement de paiement agréé (traitement de transactions) | À évaluer | 🤝 |
| **Payzone** | Passerelle en ligne homologuée CMI, PCI DSS annoncé | Élevée | 🤝 |
| **YouCan Pay** | Passerelle orientée petits vendeurs | Moyenne (aussi concurrent) | 🤝 |
| **Lana Cash (CIH), Cash Plus, Wafacash, Barid Cash** | Établissements de paiement, portefeuilles, transferts | Clé pour **Personal** et pour le modèle B | 🤝 |
| **Banques (API corporate)** | Virement instantané, relevés | Rapprochement des virements | 🤝 |
| **GeniusPay** | Orchestrateur Afrique de l'Ouest (Wave, Orange Money, MTN, Moov ; cartes via Paystack), débuts récents | **Faible pour le Maroc**, à étudier pour l'UEMOA | 🔍 |
| **Stripe** | Non disponible pour les entités marocaines | Aucune au Maroc | ⛔ |
| Flutterwave, Paystack, CinetPay, PawaPay, Moneroo | Agrégateurs Afrique subsaharienne | Phase 9 | 🔍 |

### 5.3 Recommandation

- **Lancer 3 à 4 appels d'offres parallèles** (CMI, NAPS, Payzone, plus un EP de type Lana Cash) avec la même grille. Demander l'accès sandbox **avant** de signer. 🟢
- **Premier PSP intégré = celui qui fournit le premier sandbox avec webhooks signés.** En attendant, développer contre un **MockProvider** qui simule tous les cas : succès, échec, 3-D Secure, timeout, webhook dupliqué ou désordonné. 🟢

---

## 6. Architecture technique recommandée

### 6.1 Principes

| Choix | Statut | Justification |
|---|---|---|
| Monolithe modulaire NestJS (TypeScript) | ✅ | Cahier des charges ; frontières de modules imposées par des règles de lint |
| PostgreSQL comme source de vérité | ✅ | Transactions ACID, contraintes, RLS |
| Redis et BullMQ pour l'asynchrone | ✅ | Webhooks, notifications, expirations, rapprochement |
| Monorepo pnpm et Turborepo | 🟢 | Types partagés entre l'API, le web et le mobile |
| Next.js pour le web (Business, Admin, Pay) | ✅ | |
| **PWA web d'abord, React Native après le MVP** | 🟢 | Évite trois bases de code au MVP ; partage par lien et WhatsApp natif sur le web |
| Kotlin natif (TPE) | 🔍 | Uniquement en phase 6 et avec un partenaire certifié |
| Pattern **Outbox** (événements) et **Inbox** (webhooks entrants) | 🟢 | Pas de perte d'événement, idempotence |
| Prisma **ou** Drizzle, avec SQL brut pour le ledger | 🟢 Drizzle ou Kysely | Contrôle fin des transactions et des verrous ; Prisma gère mal `SELECT … FOR UPDATE` et les triggers |
| Pas de microservices | ✅ | Règle 13 |

### 6.2 Structure du dépôt

```
vitpay/
├── apps/
│   ├── api/                # NestJS — monolithe modulaire
│   ├── worker/             # Même code, processus BullMQ séparé
│   ├── web-business/       # Next.js — espace Business (+ module TPE QR)
│   ├── web-admin/          # Next.js — VITPAY ADMIN (réseau restreint)
│   └── pay/                # Next.js — pages publiques de paiement (domaine dédié, minimal)
├── packages/
│   ├── ui/                 # Design system (tokens, composants, RTL)
│   ├── contracts/          # Schémas Zod / OpenAPI partagés
│   ├── money/              # Type Money (bigint + devise), formatage
│   ├── i18n/               # fr, ar, en (es plus tard)
│   └── config/             # eslint, tsconfig
├── infra/                  # docker-compose, puis Terraform
└── docs/                   # ARCHITECTURE.md, ADR, etc.
```

### 6.3 Modules backend (`apps/api/src/modules`)

| Module | Responsabilité | Phase |
|---|---|---|
| `identity` | Comptes, authentification, MFA, sessions | 1 |
| `tenancy` | Organisations, membres, rôles, points de vente, caisses | 1 / 5 |
| `access` | RBAC et permissions, approbation à quatre yeux | 1 / 3 |
| `audit` | Journal d'audit immuable et chaîné | 1 |
| `money` | Devises, exposants, arrondis | 2 |
| `ledger` | Comptes, écritures, soldes | 2 |
| `payment-requests` | Demandes, liens, QR, expiration | 2 / 4 |
| `orchestration` | Routage, tentatives, machine à états | 2 |
| `providers` | `PaymentProvider` et adaptateurs (Mock, PSP n°1, …) | 2 / 7 |
| `webhooks-inbox` | Réception, vérification, déduplication, rejeu | 2 |
| `refunds` / `disputes` / `payouts` | Machines à états dédiées | 2 / 7 |
| `reconciliation` | Import des rapports PSP, comparaison avec le ledger | 2 / 7 |
| `notifications` | E-mail, SMS, push, WhatsApp (via des fournisseurs) | 4 |
| `receipts` | Génération de reçus PDF, numérotation | 4 |
| `compliance` | KYC/KYB (via un fournisseur et le partenaire), plafonds, signalements | 5 |
| `terminals` | Parc TPE, appairage | 6 |
| `admin` | Vues et actions de back-office (s'appuie sur les autres modules) | 3 |

**Règle :** un module n'accède jamais aux tables d'un autre module ; il passe par son service public. Cette règle est vérifiée en CI (eslint `boundaries` ou `dependency-cruiser`). 🟢

### 6.4 Interface fournisseur

```ts
export interface PaymentProvider {
  readonly code: string;                       // 'mock', 'cmi', 'naps', ...
  capabilities(ctx: { country: string; currency: Currency }): ProviderCapabilities;
  createPayment(input: CreatePaymentInput, idempotencyKey: string): Promise<ProviderPaymentSession>;
  getPayment(providerRef: string): Promise<ProviderPaymentStatus>;   // vérité serveur
  refund(input: RefundInput, idempotencyKey: string): Promise<ProviderRefundResult>;
  verifyWebhook(raw: RawWebhook): Promise<VerifiedProviderEvent>;    // signature + horodatage
  parseSettlementReport?(file: Buffer): AsyncIterable<SettlementLine>;
}
```

**Règle de confirmation (règle absolue 9) :** une tentative ne passe à `succeeded` qu'après un événement de webhook **vérifié** (signature, horodatage, IP si le PSP les documente) **et** une relecture via `getPayment()` côté serveur. La redirection du navigateur sert uniquement à déclencher un affichage « en cours de vérification ». ✅

### 6.5 Interfaces API (aperçu)

```
POST   /v1/auth/register | /login | /mfa/verify | /refresh
GET    /v1/orgs/:orgId/...                         (toutes les routes Business sont scopées par org)
POST   /v1/orgs/:orgId/payment-requests            Idempotency-Key requis
GET    /v1/orgs/:orgId/payment-requests?status=&from=&to=
POST   /v1/orgs/:orgId/payment-requests/:id/cancel
POST   /v1/orgs/:orgId/refunds                     Idempotency-Key requis, permission refund:create
GET    /v1/orgs/:orgId/ledger/balances
GET    /v1/orgs/:orgId/exports/transactions.csv

# Public (domaine pay.)
GET    /v1/public/requests/:publicToken            → bénéficiaire (nom commercial), montant, motif, méthodes
POST   /v1/public/requests/:publicToken/attempts   → crée une tentative, renvoie l'URL du PSP
GET    /v1/public/requests/:publicToken/status     → statut sans donnée sensible

# Fournisseurs
POST   /webhooks/providers/:providerCode           → inbox (200 rapide, traitement asynchrone)

# Admin (réseau restreint, MFA matériel)
/v1/admin/...                                      → toutes les actions sont auditées
```

La documentation suit OpenAPI 3.1, générée depuis les schémas Zod. Les erreurs suivent RFC 9457 (problem+json). La pagination se fait par curseur. ✅ / 🟢

---

## 7. Architecture financière

### 7.1 Représentation monétaire ✅

- Les montants sont des **entiers en unité mineure** (`BIGINT`) accompagnés d'un code devise ISO 4217 **dans la même ligne**.
- La table `currencies(code, exponent)` fixe l'exposant : **MAD 2, EUR 2, USD 2, GBP 2, XOF 0, XAF 0**. Attention : XOF et XAF n'ont pas de centimes. Une hypothèse « tout × 100 » serait un bug.
- Les taux (frais en %, change) sont stockés en `NUMERIC(20,10)`. L'arrondi suit une règle explicite (demi-pair ou en faveur du client, **à décider et documenter**).
- Aucun `float` ou `number` JS n'est utilisé pour l'argent. Le package `money` impose le type et le lint interdit l'arithmétique directe.
- Une addition ou une soustraction entre devises différentes est **impossible au niveau du type**.

### 7.2 Ledger à double entrée ✅

```
ledger_accounts(id, code, type[asset|liability|revenue|expense], owner_type, owner_id, currency, created_at)
journal_entries(id, entry_type, reference_type, reference_id, idempotency_key UNIQUE,
                effective_at, created_at, created_by, reverses_entry_id NULL)
postings(id, entry_id, account_id, direction[debit|credit], amount BIGINT CHECK (amount > 0), currency)
```

- **Équilibre :** un trigger `DEFERRABLE INITIALLY DEFERRED` vérifie, à la fin de chaque transaction, que Σ débits = Σ crédits **par devise** pour chaque écriture.
- **Immuabilité :** l'utilisateur applicatif n'a **pas** les droits `UPDATE` ni `DELETE` sur ces tables. Une correction passe par une écriture d'annulation (`reverses_entry_id`).
- **Idempotence :** une contrainte d'unicité porte sur `idempotency_key`. Rejouer un webhook ne peut pas créer une seconde écriture.
- **Soldes :** ils sont calculés depuis les postings. Une table de soldes matérialisée, mise à jour dans la même transaction avec verrou de ligne, s'ajoute si la volumétrie l'exige.

### 7.3 Plan de comptes du *ledger miroir* (modèle A/B) 🟢

Dans ces modèles, VITPAY **ne détient pas** les fonds. Le ledger décrit qui doit quoi, chez qui :

| Compte | Sens |
|---|---|
| `provider_clearing:{psp}:{org}` | Montant encaissé par le PSP pour le commerçant, pas encore réglé |
| `merchant_settled:{org}` | Montant réglé par le PSP au commerçant (selon le rapport de règlement) |
| `provider_fees:{psp}:{org}` | Frais du PSP |
| `vitpay_fees_receivable:{org}` | Commission VITPAY due (facturée séparément en A, prélevée par *split* en B) |
| `refunds_pending:{org}` / `disputes:{org}` | Remboursements et litiges en cours |

Exemple pour un paiement confirmé de 500,00 MAD avec 1,5 % de frais PSP :
- Débit `provider_clearing` 50000, crédit `merchant_gross_sales` 50000.
- Débit `provider_fees` 750, crédit `provider_clearing` 750.

Le ledger se rapproche **ligne à ligne** du rapport de règlement du PSP (statut `settled`).

### 7.4 Machines à états (correction du cahier des charges) 🟢

La liste unique de statuts du cahier des charges mélange cinq objets. Nous les séparons :

**1. PaymentRequest** (ce que le bénéficiaire crée)
`draft → open → (paid | expired | cancelled)` ; `paid` signifie qu'au moins une tentative a abouti pour le montant total. Pas de paiement partiel au MVP.

**2. PaymentAttempt** (une tentative du payeur, potentiellement plusieurs par demande)
`created → pending → requires_action → processing → (authorized → captured) → succeeded`
ou bien `→ failed | cancelled | expired`.
`succeeded` correspond au « confirmed » du cahier des charges, mais **uniquement** sur preuve serveur.

**3. Settlement** (règlement par le PSP) : `unsettled → settled` (source : rapport PSP).

**4. Payout** (reversement au commerçant) : `payout_pending → paid_out | payout_failed`. En modèle A, ce statut est exécuté par le PSP et VITPAY ne fait que l'observer.

**5. Refund** : `requested → pending → succeeded | failed`. **Dispute** : `opened → evidence_submitted → won | lost`.

Les statuts « vus par le client » (`partially_refunded`, `refunded`, `disputed`) sont **dérivés** de ces machines, pas stockés comme des états concurrents.

Chaque transition est une fonction pure (`from`, `event`) → `to`, testée de façon exhaustive et persistée avec un `version` (verrou optimiste). Elle émet un événement dans l'outbox. Les transitions illégales lèvent une erreur et sont journalisées.

### 7.5 Anti-double paiement ✅

- `Idempotency-Key` est obligatoire sur toute création (demande, tentative, remboursement) et stocké avec un hash de la requête.
- **Une seule tentative active** par demande, imposée par un index unique partiel `WHERE status IN ('pending','processing',...)`.
- Si un webhook de succès arrive pour une demande déjà payée, VITPAY **ne marque pas** deux fois : il crée un incident « double paiement » et propose un remboursement.
- L'expiration est gérée par un job BullMQ, puis revérifiée par le PSP avant le passage effectif en `expired`.

### 7.6 Rapprochement 🟢

Il tourne une fois par jour et par PSP. Le job importe le rapport, le compare au ledger et classe chaque ligne en `matched`, `missing_in_ledger`, `missing_in_provider` ou `amount_mismatch`. Les anomalies alimentent la file d'incidents de l'Admin. **Une anomalie non résolue bloque la clôture du jour.**

---

## 8. Architecture des trois produits

```
                ┌──────────────────── VITPAY CORE (API NestJS) ─────────────────────┐
                │ identity · tenancy · access · audit · ledger · orchestration      │
                │ payment-requests · providers · webhooks · notifications · receipts│
                └───────▲──────────────────▲──────────────────▲──────────────▲──────┘
                        │                  │                  │              │
               VITPAY PERSONAL     VITPAY BUSINESS      Module TPE        VITPAY ADMIN
               (org de type        (org de type         (= fonctionnalité  (interne VIT GLOBAL)
                "personal",         "business",          de Business :
                1 membre)           N membres, POS)      terminaux/caisses)
                        ▲                  ▲
                        └──── pay.vitpay.* (pages publiques payeur, communes) ────┘
```

**Décision structurante 🟢 :** un particulier est modélisé comme une **organisation de type `personal` à un seul membre**. Un seul modèle de données, une seule logique de demandes et de ledger, et un passage naturel de Personal vers Business pour un auto-entrepreneur.

| Produit | MVP | Plus tard |
|---|---|---|
| **Business** | Organisation, membres (Owner, Admin, Cashier, Viewer), demandes, lien, QR, page publique, historique, reçu, export CSV, un point de vente | Multi-POS, multi-caisses, rapports avancés, remboursements en libre-service, API publique et webhooks sortants, récurrent |
| **TPE (module Business)** | QR statique par point de vente et QR dynamique (montant saisi par le caissier sur la PWA) | Appareils Android dédiés, appairage, gestion du parc, NFC et SoftPOS **avec acquéreur certifié** |
| **Personal** | ⛔ Rien en production. La maquette UX peut être conçue | Lancement **uniquement** avec un partenaire EP ou portefeuille |

**Page publique de paiement :** elle affiche le **nom commercial vérifié** du bénéficiaire (jamais le nom légal complet, l'e-mail, le téléphone ou le RIB d'un particulier), le montant, la devise, le motif, les méthodes disponibles, une mention « Paiement traité par {PSP agréé} » et un bouton de signalement. Le jeton public fait au moins 128 bits aléatoires et n'est pas un identifiant séquentiel. ✅

---

## 9. Architecture administrative (VITPAY ADMIN)

| Exigence | Mise en œuvre | Statut |
|---|---|---|
| Isolation | Application séparée, domaine séparé, accès via VPN ou proxy *zero-trust*, **MFA matériel (WebAuthn)** obligatoire | 🟢 |
| Rôles | Super Admin, Admin, Finance, Conformité, Support, Technique, Auditeur (lecture seule) avec des permissions granulaires (`refund:approve`, `org:suspend`, …) | ✅ |
| Quatre yeux | Remboursement manuel, déblocage d'une organisation, modification des frais, ajout d'un PSP : **initiateur ≠ approbateur** | 🟢 |
| Audit | Chaque action : qui, quoi, avant/après, IP, raison obligatoire. Table *append-only* chaînée par hash ; export pour l'auditeur | ✅ |
| Accès aux données | Le Support voit des données masquées par défaut ; le démasquage est justifié et journalisé | 🟢 |
| Super Admin | Deux personnes maximum, comptes non utilisés au quotidien (*break-glass*) | 🟢 |

**Périmètre Admin MVP :** recherche d'organisations et de transactions, suspension et réactivation, consultation du journal d'audit, file d'incidents de rapprochement, configuration des frais et des PSP (avec quatre yeux), validation KYB (si elle n'est pas déléguée au partenaire). Le reste viendra plus tard.

---

## 10. Organisation des agents IA

### 10.1 Critique

Onze agents dès le départ génèrent surtout des coûts de coordination, des conflits de fichiers et de l'incohérence. Une équipe d'agents IA **n'est pas** une équipe senior. Leurs sorties sur la finance et la sécurité **doivent** être revues par un humain compétent. Le prompt l'énonce, et c'est le point le plus important du dispositif. ✅

### 10.2 Organisation recommandée par vagues 🟢

| Vague | Phase | Agents actifs | Zone de fichiers (propriété exclusive) |
|---|---|---|---|
| 1 | 0–1 | 00 Orchestrateur, 01 Architecte, 10 Produit/Doc, 07 Sécurité/Conformité | `docs/`, `docs/adr/` |
| 2 | 1–2 | 00, 02 Backend, 06 Ledger, 08 QA, 09 DevOps | `apps/api/modules/{identity,tenancy,access,audit}`, `modules/ledger`, `packages/money`, `infra/`, `.github/` |
| 3 | 2–3 | 00, 05 Intégrations, 06, 03 Frontend, 08 | `modules/{providers,orchestration,webhooks-inbox}`, `apps/web-admin`, `apps/pay` |
| 4 | 3–5 | 00, 02, 03, 07 (revue), 08 | `apps/web-business`, `packages/ui` |
| 5 | 6+ | 04 Mobile, 05, 09 | `apps/mobile`, `apps/tpe-android` |

### 10.3 Règles de coordination ✅ / 🟢

1. Une branche par tâche (`feat/<module>-<sujet>`) et un worktree Git par agent. Pas de commit direct sur `main`.
2. Un fichier `CODEOWNERS` reflète les zones ci-dessus. Toute modification hors de sa zone passe par une PR revue par le propriétaire.
3. Les **contrats d'abord** : l'Architecte publie l'interface (types, OpenAPI, ADR) **avant** que les implémentations ne démarrent.
4. Les modules `ledger`, `orchestration`, `providers`, `access` et `audit` exigent **une revue indépendante (agent 07 + humain)** et une couverture de test d'au moins 90 % (lignes) et 100 % (transitions d'états).
5. Les agents n'accèdent qu'aux secrets de développement et de sandbox. **Aucun accès à la production** ni aux données réelles.
6. L'orchestrateur maintient `docs/STATUS.md` (décisions, terminé, bloqué, prochaines étapes) à la fin de chaque vague.

---

## 11. Roadmap

Ordre révisé par rapport au cahier des charges : **l'intégration sandbox du premier PSP remonte avant les produits**. Sans elle, on construirait des écrans sur des hypothèses.

| Phase | Contenu | Durée indicative* | Critère de sortie (obligatoire) |
|---|---|---|---|
| **0 — Discovery** (en parallèle juridique) | Avis juridique, appels d'offres PSP, 20 entretiens commerçants, PRD, ADR initiaux | 6–10 semaines | Modèle A/B choisi par écrit ; au moins 1 PSP avec sandbox ; PRD validé |
| **1 — Foundation** | Monorepo, CI/CD, Docker, PostgreSQL, authentification + MFA, organisations, RBAC, audit, i18n FR/AR (RTL) | 4–6 semaines | CI verte, tests d'isolation multi-tenant passants, revue sécurité de l'authentification |
| **2 — Financial Core** | Money, ledger, machines à états, idempotence, outbox et inbox, MockProvider, rapprochement | 5–7 semaines | Tests de propriétés (équilibre, idempotence, concurrence), revue indépendante |
| **3 — PSP n°1 (sandbox) + Pay** | Adaptateur PSP, webhooks, pages publiques, reçus | 3–5 semaines | Scénarios de bout en bout sandbox : succès, échec, 3DS, double webhook, timeout |
| **4 — Business Lite + Admin MVP** | Espace Business, QR, exports, Admin minimal | 5–7 semaines | Test utilisateur avec 5 commerçants (maquette ou sandbox) |
| **5 — Pré-production** | Pentest externe, test de charge, PRA testé, conformité CNDP, contrats signés | 3–4 semaines | Pentest sans vulnérabilité critique ou haute ouverte ; avis juridique final |
| **6 — Pilote** | 10 à 30 commerçants, plafonds bas, monitoring renforcé | 8–12 semaines | Rapprochement à 100 % sur la période, NPS, incidents traités |
| 7 — Extension | Deuxième PSP, multi-POS, TPE QR avancé, remboursements en libre-service | — | — |
| 8 — Personal | Via un partenaire EP ou portefeuille | — | Contrat partenaire et validation réglementaire |
| 9 — International | UEMOA/CEMAC (GeniusPay et autres à évaluer), Europe | — | Analyse pays par pays |

\*Durées pour une équipe d'environ 2 ou 3 développeurs seniors assistés par IA. Ce sont des estimations, pas des engagements.

---

## 12. MVP recommandé

### 12.1 Dans le MVP 🟢

- **VITPAY Business Lite** : inscription, organisation, KYB (léger ou délégué au PSP), membres avec quatre rôles, un point de vente.
- Création d'une demande (montant en MAD, motif, expiration), lien, QR, partage WhatsApp, SMS et e-mail (lien natif `wa.me`, sans API WhatsApp payante au départ).
- Page publique de paiement, tentative par carte via **un** PSP, confirmation par webhook vérifié puis relecture du statut.
- Statuts en temps réel (SSE ou polling), reçu PDF, historique, export CSV.
- Ledger miroir et rapprochement quotidien.
- Admin MVP (§9).
- Langues **FR + AR (RTL)** ; l'anglais est prêt dans les fichiers mais pas traduit ; devise **MAD uniquement**.

### 12.2 Hors MVP (en attente)

| Élément | Raison | Statut |
|---|---|---|
| VITPAY Personal en production | Agrément ou partenaire | ⛔ |
| Portefeuille, soldes, transferts, retraits | Agrément | ⛔ |
| Initiation de virement bancaire | Pas d'accès tiers connu | ⛔ / 🤝 |
| Virement avec référence et rapprochement de relevés | Accès aux relevés à obtenir | 🤝 (candidat phase 7) |
| Applications natives iOS et Android | La PWA suffit pour valider | 🔍 |
| TPE physique, NFC, SoftPOS | Certifications et acquéreur | ⛔ |
| Paiements récurrents | Tokenisation PSP | 🤝 |
| Devises autres que MAD, multi-pays | Office des Changes et PSP | 🔍 |
| Espagnol | Pas de marché au MVP | 🔍 |
| Second PSP | Après la stabilisation du premier | 🟢 (phase 7) |

---

## 13. Budget et coûts prévisionnels

> Ordres de grandeur **indicatifs**, à remplacer par de vrais devis. Aucune de ces valeurs ne doit servir de base de tarification.

| Poste | Estimation | Statut |
|---|---|---|
| Avis juridique (structuration, réglementation BAM, CNDP, contrats PSP) | 60 000 – 250 000 MAD | 🔍 devis |
| Hébergement MVP (PostgreSQL managé avec réplica, 2 ou 3 instances applicatives, Redis, stockage, sauvegardes) | 3 000 – 8 000 MAD/mois | 🔍 dépend du choix entre un hébergeur **marocain** et un hébergement à l'étranger (question CNDP) |
| Outils (Sentry, monitoring, e-mail transactionnel, SMS, gestionnaire de secrets) | 1 500 – 5 000 MAD/mois, SMS à l'usage | 🔍 |
| Fournisseur KYC/KYB (si non délégué au PSP) | À l'usage | 🤝 |
| Test d'intrusion externe avant le pilote | 40 000 – 150 000 MAD | 🔍 devis |
| PCI DSS | Faible si page hébergée par le PSP (périmètre de type SAQ A) ; à confirmer avec le PSP | 🤝 |
| Équipe minimale | Fondateur + 2 développeurs seniors (dont un profil paiements) + un conseiller conformité à temps partiel | 🟢 |
| Agrément EP (modèle C) | Capital minimal réglementaire, contrôle interne, RCCI, LBC/FT : **à chiffrer après l'avis juridique** | 🔍 |
| Usage des agents IA | Variable ; prévoir un budget mensuel plafonné | 🔍 |

---

## 14. Décisions à valider par le fondateur

| # | Décision | Recommandation |
|---|---|---|
| D1 | Modèle opérationnel de départ | **A**, avec négociation B en parallèle ; pas de C avant traction |
| D2 | Mandater un cabinet juridique (droit bancaire marocain + CNDP) | **Oui, immédiatement** ; c'est le chemin critique |
| D3 | Segment cible du pilote | Indépendants et PME avec un contrat PSP accessible ; vendeurs sociaux si le modèle B est obtenu |
| D4 | Report de VITPAY Personal en production | Oui, jusqu'à un partenaire EP |
| D5 | Web d'abord (PWA) au MVP, mobile natif ensuite | Oui |
| D6 | Langues MVP | FR + AR |
| D7 | Devise MVP | MAD uniquement |
| D8 | Hébergement | Attendre l'avis CNDP ; par défaut, hébergeur au Maroc ou région autorisée |
| D9 | PSP à approcher | CMI, NAPS, Payzone et un établissement de paiement (Lana Cash, Cash Plus…) |
| D10 | Modèle de revenus initial | Abonnement SaaS Business, plus des frais à fixer **après** les grilles PSP et l'interchange (0,50 % annoncé) |
| D11 | Modèle Personal = organisation à un membre | Oui (simplifie le code) |
| D12 | Validation humaine des modules finance et sécurité | Désigner **un** responsable technique humain qui signe les revues |

---

## 15. Première liste de tâches techniques

Ces tâches peuvent démarrer **dès maintenant**, sans dépendre des décisions juridiques, car elles sont valables quel que soit le modèle.

| # | Tâche | Agent | Dépend de | Critère de validation |
|---|---|---|---|---|
| T01 | Rédiger les ADR 001 à 008 : monolithe modulaire, PostgreSQL, monnaie en bigint, ledger miroir, machines à états, PWA d'abord, ORM, tenancy et RLS | 01 | — | ADR relus et acceptés |
| T02 | Créer `docs/` : README, ARCHITECTURE, SECURITY, FINANCIAL_CORE, PAYMENT_FLOWS, DECISIONS, AGENTS, ROADMAP | 10 | T01 | Fichiers à jour |
| T03 | Monorepo pnpm et Turborepo, tsconfig strict, eslint (règle de frontières), prettier, commitlint | 09 | T01 | `pnpm build && pnpm lint` passent |
| T04 | docker-compose (PostgreSQL 16, Redis), fichiers `.env.example` sans secret | 09 | T03 | `docker compose up` donne une API saine |
| T05 | CI GitHub Actions : lint, typecheck, tests, scan de dépendances, détection de secrets (gitleaks) | 09 | T03 | Pipeline vert, PR bloquée si échec |
| T06 | Squelette NestJS : configuration validée, logs JSON, gestion problem+json, OpenAPI, health checks | 02 | T03 | Documentation OpenAPI servie |
| T07 | Package `money` : type Money, table des devises, tests de propriétés (fast-check) | 06 | T03 | 100 % de couverture, refus d'opérations entre devises |
| T08 | Migrations ledger : tables, trigger d'équilibre différé, rôles SQL sans UPDATE/DELETE | 06 | T04 | Les tests prouvent le rejet d'une écriture déséquilibrée ou d'une modification |
| T09 | Service ledger : `post(entry)` idempotent, annulation, soldes, tests de concurrence | 06 | T07, T08 | 1 000 écritures concurrentes : soldes exacts, aucun doublon |
| T10 | Module `identity` : inscription, connexion (argon2id), refresh token rotatif, TOTP, limitation de débit | 02 | T06 | Revue sécurité 07, tests de force brute |
| T11 | `tenancy` et `access` : organisations, membres, rôles, guard de permissions, **RLS PostgreSQL par org_id** | 02 | T10 | Test qui prouve qu'une organisation ne peut pas lire une autre organisation, même avec un bug applicatif |
| T12 | Module `audit` : journal *append-only* chaîné par hash, intercepteur automatique | 07 / 02 | T06 | Une altération est détectée par le vérificateur |
| T13 | Machines à états (PaymentRequest, PaymentAttempt, Refund) en fonctions pures et tests exhaustifs | 06 | T07 | Toutes les transitions illégales sont rejetées |
| T14 | `PaymentProvider` et `MockProvider` (succès, échec, 3DS, timeout, webhook dupliqué ou désordonné) | 05 | T13 | Suite de scénarios verte |
| T15 | Inbox des webhooks : stockage brut, vérification, déduplication, traitement BullMQ, rejeu Admin | 05 | T14 | Un webhook rejoué 10 fois produit 1 seul effet |
| T16 | Module `payment-requests` : création idempotente, jeton public, QR, expiration | 02 | T11, T13 | Tests d'intégration |
| T17 | Outbox et notifications (e-mail en développement via Mailpit) | 02 | T16 | Événement livré au moins une fois, consommateur idempotent |
| T18 | Design system `packages/ui` : tokens, composants de base, **RTL**, mode sombre, AA | 03 | T03 | Storybook, audit d'accessibilité |
| T19 | Application `pay` : page publique et page de statut (contre le MockProvider) | 03 | T16, T18 | Test e2e Playwright : du lien au statut confirmé |
| T20 | Grille d'évaluation des PSP et dossier de demande sandbox | 10 / 05 | — | Envoyé à au moins 3 PSP |
| T21 | Questionnaire juridique (§4.5) remis au cabinet | 07 / 10 | D2 | Réponses écrites reçues |
| T22 | Modèle de menaces STRIDE (page publique, webhooks, admin) | 07 | T01 | Document et mesures associées dans le backlog |

---

## Sources consultées (presse et sources publiques — à recouper avec les textes officiels)

- Virement instantané, lancement le 1er juin 2023 : [Médias24](https://medias24.com/2023/05/31/banques-lancement-du-virement-instantane-ce-1er-juin-2023/), [Le360](https://fr.le360.ma/economie/officiel-le-virement-bancaire-instantane-operationnel-a-partir-du-1er-juin_7ZDN3TG35VBH5BPNNV5D5L6K4U/), [Financial Afrik](https://www.financialafrik.com/2023/05/31/maroc-lancement-du-virement-interbancaire-instantane-ce-jeudi-1er-juin/)
- Volumes 2024 : [Hespress](https://fr.hespress.com/451874-virement-instantane-lexplosion-des-transactions-en-2024.html)
- Lana Cash, premier EP à proposer le virement instantané : [AllAfrica](https://fr.allafrica.com/stories/202510300520.html)
- Agréments des établissements de paiement (2018) : [Le Desk](https://ledesk.ma/2018/02/09/bank-al-maghrib-autorise-cinq-etablissements-de-paiement/), [Médias24](https://medias24.com/2018/07/18/etablissements-de-paiement-cinq-nouveaux-operateurs-agrees-2230/)
- Ouverture du marché de l'acquisition : [Hespress](https://fr.hespress.com/480898-paiement-electronique-bam-et-le-conseil-de-la-concurrence-saluent-louverture-du-marche.html), [TelQuel](https://telquel.ma/2025/09/08/electronic-payments-will-the-end-of-the-cmi-monopoly-really-get-the-ball-rolling_1944604)
- CMI multidevise : [FNH](https://fnh.ma/article/actualite-economique/cmi-maroc-paiement-en-ligne-commerce)
- Payzone : [Médias24](https://medias24.com/2014/01/13/payzone-nouveau-concurrent-de-maroc-telecommerce/) ; NAPS : [SNRT News](https://snrtnews.com/fr/article/naps-une-solution-de-paiement-innovante-pour-un-avenir-cashless)
- GeniusPay : [Product Hunt](https://www.producthunt.com/products/geniuspay/alternatives), [xpay — plugin WooCommerce](https://www.xpay.sh/directory/woocommerce/plugins/geniuspay-for-woocommerce/)
- Système financier marocain (nombre d'EP) : [CasaInvest](https://casainvest.ma/sites/default/files/2025-10/Syste%CC%80me%20financier.pdf)
