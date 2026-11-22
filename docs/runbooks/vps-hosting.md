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

## Updating the app
On the server: `bash /srv/flourishive/repo/infra/vps/04-deploy.sh`
