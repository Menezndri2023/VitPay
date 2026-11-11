# VITPAY — Sécurité

## Contrôles en place (et testés)

| Domaine | Contrôle | Test |
|---|---|---|
| Mots de passe | argon2id (m = 19 MiB, t = 2), 12 caractères minimum, liste noire, temps constant si l'utilisateur est inconnu | `security.test.ts` |
| Force brute | Verrouillage 15 min après 5 échecs ; limitation de débit par route (`@nestjs/throttler`) | `security.test.ts` |
| Récupération de compte | Mot de passe oublié : réponse identique (pas d'énumération), jeton de 256 bits haché, 30 min, usage unique ; toutes les sessions révoquées ; comptes admin exclus (réinitialisation par un Super Admin) | `accounts.test.ts`, e2e |
| E-mails | File asynchrone avec reprise ; corps (liens à jeton) **purgé après envoi** ; adresses masquées dans les journaux | `accounts.test.ts` |
| Justificatifs KYB | Chiffrés AES-256-GCM au repos + empreinte SHA-256 vérifiée à la lecture ; type réel détecté par signature (PDF/PNG/JPEG), taille ≤ 5 Mo, nom de fichier assaini ; non modifiables par le commerçant ; consultation conformité **journalisée** | `admin.test.ts`, e2e |
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

## À faire avant la production

1. **Test d'intrusion externe** et revue OWASP ASVS niveau 2.
2. Rotation des clés : versionner `APP_ENCRYPTION_KEY` (préfixe `v1.` déjà en place), procédure de re-chiffrement.
3. ☑ Rôle PostgreSQL distinct `vitpay_system` (BYPASSRLS) pour les chemins système ; plus de variable de contournement ; moindre privilège du rôle applicatif (aucun accès aux sessions, webhooks, idempotence, approbations, prestataire simulé ; pas de modification des utilisateurs) — migration 007, testé.
4. Limitation de débit distribuée (stockage partagé) dès qu'il y a plusieurs instances ; plafonner les webhooks rejetés stockés.
4b. ☑ Outbox : chaque événement est verrouillé et validé dans sa propre transaction.
5. Signalement d'abus sur la page publique (anti-hameçonnage) et domaine `pay.` dédié.
6. WAF et protection DDoS (fournisseur à choisir).
7. Monitoring et alerting des incidents critiques (Sentry, astreinte).
8. En production, le rôle propriétaire de la base ne doit **pas** être superutilisateur. Le compose local l'est par commodité.
9. Politique de sauvegarde chiffrée et test de restauration trimestriel.

## Signaler une vulnérabilité

Contact sécurité de VIT GLOBAL TECHNOLOGIES GROUP (adresse à définir). Ne jamais publier de vulnérabilité dans un ticket public.
