# Phase 2B — Platform control centre

**Status:** Decisions approved 2026-11-22; build started 2026-11-23 (PR 1, 2 and 3 built, in review) · **Depends on:** Phase 2 · **Unlocks:** Phase 3 (now billing, SSO and the public API only)

## Goal

The super admin, and tenant admins within limits, can run and shape every tenant from the console without a code change or a server edit:

- brand and theme, with uploads, pickers and a live preview
- email senders, wording and delivery
- API keys and integration settings
- platform staff roles
- user accounts and two-step sign-in
- readable logs and alerts
- region, sign-in and notification rules
- custom domains
- platform-wide switches

## Where things stand today (2026-11-22)

- **Platform staff:** `platform_users` has no role. Every console user is an equal super admin.
- **Super admin powers:** create, rename and suspend tenants; DNS sync; about 10 settings (`backend/src/modules/settings/registry.ts`); two-step policy per role. No action on a tenant user's password or two-step.
- **Branding:** `branding.accentColor` (typed hex text), `branding.defaultTheme`, `branding.emailSenderName`. No logo. Bug: the accent default is still the old bronze `#c4914f`, but the UI moved to mint (D-53).
- **Product brand:** the name, tagline and addresses live in a static `brand.json` next to each app (`packages/ui/src/brand.ts`).
- **Email:** one SMTP account from `api.env` (`backend/src/platform/mail/mail.service.ts`). Only the sender display name varies per tenant. No delivery record.
- **Keys:** every key lives only in `/etc/flourishive/api.env` (`backend/src/platform/config/config.ts`).
- **Two-step:**
  - Each role has a two-step policy with a platform floor that tenants cannot go below (`role-policy.service.ts`).
  - No remembered devices, passkeys or opting out.
- **Logs:** only the tamper-evident audit log (tenant `audit_log` and platform audit). No request IDs and no error log. Nest `Logger` writes to journald only.

## Decisions (approved 2026-11-22, D-53..D-71)

- **D-53 Visual direction v2 (supersedes D-08's colours):** light-first mint and deep teal, Outfit headings, large radii (merged in #14). Dark is a green-black. Tenants still set their own accent (D-61).
- **D-54 Placement:** a new Phase 2B between Phase 2 and Phase 3. These items move here from Phase 3:
  - settings editor
  - tenant branding
  - support sessions
  - module on/off per tenant (without billing)
- **D-55 Platform staff roles:** permission-based like tenant roles.
  - Seeded presets: Owner, Super admin, Support, Read-only auditor.
  - Owners create roles and tick permissions per area.
  - There must always be at least one active Owner.
- **D-56 Support access:**
  - Tenant metadata is always visible to roles that have the permission.
  - Tenant data needs a support session: time-limited, reason required, a banner inside the tenant and an audit entry on both sides.
  - Sessions are read-only by default. Write access is a separate permission.
- **D-57 Runtime config and secrets:**
  - Integration settings and keys are stored in the database. Secrets are encrypted with `FIELD_ENCRYPTION_KEY`.
  - Secrets are write-only: after saving, the console shows only "set on <date> by <who>".
  - Each group has a Test button. Saving needs a step-up check (two-step or password within the last 5 minutes).
  - Lookup order: database, then `api.env`, then the built-in default.
  - Bootstrap keys never move out of `api.env`: `DATABASE_URL`, `REDIS_URL`, `FIELD_ENCRYPTION_KEY`, `HMAC_SECRET`, `JWT_SECRET`, `NODE_ENV`, `PORT`.
- **D-58 Email senders:**
  - Every tenant uses the platform sender by default.
  - A tenant may switch to its own sender:
    - (a) its own SMTP account, or
    - (b) a verified From address on the platform account.
  - Either the super admin or a tenant admin with `email.manage` sets it up.
  - A sender goes live only after (1) a 6-digit code emailed to the address is entered, (2) a test mail succeeds through the new settings, and (3) SPF, DKIM and DMARC are looked up. DNS results are shown as green or amber with fix-it hints; amber warns but does not block.
- **D-59 Email templates:** per event, a subject and body with `{{variable}}` placeholders.
  - Variables come from a per-event allow-list and are always HTML-escaped. No logic in templates.
  - Live preview, send-a-test and reset-to-default.
  - Platform defaults; tenants override only where the super admin has unlocked it.
  - The branded header and footer are applied automatically.
- **D-60 Mail delivery log:** every email is recorded (recipient, event, tenant, status, provider message or error, attempts) and can be resent.
  - OTP, reset and invite bodies are never stored. Resending them issues a fresh code or link.
- **D-61 Tenant branding:**
  - Assets: logo (light and dark), favicon, sign-in panel (headline, tagline, colour or image), email header and footer, display name, support email and phone.
  - Colours: preset themes (Mint, Bronze, Ocean, Plum, Slate) or any accent from a colour picker.
    - Hover and soft shades are generated.
    - A WCAG AA contrast check blocks unreadable choices.
  - Fonts: a curated list of tested heading and body pairs.
  - Publishing: edit a draft with a live preview (app shell, sign-in, email; light and dark), then publish, with one-click revert to the previous version.
- **D-62 Product brand in the database:** the super admin edits the product brand in the console, and `GET /v1/brand` serves it publicly. `brand.json` stays only as a fallback when the API is unreachable.
  - Brand fields: name, logo, favicon, tagline, sign-in panel bullets, support contact, terms and privacy links.
- **D-63 Account actions:**
  - The actions:
    - reset password (by link only; nobody sees or sets the password)
    - reset two-step (the user enrols again)
    - unlock, sign out everywhere
    - suspend and reactivate, resend invite
    - change sign-in email (confirmation sent to both the old and the new address)
  - Every action needs a reason and a step-up check, emails the user and is audited.
  - The super admin can act on anyone.
  - A tenant admin can act only on users whose permissions are a subset of their own, and never on themselves through this route.
- **D-64 Two-step ease:**
  - Remember this device (default 30 days, configurable per tenant and for platform staff; listed and revocable).
  - Email code fallback where the role's policy allows it.
  - Passkeys (WebAuthn).
  - A separate "stay signed in" length for admin roles.
- **D-65 Two-step opt-out (supersedes the "mandatory" part of D-16):**
  - The policy decides. Platform floors are removed; the platform defaults for admin roles stay REQUIRED, but as defaults only.
  - When a person's policy is OPTIONAL, they can turn off their own two-step from My security after re-entering their password. A red warning shows, the change is audited, and admins can see who has it off.
- **D-66 Break-glass:** another Owner resets a locked-out Owner in the console. If no other Owner can, the server command `node dist/cli.js platform-reset-mfa <email>` does it, and the use is audited.
- **D-67 Logs:**
  - Four kinds:
    - errors, as a plain-English story with the technical detail folded underneath
    - request activity
    - background jobs and emails
    - sign-in activity
  - Every request has an ID (`X-Request-Id`).
  - Stored in MySQL with personal data masked. Retention is set by the Owner: 7 to 180 days, default 30.
  - Errors are also forwarded to an external error service (Sentry-compatible DSN) when one is configured.
- **D-68 Alerts:**
  - Each super admin or tenant admin chooses their own alert emails: which events, and whether each is instant, in a daily digest, or off.
  - Tenant admins only see events for their own tenant.
  - Everything is off by default. The setup wizard asks.
- **D-69 Company configuration added:**
  - region and formats
  - sign-in rules (password strength, expiry and reuse; idle timeout; allowed email domains; optional IP allowlist for admin roles)
  - notification rules (event by role matrix, reminder timings, quiet hours)
  - custom domains (`hr.company.com`, CNAME to `custom.flourishive.in`, HTTPS through Caddy on-demand TLS, allowed only for verified domains)
- **D-70 Platform controls:**
  - announcement banner (all or chosen tenants)
  - maintenance mode (friendly page; only platform staff can sign in)
  - feature switches per tenant
  - tenant usage overview
  - settings and branding import/export as a JSON file, which never includes secrets
- **D-71 Console UX:**
  - One Settings area grouped as Brand, Email, Security, Sign-in, Region, Notifications, Integrations, Logs.
  - Every setting shows:
    - the right control (picker, upload, toggle, list)
    - a one-line hint
    - who can change it
    - a lock that lets the super admin allow or block tenant admins
  - Ctrl+K finds any setting.
  - A step-by-step setup wizard for new tenants.

## Rules for whoever builds this (read first)

These match how Phases 1 and 2 were built. Breaking them has caused real bugs before.

1. **One PR per slice below, in order.** Each slice ships to production on its own (merging to `main` deploys; see `docs/runbooks/vps-hosting.md`). Tick the boxes in this file in the same PR.
2. **Tenancy:**
   - Tenant-owned tables have `tenantId` and go through the tenant data layer.
   - Prisma creates must pass `tenantId` explicitly (the extension verifies it; only reads, updates and deletes are injected).
   - Wrap platform work in `runAsSystem` and tenant work in `runInTenant`.
   - Add every new tenant endpoint to `backend/test/cross-tenant-endpoints.e2e-spec.ts`.
3. **Contracts:**
   - Request and response shapes go in `packages/schemas` (Zod).
   - The client in `packages/api-client` is hand-written: add methods there.
   - Extend `backend/test/contracts.e2e-spec.ts` for every new endpoint.
4. **Settings:** declare every new setting once in `backend/src/modules/settings/registry.ts`. Never read `process.env` outside `platform/config`. Runtime keys go through the new `RuntimeConfigService` (PR 1).
5. **Audit:** every change of state writes an audit entry. Tenant changes go to `audit_log`; platform changes go to the platform audit through `PlatformAuditService`.
   - Never put secrets, passwords, codes, tokens or personal data values in `meta`.
   - Add a readable label in `frontend/web/src/lib/audit-labels.ts` and its admin equivalent.
6. **Permissions:**
   - New tenant codes go in `backend/src/modules/access/permissions.ts`.
   - New platform codes go in the new `platform-permissions.ts` (PR 2).
   - Re-run the seed; it is idempotent.
   - Guard every endpoint, and also hide UI the user cannot use.
7. **Step-up:** secrets, account actions, role and permission changes, sender activation and two-step opt-out require `@RequireStepUp()` (PR 1).
8. **Caching:** settings and permissions are cached in Redis (D-32). Invalidate on every write.
9. **UI:**
   - Use `@flourishive/ui` components and tokens only. No raw hex colours in screens.
   - Async buttons use `loading` (or return a promise from `onClick`).
   - Empty, loading (`Skeleton` / `PageLoader`) and error states are required.
   - Check light and dark.
10. **Before opening a PR:** run `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm --filter @flourishive/backend test:e2e`. CI runs the same and a red PR is never merged.
    - If you touch `packages/design-tokens/src/tokens.css`, the desktop colours in `desktop/src/flourishive_desktop/design.py` must match (`test_design_sync.py`).
11. **Check it in a browser** against the local API (`pnpm start:dev` in `backend`; web :5173, admin :5174, verify :5175), signed in with the dev logins.
    - The dev logins are in `backend/.env` and the seed. Never copy them into code or docs.
    - State in the PR what you saw.
12. **Security defaults:**
    - Rate-limit every endpoint that sends mail or checks a code.
    - Validate uploads by content, not extension.
    - Never let a tenant-supplied host reach private or loopback addresses (SMTP test, see PR 5).

---

## Work breakdown

### PR 1 — Foundations: typed settings v2, runtime config and secrets, step-up

**Backend**
- [x] Registry v2 (`modules/settings/registry.ts`). Add the following to `SettingDefinition`:
  - `kind`: `boolean | number | enum | color | font | image | text | longtext | email | url | secret | list | timezone | json`. Stop inferring it from the key name (`shapeOf` today).
  - `group`: `Brand | Email | Security | Sign-in | Region | Notifications | Integrations | Logs | Platform`
  - `hint`: a one-line "what this does"
  - `tenantEditable`: the default for the lock
  - `sensitive`: true for `secret`
  - `scope`: `platform` (runtime config) or `layered` (today's user → entity → tenant → platform chain)
- [x] Fix the default `branding.accentColor` to `#2a9158` (D-53). Add a data migration that leaves explicitly set tenant values alone.
- [x] `RuntimeConfigService` (`platform/config/runtime-config.service.ts`):
  - `get(key)` resolves database (`platform_config`), then `api.env`, then the default, with a 60-second Redis cache invalidated on write.
  - Secrets are decrypted with `CryptoService` only at the point of use.
- [x] Data: `platform_config` (`key` PK, `valueJson` for plain values, `secretEnc` for secrets, `updatedBy`, `updatedAt`). Secrets are never returned by any API; the API returns `{ isSet, updatedAt, updatedBy }`.
- [x] Move these keys into runtime config _(R2 keys are editable but the storage driver reads them once at startup, so a change needs an API restart; the console says so. Error tracking test checks the DSN only; sending a real test event arrives with PR 8.)_ (keep the env names as fallbacks):
  - `SMTP_*`, `MAIL_FROM`
  - `GOOGLE_CLIENT_ID`
  - `CLOUDFLARE_*`, `DNS_TARGET_IP`
  - `SEAL_TSA_URL`, `DSC_TSA_URL`
  - `ERROR_TRACKING_DSN` (new)
  - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (from Phase 2 PR 8, D-72); `STORAGE_DRIVER` stays in `api.env`
  - `TENANT_URL_TEMPLATE`, `WEB_URL`, `ADMIN_URL`, `VERIFY_URL`, `API_URL`
  - Each consumer reads through `RuntimeConfigService`. `MailService` rebuilds its transport when SMTP settings change.
- [x] Test actions per group: `POST /v1/platform/config/test/:group` (smtp: connect, then EHLO; cloudflare: zone read; google: client id format; error tracking: send a test event). The result says what failed in plain words.
- [x] Step-up:
  - `POST /v1/auth/step-up` and `POST /v1/platform/auth/step-up` take a two-step code (or the password if the user has no two-step) and mark the session as stepped-up for 5 minutes.
  - `@RequireStepUp()` returns `403 { code: 'STEP_UP_REQUIRED' }`.
- [x] Request ID middleware: accept or generate `X-Request-Id`, put it in the async context, return it on every response and in every error body. PR 8 builds on it.

**Frontend**
- [x] `SettingControl` (`packages/ui/src/components/setting-control.tsx`) handles every new kind:
  - colour: picker plus hex, with a swatch
  - font: dropdown with a live sample, from the curated list in PR 7
  - image: upload with preview and remove
  - secret: masked, "Replace" button, shows `set on … by …`
  - list: chips
  - timezone: searchable select
  - longtext: textarea
- [x] `StepUpDialog` (shared): appears automatically when an API call returns `STEP_UP_REQUIRED`, asks for the code, then retries the call.
- [x] Admin console, Settings, then Integrations: the runtime config groups with Test buttons.

**Done when:** the super admin changes the SMTP password in the console (after step-up), the Test button shows success, a password-reset email goes out through it, `api.env` is untouched, and the old value is not visible anywhere.

### PR 2 — Platform staff roles and support sessions (D-55, D-56)

**Backend**
- [x] `platform-permissions.ts` catalogue, for example:
  - `tenants.read`, `tenants.manage`, `tenants.users.read`, `tenants.users.manage`, `tenants.data.read`, `tenants.data.write`
  - `staff.manage`, `roles.manage`
  - `config.read`, `config.secrets.manage`
  - `email.manage`, `brand.manage`
  - `logs.read`, `logs.errors.detail`, `alerts.manage`
  - `platform.controls`
- [x] Data: `platform_roles` (`id`, `key`, `name`, `isPreset`), `platform_role_permissions`, `platform_users.roleId` (required).
  - Migration: every existing platform user becomes Owner.
  - Seed the presets:
    - **Owner:** everything
    - **Super admin:** everything except `staff.manage`, `roles.manage` and `config.secrets.manage`
    - **Support:** `tenants.read`, `tenants.users.read`, `logs.read`, and support sessions read-only
    - **Read-only auditor:** `tenants.read`, `logs.read`, platform audit read
- [x] `@RequirePlatformPermission(code)` guard. Every existing platform endpoint gets a code, and `PlatformGuard` loads permissions (cached).
- [x] Invariants, enforced in the service and covered by tests:
  - At least one active Owner always.
  - You cannot remove your own `roles.manage`.
  - Only an Owner can grant Owner.
- [x] Support sessions:
  - Data: `support_sessions` (`tenantId`, `platformUserId`, `reason`, `mode: READ|WRITE`, `startedAt`, `expiresAt` (max 4 h, default 1 h), `endedAt`).
  - `POST /v1/platform/tenants/:id/support-sessions` issues a short-lived tenant-audience token flagged `support: { sessionId, mode }`.
  - READ mode rejects every non-GET request (one guard).
  - WRITE mode needs `tenants.data.write`.
  - Every request made in a session is audited in the tenant as actor `SUPPORT`.
- [x] The tenant sees support sessions: a banner in the web app while a session is active ("Flourishive support is viewing your account until 15:30, reason: …"), and a list in their Audit screen.

**Frontend (admin)**
- [x] Staff screen: invite, assign role, suspend.
- [x] Roles screen: preset roles are read-only (they can be duplicated); custom roles use a permission checklist grouped by area, with plain-English descriptions.
- [x] Tenant detail: an "Open as support" button with reason and mode, opening the web app in a new tab with a top banner and an "End session" button.
- [x] Navigation and actions are hidden when the permission is missing.

**Done when:** a Support user can see tenants and logs but not keys. They open a 1-hour read-only session with a reason, the tenant admin sees the banner and the audit line, and a write attempt in that session is refused.

### PR 3 — Account and two-step management (D-63, D-64 except passkeys, D-65, D-66)

**Backend**
- [x] Account action service, shared by the tenant and platform routes:
  - `reset-password` (emails a reset link and ends the user's sessions)
  - `reset-mfa` (clears the secret, recovery codes and trusted devices; the user enrols at next sign-in if the policy requires it)
  - `unlock` (clears the lockout counters in Redis)
  - `sign-out-everywhere`
  - `suspend` / `reactivate`
  - `resend-invite`
  - `change-email`: pending until confirmed from the new address; the old address gets a notice with a "this wasn't me" link that cancels the change and locks the account for review _(NOT BUILT in this PR: deferred, needs its own confirmation flow)_
  - Each takes `{ reason }`, needs step-up, writes an audit entry and emails the user ("Your two-step sign-in was reset by <name> at <company>").
- [x] Routes:
  - tenant: `POST /v1/users/:id/actions/:action` (permission `users.manage`, plus the subset rule from D-63, never on yourself)
  - platform: `POST /v1/platform/tenants/:tid/users/:id/actions/:action` (`tenants.users.manage`) and `POST /v1/platform/staff/:id/actions/:action` (`staff.manage`; the Owner rules from PR 2)
- [x] Subset rule helper `canActOn(actor, target)`: the target's effective permissions must be a subset of the actor's. Unit-test it with tricky cases (equal roles, an entity-scoped role, the target holding a custom role).
- [x] Two-step policy (D-65):
  - Remove `mfaFloor` enforcement from `role-policy.service.ts`. Keep the column for history, ignore it, and drop it after one release.
  - Admin-role defaults stay REQUIRED.
  - `platform.superAdminMfa` accepts OFF, OPTIONAL and REQUIRED with no floor.
  - Self opt-out: `POST /v1/auth/mfa/disable` with password re-entry, allowed only when the effective policy is OFF or OPTIONAL. Same for platform staff.
- [x] Trusted devices:
  - Data: `trusted_devices` and `platform_trusted_devices` (`userId`, `tokenHash`, `label` from the user agent, `createdAt`, `lastUsedAt`, `expiresAt`).
  - After a two-step success, "Remember this device" sets an httpOnly, SameSite=Strict cookie holding a random token.
  - Sign-in skips the code when the cookie matches and has not expired.
  - New settings: `security.trustedDeviceDays` (0 to 90, default 30; tenant and platform) and `security.adminSessionDays` (separate length for roles with any `*.manage` permission).
- [x] Email-code fallback: on the two-step step, "Email me a code instead" appears when the role policy allows it. This reuses the existing OTP service and is rate-limited.
- [x] Break-glass: `cli.ts platform-reset-mfa <email>` clears two-step for a platform user, ends their sessions, writes a platform audit entry with actor `SYSTEM_CLI`, and prints next steps. Document it in `docs/runbooks/vps-hosting.md`.

**Frontend**
- [x] Web, People, then person detail, then an Account panel: status, last sign-in, two-step on or off, trusted devices count, and an Actions menu with a reason dialog and step-up.
- [x] Admin, Tenant detail, then Users: the same panel for any tenant user.
- [x] Admin, Staff: the same for platform staff.
- [x] My security (web and admin):
  - trusted devices list with revoke
  - "Turn off two-step" when allowed, with a red warning
  - email fallback toggle shown according to policy
- [ ] Admin and web Policy screens show "who has two-step off" counts per role. _(deferred)_

**Done when:** a tenant admin resets a staff member's two-step and that person re-enrols. The same admin cannot reset a higher admin. A super admin turns platform two-step to OPTIONAL and turns their own off. A trusted device skips the code for 30 days. The break-glass command works on a test server.

### PR 4 — Passkeys (D-64)

- [x] Library: `@simplewebauthn/server` and `@simplewebauthn/browser`. Relying-party ID: the tenant host (`<slug>.flourishive.in` or the custom domain) for tenants, and `admin.flourishive.in` for platform staff. _(Built: the host of the browser's Origin; for staff it must equal `ADMIN_URL`.)_
- [x] Data: `passkeys` and `platform_passkeys` (`userId`, `credentialId`, `publicKey`, `counter`, `transports`, `label`, `createdAt`, `lastUsedAt`).
- [x] Registration from My security (needs step-up). A passkey counts as a second factor, and as password plus two-step in one step when used to sign in.
- [x] Sign-in: the email step offers "Use a passkey" when the browser supports it.
- [x] Policy: a passkey satisfies REQUIRED two-step. Admins can see and remove a user's passkeys through account actions. _(Built: the account panel shows the count, and Reset two-step also removes passkeys, in the company and staff routes and in the break-glass command.)_
- [x] Tests: registration and authentication ceremonies with a software authenticator (`test/virtual-authenticator.ts`), not library vectors. Replay with an old counter is refused.

**Done when:** an admin signs in with Touch ID on a Mac and Face ID on an iPhone without typing a code.

### PR 5 — Email senders, verification and delivery log (D-58, D-60)

**Backend**
- [x] Data:
  - `mail_senders` (`tenantId` nullable = platform):
    - `kind`: `PLATFORM_DEFAULT | VERIFIED_FROM | OWN_SMTP`
    - `fromName`, `fromAddress`, `replyTo`
    - `smtpHost`, `smtpPort`, `smtpSecure`, `smtpUser`, `smtpPassEnc`
    - `status`: `DRAFT | VERIFYING | ACTIVE | FAILED`
    - `verifiedAt`, `lastTestAt`, `lastTestResult`, `dnsReport` (JSON)
  - `mail_deliveries`: `tenantId`, `event`, `to` (stored masked, e.g. `as***@gmail.com`, plus a hash for search), `senderId`, `status` (`QUEUED | SENT | FAILED`), `providerMessageId`, `error`, `attempts`, `requestId`, `createdAt`, `sentAt`.
- [x] Sending goes through the queue (`platform/queue`) with retries (3, with backoff). _(Built: the first attempt is inline, so codes and links are not held up waiting for the cron worker; a failure is logged and retried by the worker, 3 tries with backoff. The message is held in Redis for an hour for the retry; it is never stored in the database.)_ `MailService.send` picks the tenant's ACTIVE sender, else the platform default.
- [x] Verification flow `POST /v1/mail/senders/:id/verify/start`:
  1. Email a 6-digit code to `fromAddress` (expires in 10 minutes, 5 attempts).
  2. `verify/confirm` with the code.
  3. Test send through the sender's own transport to the requesting admin.
  4. DNS report: SPF (TXT on the domain includes the provider), DKIM (selector entered by the admin, or common selectors tried), DMARC (`_dmarc` TXT). Each is shown as pass or warn with a fix-it hint written for a non-technical admin.
  5. `activate` is allowed only after steps 2 and 3.
- [x] SSRF guard for `OWN_SMTP`:
  - Resolve the host. Refuse private, loopback, link-local and metadata addresses.
  - Allow only ports 25, 465, 587 and 2525.
  - Time out after 10 seconds.
- [x] Permissions: tenant `email.manage` (new); platform `email.manage`. The super admin can do all of it for any tenant. _(Built: the super admin sees the email log across companies, can resend, and can switch a company back to the default sender. Setting up a sender on a company's behalf is not built; they can use a support session.)_
- [x] Delivery log API with filters (event, status, date, recipient search by hash) and `POST /v1/mail/deliveries/:id/resend`. For OTP, reset and invite events, resending re-runs the event to issue a fresh code or link. _(Built differently: Resend sends the held copy while it is under an hour old. After that it says to repeat the action, for example Forgot password. Re-running each event is not built.)_

**Frontend**
- [x] Settings, then Email: current sender card; "Use our own sender" wizard (choose a kind, enter details, verify the code, test, DNS report, activate); "Switch back to default".
- [x] Email log screen in web (tenant) and admin (platform, filter by tenant), with statuses, plain-English errors (for example "Gmail refused the login. Use an app password." mapped from common SMTP codes) and Resend.

**Done when:** a tenant admin connects their Google Workspace SMTP with an app password, verifies it, sees an amber DMARC warning with a fix hint, activates it, and an invite arrives from their address. A failed send shows in the log with a readable reason and resends successfully.

### PR 6 — Email templates (D-59)

- [x] _(Built: the events that exist today. Sign-in from a new device, email-change notices, "letter signed", account-action notices to company users and the alert/digest mails do not exist yet or are written by the caller; add them to `events.ts` when they land. The email layout uses the product name and a default accent until PR 7 supplies the published brand.)_ Event catalogue in code (`modules/notifications/events.ts`): key, description, allowed variables with sample values, and a default subject and body. Events:
  - invite, password reset
  - two-step code, two-step reset notice
  - sign-in from a new device
  - email change notices
  - letter sent for signature, letter signed, letter issued
  - acceptance OTP
  - account action notices (PR 3)
  - alert and digest emails (PR 8)
- [x] Renderer: minimal `{{path}}` substitution, always HTML-escaped. Unknown variables fail validation at save time. No helpers or logic. Markdown-lite body (paragraphs, bold, links, buttons as `[[Button text|{{link}}]]`) rendered into the branded email layout. Plain-text part generated.
- [x] Data: `email_templates` (`tenantId` nullable = platform override, `event`, `subject`, `body`, `updatedBy`, `updatedAt`). Resolution order: tenant, then platform override, then code default. Lock per event (`tenantEditable`) as for settings.
- [x] API: list events, get the effective template, save, reset, preview (render with sample values), send a test to yourself.
- [x] UI: Settings, then Email, then Templates. Event list on the left; editor with a variable picker (click to insert); live preview in light and dark; "Send me a test"; "Reset to default".

**Done when:** a tenant changes the invite wording and sees it in the preview. The test mail matches the preview. A placeholder that doesn't exist is rejected with a clear message.

### PR 7 — Branding: product and tenant, draft and publish (D-61, D-62)

**Backend** _(PR 7 is built in two stacked PRs. 7a, done here: everything below except logo/favicon/panel-image uploads. 7b: uploads, the sign-in panel image, and the logo in the email header and app.)_
- [x] Data:
  - `brand_profiles`: `scope` `PLATFORM | TENANT`, `tenantId`, `status` `DRAFT | PUBLISHED | ARCHIVED`, `version`, `data` JSON, `publishedBy`, `publishedAt`. Publishing archives the previous version; revert republishes the previous version as a new version.
  - The JSON shape lives in `packages/schemas/src/brand.ts`:
    - `displayName`
    - `logoLightFileId`, `logoDarkFileId`, `faviconFileId`
    - `theme`: `{ preset, accent, defaultMode: light|dark|system }`
    - `fonts`: `{ pairId }`
    - `signIn`: `{ headline, tagline, bullets[≤4], panelColor | panelImageFileId }`
    - `email`: `{ headerLogo: 'light'|'dark', bandColor, footerText, address }`
    - `support`: `{ email, phone, url }`
    - `legal`: `{ termsUrl, privacyUrl }` (platform only)
- [x] _(7b. Built as its own table, `brand_assets`, and a public route, because brand pictures must show before sign-in and the files module is private and per company. PNG, JPEG, WebP and SVG are accepted, checked by their bytes, up to 2 MB. SVG is rebuilt through DOMPurify (script, handlers, links, embedded pages removed). Rasters are re-encoded with sharp: logos to at most 512 px PNG, the sign-in picture to at most 2000 px WebP, the favicon to a 64 px square PNG, with an `.ico` made on request at `/v1/public/brand-assets/:id/favicon.ico`. The favicon file itself is the PNG; the 32 px PNG-in-ICO is generated when asked for.)_ Assets through the files module:
  - PNG, JPEG and WebP, plus SVG sanitised with DOMPurify server-side. Files are served with `Content-Security-Policy: sandbox` and `nosniff`.
  - Maximum 2 MB. Raster images are resized to 512 px for logos and 64/32 px PNG plus ICO for favicons.
  - Content type is checked by magic bytes.
- [x] _(Built in `packages/schemas/src/theme.ts`, because the API imports it and that package is built. Presets skip the contrast rule: Mint, the existing look, reaches 4.3:1 against the 4.5 AA mark. Custom colours are held to it.)_ Theme engine (`packages/design-tokens/src/theme.ts`, shared by backend validation and frontend):
  - From one accent, generate `--accent-hi` and `--accent-lo` for light and dark (OKLCH lightness steps).
  - Choose `--on-accent` (white or near-black) by contrast.
  - Reject the accent if neither text colour reaches 4.5:1 on the accent, or the accent reaches less than 3:1 on the surface (WCAG AA).
  - Presets: Mint (current), Bronze (the old D-08 palette), Ocean, Plum, Slate. Each is a full light and dark set.
- [x] Font pairs (curated, checked with Indian names and ₹ amounts):
  - Outfit / Hanken Grotesk
  - Inter / Inter
  - Manrope / Manrope
  - DM Sans / DM Sans
  - Plus Jakarta Sans / Plus Jakarta Sans
  - Poppins / Poppins
  - Source Serif 4 / Source Sans 3
  - Noto Sans / Noto Sans (Devanagari-safe)
  - Loaded from Google Fonts, falling back to system fonts.
- [x] _(Served at `/v1/public/brand` and `/v1/public/company/:slug/brand`, matching the existing public routes. Tenant-detail brand editing by the super admin is not built.)_ Public endpoints, cacheable for 5 minutes with an ETag:
  - `GET /v1/brand` (platform brand)
  - `GET /v1/company/:slug/brand` (published tenant brand, merged over the platform brand)
  - Draft and preview endpoints need `brand.manage` (tenant: new permission `brand.manage`; platform: `brand.manage`).
- [x] _(`branding.defaultTheme` stays as a personal, per-user choice; the company default is the brand's `defaultMode`. Values were migrated in SQL.)_ Remove `branding.accentColor` and `branding.defaultTheme` from the registry after migrating their values into each tenant's first published brand profile. Keep `branding.emailSenderName` (it moves into the sender settings in PR 5).

**Frontend**
- [x] `packages/ui/src/brand.ts` loads `/v1/brand` first, with `brand.json` as the fallback. Add `applyBrand(profile)`, which sets CSS variables, injects the font link, swaps the favicon, sets the title and exposes logo URLs.
- [x] `AuthFrame` and `BrandMark` show the logo when one is set (else the initial) and use the sign-in panel content and colour.
- [x] Web `lib/company.ts` replaces today's accent-only override with `applyBrand`. Tenant brand wins over platform brand.
- [x] Brand editor (web Settings, then Brand, for tenants; admin, then Product brand, and Tenant detail, then Brand, for the super admin):
  - Form on the left: uploads, preset cards, accent picker with live contrast badge, font pair cards with sample text.
  - Preview on the right, with tabs for App, Sign-in and Email, and a light/dark switch. It renders the real components in an isolated container with the draft variables.
  - Buttons: Save draft, Publish, Revert to previous; "Unpublished changes" badge.
- [x] Email layout uses the published brand (PR 6 renderer).

**Done when:** a tenant uploads a logo, picks Ocean, then a custom accent (an unreadable yellow is blocked with an explanation), picks Manrope, previews sign-in and an email in dark mode, publishes, then reverts. The super admin changes the product tagline in the console and every app shows it without a deploy.

### PR 8 — Logs, error tracking and alerts (D-67, D-68)

_Built: `nestjs-pino` stdout lines, `log_requests`/`log_errors`/`log_signins`/`alert_subscriptions`, stories, Sentry forwarding (also used by the Integrations test), nightly purge and the per-minute alert tick both run from the cron worker (`cli.js worker`). Error toasts show the reference for 5xx. The audit trail now stores the request id in `meta` and queued jobs keep it in their payload so a trace can find them. Digest uses Asia/Kolkata until PR 9 adds `region.timeZone`. The “Email” tab in the admin Logs reuses the email log; the company app keeps its separate Email log page._

**Backend**
- [x] Structured logger: `nestjs-pino` with request ID, tenant, actor and route on every line. Redact `authorization`, cookies, `password`, `code`, `token`, `secret` and email bodies. JSON goes to stdout (journald).
- [x] Data, all MySQL, each with a `createdAt` index and a `tenantId` index where relevant:
  - `log_requests`: `requestId`, `tenantId`, `actorType`, `actorId`, `method`, `routePattern` (e.g. `/v1/people/:id`, never raw IDs or query values), `status`, `durationMs`, `ip`, `userAgentShort`, `createdAt`
    - Writes go through a buffered batch insert every 2 seconds.
    - All non-GET requests, all 4xx/5xx and requests slower than 1 second are recorded. Successful GETs are sampled (setting `logs.sampleGetsPercent`, default 10).
  - `log_errors`: `requestId`, `tenantId`, `actorId`, `routePattern`, `errorCode`, `message`, `story` (plain-English, below), `stack` (only shown with `logs.errors.detail`), `fingerprint` (hash of the error type and top frame, used for grouping), `count`, `firstSeen`, `lastSeen`
  - `log_signins`: `tenantId` nullable for platform, `userId` nullable, `emailHash`, `outcome` (`SUCCESS | BAD_PASSWORD | LOCKED | MFA_OK | MFA_FAILED | PASSKEY | TRUSTED_DEVICE | SUSPENDED`), `ip`, `userAgentShort`, `createdAt`
  - Jobs already have `job_records`; email has `mail_deliveries` (PR 5).
- [x] The "story" builder turns each error into readable text from the request context, for example: *"Asha (HR admin, Flourisense) clicked Send for signature on letter FS/INT/2026/0012. The server could not reach the timestamp service (timestamp.digicert.com) and stopped. Nothing was sent. Try again in a few minutes; if it keeps failing, check Integrations, then Timestamp URL."*
  - Built from a map of known error codes to templates (`modules/logs/stories.ts`), plus a generic fallback.
  - Every `AppError` subclass gets a code.
- [x] Error forwarding: when `ERROR_TRACKING_DSN` is set, send to Sentry (`@sentry/node`) with the request ID as a tag and personal data stripped.
- [x] Retention job (nightly, queue): delete rows older than `logs.retentionDays` (7 to 180, default 30; platform-only setting).
- [x] Alerts:
  - Data: `alert_subscriptions`:
    - `subscriberType` (`PLATFORM_USER | USER`) and `subscriberId`
    - `tenantId` (forced to their own tenant for tenant users)
    - `event`: `ERROR_SPIKE | JOB_FAILING | MAIL_FAILING | AUDIT_CHAIN_BROKEN | SIGNIN_ATTACK | DISK_LOW | SENDER_DNS_BROKEN`
    - `delivery`: `INSTANT | DIGEST | OFF`
  - Thresholds are settings. Defaults: 20 errors in 10 minutes, 3 job failures in a row, 5 mail failures in 10 minutes, 50 failed sign-ins in 10 minutes for a tenant, disk free below 15%.
  - The alert evaluator runs every minute in the worker. It sends instant alerts at most once per event per hour (deduplicated in Redis).
  - The digest runs daily at 08:00 in the subscriber's time zone.
- [x] APIs:
  - platform `GET /v1/platform/logs/{requests|errors|signins|jobs|mail}` with filters (tenant, user, status, route, time range, request ID, text search on message)
  - `GET /v1/platform/logs/trace/:requestId`: everything sharing that ID, in time order
  - tenant equivalents restricted to their tenant (`audit.read` plus new `logs.read`)

**Frontend**
- [x] Admin Logs area (Errors, Activity, Sign-ins, Jobs, Email):
  - Errors are grouped by fingerprint, showing count, first and last seen, and the story in large type. "Technical detail" folds out to the stack, route and request ID.
  - "Trace this request" opens the timeline (request, job, mail, audit entries with the same request ID).
  - "Copy for support" copies a sanitised summary.
  - Filters are in the URL, so they can be shared.
- [x] Web, Settings, then Logs (tenant admin): Activity, Sign-ins, Email, and a simplified Errors view (story only, no stack).
- [x] Error toasts and error states in the web and admin apps show "Reference: <request ID>" so users can quote it.
- [x] Alerts page (My account, then Alerts) in web and admin: each event as a row with an Instant / Digest / Off control.

**Done when:** a forced error in staging appears in the console within 5 seconds with a readable story. The request ID from the user's error toast finds it. The trace shows the related job and email. An Owner who subscribed to MAIL_FAILING gets one email when SMTP is broken, not fifty. Rows older than the retention are gone the next morning.

### PR 9 — Company configuration: region, sign-in rules, notification rules (D-69)

_Built: region settings with `fmtDate`/`fmtDateTime`/`fmtNumber`/`fmtMoney` in `packages/ui/src/format.ts` (web and admin call them; direct `toLocale*` calls removed); password mix, expiry (blocks sign-in with “Forgot password”) and history (`password_history`); idle sign-out with a one-minute warning; allowed email domains (people create/update/invite); admin network allowlist (checked at sign-in before any second step, and on refresh); `notification_rules` with three events (letter issued, signer declined, approval reminder), reminders from `notifications.reminderHours`, and quiet hours that delay the queued job. In-app channel is stored but there is no in-app inbox yet, so the matrix is email only. Entity-level overrides exist in the registry but have no screen yet._

- [x] Region and formats (settings, tenant level, entity override where noted):
  - `region.timeZone` (default Asia/Kolkata; entity)
  - `region.dateFormat` (`DD MMM YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`)
  - `region.numberGrouping` (Indian / international)
  - `region.currency` (INR default)
  - `region.fyStartMonth` (April default; entity)
  - `region.weekStart`
  - Web and admin `lib/format.ts` read them: dates, numbers and money everywhere use the helpers. Find and replace direct `toLocaleString` and `Intl` calls.
- [x] Sign-in rules:
  - `security.passwordRequireMix` (letters + digits + symbol)
  - `security.passwordExpiryDays` (0 = never)
  - `security.passwordHistory` (0 to 10, using new table `password_history` of hashes)
  - `security.idleTimeoutMinutes` (web signs out after inactivity, with a 1-minute warning dialog)
  - `signin.allowedEmailDomains` (list; invites and email changes outside it are refused)
  - `signin.adminIpAllowlist` (list of CIDRs, applied to roles with any `*.manage` permission; checked at sign-in and on refresh; the super admin can always bypass through a support session)
- [x] Notification rules:
  - Data: `notification_rules` (`tenantId`, `event`, `roleKey` or `SUBJECT` meaning the person concerned, `channel` `EMAIL|IN_APP`, `enabled`)
  - `notifications.reminderHours` (list, e.g. 24 and 72)
  - `notifications.quietHours` (`{ start, end }` in the tenant time zone; non-urgent mail is held until the end; OTP, reset and security mail are never held)
  - UI: a matrix of events by roles with toggles, plus reminder and quiet-hour controls.

**Done when:** setting `DD/MM/YYYY` and international grouping changes every date and amount in the web app. A password from the last 5 is refused. An admin outside the IP allowlist is refused with a clear message. Turning off "letter issued, to HR admin" stops that email.

### PR 10 — Custom domains (D-69)

- [ ] Data: `tenant_domains` (`tenantId`, `hostname` unique, `status` `PENDING_DNS | VERIFIED | ACTIVE | FAILED`, `verificationToken`, `checkedAt`, `error`).
- [ ] Flow:
  1. The admin enters `hr.company.com`.
  2. We show two DNS records: `CNAME hr.company.com → custom.flourishive.in` and `TXT _flourishive.hr.company.com = <token>`.
  3. "Check now" (and a job every 10 minutes for 48 hours) resolves both.
  4. When both match, the domain is VERIFIED.
  5. The first HTTPS request issues the certificate, and the domain becomes ACTIVE.
- [ ] Infrastructure (`infra/vps/caddy/Caddyfile` and the runbook):
  - `custom.flourishive.in` is an A record to the VPS, DNS-only (not proxied).
  - A Caddy `on_demand_tls` block with `ask http://127.0.0.1:3000/v1/internal/domains/allowed?domain=…`, which returns 200 only for VERIFIED or ACTIVE hostnames (so certificates cannot be requested for arbitrary names).
  - Rate-limit the endpoint.
- [ ] Tenant resolution (`modules/company/tenant-host.ts`) also matches active custom hostnames (cached). CORS, cookie domain, the passkey relying-party ID (PR 4) and email links use the tenant's primary domain.
- [ ] Setting `domains.primary` chooses which address links in emails use.

**Done when:** a test domain points to us, verifies, gets HTTPS automatically, and sign-in, passkeys and email links all work on it. An unverified hostname gets no certificate.

### PR 11 — Platform controls (D-70)

- [ ] Announcement banner:
  - Data: `announcements` (`message`, `tone` info/warning/critical, `audience` all or a tenant list, `startsAt`, `endsAt`, `dismissible`).
  - The web app shows it above the page header; dismissal is remembered per user.
- [ ] Maintenance mode: the platform setting `platform.maintenance` (`{ enabled, message, until }`). The API returns 503 with the message for tenant routes, except sign-in by platform staff and support sessions. Web shows a friendly full-page screen with the message and time. Verify stays up.
- [ ] Feature switches per tenant:
  - Data: `tenant_features` (`tenantId`, `feature`, `enabled`). The catalogue is in code (`documents`, `letters.bulk`, `signing.dsc`, `signing.otp`, `signing.aadhaar`, `people.import`, `org`, plus later modules).
  - Guard `@RequireFeature()` on endpoints; web navigation hides disabled modules.
  - Phase 3's plan limits will layer on top of this.
- [ ] Usage overview: a nightly job writes `tenant_usage_daily` (users, active users in 30 days, people, letters this month, storage bytes, emails sent, last activity). The admin dashboard shows a table with sparklines (use the `dataviz` guidance) and a per-tenant detail.
- [ ] Settings import/export:
  - `GET /v1/platform/tenants/:id/export` gives JSON with settings, published brand (assets embedded as base64, maximum 5 MB total), email templates, notification rules, role policies and feature switches. Never secrets, sender SMTP passwords or user data.
  - `POST …/import` shows a dry-run diff and needs confirmation and step-up.

**Done when:** the super admin schedules a banner for one tenant, turns on maintenance and sees tenants get the maintenance page while staff can still sign in, turns off DSC signing for a tenant (the menu disappears and the API refuses it), and copies one tenant's setup into a new tenant through export and import.

### PR 12 — Setup wizard and settings hub (D-71)

- [ ] Admin: the "New tenant" wizard replaces today's single form. Steps:
  1. Company (name, slug, primary entity)
  2. First admin (invite)
  3. Brand (preset, logo, accent; optional, "do later")
  4. Email (platform default or own sender, which links into the PR 5 flow)
  5. Security (two-step policy per role, trusted device days, allowed domains)
  6. Features
  7. Alerts for this tenant
  8. Review and create
  - Progress is saved as a draft tenant until the last step. Each step is skippable where the default is safe.
- [ ] A tenant-side "Finish setting up" checklist on Home for the first admin (brand, email sender, invite people, security), driven by what is still default.
- [ ] Settings hub in web and admin:
  - Grouped navigation per D-71.
  - Every setting row shows the control, hint, current source ("default", "set by platform", "set by you"), a lock icon (super admin: click to allow or block tenant admins; tenant admin: shows locked and why) and "Reset to default".
  - Ctrl+K indexes every setting by label, hint and key, and jumps to it with a highlight.

**Done when:** a new tenant is created end to end through the wizard in under 5 minutes. A tenant admin finds "password expiry" with Ctrl+K, and sees why a locked setting is locked.

---

## Data introduced

`platform_config`, `platform_roles`, `platform_role_permissions`, `support_sessions`, `trusted_devices`, `platform_trusted_devices`, `passkeys`, `platform_passkeys`, `mail_senders`, `mail_deliveries`, `email_templates`, `brand_profiles`, `log_requests`, `log_errors`, `log_signins`, `alert_subscriptions`, `password_history`, `notification_rules`, `tenant_domains`, `announcements`, `tenant_features`, `tenant_usage_daily`

## New permissions

- Tenant: `email.manage`, `brand.manage`, `logs.read`. `users.manage` gains account actions.
- Platform: the PR 2 catalogue.

## Decisions that apply

D-01, D-03, D-16 (as amended by D-65), D-17, D-20, D-32, D-53 – D-71

## Exit criteria

1. The super admin changes the SMTP password, Google client ID and timestamp URL from the console without touching the server, and each Test passes.
2. A tenant admin brands their company (logo, preset or accent, font, sign-in panel, email header), previews it in light and dark, publishes it, and every screen and email shows it. The product brand is also edited in the console.
3. A tenant sends from its own verified address, and its email log shows deliveries and a resent failure.
4. A Support user works through a read-only support session that the tenant can see. They cannot see keys or change data.
5. A super admin resets a tenant user's password and two-step, and a tenant admin does the same within their limits. Trusted devices and passkeys remove repeated code entry, and an admin with an OPTIONAL policy can turn their own two-step off.
6. A real error is found by its reference number, read as a plain-English story, and traced across its job and email. Subscribed admins get exactly the alerts they chose.
7. A custom domain works with HTTPS, sign-in and passkeys.
8. A new tenant is set up through the wizard without developer help.

## Risks

- **Two-step opt-out (D-65)** weakens protection of admin accounts. Mitigations: defaults stay REQUIRED, opting out needs the password plus a warning, it is audited, admins can see who has it off, and alerts are available for it.
- **SSRF through tenant SMTP**, and **certificate abuse through custom domains**: guarded as described in PR 5 and PR 10. Both need tests.
- **Secrets in the database**: if `FIELD_ENCRYPTION_KEY` is lost, they cannot be decrypted. The key stays in `api.env`, and the runbook's off-server backup of `api.env` must exist before PR 1 ships.
- **Log volume on a single VPS**: sampling, batch inserts, retention and indexes. Watch the size of the `log_requests` table in the usage overview.

## Business inputs needed

- Final list of preset themes and font pairs (the suggested ones above are fine to start with)
- Wording for the default email templates (drafts are written in PR 6 for review)
- Terms of service and privacy policy URLs
- Optional: a Sentry (or compatible) project DSN for error forwarding
- Who the platform Owners are (at least two, so the break-glass server command is rarely needed)
