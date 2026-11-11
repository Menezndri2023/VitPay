#!/usr/bin/env bash
# VITPAY STAGING — sécurisation initiale d'un VPS Ubuntu 24.04 neuf (à lancer UNE fois, en root).
# Usage : ssh root@<ip> 'bash -s' < infra/staging/scripts/bootstrap-server.sh
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
[ -s /root/.ssh/authorized_keys ] || { echo "aucune clé SSH sur root : refus (risque de se fermer l'accès)" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
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
install -m 600 -o vitpay -g vitpay /root/.ssh/authorized_keys /home/vitpay/.ssh/authorized_keys
echo "vitpay ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-vitpay && chmod 440 /etc/sudoers.d/90-vitpay

echo "3/6 SSH : clés uniquement, pas de connexion root"
cat > /etc/ssh/sshd_config.d/90-vitpay.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
sshd -t && systemctl reload ssh

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
# Journaux Docker bornés (pas de croissance illimitée du disque).
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "5" } }
EOF
systemctl restart docker

echo "6/6 Dépôt VITPAY"
if [ ! -d /home/vitpay/VitPay ]; then
  sudo -u vitpay git clone --quiet --branch "$BRANCH" "$REPO" /home/vitpay/VitPay
fi
echo "✓ Serveur prêt. Reconnectez-vous en « vitpay » (ssh vitpay@<ip>) : la connexion root est désormais désactivée."
