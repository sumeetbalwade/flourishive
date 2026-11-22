#!/usr/bin/env bash
# Step 2: base software. Run on the server as the deploy user (uses sudo).
#   MariaDB 11.4 LTS and Redis, both listening on localhost only; Node 22 + pnpm.
# Passwords are generated here, stored root-only in /etc/flourishive/, never printed.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
SECRETS=/etc/flourishive
sudo install -d -m 750 -o root -g deploy $SECRETS

echo "==> MariaDB 11.4"
if ! command -v mariadb >/dev/null; then
  curl -fsSL https://r.mariadb.com/downloads/mariadb_repo_setup -o /tmp/mariadb_repo_setup
  sudo bash /tmp/mariadb_repo_setup --mariadb-server-version=mariadb-11.4 --skip-maxscale --skip-tools
  sudo apt-get install -y mariadb-server mariadb-client
fi
sudo tee /etc/mysql/mariadb.conf.d/99-flourishive.cnf >/dev/null <<'CONF'
[mysqld]
bind-address = 127.0.0.1
skip-name-resolve
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
innodb_buffer_pool_size = 2G
max_connections = 150
CONF
sudo systemctl enable mariadb
sudo systemctl restart mariadb

if [ ! -f $SECRETS/db.env ]; then
  DBPASS=$(openssl rand -hex 24)
  # the root account stays socket-only (no password); the app gets its own user
  sudo mariadb <<SQL
CREATE DATABASE IF NOT EXISTS flourishive CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'flourishive'@'localhost' IDENTIFIED BY '$DBPASS';
ALTER USER 'flourishive'@'localhost' IDENTIFIED BY '$DBPASS';
GRANT ALL PRIVILEGES ON flourishive.* TO 'flourishive'@'localhost';
FLUSH PRIVILEGES;
SQL
  printf 'DATABASE_URL=mysql://flourishive:%s@127.0.0.1:3306/flourishive\n' "$DBPASS" | sudo tee $SECRETS/db.env >/dev/null
  sudo chown root:deploy $SECRETS/db.env; sudo chmod 640 $SECRETS/db.env
fi
sudo mariadb -e "SELECT VERSION();"

echo "==> Redis"
sudo apt-get install -y redis-server
if [ ! -f $SECRETS/redis.env ]; then
  RPASS=$(openssl rand -hex 24)
  printf 'REDIS_URL=redis://:%s@127.0.0.1:6379\n' "$RPASS" | sudo tee $SECRETS/redis.env >/dev/null
  sudo chown root:deploy $SECRETS/redis.env; sudo chmod 640 $SECRETS/redis.env
  sudo tee /etc/redis/redis.conf.d-flourishive >/dev/null <<CONF
bind 127.0.0.1 -::1
protected-mode yes
requirepass $RPASS
maxmemory 512mb
maxmemory-policy noeviction
appendonly yes
CONF
  sudo sed -i '/^# flourishive$/,$d' /etc/redis/redis.conf
  { echo '# flourishive'; echo 'include /etc/redis/redis.conf.d-flourishive'; } | sudo tee -a /etc/redis/redis.conf >/dev/null
  sudo chmod 640 /etc/redis/redis.conf.d-flourishive; sudo chown root:redis /etc/redis/redis.conf.d-flourishive
fi
sudo systemctl enable redis-server
sudo systemctl restart redis-server
RPASS=$(sed 's#.*://:\(.*\)@.*#\1#' $SECRETS/redis.env)
REDISCLI_AUTH="$RPASS" redis-cli ping

echo "==> Node 22 and pnpm"
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup
  sudo bash /tmp/nodesource_setup
  sudo apt-get install -y nodejs
fi
sudo corepack enable
node -v; corepack --version
sudo apt-get install -y build-essential python3 poppler-utils

echo "==> Listening ports (should be localhost only, except SSH)"
sudo ss -ltnp | awk 'NR==1 || /LISTEN/' | awk '{print $1,$4,$6}'
