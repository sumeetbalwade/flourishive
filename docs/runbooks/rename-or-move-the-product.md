# Runbook: rename the product or move it to another website

The product's name and its website are settings. No company data, code or database change is needed.

## What to change
| Where | Setting | Effect |
|---|---|---|
| API environment | `APP_NAME` | Name in emails, the authenticator app entry, the default sender name, the "platform" company name |
| API environment | `APP_DOMAIN` | Company addresses `https://{slug}.<domain>`, `app.`/`admin.`/`verify.` addresses, allowed browser origins, mail sender address |
| Each frontend's `brand.json` | `appName`, `tagline`, `tenantDomain`, `apiUrl` | Name on screens, page titles, downloaded file names; where company addresses and the API live |

`brand.json` sits next to `index.html` in each deployed app (`web`, `admin`, `verify`). It is read when the
page loads, so editing the file is enough. It can be an empty `{}`: the build's defaults
(`VITE_APP_NAME`, `VITE_TENANT_DOMAIN`, `VITE_API_URL`) then apply. A missing or broken file is ignored.

Example for a product renamed "Acme HR" on `acmehr.com`:

```
# API
APP_NAME=Acme HR
APP_DOMAIN=acmehr.com

# brand.json in web, admin and verify
{ "appName": "Acme HR", "tagline": "People, simply.", "tenantDomain": "acmehr.com", "apiUrl": "https://api.acmehr.com" }
```

## Moving to a new domain: checklist
1. Add the new domain to Cloudflare and follow `cloudflare-dns-ssl.md` for it (DNS records, wildcard
   subdomain, Origin certificate).
2. Add the new mail records (SPF, DKIM, DMARC, and your mail provider's records) so email still sends.
3. Change `APP_DOMAIN` (and `APP_NAME`) in the API environment and restart the API.
4. Edit `brand.json` in each frontend.
5. Companies keep working: each company is stored by its short name (slug), not by its address.
6. Keep the old domain redirecting to the new one for a while, because old emails contain old links
   (sign-in addresses, password links).

## Things the rename does not change
- Sessions: people sign in again on the new address, because the sign-in cookie belongs to the address.
- Internal technical names (package names such as `@flourishive/...`, cookie names, the token issuer
  `flourishive-api`) are not shown to anyone. Renaming those is optional and would sign everyone out.
- The Windows/macOS desktop app has its own name and settings (Phase 2).
- Existing companies' own "email sender name" setting, if they set one, keeps its value; the default
  follows `APP_NAME`.
