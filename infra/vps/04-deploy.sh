#!/usr/bin/env bash
# Step 4: deploy (first time and every update). Run on the server as deploy:
#   bash /srv/flourishive/repo/infra/vps/04-deploy.sh [branch]      (default: main)
# Safe to re-run. Secrets are created once in /etc/flourishive/api.env and never overwritten.
set -euo pipefail
BRANCH=${1:-main}
ROOT=/srv/flourishive
REPO=$ROOT/repo
WWW=$ROOT/www
DOMAIN=flourishive.in
export PATH=$PATH:/usr/local/go/bin

cd "$REPO"
git fetch -q origin
git checkout -q "$BRANCH"
git reset -q --hard "origin/$BRANCH"
echo "==> Deploying $(git log --oneline -1)"

echo "==> Secrets and settings"
sudo install -d -m 750 -o root -g deploy /etc/flourishive
ENVF=/etc/flourishive/api.env
if [ ! -f $ENVF ]; then
  {
    echo "NODE_ENV=production"
    echo "PORT=3000"
    echo "APP_VERSION=$(git rev-parse --short HEAD)"
    echo "APP_DOMAIN=$DOMAIN"
    echo "APP_NAME=Flourishive"
    echo "COOKIE_SECURE=true"
    echo "STORAGE_DIR=$ROOT/storage"
    echo "FIELD_ENCRYPTION_KEY=$(openssl rand -hex 32)"
    echo "HMAC_SECRET=$(openssl rand -hex 32)"
    echo "JWT_SECRET=$(openssl rand -hex 32)"
    echo "TRUSTED_ROOTS_DIR=$ROOT/trust/roots"
    echo "TRUSTED_TSA_DIR=$ROOT/trust/tsa"
    echo "SEAL_TSA_URL=http://timestamp.digicert.com"
    cat /etc/flourishive/db.env /etc/flourishive/redis.env
  } | sudo tee $ENVF >/dev/null
  sudo chown root:deploy $ENVF; sudo chmod 640 $ENVF
fi
# Company addresses are created in Cloudflare by the API (no wildcard DNS record). Added once.
if ! sudo grep -q '^CLOUDFLARE_API_TOKEN=' $ENVF; then
  . /etc/flourishive/cloudflare.env
  {
    echo "CLOUDFLARE_API_TOKEN=$CF_API_TOKEN"
    echo "CLOUDFLARE_ZONE_ID=${CLOUDFLARE_ZONE_ID:?set CLOUDFLARE_ZONE_ID when first deploying}"
    echo "DNS_TARGET_IP=${DNS_TARGET_IP:?set DNS_TARGET_IP when first deploying}"
  } | sudo tee -a $ENVF >/dev/null
fi
mkdir -p "$ROOT/storage" "$ROOT/trust/roots" "$ROOT/trust/tsa" "$ROOT/backups"
chmod 700 "$ROOT/storage"
set -a; . $ENVF; set +a

echo "==> Install and build"
corepack enable >/dev/null 2>&1 || sudo corepack enable
pnpm install --frozen-lockfile
VITE_APP_NAME=Flourishive VITE_TENANT_DOMAIN=$DOMAIN VITE_API_URL=https://api.$DOMAIN pnpm build

echo "==> Seal key (first time only; keep the backup safe)"
if ! grep -q '^SEAL_KEY_BASE64=' $ENVF; then
  (cd backend && pnpm -s seal:generate | grep '^SEAL_' ) | sudo tee -a $ENVF >/dev/null
  echo "Seal key created. Back up /etc/flourishive/api.env somewhere safe, off this server."
fi
set -a; . $ENVF; set +a

echo "==> Database migrations"
(cd backend && pnpm -s db:deploy)

echo "==> Web apps"
for app in web:app admin:admin verify:verify; do
  src=${app%%:*}; host=${app##*:}
  mkdir -p "$WWW/$host"
  rsync -a --delete "frontend/$src/dist/" "$WWW/$host/"
  printf '{ "appName": "Flourishive", "tenantDomain": "%s", "apiUrl": "https://api.%s" }\n' "$DOMAIN" "$DOMAIN" > "$WWW/$host/brand.json"
done
# company addresses (<slug>.flourishive.in) serve the same web app as app.
mkdir -p "$WWW/company" && rsync -a --delete "$WWW/app/" "$WWW/company/"

echo "==> Services"
sudo tee /etc/systemd/system/flourishive-api.service >/dev/null <<UNIT
[Unit]
Description=Flourishive API
After=network-online.target mariadb.service redis-server.service
Wants=mariadb.service redis-server.service

[Service]
User=deploy
WorkingDirectory=$REPO/backend
EnvironmentFile=$ENVF
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
MemoryMax=2G

[Install]
WantedBy=multi-user.target
UNIT
sudo tee /etc/systemd/system/flourishive-worker.service >/dev/null <<UNIT
[Unit]
Description=Flourishive background jobs (one run)
After=mariadb.service redis-server.service

[Service]
Type=oneshot
User=deploy
WorkingDirectory=$REPO/backend
EnvironmentFile=$ENVF
ExecStart=/usr/bin/node dist/cli.js worker --max-seconds=55
TimeoutStartSec=120
UNIT
sudo tee /etc/systemd/system/flourishive-worker.timer >/dev/null <<UNIT
[Unit]
Description=Run Flourishive background jobs every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=1s

[Install]
WantedBy=timers.target
UNIT
sudo tee /etc/systemd/system/flourishive-audit.service >/dev/null <<UNIT
[Unit]
Description=Flourishive nightly audit chain check
After=mariadb.service

[Service]
Type=oneshot
User=deploy
WorkingDirectory=$REPO/backend
EnvironmentFile=$ENVF
ExecStart=/usr/bin/node dist/cli.js verify-audit
UNIT
sudo tee /etc/systemd/system/flourishive-audit.timer >/dev/null <<UNIT
[Unit]
Description=Nightly audit chain check

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now flourishive-api flourishive-worker.timer flourishive-audit.timer >/dev/null 2>&1
sudo systemctl restart flourishive-api

echo "==> Web server"
sudo install -m 644 -o caddy -g caddy "$REPO/infra/vps/caddy/Caddyfile" /etc/caddy/Caddyfile
sudo systemctl reload caddy

echo "==> Waiting for the API"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/v1/health >/dev/null 2>&1; then echo "API is up"; break; fi
  sleep 1
done
sudo systemctl is-active flourishive-api
