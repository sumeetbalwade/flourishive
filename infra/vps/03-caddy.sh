#!/usr/bin/env bash
# Step 3: Caddy web server built with the Cloudflare DNS plugin (for the wildcard certificate).
# Built from source with xcaddy so we do not depend on a third-party binary download.
# Run on the server as deploy. Needs /etc/flourishive/cloudflare.env with CF_API_TOKEN=...
set -euo pipefail
[ -f /etc/flourishive/cloudflare.env ] || { echo "missing cloudflare.env"; exit 1; }
GO_VERSION=1.24.4

if ! /usr/local/bin/caddy list-modules 2>/dev/null | grep -q dns.providers.cloudflare; then
  if [ ! -x /usr/local/go/bin/go ]; then
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tgz
    sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/go.tgz && rm /tmp/go.tgz
  fi
  export PATH=$PATH:/usr/local/go/bin:$HOME/go/bin
  go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
  (cd /tmp && xcaddy build --with github.com/caddy-dns/cloudflare --output /tmp/caddy)
  sudo install -m 755 /tmp/caddy /usr/local/bin/caddy
  rm -f /tmp/caddy
fi
caddy version
caddy list-modules | grep cloudflare

id caddy >/dev/null 2>&1 || sudo useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
sudo install -d -o caddy -g caddy /etc/caddy /var/log/caddy
# Caddy gets its own copy of the token; it cannot read the database or Redis passwords.
sudo install -m 640 -o root -g caddy /etc/flourishive/cloudflare.env /etc/caddy/cloudflare.env

sudo tee /etc/systemd/system/caddy.service >/dev/null <<'UNIT'
[Unit]
Description=Caddy web server
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
EnvironmentFile=/etc/caddy/cloudflare.env
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
LimitNOFILE=1048576
Restart=on-failure
ProtectSystem=full
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
