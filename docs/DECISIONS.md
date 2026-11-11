# VITPAY — Journal des décisions (ADR)

Chaque décision importante est consignée ici. **Aucune ne doit être modifiée silencieusement** : une révision donne lieu à un nouvel ADR qui remplace l'ancien.

---

## ADR-000 — Modèle opérationnel A (prestataire technique)
- **Date** : 10/11/2026 — **Statut** : ✅ Validé par le fondateur
- **Problème** : encaisser pour autrui est un service de paiement réglementé (loi 103-12).
- **Options** : A (technique, les fonds passent par le prestataire du commerçant) ; B (établissement partenaire) ; C (agrément propre).
- **Décision** : A. Les points juridiques seront formalisés **avant** toute activation live ([`COMPLIANCE.md`](COMPLIANCE.md)).
- **+** Démarrage rapide, risque réglementaire minimal, aucun fonds détenu.
- **−** Onboarding commerçant plus lent (contrat prestataire par commerçant) ; Personal impossible en production.
- **Conséquences** : le ledger est un ledger miroir ; la commission est facturée hors flux ; le garde-fou live est codé.

## ADR-001 — Monolithe modulaire NestJS
- **Statut** : ✅ — Pas de microservices au MVP (règle 13). Modules par dossiers, accès inter-modules via les services. Le même binaire sert d'API et de worker.

## ADR-002 — PostgreSQL comme unique source de vérité
- **Statut** : ✅ — Ledger, audit, outbox, inbox et file de tâches dans PostgreSQL. **−** Charge sur une seule base : surveiller et séparer les workers si nécessaire.

## ADR-003 — Montants en `bigint` d'unité mineure
- **Statut** : ✅ — Type `Money` (paquet `@vitpay/money`) ; aucune arithmétique sur `number`. L'API transporte des chaînes. Les exposants viennent de la table `currencies` (XOF/XAF = 0).

## ADR-004 — Abstraction des prestataires (`PaymentProvider`)
- **Statut** : ✅ — Adaptateur par prestataire ; état relu chez le prestataire (`getPayment`) après tout webhook. Capacités déclarées **uniquement si vérifiées**. Un prestataire simulé permet de développer sans contrat signé.

## ADR-005 — Machines à états séparées par objet
- **Statut** : 🟢 Recommandé et appliqué — La liste unique de statuts du cahier des charges est éclatée en demande, tentative, remboursement, litige, règlement et reversement. Les statuts d'affichage sont dérivés.

## ADR-006 — Sessions opaques plutôt que JWT
- **Statut** : 🟢 — Révocation immédiate, aucune donnée dans le jeton, seul le hash est stocké. **−** Une lecture en base par requête (acceptable au MVP).

## ADR-007 — File de tâches PostgreSQL (SKIP LOCKED) plutôt que Redis/BullMQ
- **Statut** : 🟢 — Moins de composants au MVP ; l'outbox est transactionnelle par construction. **Réversible** : BullMQ/Redis si les volumes l'exigent (nouvel ADR).

> Complément (11/11/2026) : les compteurs de limitation de débit utilisent aussi PostgreSQL (table `UNLOGGED rate_limits`), partagés par toutes les instances. Seuil de bascule vers Redis : quand la latence ajoutée par requête devient mesurable en production.

## ADR-008 — Isolation multi-tenant par RLS PostgreSQL
- **Statut** : ✅ — Défense en profondeur : même une requête applicative non filtrée ne voit que l'organisation courante. Le bypass est explicite (`Db.system`) et limité.

## ADR-009 — Web d'abord (PWA), trois apps Next.js, mobile natif ensuite
- **Statut** : 🟢 — `pay` (public), `business` et `admin` (isolé, domaine séparé). React Native après validation terrain.

## ADR-010 — Particulier = organisation `personal` à un membre
- **Statut** : 🟢 — Un seul modèle de données ; passage naturel de Personal à Business.

## ADR-011 — Ports locaux dédiés
- **Statut** : ✅ — API 4710, Pay 3710, Business 3711, Admin 3712, PostgreSQL 5433, tests 4555, pour éviter les conflits avec d'autres projets du poste.

## ADR-012 — Décisions produit du 11/11/2026
- **Statut** : ✅ Validée (porteur du projet) et appliquée.
- **Commission** : uniquement sur les transactions réussies ; aucune sur un remboursement ni sur la part remboursée ou perdue en litige (au prorata — une annulation totale sur un remboursement partiel ouvrirait un contournement par remboursement symbolique) ; avoir reporté sur le relevé suivant si déjà facturée, jamais de relevé négatif. À revoir si des frais de service sont possibles juridiquement et commercialement (voir FINANCIAL_CORE).
- **KYB avant l'équipe** : en mode réel (`PAYMENTS_LIVE_ENABLED=true`), une organisation ne peut inviter de collaborateurs qu'avec un KYB vérifié (`kyb_required`). En sandbox, les invitations restent libres.
- **Comptes non vérifiés** : libérés après 7 jours (adresse et nom effacés, empreinte de l'adresse conservée dans l'audit, organisation fermée). Jamais si le compte a la moindre activité de paiement ou partage une organisation.
