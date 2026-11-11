# VITPAY — Sécurité

## Contrôles en place (et testés)

| Domaine | Contrôle | Test |
|---|---|---|
| Mots de passe | argon2id (m = 19 MiB, t = 2), 12 caractères minimum, liste noire, temps constant si l'utilisateur est inconnu | `security.test.ts` |
| Force brute | Verrouillage 15 min après 5 échecs ; limitation de débit par route (`@nestjs/throttler`) | `security.test.ts` |
| Récupération de compte | Mot de passe oublié : réponse identique (pas d'énumération), jeton de 256 bits haché, 30 min, usage unique ; toutes les sessions révoquées ; comptes admin exclus (réinitialisation par un Super Admin) | `accounts.test.ts`, e2e |
| E-mails | File asynchrone avec reprise ; corps (liens à jeton) **purgé après envoi** ; adresses masquées dans les journaux | `accounts.test.ts` |
| Justificatifs KYB | Chiffrés AES-256-GCM au repos + empreinte SHA-256 vérifiée à la lecture ; type réel détecté par signature (PDF/PNG/JPEG), taille ≤ 5 Mo, nom de fichier assaini ; non modifiables par le commerçant ; consultation conformité **journalisée** | `admin.test.ts`, e2e |
| Clés API | Clé 256 bits affichée une fois, **seule l'empreinte stockée** ; périmètres limités, organisation unique, jamais d'accès admin ni gestion des clés ; révocation immédiate ; actions journalisées `api_key` | `developers.test.ts`, e2e |
| Webhooks sortants (SSRF) | HTTPS obligatoire en production ; adresses privées, loopback, link-local, métadonnées cloud refusées **à la connexion** (anti DNS rebinding) ; pas de redirection suivie ; délai 10 s ; signature HMAC + horodatage | `developers.test.ts` |
| Vérification e-mail | Lien à jeton haché (48 h, usage unique, dernier envoi seul valide, 3 envois/h) ; tant qu'elle manque : connexion d'un prestataire, équipe, intégrations, dossier KYB et remboursements refusés (`email_not_verified`) ; les liens de réinitialisation et d'invitation valent aussi vérification | `accounts.test.ts` |
| Rotation secret webhook | Nouveau secret affiché une fois ; ancien accepté pendant un recouvrement (0 à 168 h, double `v1`) ; rotation d'urgence immédiate ; journalisée | `developers.test.ts` |
| Invitations | Jeton à usage unique (7 j), acceptation réservée à l'e-mail invité ; redirections `next` limitées aux chemins internes | `accounts.test.ts` |
| Sessions | Jeton opaque de 256 bits, **seul le hash SHA-256 est stocké**, expiration 12 h (Business) / 4 h (Admin), révocation à la déconnexion | |
| MFA | TOTP ; **obligatoire pour l'admin** (enrôlement forcé), secret chiffré AES-256-GCM | `admin.test.ts` |
| Audiences | Cookies et sessions distincts Business / Admin : une session Business ne donne jamais accès à l'admin | `admin.test.ts` |
| CSRF | Cookies `SameSite=Strict` + en-tête `x-vitpay-csrf` obligatoire + liste blanche `Origin` | `security.test.ts` |
| Autorisation | Garde unique, refus par défaut : permissions d'organisation (owner/admin/cashier/viewer) et de plateforme (7 rôles) | `security.test.ts`, `admin.test.ts` |
| Isolation | RLS PostgreSQL + 404 sur les ressources d'une autre organisation | `security.test.ts`, `ledger.test.ts` |
| Quatre yeux | Frais et réactivation : initiateur ≠ approbateur, contrainte **aussi en base** (`CHECK`) | `admin.test.ts` |
| Données personnelles | Masquage en admin selon le rôle (`orgs:read_pii`) ; page publique sans e-mail, téléphone, identité légale ni identifiants internes | `payment-flow.test.ts` |
| Secrets prestataires | Chiffrés AES-256-GCM, jamais journalisés ni renvoyés par l'API | `security.test.ts` |
| Webhooks | HMAC, tolérance de 5 min (anti-rejeu), secret par compte marchand, déduplication, relecture serveur | `security.test.ts`, `payment-flow.test.ts` |
| Audit | Journal append-only, **chaîné par SHA-256**, vérifiable depuis l'admin ; une altération est détectée | `security.test.ts` |
| Injections | Requêtes SQL paramétrées uniquement ; Zod sur toutes les entrées ; échappement HTML (page du prestataire simulé) ; export CSV protégé contre l'injection de formules | `payment-flow.test.ts` |
| En-têtes | Helmet (CSP `default-src 'none'` côté API), `X-Frame-Options: DENY` et `Referrer-Policy: no-referrer` côté apps | |
| SSRF | Aucun appel sortant vers une URL fournie par l'utilisateur ; les URLs des prestataires viennent de la configuration | |
| Garde-fou légal | Mode live impossible sans `PAYMENTS_LIVE_ENABLED` + `LEGAL_SIGNOFF_REF` ; prestataire simulé interdit en production | `security.test.ts` |

## Revue indépendante (10/11/2026) — défauts corrigés

Revue des modules finance et sécurité par un agent distinct, sans accès au contexte de conception. Les 9 défauts relevés ont été corrigés et sont couverts par des tests (migration `006_review_hardening.sql`).

| # | Défaut | Correction |
|---|---|---|
| R1 | Tentative expirée localement puis payée chez le prestataire : paiement non comptabilisé, double paiement possible | Plus d'expiration locale ; le succès tardif est **comptabilisé** et un incident est ouvert |
| R2 | Verrouillage contournable par requêtes concurrentes | Incrément atomique `failed_login_count + 1` |
| R3 | Force brute et rejeu des codes TOTP | Anti-rejeu (dernier pas mémorisé) ; session révoquée après 5 échecs |
| R4 | Enrôlement MFA admin possible avec le seul mot de passe | **Jeton d'invitation à usage unique** (72 h) remis hors bande |
| R5 | Remboursement possible après un litige perdu | Montant remboursable = payé − remboursements − litiges perdus ; plafond sur les litiges |
| R6 | Trigger ledger contournable sous RLS (compte d'une autre organisation) | `SECURITY DEFINER` + `NOT FOUND` + `IS DISTINCT FROM` |
| R7 | Données KYB visibles dans l'audit par l'auditeur | Audit KYB sans valeurs ; masquage avant/après sans `orgs:read_pii` |
| R8 | Webhook de remboursement non rattaché au compte prestataire | Jointure sur `provider_account_id`, validation de l'UUID |
| R9 | Montant net du règlement non contrôlé | `net = brut − frais`, sinon écart |

Durcissements associés : unicités scopées (référence prestataire par compte, clé comptable par organisation) ; appels au prestataire depuis la page publique limités par `last_synced_at` ; libération des clés d'idempotence bloquées ; approbations « quatre yeux » liées à la valeur courante ; autres sessions révoquées à l'activation de la MFA ; verrouillage révélé seulement après vérification du mot de passe.

## Seconde revue indépendante (10/11/2026) — défauts corrigés

Elle porte sur les ajouts depuis la première revue. Les 9 défauts relevés sont corrigés et couverts par des tests (migration `012_review2_hardening.sql`).

| # | Défaut | Correction |
|---|---|---|
| R2-1 | **SSRF** via adresses IPv6 « déguisées » (`[::ffff:127.0.0.1]` est réécrit en `[::ffff:7f00:1]`), NAT64, 6to4 ; le contrôle DNS est ignoré pour une IP littérale | `net.BlockList` (formes normalisées), plages IPv6 encapsulantes refusées, revérification à chaque envoi, erreurs réduites à une catégorie |
| R2-2 | Clé API encore valide après le retrait de son créateur | Clé valide seulement si le créateur est toujours owner/admin ; révocation au retrait du membre |
| R2-3 | Redirection ouverte après connexion (`next=/%09/evil.com`) | Résolution par `URL` et comparaison d'origine (test navigateur) |
| R2-4 | Notifications et e-mails en double si un consommateur outbox échoue | Index unique (organisation, événement) + `ON CONFLICT DO NOTHING` |
| R2-5 | Un endpoint lent bloque les webhooks de tous les commerçants | Un envoi par endpoint et par lot, parallélisme borné, bail sans verrou pendant l'appel HTTP, délai 5 s, désactivation automatique après 50 échecs, test limité à 5/min |
| R2-6 | Limitation de débit devenue globale derrière le proxy Next en conteneurs | `TRUST_PROXY` configurable (`uniquelocal` en conteneurs) ; plafond par compte pour le mot de passe oublié |
| R2-7 | Une invitation expirée bloquait toute nouvelle invitation | Révocation automatique des invitations expirées |
| R2-8 | Hameçonnage par e-mail d'invitation (nom d'organisation libre) | Liens et domaines retirés, longueur bornée, 20 invitations par jour et par organisation |
| R2-9 | Rôle système autorisé à DELETE sur les tables financières | DELETE retiré partout sauf `idempotency_keys` (et le prestataire simulé) |

Durcissements associés :

- Le rôle applicatif ne lit plus `password_hash` ni les secrets MFA (droits par colonne).
- La facturation se fait par organisation, chacune dans sa propre transaction.
- Justificatifs KYB : limite de 30 par organisation, en-tête `filename*` correct, pas de seconde revue d'un document déjà décidé.
- Le mot de passe oublié est traité en arrière-plan, pour un temps de réponse constant.
- Les jetons de 20 caractères et plus sont masqués dans les journaux.
- La date de dernière utilisation d'une clé API n'est mise à jour qu'une fois par minute.

Points ouverts : rotation de la clé de chiffrement `APP_ENCRYPTION_KEY` (rechiffrement des secrets) ; pré-enregistrement d'une adresse : le compte non vérifié est libéré après 7 jours (ADR-012), ou plus tôt par « mot de passe oublié » si la victime le souhaite.

## Troisième revue indépendante (11/11/2026) — vérification e-mail et rotation des secrets

| # | Défaut | Correction |
|---|---|---|
| R3-1 | **Élevé** — un compte Business créé par un tiers (mot de passe et MFA choisis par lui) pouvait être promu administrateur par le CLI s'il portait l'adresse visée | Le CLI refuse toute promotion d'un compte non administrateur ; adresse dédiée obligatoire (`admin.test.ts`) |
| R3-2 | Un vérificateur de signature ne lisant qu'une valeur `v1` échoue pendant une rotation | Avertissement dans l'interface avant rotation + note de changement dans `DEVELOPERS.md` |
| R3-3 | Un compte non vérifié pouvait lier une MFA et verrouiller le vrai titulaire de l'adresse | MFA refusée tant que l'adresse n'est pas confirmée ; MFA retirée lors d'une réinitialisation d'un compte jamais vérifié |
| R3-4 | Accepter une invitation connecté ne valait pas vérification | L'acceptation marque l'adresse vérifiée (`accounts.test.ts`) |
| R3-5 | Anciens secrets de webhook expirés conservés | Effacés par le worker après expiration et à la désactivation |
| R3-6 | Page de confirmation validée à l'ouverture (analyseurs de liens des messageries) | Confirmation par clic explicite (e2e) |
| R3-7 | Deux rotations simultanées : le premier secret remis devenait « ancien » | Seconde rotation refusée (409) pendant 10 s |
| R3-8 | Le rôle applicatif pouvait insérer un jeton de vérification pour n'importe quel compte | Jeton créé par le rôle système après l'inscription ; droit retiré (migration 014) |

## Quatrième revue indépendante (11/11/2026) — commission, KYB d'équipe, libération des comptes

| # | Défaut | Correction |
|---|---|---|
| R4-C1 | **Élevé** — annuler un relevé dont la commission avait déjà donné lieu à un avoir créditait deux fois le commerçant | Facturation par écart (dû − déjà facturé) : l'émission suivante rétablit le dû (`admin.test.ts`) |
| R4-C2 | **Élevé** — un paiement reporté (remboursement en cours, litige ouvert) n'était jamais facturé après résolution | Rattrapage : tout paiement confirmé avant la fin de période et au montant définitif est régularisé |
| R4-C3 | Ajout direct d'un membre sans KYB en mode réel | Même contrôle que les invitations ; ni compte non vérifié, ni compte désactivé |
| R4-C4 | Invitation émise avant le passage en réel acceptée sans KYB | Contrôle revérifié à l'acceptation, avant toute création de compte |
| R4-C5 | Données personnelles restantes après libération (e-mails sortants, nom d'organisation, IP de session, empreinte réversible par dictionnaire) | Expurgées ; empreinte HMAC à clé serveur |
| R4-P1 | Double avoir possible lors de deux émissions simultanées | Verrou consultatif par organisation, devise et mode |
| R4-P2 | Vérification d'un compte libéré ; ajout d'un compte non vérifié à une organisation pour empêcher sa libération | Refusés |

Résiduel connu : le journal d'audit (immuable) conserve le nom d'organisation saisi à l'inscription d'un compte libéré — à couvrir par la durée de conservation de l'audit (COMPLIANCE C3).

## Cinquième revue indépendante (11/11/2026) — rotation de clé et avoirs reportés

| # | Défaut | Correction |
|---|---|---|
| R5-1 | Le décodeur base64 tolérant faisait disparaître silencieusement une ancienne clé mal séparée (espace, point-virgule…) | Validation stricte (base64 canonique), doublons et éléments vides refusés (`key-rotation.test.ts`) |
| R5-2 | Rechiffrement des justificatifs KYB par lots de 200 (jusqu'à 1 Go en mémoire) | Lots de 2 pour les contenus binaires |
| R5-3 | Une valeur illisible bloquait toute la rotation | Parcours par identifiant, échec isolé et compté, code de sortie non nul |
| R5-4 | Pas d'audit en cas de rotation interrompue | Une entrée d'audit par colonne traitée |
| R5-5 | Report d'avoir invisible pour la finance | `deferred` dans la réponse d'émission |
| R5-6 | Avoir affiché brut (non net des commissions à facturer) | Position nette ; filtre explicite par organisation |
| R5-7 | Anciens relevés négatifs bloqués | Annulés (migration 017) : l'avoir redevient en attente |
| R5-8 | Déploiement progressif / retour arrière pendant une rotation | Procédure en deux phases ci-dessous |
| R5-10 | Empreinte d'adresse calculée avec la clé de chiffrement | Clé dérivée dédiée (HKDF) |

Restant (R5-9, défense en profondeur) : lier chaque chiffré à son contexte (table, colonne, ligne) par données associées GCM, pour empêcher la permutation de chiffrés par un attaquant ayant un accès en écriture à la base.

## Sixième revue indépendante (11/11/2026) — limitation de débit partagée

| # | Défaut | Correction |
|---|---|---|
| R6-1 | **Élevé** — en conteneurs, IP client falsifiable (`X-Forwarded-For` relayé tel quel par Next, `TRUST_PROXY=uniquelocal`) : limite contournable, ou compteur unique pour tous | Proxy `edge` qui écrase l'en-tête, adresses approuvées explicites, ports internes non publiés ; test d'en-tête forgé |
| R6-2 | Une écriture en base par requête sur le pool métier, sans délai | Pool dédié (4 connexions, délais 1 s / 250 ms), cache des clés bloquées, politique explicite en cas d'erreur |
| R6-3 | Croissance de la table (clés pulvérisées, IPv6 /64) | Purge par lots chaque minute, IPv6 /56 |
| R6-5 | Durée de blocage nulle ou inférieure à la fenêtre | Refus au-delà de la limite ; compteur remis à zéro en fin de blocage |
| R6-6 | Rôle applicatif en lecture/écriture sur les compteurs (IP des clients) | Accès révoqué, fonction `SECURITY DEFINER` aux arguments bornés, clés HMAC |
| R6-7 | Méthode `Db.autocommit` contournant les transactions | Supprimée |

## À faire avant la production

1. **Test d'intrusion externe** et revue OWASP ASVS niveau 2.
2. ☑ Rotation de la clé de chiffrement (`key-rotation.test.ts`). Chaque valeur porte l'identifiant de sa clé (`v2.<kid>.…`) ; l'ancien format reste lisible. Procédure en **deux phases** (compatible avec un déploiement progressif : aucune instance ne reçoit une valeur qu'elle ne sait pas lire) :
   1. Générer la nouvelle clé (`openssl rand -base64 32`) dans le coffre de secrets. Format strict vérifié au démarrage (base64 canonique, ni doublon ni élément vide).
   2. **Phase 1** — déployer partout `APP_ENCRYPTION_KEY=<ancienne>` et `APP_ENCRYPTION_KEYS_PREVIOUS=<nouvelle>` : toutes les instances savent lire la nouvelle clé, aucune ne l'utilise encore.
   3. **Phase 2** — une fois la phase 1 entièrement déployée : `APP_ENCRYPTION_KEY=<nouvelle>`, `APP_ENCRYPTION_KEYS_PREVIOUS=<ancienne>`.
   4. Lancer `pnpm --filter @vitpay/api keys:reencrypt` : par lots, reprenable, une ligne en échec n'arrête pas les autres (table/colonne/identifiant journalisés, jamais la valeur), audit par colonne. Code de sortie 0 = tout est rechiffré.
   5. Vérifier `keys:reencrypt --status`, puis retirer l'ancienne clé, redéployer. Conserver l'ancienne clé dans le coffre aussi longtemps que les sauvegardes qu'elle protège.
   Retour arrière : la version actuelle lit les deux formats ; ne pas revenir à une version antérieure au 11/11/2026 (format v1 seul) après écriture de valeurs v2.
   Un test vérifie que toute nouvelle colonne `*_enc` est couverte par la rotation.
3. ☑ Rôle PostgreSQL distinct `vitpay_system` (BYPASSRLS) pour les chemins système ; plus de variable de contournement ; moindre privilège du rôle applicatif (aucun accès aux sessions, webhooks, idempotence, approbations, prestataire simulé ; pas de modification des utilisateurs) — migration 007, testé.
4. ☑ Limitation de débit partagée entre instances (`rate-limit.test.ts`) : fonction PostgreSQL atomique (le rôle applicatif n'a pas accès à la table), pool dédié borné avec délais courts, clés HMAC, cache local des clés bloquées, purge par lots, regroupement IPv6 /56. Fenêtre fixe (jusqu'à 2× la limite à la jonction de deux fenêtres) ; si la base ne répond pas, la requête passe (métrique `vitpay_rate_limit_errors_total`) — le verrouillage de compte reste en base. ☐ Plafonner les webhooks rejetés stockés. À forte charge : stockage mémoire partagé (ADR-007).
4c. **IP client** : l'API ne doit approuver (`TRUST_PROXY`) que des relais qui **écrasent** `X-Forwarded-For` ou le relaient d'un tel relais. Sandbox : proxy `edge` (nginx) seul point d'entrée, adresses fixes approuvées, API et apps sans port publié. Production : idem avec le répartiteur de charge de l'hébergeur (jamais `uniquelocal` ni une plage incluant la passerelle).
4b. ☑ Outbox : chaque événement est verrouillé et validé dans sa propre transaction.
5. Signalement d'abus sur la page publique (anti-hameçonnage) et domaine `pay.` dédié.
6. WAF et protection DDoS (fournisseur à choisir).
7. Monitoring et alerting des incidents critiques (Sentry, astreinte).
8. En production, le rôle propriétaire de la base ne doit **pas** être superutilisateur. Le compose local l'est par commodité.
9. Politique de sauvegarde chiffrée et test de restauration trimestriel.

## Signaler une vulnérabilité

Contact sécurité de VIT GLOBAL TECHNOLOGIES GROUP (adresse à définir). Ne jamais publier de vulnérabilité dans un ticket public.
