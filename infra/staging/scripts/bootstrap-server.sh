#!/usr/bin/env bash
# VITPAY STAGING — sécurisation initiale d'un VPS Ubuntu 24.04 neuf (à lancer UNE fois, en root).
# Usage :
#   Clé sur root (Contabo, Hetzner)        : ssh root@<ip>   'bash -s'      < infra/staging/scripts/bootstrap-server.sh
#   Clé sur un utilisateur sudo (« ubuntu ») : ssh ubuntu@<ip> 'sudo bash -s' < infra/staging/scripts/bootstrap-server.sh
#
# Effets :
#   - utilisateur « vitpay » (sudo, clé SSH reprise de root), connexion root et mots de passe SSH désactivés ;
#   - pare-feu : seuls SSH (22), HTTP (80) et HTTPS (443) entrants ;
#   - mises à jour de sécurité automatiques, fail2ban sur SSH ;
#   - Docker Engine + Compose depuis le dépôt officiel Docker ;
#   - dépôt VITPAY cloné (branche de la PR) dans /home/vitpay/VitPay.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "à lancer en root" >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo "Ubuntu attendu (24.04 LTS)" >&2; exit 1; }
# Clé SSH de départ : celle de l'utilisateur qui lance le script via sudo (ex. « ubuntu »), sinon root.
SRC_HOME="/root"
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then SRC_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"; fi
KEYS="$SRC_HOME/.ssh/authorized_keys"
[ -s "$KEYS" ] || { echo "aucune clé SSH dans $KEYS : refus (risque de se fermer l'accès)" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# Résolveurs DNS fiables en premier : ceux de certains hébergeurs (constaté chez Contabo)
# expirent par intermittence et font échouer apt, git et la construction des images.
install -d /etc/systemd/resolved.conf.d
cat > /etc/systemd/resolved.conf.d/10-vitpay-dns.conf <<'EOF'
[Resolve]
DNS=1.1.1.1 9.9.9.9 2606:4700:4700::1111 2620:fe::fe
EOF
systemctl restart systemd-resolved
REPO="${VITPAY_REPO:-https://github.com/Menezndri2023/VitPay.git}"
BRANCH="${VITPAY_BRANCH:-feat/mvp-model-a}"

echo "1/6 Mises à jour système"
apt-get update -q && apt-get -y -q upgrade
apt-get -y -q install ca-certificates curl git ufw fail2ban unattended-upgrades openssl
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "2/6 Utilisateur d'exploitation « vitpay »"
id vitpay >/dev/null 2>&1 || adduser --disabled-password --gecos "VITPAY staging" vitpay
usermod -aG sudo vitpay
install -d -m 700 -o vitpay -g vitpay /home/vitpay/.ssh
install -m 600 -o vitpay -g vitpay "$KEYS" /home/vitpay/.ssh/authorized_keys
echo "vitpay ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-vitpay && chmod 440 /etc/sudoers.d/90-vitpay

echo "3/6 SSH : clés uniquement, pas de connexion root"
# sshd retient la PREMIÈRE valeur lue : le fichier doit précéder ceux de l'image
# (ex. 50-cloud-init.conf « PasswordAuthentication yes », fréquent chez Contabo).
rm -f /etc/ssh/sshd_config.d/90-vitpay.conf
cat > /etc/ssh/sshd_config.d/01-vitpay.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
sshd -t
# Contrôle de la configuration effective, et pas seulement du fichier écrit.
EFFECTIVE="$(sshd -T)"
for want in "permitrootlogin no" "passwordauthentication no" "kbdinteractiveauthentication no"; do
  grep -qx "$want" <<<"$EFFECTIVE" || { echo "SSH : « $want » non appliqué (configuration effective)" >&2; exit 1; }
done
systemctl reload ssh

echo "4/6 Pare-feu"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
systemctl enable --now fail2ban

echo "5/6 Docker (dépôt officiel)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q && apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
usermod -aG docker vitpay
# Journaux Docker bornés (pas de croissance illimitée du disque) ; DNS explicite pour les
# conteneurs et la construction des images (indépendant des résolveurs de l'hébergeur).
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" }, "dns": ["1.1.1.1", "9.9.9.9"] }
EOF
systemctl restart docker

echo "6/6 Dépôt VITPAY"
if [ ! -d /home/vitpay/VitPay ]; then
  sudo -u vitpay git clone --quiet --branch "$BRANCH" "$REPO" /home/vitpay/VitPay
fi
echo "✓ Serveur prêt. Reconnectez-vous en « vitpay » (ssh vitpay@<ip>) : la connexion root est désormais désactivée."
