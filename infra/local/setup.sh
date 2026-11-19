#!/usr/bin/env bash
# One-command local setup (macOS, Homebrew). Safe to re-run.
# Starts MariaDB 10.6, Redis and Mailpit, creates the dev and test databases
# plus a local-only `flourishive` DB user, and writes backend/.env if missing.
# It never touches other databases that already exist on the server.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"

for svc in mariadb@10.6 redis mailpit; do
  if ! brew list "$svc" >/dev/null 2>&1; then
    echo "Missing Homebrew package: $svc  (brew install $svc)" >&2
    exit 1
  fi
  brew services start "$svc" >/dev/null 2>&1 || true # already running is fine
  echo "started $svc"
done

db="$(brew --prefix mariadb@10.6)/bin/mariadb" # connects over the socket as your macOS user
echo -n "waiting for MariaDB"
for _ in $(seq 1 30); do
  "$db" -e "SELECT 1" >/dev/null 2>&1 && break
  echo -n "."; sleep 1
done
echo

"$db" <<'SQL'
CREATE DATABASE IF NOT EXISTS flourishive_dev  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS flourishive_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'flourishive'@'localhost'  IDENTIFIED BY 'flourishive_dev';
CREATE USER IF NOT EXISTS 'flourishive'@'127.0.0.1'  IDENTIFIED BY 'flourishive_dev';
GRANT ALL ON flourishive_dev.*  TO 'flourishive'@'localhost', 'flourishive'@'127.0.0.1';
GRANT ALL ON flourishive_test.* TO 'flourishive'@'localhost', 'flourishive'@'127.0.0.1';
-- Prisma migrate needs a throwaway shadow database
GRANT ALL ON `prisma\_%`.*      TO 'flourishive'@'localhost', 'flourishive'@'127.0.0.1';
SQL
echo "databases ready: flourishive_dev, flourishive_test"

env_file="$root/backend/.env"
if [ ! -f "$env_file" ]; then
  cp "$root/backend/.env.example" "$env_file"
  echo "wrote backend/.env"
else
  echo "backend/.env already exists, left unchanged"
fi

echo "Mailpit inbox: http://localhost:8025"
echo "Done. Next: pnpm install && pnpm --filter @flourishive/web dev"
