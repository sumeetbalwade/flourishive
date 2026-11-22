#!/usr/bin/env bash
# Step 1 of the VPS setup: run ONCE as root on a fresh Ubuntu 24.04 server.
#   - patches the OS, sets the clock to India time, adds a small swap file
#   - creates the `deploy` user (key login only) with sudo
#   - turns off root and password logins over SSH
#   - firewall: only SSH (22), HTTP (80) and HTTPS (443) are open
#   - fail2ban bans repeated bad SSH logins; security updates install themselves
# Usage:  DEPLOY_PUBKEY='ssh-ed25519 AAAA... comment' bash 01-harden.sh
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
[ -n "${DEPLOY_PUBKEY:-}" ] || { echo "Set DEPLOY_PUBKEY to the public key line"; exit 1; }
case "$DEPLOY_PUBKEY" in ssh-ed25519\ *|ssh-rsa\ *) ;; *) echo "DEPLOY_PUBKEY does not look like a public key"; exit 1;; esac
. /etc/os-release
[ "$ID" = ubuntu ] || { echo "This script is written for Ubuntu"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
echo "==> Updating the system"
apt-get update -y
apt-get upgrade -y
apt-get install -y ufw fail2ban unattended-upgrades curl git ca-certificates chrony

echo "==> Clock and swap"
timedatectl set-timezone Asia/Kolkata
systemctl enable --now chrony
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/90-swappiness.conf
  sysctl -p /etc/sysctl.d/90-swappiness.conf >/dev/null
fi

echo "==> deploy user"
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "$DEPLOY_PUBKEY" /home/deploy/.ssh/authorized_keys 2>/dev/null \
  || echo "$DEPLOY_PUBKEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys
# No password exists for this user, so sudo must not ask for one.
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy
visudo -cf /etc/sudoers.d/90-deploy >/dev/null

echo "==> SSH hardening"
cat > /etc/ssh/sshd_config.d/01-flourishive.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy
MaxAuthTries 3
CONF
sshd -t
systemctl restart ssh

echo "==> Firewall"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp comment 'SSH (rate limited)'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw allow 443/udp comment 'HTTP/3'
ufw --force enable

echo "==> fail2ban and automatic security updates"
cat > /etc/fail2ban/jail.d/sshd.local <<'CONF'
[sshd]
enabled = true
maxretry = 4
findtime = 10m
bantime = 1h
CONF
systemctl enable --now fail2ban
systemctl restart fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

echo
echo "DONE. Do NOT close this window yet."
echo "From your computer, in a NEW terminal, check:  ssh -i ~/.ssh/flourishive_vps deploy@$(hostname -I | awk '{print $1}')"
[ -f /var/run/reboot-required ] && echo "A reboot is pending (kernel update); I will do it from the deploy user."
exit 0
