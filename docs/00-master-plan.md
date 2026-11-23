# Flourishive — Master Plan

**Status:** v1.0, approved 8 Nov 2026 · **Owner:** Sumeet · **Date:** 8 Nov 2026

Flourishive is a multi-tenant HR management SaaS. Flourisense is the first customer (tenant #1); other companies are onboarded and configured by the Flourishive super admin. The digital signing module is built first, on top of a small but tenant-aware core, and the product runs on shared cPanel hosting at `flourishive.in`.

This plan supersedes the hosting, stack and phase sections of *HRM platform: prerequisites and architecture* (1 Nov 2026). That document's business prerequisites, data-model principles and India compliance notes still apply.

---

## 1. Decision log

Approved decisions. Changing any of them needs a new entry, not an edit.

| # | Area | Decision |
|---|------|----------|
| D-01 | Product model | Multi-tenant SaaS. Flourisense = tenant #1. Super admin configures every tenant, including Flourisense. |
| D-02 | Hosting | Shared cPanel hosting. The host must meet the checklist in §3.2. |
| D-03 | Tenancy | One shared database; `tenant_id` on every tenant-owned table, enforced centrally in the data layer. A large customer can be moved to its own database later. |
| D-04 | Backend | NestJS (TypeScript), deployed as a cPanel "Setup Node.js App". REST + JSON, versioned at `/v1`, documented with OpenAPI. |
| D-05 | Database | MySQL 8 / MariaDB 10.6+ with Prisma ORM and migrations. |
| D-06 | Web frontends | React + Vite SPAs (TypeScript, Tailwind, shadcn/ui restyled, TanStack Query + Router), deployed as static files. |
| D-07 | Repository | One Git repo; backend, each frontend, desktop app and mobile app are separate top-level apps that build and deploy independently. |
| D-08 | Visual direction | Dark premium black + bronze (`design dark main.webp`), with a matching light mode. Each tenant can set its own logo and accent colour. |
| D-09 | Design process | Coded design system + clickable high-fidelity prototypes, approved before screens are built. |
| D-10 | Signature methods | DSC Class 3 USB token, OTP e-acceptance, Aadhaar eSign. |
| D-11 | DSC signing location | Entirely inside Flourishive Desktop (pyHanko + PKCS#11). The server only verifies and stores. Key and PIN never leave the signer's computer. |
| D-12 | Desktop platforms | Windows and macOS at launch. |
| D-13 | Templates | Three paths: visual editor (JSON → pdfmake + pdf-lib), developer-coded layouts (React-PDF), and HR uploads (plain PDF, fillable PDF, DOCX). |
| D-14 | DOCX → PDF | Through Flourishive Desktop or an external conversion API, chosen per tenant by the super admin. |
| D-15 | Tenant URL | Single `app.flourishive.in`; the tenant is resolved at login (email domain or company code). |
| D-16 | Login | Email + password with MFA (mandatory for HR, admins and super admin); "Sign in with Google" for all users; optional per-tenant SSO (Google Workspace, Microsoft 365). |
| D-17 | Messaging | Transactional email (Zoho ZeptoMail or Amazon SES) for mail and email OTP. SMS added after TRAI DLT registration. |
| D-18 | Domain | `flourishive.in`. |
| D-19 | Phase order | Signing first, on a minimal core that is tenant-aware from day one. |
| D-20 | SaaS controls | At launch: tenant creation, module on/off, limits, every setting, and subscription billing. |
| D-21 | Payments | Razorpay (Subscriptions, UPI AutoPay) behind a payment-gateway adapter. |
| D-22 | Deployment | GitHub Actions builds and tests, then deploys over SSH/rsync to cPanel. No builds on the server. |
| D-23 | Mobile | React Native (Expo) after the leave & attendance phase. Before that, the web app is responsive and installable as a PWA. |
| D-24 | Desktop ↔ API (P-01) | Flourishive Desktop pairs with the user's account and talks to the API directly; the web app opens it with a `flourishive://` link. No localhost server. |
| D-25 | OTP tamper-evidence (P-02) | OTP-accepted PDFs are sealed server-side with a Flourishive organisation document-signing certificate. |
| D-26 | Toolchain (P-03) | pnpm workspaces + Turborepo; Vitest and Playwright; ESLint + Prettier; uv + pytest for the desktop app. |
| D-27 | VPS trigger (P-04) | Move to a VPS when the first paying external customer signs, or at 300 active users, whichever comes first. |
| D-28 | Aadhaar eSign provider (P-05) | Compare quotes from 2–3 licensed providers during Phase 1; build against the adapter; choose before Phase 2. |
| D-29 | Custom fields (P-06) | Ship in Phase 3 for persons and engagements, with role-based visibility. |
| D-30 | Job queue | The host provides Redis. BullMQ queues in Redis; cron starts a worker every minute that runs for about 55 s and exits. Important jobs are also recorded in MySQL, and a reconciler re-queues them if Redis loses data. Replaces the MySQL-only queue. |
| D-31 | Python on the server | Not used, even though the host offers it. Signature validation and the organisation seal (D-25) run in Node (@signpdf, node-forge, pdf-lib). pyHanko runs only inside Flourishive Desktop. Accepted trade-off: weaker server-side checking of timestamps and revocation than pyHanko. |
| D-32 | Other Redis uses | Rate limits and login lockouts, settings and permission cache, short-lived tokens (desktop pairing codes, download nonces, idempotency keys). OTPs and acceptance evidence stay in MySQL. |
| D-33 | DSC flow (re-confirmed) | D-11 unchanged: Flourishive Desktop signs the full PDF locally; the server validates it before accepting it. |
| D-34 | Local development | Homebrew services on macOS (MySQL 8.4, Redis, Mailpit, SoftHSM) instead of Docker. `infra/local/` holds a setup script. |
| D-35 | Signatory | The HR lead is the authorised signatory; the mToken DSC is in the HR lead's name. The signatory is still configurable per entity. |
| D-38 | Expired DSC during development | Development continues with the HR lead's expired DSC. Signatures made with it are test output only. A development-only setting (`ALLOW_EXPIRED_SIGNER_CERT`) lets the server accept them; it is off by default and **must not exist in production**. Before go-live the DSC is renewed, the setting and its code path are removed, and full certificate validation (validity dates, chain, revocation, timestamp) is verified on a real renewed token. |
| D-37 | Signing animation | A pen-stroke-and-checkmark animation shows signing progress in Flourishive Desktop, on the web document page (signature timeline) and on the candidate OTP acceptance screen. It follows the real signing state, never a fake timer, and respects reduced-motion settings. |
| D-36 | Signing spike | The Phase 0 spike runs on this Mac and on a Windows laptop with the mToken, after first passing against a SoftHSM test token. |
| D-39 – D-52 | Phase 2 build | See [phase-02](phases/phase-02-documents-and-signing.md#decisions-approved-2026-11-21-d-39d-44). |
| D-53 | Visual direction v2 | Supersedes D-08's colours: light-first mint and deep teal, Outfit headings, large radii; dark is green-black. Tenants still set their own accent. |
| D-54 | Phase 2B | New phase "Platform control centre" between Phase 2 and Phase 3; settings editor, tenant branding, support sessions and module on/off move there from Phase 3. |
| D-55 | Platform staff roles | Permission-based custom roles with presets Owner, Super admin, Support, Read-only auditor; at least one active Owner always. |
| D-56 | Support access | Tenant data only through time-limited, reasoned support sessions visible to the tenant; read-only by default, write is a separate permission. |
| D-57 | Runtime config and secrets | Integration settings and keys stored in the database (secrets encrypted, write-only, Test button, step-up to change); `api.env` keeps only bootstrap keys and acts as fallback. |
| D-58 | Email senders | Platform sender by default; a tenant may use its own SMTP or a verified From address, activated only after code, test mail and SPF/DKIM/DMARC check. |
| D-59 | Email templates | Subject and body per event with escaped `{{variables}}`, preview, test, reset; tenant overrides where unlocked. |
| D-60 | Mail delivery log | Every email recorded with status and reason, resendable; OTP, reset and invite bodies never stored. |
| D-61 | Tenant branding | Logos, favicon, sign-in panel, email header and footer, support contact; preset themes plus custom accent with WCAG AA check; curated font pairs; draft, preview, publish, revert. |
| D-62 | Product brand | Edited by the super admin in the console and served from `GET /v1/brand`; `brand.json` is only a fallback. |
| D-63 | Account actions | Super admin and tenant admin can reset password (link) and two-step, unlock, sign out everywhere, suspend, resend invite, change email; reason, step-up, user notified, audited; tenant admins only on users with a subset of their permissions. |
| D-64 | Two-step ease | Remember device (default 30 days), email code fallback by policy, passkeys, separate admin session length. |
| D-65 | Two-step opt-out | Amends D-16: policy decides, platform floors removed (admin defaults stay REQUIRED); under an OPTIONAL policy a person may turn their own two-step off after password re-entry, with warning and audit. |
| D-66 | Break-glass | Another Owner resets a locked-out Owner; otherwise the server command `platform-reset-mfa`, audited. |
| D-67 | Logs | Errors (plain-English story), request activity, jobs and email, sign-ins; request IDs; MySQL with masking and 7–180 day retention (default 30); errors also to a Sentry-compatible service when configured. |
| D-68 | Alerts | Each super admin or tenant admin picks their own alert emails per event: instant, daily digest or off; off by default. |
| D-69 | Company configuration | Region and formats, sign-in rules (password policy, idle timeout, allowed domains, admin IP allowlist), notification rules, custom domains via Caddy on-demand TLS for verified domains. |
| D-70 | Platform controls | Announcement banner, maintenance mode, feature switches per tenant, usage overview, settings import/export without secrets. |
| D-71 | Console UX | Grouped settings hub with search, per-setting control, hint and lock; setup wizard for new tenants. |
| D-72 | File storage | Files in a private Cloudflare R2 bucket behind the storage service; downloads pass the API's checks, then redirect to a 5-minute presigned link. |
| D-73 | Uploads | Still through the API (content check, sha256), then written to R2. |
| D-74 | Storage migration | Verified copy command, local read fallback while settling, local copies deleted after a clean week. |
| D-76 | Bulk issue | Pick people or paste CSV; all rows checked first; queue job, resumable; 200 rows max. |
| D-77 | Letter delivery | HR-triggered email with a private 30-day link; offer downloads held until an admin releases them (company setting). |
| D-78 | Editor PDF engine | Visual editor JSON drawn by React-PDF (replaces pdfmake in D-13). |
| D-79 | Signing without DSC | Company setting (off by default, lockable by super admin); authenticator code; visible stamp plus organisation seal; labelled "Signed electronically (no DSC)". |
| D-75 | Phase 2 order | Amends D-39: R2 is Phase 2 PR 8; visual editor PR 9; Aadhaar eSign adapter PR 10. |

---

## 2. Architecture

```
                       ┌──────────────────────── shared cPanel host ────────────────────────┐
 Browser ── HTTPS ──►  │ app.flourishive.in     static React SPA  (customer workspace)      │
 Browser ── HTTPS ──►  │ admin.flourishive.in   static React SPA  (super admin console)     │
 Public  ── HTTPS ──►  │ verify.flourishive.in  static page       (document verification)   │
                       │                                                                    │
 all of the above ───► │ api.flourishive.in/v1  NestJS (Node.js App via Passenger)          │
 Flourishive Desktop ─►│        │                                                           │
 External systems ────►│        ├── MySQL / MariaDB   (all tenants, tenant_id scoped)       │
 Mobile app (later) ──►│        ├── Private file storage  (outside public_html)             │
                       │        ├── Redis  (BullMQ queues, rate limits, cache, tokens)       │
                       │        └── cron (every minute) → BullMQ worker (~55 s run)          │
                       │                 PDFs, bulk letters, emails, webhooks, reminders     │
                       └────────────────────────────────────────────────────────────────────┘
          │                                    │
          ▼                                    ▼
  External services                     Signer's computer (Windows / macOS)
  - ZeptoMail or SES (email, OTP)       - Flourishive Desktop
  - Razorpay (billing)                    · DSC signing with USB token (PKCS#11, pyHanko)
  - Aadhaar eSign provider (ESP)          · DOCX → PDF (Word / LibreOffice)
  - DOCX conversion API (opt-in)        - CA timestamp (TSA) and OCSP/CRL for long-term validation
  - Google / Microsoft sign-in
```

**Rules that keep the frontend and backend separate**

- The API holds all business logic, permissions and validation. The SPAs, the desktop app and the mobile app only display data and call `/v1`.
- Every feature exists as an API endpoint before any screen uses it.
- The OpenAPI spec is generated from the backend; a TypeScript client is generated from the spec for every frontend, so they never drift.
- External systems use the same `/v1` endpoints with OAuth client credentials and scopes, plus signed webhooks.
- Breaking API changes go into `/v2`; `/v1` stays supported for at least 6 months.

---

## 3. Hosting: shared cPanel constraints and how we design around them

### 3.1 Constraints → design response

| Constraint on shared cPanel | Design response |
|---|---|
| Redis is available, but permanent background processes are not | BullMQ queues in Redis. A cron job starts `node dist/cli.js worker --max-seconds=55` every minute, so jobs run almost continuously. Every job is idempotent and retry-safe. Important jobs are also recorded in the MySQL `job_records` table, and a reconciler re-queues anything lost if Redis restarts without persistence. |
| Python is available | Not used on the server (D-31). Signature validation and sealing run in Node; pyHanko runs only in Flourishive Desktop. |
| No headless Chrome | PDFs are rendered in pure JavaScript: pdfmake (visual-editor templates), React-PDF (coded layouts), pdf-lib (letterhead overlay, fillable PDFs, QR codes). |
| No LibreOffice | DOCX → PDF runs in Flourishive Desktop or an opt-in external API (D-14). |
| Node processes are started on demand and killed when idle (Passenger) | The API is stateless: no in-memory sessions or caches that matter. A cron ping every 5 minutes keeps the first request after a quiet spell fast. |
| CPU, memory and process limits | Heavy work (PDF batches, imports) only runs in the job worker, in small batches. Uploads are streamed to disk, never buffered whole. |
| Time-sensitive messages can't wait for cron | Login and acceptance OTP emails are sent in the request itself; everything else goes through the queue. |
| No object storage | A storage adapter writes to a private folder outside `public_html` (`~/flourishive-storage/<tenant>/…`). Files are only served through the API with short-lived signed URLs. An S3-compatible adapter can be switched on later. |
| Weak isolation between hosting accounts | Column-level encryption (AES-256-GCM) for sensitive fields; keys only in the Node app's environment variables; nightly encrypted off-site backups. |

### 3.2 Hosting purchase checklist

Buy only a plan that has all of these; confirm them with the host's sales team in writing.

- [ ] cPanel "Setup Node.js App" (CloudLinux Node.js Selector) with **Node 22 or 24 LTS**
- [ ] SSH access (needed for D-22 deploys and running migrations)
- [ ] MySQL 8.0+ or MariaDB 10.6+, with remote access disabled
- [ ] Cron jobs at a **1-minute** interval (some hosts only allow 5 or 15 minutes)
- [ ] Redis for the account: note its memory limit, whether it saves data to disk, and whether it is password- or socket-protected from other accounts on the server
- [ ] At least 2 GB RAM per account and enough entry processes for Node
- [ ] Free AutoSSL (Let's Encrypt) for `flourishive.in` and its subdomains
- [ ] Data centre in India, or as close as the host offers
- [ ] Daily backups by the host, plus permission to run our own off-site backups
- [ ] Enough disk and inode quota for signed PDFs (start at 50 GB+)

### 3.3 When to move to a VPS

Shared hosting is accepted for launch. Everything is configured through environment variables and adapters, so moving to a VPS is a redeploy, not a rewrite. The trigger for that move is proposal P-04 (§11).

---

## 4. Repository and folder structure

One repo, `flourishive/`, managed with pnpm workspaces and Turborepo (toolchain proposal P-03). Every top-level app has its own `package.json` (or `pyproject.toml`), its own build and its own deploy job.

```
flourishive/
├── backend/                       NestJS API: the only place business logic lives
│   ├── src/
│   │   ├── main.ts                HTTP entry (Passenger starts this)
│   │   ├── cli.ts                 CLI entry: job worker, cron tasks, seeds
│   │   ├── config/                typed env config, validated at startup
│   │   ├── common/                guards, interceptors, filters, pagination, idempotency
│   │   ├── platform/              infrastructure adapters (swappable)
│   │   │   ├── database/          Prisma client + automatic tenant scoping
│   │   │   ├── queue/             BullMQ queues, cron-run worker, MySQL job records + reconciler
│   │   │   ├── cache/             Redis: settings/permission cache, rate limits, short-lived tokens
│   │   │   ├── storage/           local-disk adapter (S3 adapter later)
│   │   │   ├── mail/              ZeptoMail / SES / SMTP adapters
│   │   │   ├── sms/               (after DLT) SMS adapters
│   │   │   ├── pdf/               pdfmake, React-PDF, pdf-lib renderers
│   │   │   ├── payments/          Razorpay adapter
│   │   │   ├── esign/             Aadhaar eSign provider adapter(s)
│   │   │   ├── conversion/        external DOCX→PDF API adapter
│   │   │   └── crypto/            field encryption, hashing, HMAC
│   │   ├── modules/               one folder per domain module
│   │   │   ├── tenancy/           tenants, entities (legal companies)
│   │   │   ├── identity/          login, MFA, Google, SSO, sessions, devices
│   │   │   ├── access/            roles, permissions, scoping
│   │   │   ├── settings/          settings registry, overrides, feature flags
│   │   │   ├── org/               departments, designations, locations
│   │   │   ├── people/            persons, engagements, custom fields
│   │   │   ├── files/             uploads, signed URLs, retention
│   │   │   ├── audit/             hash-chained audit log
│   │   │   ├── notifications/     in-app + email, templates, preferences
│   │   │   ├── workflow/          configurable approval flows
│   │   │   ├── documents/         letterheads, templates, numbering, generation
│   │   │   ├── signing/           signature requests, DSC, OTP, Aadhaar eSign, verify
│   │   │   ├── billing/           plans, subscriptions, invoices, limits
│   │   │   ├── integrations/      API clients, webhooks
│   │   │   ├── platform-admin/    super admin endpoints
│   │   │   └── letters/           first business module (intern letters)
│   │   └── jobs/                  job handler registry
│   ├── prisma/
│   │   ├── schema/                schema split per module (*.prisma)
│   │   ├── migrations/
│   │   └── seed/
│   └── test/
│
├── frontend/
│   ├── web/                       customer workspace → app.flourishive.in
│   │   └── src/
│   │       ├── app/               router, providers, layouts, theme
│   │       ├── features/          one folder per module (pages, components, hooks)
│   │       └── lib/
│   ├── admin/                     super admin console → admin.flourishive.in
│   └── verify/                    public verification page → verify.flourishive.in
│
├── desktop/                       Flourishive Desktop (Python): DSC signing + DOCX conversion
│   ├── src/flourishive_desktop/
│   │   ├── api/                   API client, device pairing
│   │   ├── signing/               pyHanko + PKCS#11, token driver detection, TSA, LTV
│   │   ├── conversion/            Word (Windows) / LibreOffice (macOS) DOCX→PDF
│   │   └── ui/                    small desktop UI (queue, PIN entry, status)
│   ├── packaging/                 Windows installer, macOS .app + notarisation
│   └── tests/
│
├── mobile/                        (Phase 7) React Native + Expo app
│
├── packages/                      shared code, never deployed on its own
│   ├── design-tokens/             colours, type, spacing, radii, motion (CSS vars + TS)
│   ├── ui/                        shared React components for web, admin, verify
│   ├── api-client/                generated from the OpenAPI spec
│   ├── schemas/                   shared Zod schemas and types
│   └── config/                    shared tsconfig, lint, Tailwind preset
│
├── design/                        prototypes, screen specs, reference images
├── infra/
│   ├── cpanel/                    .htaccess files, cron definitions, Node app setup notes
│   ├── deploy/                    rsync/SSH deploy scripts used by CI
│   └── local/                     Homebrew setup script for MySQL, Redis, Mailpit, SoftHSM
├── docs/
│   ├── 00-master-plan.md          this document
│   ├── adr/                       one short record per architecture decision
│   ├── runbooks/                  deploy, backup/restore, incident, DSC token setup
│   └── api/                       guide for external integrators
└── .github/workflows/             one workflow per deployable app
```

**Boundaries enforced in code review and lint rules**

- `frontend/*` may import `packages/*` only; never `backend/`.
- `backend/src/modules/X` may not import another module's Prisma models; it calls that module's service or listens to its events.
- `platform/*` adapters are the only code that talks to an external service.

---

## 5. Configuration model ("everything configurable")

### 5.1 Settings registry

Each setting is declared once in code with a key, a Zod type, a default, the levels where it can be overridden, and whether it is sensitive. Values are stored as data and resolved in this order:

```
user  →  entity (legal company)  →  tenant  →  subscription plan  →  platform default
```

The super admin edits platform defaults and any tenant's values; tenant admins edit only what the super admin has unlocked for them.

### 5.2 What is configurable

| Area | Examples |
|---|---|
| Tenant & plan | Modules on/off, user/storage/signature limits, trial length, plan price |
| Branding | Logo, accent colour, default theme (dark/light), email sender name, letterheads per entity |
| Access | Roles, permission sets per role, entity scoping, MFA policy, password policy, session length |
| Login | Password, Google sign-in, Google Workspace / Microsoft 365 SSO, allowed email domains |
| Documents | Templates (all 3 paths), numbering formats per entity and letter type, QR/verification on/off |
| Signing | Allowed methods per document type, signing order, TSA URL, DOCX conversion mode (desktop/API) |
| Workflows | Steps, approvers, reminders, escalation per process |
| People data | Custom fields on persons and engagements, required fields, field visibility per role (P-06) |
| Notifications | Templates per event, channels, reminder timings |
| Compliance | Privacy notice versions, retention rules per data type |
| Calendar | Financial year, holidays per location/state, working days |

---

## 6. Digital signing design (built first)

### 6.1 Signature methods

| Method | Who uses it | How it works | Legal weight |
|---|---|---|---|
| DSC Class 3 (USB token) | Authorised signatory (HR lead) | Flourishive Desktop downloads the approved PDF, signs it locally (PAdES with CA timestamp and long-term validation data), uploads it; the API verifies the signature, certificate and hash before accepting it | Digital signature under the IT Act |
| OTP e-acceptance | Candidates, interns, employees | Email OTP; we record name, email, time, IP, user agent and document hash, and add an acceptance certificate | Electronic record with audit trail; weaker than DSC |
| Aadhaar eSign | Anyone without a token | Through a licensed eSign provider: create request → signer completes Aadhaar OTP on the provider's page → callback → download signed PDF | Electronic signature under the IT Act (Second Schedule) |

### 6.2 Signature requests

One `signature_request` per document with ordered `signature_parties` (for example: candidate accepts by OTP → HR lead signs with DSC). The order is configurable per document type.

**Ordering rule:** anything that changes the PDF content (acceptance certificate pages, filled fields) happens *before* the first cryptographic signature. Later signatures are added as PDF incremental updates so earlier signatures stay valid. The workflow engine refuses orders that would break this.

### 6.3 Flourishive Desktop

- **Tech:** Python 3.12, pyHanko, python-pkcs11, PySide6 for the small UI, packaged with PyInstaller. A code-signed Windows installer and a notarised macOS app.
- **Tokens:** detects common Indian token drivers (ePass2003, HyperPKI, Proxkey, mToken, WatchData) and their PKCS#11 libraries; the user can also set a custom library path.
- **Connection to the API:** proposal P-01 (§11).
- **Batch signing:** HR selects 20 approved letters, enters the PIN once, and the app signs them in sequence and shows progress.
- **DOCX conversion:** Windows uses Microsoft Word if installed, otherwise LibreOffice; macOS uses LibreOffice.
- **Auto-update:** checks the API for a newer signed build.

### 6.4 Verification

Every issued document carries a reference number and a QR code that points to `verify.flourishive.in/<ref>`. The page shows issuer, document type, issue date, status (valid / revoked / superseded) and signer details. Anyone can upload a copy, and its hash is compared with the stored original.

### 6.5 Risk spike first

Before any other signing work, Phase 0 proves that Flourishive Desktop can sign a PDF with **the HR lead's actual token**, on Windows and macOS, and that Adobe Reader shows it as valid with a timestamp. If that fails, we find out on day 5, not week 8.

---

## 7. Data model additions

These are on top of the tables in the 1 Nov architecture document (entities, persons, engagements, workflow, templates, files, audit_log and others). Every tenant-owned table carries `tenant_id` plus, where relevant, `entity_id`.

| Table | Purpose |
|---|---|
| `tenants` | Customer companies: name, slug, status, plan, branding, region |
| `plans`, `plan_limits` | Subscription plans and their limits |
| `subscriptions`, `invoices`, `payments` | Razorpay billing, GST invoices |
| `tenant_modules` | Which modules each tenant has switched on |
| `setting_values` | Overrides per scope (platform, plan, tenant, entity, user) |
| `custom_field_definitions`, `custom_field_values` | Tenant-defined fields (P-06) |
| `platform_users` | Super admin staff (kept apart from tenant users) |
| `desktop_devices` | Paired Flourishive Desktop installs; revocable |
| `signature_requests`, `signature_parties`, `signature_events` | Signing orchestration and evidence |
| `otp_challenges` | Hashed OTPs, attempts, expiry |
| `esign_transactions` | Aadhaar eSign provider requests and callbacks |
| `document_conversions` | DOCX → PDF jobs and their route (desktop or API) |
| `job_records` | MySQL record of important queued jobs, so the reconciler can re-queue them if Redis loses data |

Conventions from the earlier document stay: UUID keys, `created_*`/`updated_*` columns, soft delete, encrypted sensitive fields, Aadhaar last 4 digits only.

---

## 8. Security and compliance

- **Passwords:** argon2id. **MFA:** TOTP authenticator apps, plus recovery codes.
- **Tokens:** 15-minute access JWT plus rotating refresh token in an httpOnly cookie for the web; secure storage on desktop and mobile.
- **Rate limits and lockouts:** Redis-backed counters shared by every API process (login, OTP, public API).
- **Tenant isolation:** a Prisma extension injects `tenant_id` into every query. An automated test suite tries to read across tenants on every endpoint.
- **Super admin access to tenant data:** only through a "support session" that is time-limited, reason-required, visible to the tenant and audit-logged.
- **Audit log:** append-only and hash-chained (`prev_hash`). It covers every change, every sensitive-field read and every signature.
- **Transport and headers:** HTTPS everywhere, HSTS, strict CSP on the SPAs (set in `.htaccess`), and CORS limited to the known frontends.
- **DPDP readiness** (full obligations from 13 May 2027): privacy notice acknowledgement per version, personal data inventory, retention rules, self-service access and correction, breach runbook.
- **Backups:** nightly encrypted MySQL dump and storage sync to off-site storage, with 30-day retention and a quarterly restore test.
- **Monitoring:** Sentry (API, SPAs, desktop) and an external uptime check on `api.flourishive.in/health`.

---

## 9. Phases

Each phase has its own file in [`phases/`](phases/), with its goal, task checklist, data introduced, the decisions that apply, exit criteria, risks and open items. Each phase ends with something running in production and exit criteria the product owner signs off.

| Phase | File | Depends on | Status |
|---|---|---|---|
| 0 — Setup, design system and signing spike | [phase-00-setup-design-signing-spike.md](phases/phase-00-setup-design-signing-spike.md) | – | In progress |
| 1 — Minimal, tenant-aware core | [phase-01-core-platform.md](phases/phase-01-core-platform.md) | 0 | Not started |
| 2 — Documents and digital signing (first go-live for Flourisense) | [phase-02-documents-and-signing.md](phases/phase-02-documents-and-signing.md) | 1 | Not started |
| 2B — Platform control centre (config, branding, email, staff roles, accounts, logs) | [phase-02b-platform-control-centre.md](phases/phase-02b-platform-control-centre.md) | 2 | Not started |
| 3 — SaaS layer (ready for the second customer) | [phase-03-saas-layer.md](phases/phase-03-saas-layer.md) | 2 | Not started |
| 4 — People core and self-service | [phase-04-people-core.md](phases/phase-04-people-core.md) | 3 | Not started |
| 5 — Onboarding and offboarding | [phase-05-onboarding-offboarding.md](phases/phase-05-onboarding-offboarding.md) | 4 | Not started |
| 6 — Leave and attendance | [phase-06-leave-attendance.md](phases/phase-06-leave-attendance.md) | 4 | Not started |
| 7 — Mobile app (React Native + Expo) | [phase-07-mobile-app.md](phases/phase-07-mobile-app.md) | 6 | Not started |
| 8 — Payroll | [phase-08-payroll.md](phases/phase-08-payroll.md) | 5, 6 | Not started |
| 9 — Talent | [phase-09-talent.md](phases/phase-09-talent.md) | 5 | Not started |
| 10 — Reports and integrations | [phase-10-reports-integrations.md](phases/phase-10-reports-integrations.md) | 4–8 | Not started |

Phases 0–3 (with 2B between 2 and 3) are fixed in order. Phases 4–10 can be reordered for business priority, and each is detailed and approved before it starts.

---

## 10. Engineering practices

- TypeScript `strict` everywhere; Zod schemas shared between API validation, OpenAPI and the frontends.
- Tests on every pull request: unit tests, API tests (including cross-tenant access tests), and end-to-end tests for the signing flow using a SoftHSM test token.
- Database changes only through Prisma migrations; never edit production data by hand.
- Pull requests with at least one review; `main` is always deployable; each app deploys independently.
- One ADR per significant decision in `docs/adr/`.
- Seed scripts with realistic fake tenants, entities and people for local and staging.
- Environments: local (Homebrew services: MySQL, Redis, Mailpit, SoftHSM), staging (`staging.flourishive.in` subdomains on the same host, separate database and a test DSC), production.

---

## 11. Proposals (all approved 8 Nov 2026 as D-24 – D-29; kept for the reasoning)

| # | Topic | Recommended | Alternative |
|---|---|---|---|
| P-01 | Desktop ↔ API connection | Desktop app pairs with the user's account (one-time code from the web app) and talks to the API directly; the web app opens it with a `flourishive://` link. No localhost server, so no browser security blocks. | Browser talks to the desktop app on `localhost` (as in the 1 Nov document). Chrome's Private Network Access rules increasingly block this, and it needs a local HTTPS certificate. |
| P-02 | Tamper-evidence for OTP-accepted documents | Seal the final PDF server-side with a Flourishive organisation document-signing certificate (`.p12`, signed in Node with @signpdf), so any edit shows as invalid. | Store the hash in the audit log only; editing the PDF isn't visibly flagged. |
| P-03 | Toolchain | pnpm workspaces + Turborepo; Vitest (unit) and Playwright (E2E); ESLint + Prettier; uv + pytest for the desktop app. | npm workspaces without Turborepo; Biome instead of ESLint + Prettier. |
| P-04 | VPS migration trigger | Move to a VPS when the first paying external customer signs, or at 300 active users, whichever comes first. | Stay on shared hosting until performance problems appear. |
| P-05 | Aadhaar eSign provider | Get quotes from 2–3 licensed providers (for example Digio, Leegality, eMudhra, Protean) during Phase 1; build against the adapter; choose before Phase 2. | Pick one now without comparison. |
| P-06 | Custom fields | Ship in Phase 3 for persons and engagements (text, number, date, select, file), with role-based visibility. | Defer until a customer asks. |

---

## 12. Product owner answers (8 Nov 2026)

| Question | Answer |
|---|---|
| Who builds and maintains it | Sumeet with Claude (Claude Code). |
| Phase 2 go-live target | As soon as possible, so Phase 0 runs the repo, deploy pipeline and signing spike in parallel. |
| DSC token brand | mToken, in the HR lead's name. The macOS driver must be verified in the spike. |
| States | Maharashtra (drives professional tax, holidays and Shops & Establishments rules). |
| Hosting | Existing cPanel hosting account; to be checked against §3.2 before Phase 0 deploys. |
| Headcount now / in 2 years | Still open. |
