# Runbook: the VPS (Contabo, Ubuntu 24.04) and company addresses

Replaces the cPanel plan in `cloudflare-dns-ssl.md` (kept for reference). Server scripts live in `infra/vps/`.

## How an address reaches the right place
- **DNS (Cloudflare)** has **no wildcard record**. It holds `@`, `www`, `app`, `admin`, `api`, `verify` (set by hand, once) and one
  `A` record per company. The API adds a company's record itself when the company is created in the admin app.
  A name nobody created does not resolve.
- **HTTPS**: one wildcard certificate for `*.flourishive.in` (Let's Encrypt, DNS challenge through Cloudflare, renewed by Caddy).
  A certificate does not need a wildcard DNS record, so this is unaffected.
- **Caddy** sends `api.` to the API, `admin.` and `verify.` to their apps, and everything else to the staff web app.
- **The app** reads the company from the part before `.flourishive.in`.

## Settings in `/etc/flourishive/api.env`
`CLOUDFLARE_API_TOKEN` (DNS edit on this one zone), `CLOUDFLARE_ZONE_ID`, `DNS_TARGET_IP` (the server's IPv4), `DNS_PROXIED`.
If any is missing the API leaves DNS alone.

## When a company's address does not work
1. Admin app shows `dns: failed` after creating a company (or the address does not resolve).
2. Repeat it: `POST /v1/platform/tenants/<id>/dns` (safe to repeat; fixes a wrong record too).
3. The reason is in the platform audit log as `platform.tenant_dns_failed`.

## Moving the server (new IP)
Change `DNS_TARGET_IP`, restart the API, then call the endpoint above for each company; also update `@`, `app`, `admin`, `api`, `verify`, `www` by hand.

## A staff member is locked out of two-step (break-glass)

Another Owner can reset it in the console (Platform staff, then the person, then Actions, then Reset two-step). If no
other Owner can, run this on the server, as the deploy user, from the app folder:

```
node dist/cli.js platform-reset-mfa --email=person@example.com
```

It clears their two-step, ends their sessions and writes `platform.mfa_reset_break_glass` (by `SYSTEM_CLI`) to the
platform audit. They sign in with their password and set up two-step again. Check the audit line afterwards, and do not
leave the command in shell history on a shared machine.

## Updating the app
Merging to `main` deploys by itself: when CI passes on a push to `main`, `.github/workflows/deploy.yml` connects to the server
and runs `04-deploy.sh`, then checks that `https://api.flourishive.in/v1/health` reports the new commit.
To deploy by hand (or retry): GitHub, Actions, Deploy, Run workflow; or on the server run
`bash /srv/flourishive/repo/infra/vps/04-deploy.sh`.
A failed CI run never deploys. To roll back, revert on `main` (the revert deploys the same way).

### One-time setup for automatic deploys
1. **Make a key for GitHub** (on your own computer, not the server): `ssh-keygen -t ed25519 -f flourishive-deploy -N ""`.
2. **Allow it on the server**, locked to the deploy script. Append this one line to `/home/deploy/.ssh/authorized_keys`
   (replace the key text with the contents of `flourishive-deploy.pub`):
   `command="bash /srv/flourishive/repo/infra/vps/04-deploy.sh",restrict ssh-ed25519 AAAA... flourishive-github-deploy`
   With `restrict` and `command=`, this key can only run the deploy script and nothing else.
3. **Get the server's host key** (so GitHub can tell it is talking to your server): `ssh-keyscan -t ed25519 <server-ip>`.
4. **Add GitHub secrets** (repo Settings, Secrets and variables, Actions, or on the `production` environment):
   `VPS_HOST` (server IP or hostname), `VPS_USER` (`deploy`), `VPS_SSH_KEY` (the private key file contents),
   `VPS_KNOWN_HOSTS` (the line from step 3).
5. Delete the private key file from your computer once it is in GitHub.
