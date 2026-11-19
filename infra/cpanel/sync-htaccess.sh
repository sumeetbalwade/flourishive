#!/usr/bin/env bash
# Copies the shared SPA .htaccess into every frontend's public/ folder.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
for app in "$root"/frontend/*/; do
  cp "$root/infra/cpanel/spa.htaccess" "$app/public/.htaccess"
  echo "synced $(basename "$app")"
done
