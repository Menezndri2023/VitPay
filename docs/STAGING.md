# VITPAY STAGING — installation, exploitation, redéploiement

> **Environnement de TEST accessible publiquement.** Paiements simulés uniquement (prestataire simulé), données fictives uniquement, aucun e-mail réel envoyé. Le mode réel est refusé par la configuration (`APP_ENV=staging`) : il ne peut pas être activé, même par erreur.

## 1. Architecture

```
Internet ──443──▶ Caddy (HTTPS automatique, X-Forwarded-For écrasé, admin sous authentification HTTP)
                   ├─ pay.<ip>.sslip.io    → pay (Next)
                   ├─ app.<ip>.sslip.io    → business (Next)
                   ├─ admin.<ip>.sslip.io  → admin (Next)  [authentification HTTP + connexion VITPAY avec MFA]
                   └─ api.<ip>.sslip.io    → api (NestJS)  [page de paiement simulée, webhooks]
Réseau interne (sans Internet) : postgres · mailpit (capture SMTP) · worker · migrate
```

| Service | Exposition | Rôle |
|---|---|---|
| caddy | 80, 443 publics | Seul point d'entrée. Certificats Let's Encrypt (repli automatique ZeroSSL). |
| pay, business, admin | aucune | Applications web. Bandeau « VITPAY STAGING » sur toutes les pages. |
| api | aucune | API, page du prestataire simulé. |
| worker | aucune | Tâches de fond. Accès sortant pour les webhooks vers les URL de test des commerçants. |
| postgres | **aucune** | Base de test. Rôles distincts, mots de passe aléatoires. |
| mailpit | `127.0.0.1:8025` seulement | Capture de tous les e-mails. Aucun relais sortant. |

Domaine temporaire : `<ip-avec-tirets>.sslip.io` (service DNS public qui résout `203-0-113-10.sslip.io` vers `203.0.113.10`). Aucun achat de domaine.

## 2. Serveur recommandé

| | Minimum | Recommandé |
|---|---|---|
| CPU | 2 vCPU | **4 vCPU** (construction des images Next sur le serveur) |
| Mémoire | 4 Go (images construites ailleurs) | **8 Go** |
| Disque | 40 Go SSD | **75–80 Go NVMe** (images, sauvegardes, journaux) |
| Système | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |
| Réseau | IPv4 publique | IPv4 publique, région Europe de l'Ouest (latence vers le Maroc) |

Charge mesurée de la pile au repos : environ 1,5 à 2 Go de mémoire pour les 7 services. La construction d'une image Next consomme environ 1,5 Go de plus pendant quelques minutes.

## 3. Mise en place (une fois)

Sur le serveur, en tant qu'utilisateur non root disposant de `sudo` :

```bash
# Système et pare-feu : seuls SSH, HTTP et HTTPS sont ouverts.
sudo apt update && sudo apt -y upgrade && sudo apt -y install ufw unattended-upgrades git
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable
# SSH : clés uniquement (désactiver l'authentification par mot de passe dans /etc/ssh/sshd_config).
# Docker (dépôt officiel) : https://docs.docker.com/engine/install/ubuntu/
git clone https://github.com/Menezndri2023/VitPay.git && cd VitPay/infra/staging
scripts/generate-env.sh <IP_PUBLIQUE>      # secrets aléatoires propres au staging (.env, droits 600)
scripts/deploy.sh                          # sauvegarde, construction, migration, démarrage, vérifications
docker compose run --rm seed               # comptes de démonstration : identifiants aléatoires affichés UNE fois
```

Docker publie ses ports en contournant `ufw` : c'est pourquoi **seul Caddy publie des ports** (80, 443) et Mailpit uniquement sur `127.0.0.1`.

## 4. Variables d'environnement (`infra/staging/.env`)

| Variable | Contenu |
|---|---|
| `STAGING_DOMAIN_SUFFIX` | `<ip-avec-tirets>.sslip.io` |
| `STAGING_URL_PORT` | vide (443) ; `:18443` pour la répétition locale |
| `PG_SUPERUSER_PASSWORD` | superutilisateur d'initialisation (création des rôles uniquement) |
| `PG_OWNER_PASSWORD` / `PG_APP_PASSWORD` / `PG_SYSTEM_PASSWORD` | rôles `vitpay_owner` (migrations), `vitpay_app` (RLS), `vitpay_system` (BYPASSRLS) |
| `APP_ENCRYPTION_KEY` / `APP_ENCRYPTION_KEYS_PREVIOUS` | clé AES-256 (rotation : docs/SECURITY.md) |
| `METRICS_TOKEN` | accès à `/health/metrics` |
| `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_HASH` | authentification HTTP devant la console admin (bcrypt) |
| `CADDY_GLOBAL_EXTRA` | vide ; `local_certs` pour la répétition locale |

Fixées dans `docker-compose.yml` (non modifiables par `.env`) : `APP_ENV=staging`, `PAYMENTS_LIVE_ENABLED=false`, `MOCK_PSP_ENABLED=true`, `COOKIE_SECURE=true`, `SMTP_URL=smtp://mailpit:1025`, `TRUST_PROXY` (adresses fixes de Caddy et des apps). La configuration de l'API **refuse de démarrer** en staging si l'une de ces protections est contournée.

## 5. Exploitation

| Besoin | Commande (dans `infra/staging`) |
|---|---|
| État des services | `docker compose ps` |
| Journaux (JSON, expurgés) | `docker compose logs -f api worker` |
| Vérifications de sécurité | `scripts/verify.sh` |
| Sauvegarde manuelle | `scripts/backup.sh` (vérifiée, 14 conservées dans `backups/`) |
| Sauvegarde quotidienne | `crontab -e` → `30 2 * * * cd ~/VitPay/infra/staging && scripts/backup.sh >> backups/cron.log 2>&1` |
| E-mails capturés (Mailpit) | depuis votre poste : `ssh -L 8025:127.0.0.1:8025 <user>@<ip>` puis http://localhost:8025 |
| Redéploiement | `scripts/deploy.sh [git-ref]` (sauvegarde automatique avant toute modification) |
| Retour à une version | `scripts/deploy.sh <commit-précédent>` (les migrations ne sont jamais annulées : restaurer la sauvegarde si besoin) |
| Restauration | `docker compose stop api worker && docker compose exec -T postgres pg_restore -U postgres -d vitpay --clean --if-exists < backups/<fichier>.dump && docker compose start api worker` |
| Arrêt complet | `docker compose down` (données conservées) ; `docker compose down -v` **efface** la base |

## 6. Ce que les vérifications automatiques contrôlent (`scripts/verify.sh`)

HTTPS et certificat valide · environnement `staging` · paiements réels verrouillés · console admin derrière authentification HTTP (401) · bandeau STAGING · HSTS · cookies `Secure`/`HttpOnly`/`SameSite=Strict` · outils bruts du prestataire simulé non exposés · métriques protégées · limitation de débit effective malgré un `X-Forwarded-For` forgé · PostgreSQL et Mailpit fermés côté public.

## 7. Répétition générale locale

Avant toute commande de serveur, la même pile se lance sur un poste avec les certificats de l'autorité locale de Caddy :

```bash
cd infra/staging
scripts/generate-env.sh 127.0.0.1
sed -i '' 's/^STAGING_URL_PORT=$/STAGING_URL_PORT=:18443/; s/^CADDY_GLOBAL_EXTRA=$/CADDY_GLOBAL_EXTRA=local_certs/' .env
docker compose -f docker-compose.yml -f docker-compose.rehearsal.yml up -d --build
VERIFY_CURL_OPTS=-k scripts/verify.sh
```
