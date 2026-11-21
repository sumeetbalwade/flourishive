# Runbook: Cloudflare DNS, wildcard HTTPS and company addresses

Decision (19 Nov 2026): DNS and HTTPS for the product's domain (`flourishive.in` today) go through Cloudflare's free plan, with the
Cloudflare proxy in front of the cPanel host. Each company signs in at `<slug>.<your domain>`.

You do the steps in Cloudflare and cPanel; the app side is already in the code (`TRUST_CLOUDFLARE`,
`TENANT_URL_TEMPLATE`, wildcard CORS). Menu names below are from memory: if one differs, look for the
closest label and tell me.

## 0. What you need
- Login to the registrar of `flourishive.in` (to change nameservers).
- A Cloudflare account (free).
- The cPanel host's public IP address (cPanel: right side panel "Shared IP Address").
- A list of the domain's **current** DNS records (cPanel → Zone Editor), to copy across.

## 1. Add the domain to Cloudflare
1. Cloudflare dashboard → **Add a domain** → `flourishive.in` → choose the **Free** plan.
2. Cloudflare scans the existing records. **Compare them with the list from cPanel** and add anything
   missing, especially mail: `MX`, SPF (`TXT` starting `v=spf1`), DKIM, DMARC, and any records
   ZeptoMail or SES asked for.
3. Every mail-related record must be **DNS only** (grey cloud). Never proxy `MX` or mail hosts.
4. Cloudflare shows two nameservers. At the registrar, replace the domain's nameservers with them.
   Wait until Cloudflare says the domain is **Active** (minutes to a day).

## 2. DNS records (all proxied, orange cloud, unless noted)
| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` | cPanel IP | Proxied |
| A | `*` | cPanel IP | Proxied (this makes every company address work) |
| A | `app` | cPanel IP | Proxied |
| A | `admin` | cPanel IP | Proxied |
| A | `api` | cPanel IP | Proxied |
| A | `verify` | cPanel IP | Proxied |
| A | `www` | cPanel IP | Proxied |

Explicit records (`app`, `admin`, `api`, `verify`) win over the `*` record. Company names `app`,
`admin`, `api`, `verify`, `www` and others are blocked in the app so a company cannot take them.
Wildcard records can be proxied on the free plan. A name two levels deep (`a.b.flourishive.in`) is not covered.

## 3. HTTPS
1. **SSL/TLS → Overview**: set the mode to **Full (strict)**. (Do this only after step 4, or the site
   will show errors.)
2. **SSL/TLS → Edge Certificates**: leave Universal SSL on (it covers `flourishive.in` and
   `*.flourishive.in`), turn **Always Use HTTPS** on, set **Minimum TLS version** to 1.2.
3. Leave **HSTS** off until everything works, then enable it later.

## 4. Certificate on the cPanel host (free, no renewals for 15 years)
1. Cloudflare → **SSL/TLS → Origin Server → Create Certificate**.
2. Private key type RSA, hostnames `flourishive.in` and `*.flourishive.in`, validity 15 years.
3. Copy the **certificate** and the **private key** (the key is shown once; keep it safe, never commit it).
4. cPanel → **SSL/TLS → Manage SSL sites** (Install and Manage SSL) → paste both for each of:
   `flourishive.in`, `app.`, `admin.`, `api.`, `verify.`, and the wildcard (see step 5).
5. Wildcard company addresses on cPanel: **Domains → Create a new domain** (or Subdomains) with
   `*.flourishive.in` and the same document root as `app.flourishive.in` (the company web app build).
   Not every host allows wildcard subdomains. If yours does not, ask them; this is the one host
   feature the plan depends on.
6. Now switch Cloudflare to **Full (strict)** if you have not.

## 5. Caching
Cloudflare does not cache API JSON by default. Add one **Cache Rule**: hostname equals
`api.flourishive.in` → **Bypass cache**. Do the same for the `index.html` of each app if you see stale
pages after a deploy.

## 6. App settings on the server
The product name and website are settings, not code (see `docs/runbooks/rename-or-move-the-product.md`).
Set these environment variables for the API (cPanel → Setup Node.js App). `<your domain>` is
`flourishive.in` today:

```
APP_NAME=Flourishive
APP_DOMAIN=<your domain>
TRUST_CLOUDFLARE=true
COOKIE_SECURE=true
```

From `APP_DOMAIN` the API builds the company address (`https://{slug}.<your domain>`), the app, admin
and verify addresses, the allowed browser origins and the mail sender. Set `TENANT_URL_TEMPLATE`,
`WEB_URL`, `ADMIN_URL`, `CORS_ORIGINS` or `MAIL_FROM` only if you need something different.

Each frontend reads `brand.json` (a file next to its `index.html`) at start-up:

```json
{ "appName": "Flourishive", "tenantDomain": "<your domain>", "apiUrl": "https://api.<your domain>" }
```

`TRUST_CLOUDFLARE=true` makes sign-in lockouts and rate limits count each real visitor. Without it every
visitor looks like one Cloudflare address. The app only believes the visitor header when the connection
itself comes from a Cloudflare range (list built in; override with `CLOUDFLARE_IP_RANGES`).

## 7. Optional hardening: only accept traffic from Cloudflare
In the site's `.htaccess` (or the host's firewall), allow only Cloudflare's ranges
(https://www.cloudflare.com/ips) so nobody can bypass Cloudflare by calling the server's IP directly.

## 8. Check it works
```
curl -sI https://app.flourishive.in            # 200, header "server: cloudflare"
curl -sI https://flourisense.flourishive.in    # 200 (a company address)
curl -s  https://api.flourishive.in/v1/health  # {"status":"ok",...}
curl -s  https://api.flourishive.in/v1/public/company/flourisense
```
Then open `https://flourisense.flourishive.in` in a browser: the sign-in page shows the company name
and no company code field. Try five wrong passwords from one phone, then sign in from another device on
a different network: only the first should be locked.

## Troubleshooting
- **Error 525/526**: the server certificate is missing or not attached to that name (step 4), or SSL mode
  is Full (strict) before the certificate was installed.
- **Error 522/523/524**: Cloudflare cannot reach the server; check the A record IP and the host firewall.
- **A company address shows the wrong site**: the wildcard subdomain's document root (step 4.5) is wrong.
- **Mail stopped**: a mail record was proxied or not copied (step 1).
- **Everyone gets locked out together**: `TRUST_CLOUDFLARE` is not set, or the host's proxy hides
  Cloudflare's address; tell me what the host runs (Apache, LiteSpeed, Passenger).
