# Phase 0 — Setup, design system and signing spike

**Status:** In progress (started 8 Nov 2026) · **Depends on:** nothing · **Unlocks:** Phase 1, and the desktop work in Phase 2

## Goal

Everything needed before feature work: hosting and accounts ready, the repo and CI/CD deploying every app, an approved design system with prototypes, and proof that the mToken can sign PDFs on macOS and Windows.

## Work breakdown

### A. Accounts, domain and hosting
- [ ] Check the existing cPanel hosting against the checklist ([runbook](../runbooks/cpanel-host-check.md))
- [ ] Buy `flourishive.in`; point DNS to the cPanel host
- [ ] Create subdomains `app.`, `admin.`, `api.`, `verify.` and their `staging-` versions; enable AutoSSL
- [ ] Transactional email account (Zoho ZeptoMail or Amazon SES, D-17); SPF, DKIM and DMARC on `flourishive.in`
- [x] Private GitHub repository (done). [ ] Branch protection on `main` needs GitHub Pro or a paid org plan
- [ ] Sentry account (API, SPAs, desktop) and an external uptime monitor

### B. Repository and tooling
- [x] Monorepo skeleton as in plan §4 (pnpm workspaces + Turborepo)
- [x] NestJS API: `/v1` URI versioning, `/v1/health`, CORS allow-list, `passenger.cjs` start file for cPanel
- [x] Three Vite React SPAs (web :5173, admin :5174, verify :5175) with the shared `.htaccess`
- [x] Desktop Python project (uv, pyHanko 0.38 with PKCS#11)
- [x] Homebrew services installed (MySQL 8.4, Redis, Mailpit, SoftHSM, OpenSC)
- [x] `infra/local/setup.sh`: start the services, create the local database, write `.env` files. Local DB is MariaDB 10.6 (the Mac's shared MySQL data dir already holds MariaDB data, so MySQL 8.4 would not start); verify against the host's engine before Phase 1 migrations
- [x] Confirm oxlint (Nest 12 / Vite default) in place of ESLint (D-26): `pnpm lint` runs oxlint in every app and passes in CI
- [x] First commit and push to GitHub (private repo `sumeetbalwade/flourishive`; work goes through feature branches and PRs; branch protection is unavailable on a free private repo, so it is by convention)

### C. CI/CD (D-22)
- [x] GitHub Actions on every pull request: build, typecheck, lint, test for each app (`.github/workflows/ci.yml`)
- [ ] Deploy workflow for the API: build on CI, rsync over SSH, run migrations, restart the Node app
- [ ] Deploy workflows for web, admin and verify: build on CI, rsync `dist/` to each subdomain's document root
- [ ] Cron entries: worker every minute (a no-op until Phase 1) and a keep-warm ping every 5 minutes
- [ ] Staging deploys on `staging-*` subdomains with a separate database

### D. Design system (D-08, D-09)
- [x] Direction round approved 19 Nov 2026: Hanken Grotesk + Instrument Serif + JetBrains Mono; warm black + bronze `#c4914f` with semantic green/amber/red; 20px card radius, pill buttons and inputs, comfortable density; warm-paper light theme. Chart style still to confirm when charts are built
- [x] Tokens in `packages/design-tokens`: dark and light themes plus a tenant accent override (`--accent*` variables)
- [x] Components in `packages/ui` (Radix + Tailwind, restyled): button, input/field, select, date picker, table (with compact rows), card, badge, dialog, sheet, tabs, toast, avatar, app shell (sidebar + top bar), empty state, skeleton, bar and line charts. All shown in the `frontend/web` gallery. Dark theme checked in a browser; light theme still to eyeball
- [x] App shell: sidebar, top bar, theme switch (tenant branding via the brand slot and accent variables); shown in the web gallery
- [ ] Clickable prototypes: login + MFA, super admin tenant list and detail, letters list, template editor, signing queue, document detail with signature timeline, verify page, Flourishive Desktop window
- [ ] Signing animation (D-37): a signature line draws itself, then settles into a bronze checkmark; a batch variant advances page by page; failure and waiting states; reduced-motion version. Prototype for the desktop window, the web signature timeline and the candidate acceptance screen
- [ ] Product owner sign-off on the design

### E. Signing spike (plan §6.5, D-36)
- [x] Spike CLI `desktop/spikes/sign_with_token.py` (find-lib, list, sign, verify)
- [x] SoftHSM self-test passes: PAdES signature intact, valid and trusted; DigiCert timestamp trusted; entire file covered
- [ ] mToken on macOS ([runbook](../runbooks/dsc-signing-spike.md))
- [x] mToken on Windows (18 Nov 2026): token `mToken CryptoID` found through `C:\Windows\System32\CryptoIDA_pkcs11.dll` (64-bit), certificate listed as signing-capable, signed PDF created. Evidence in [docs/evidence/phase-0/](../evidence/phase-0/)
- [ ] **Renew the HR lead's DSC** (development continues on the expired one, D-38; renewal gates go-live, see Phase 2). The certificate on the token (ProDigiSign Sub CA DSC 2022) was valid 29 May 2024 to 29 May 2026, so it is **expired**. A signature made with it will not validate as trusted. A renewed Class 3 DSC is needed before any real letter is issued
- [ ] Verify the Windows signed PDF: send `signed.pdf` for checking with pyHanko, and an Adobe Reader screenshot of the signature panel (validity, timestamp). The stamp alone does not prove validity
- [ ] Re-run on Windows with the renewed DSC; Adobe Reader must show a valid signature with a timestamp

## Decisions that apply

D-02, D-04, D-06, D-07, D-08, D-09, D-12, D-18, D-22, D-26, D-34, D-36

## Exit criteria

1. Every app deploys from GitHub Actions to its subdomain, and `api.flourishive.in/v1/health` answers.
2. Cron runs the worker command every minute on the host.
3. The mToken signs the test letter on macOS and Windows, and Adobe Reader shows a valid signature with a timestamp.
4. The design system and prototypes are approved.

## Risks

| Risk | Impact | Response |
|---|---|---|
| The mToken has no working macOS driver | D-12 (macOS at launch) can't be met | Ship Windows first and revisit D-12 with you |
| The host lacks Node 22/24, SSH or 1-minute cron | The approved stack can't run | Ask the host to enable it, or bring the VPS move (D-27) forward |
| Design rounds take longer than expected | Phase 1 screens wait | Phase 1 backend work starts in parallel; only the screens wait for approval |

## Findings from the Windows run (18 Nov 2026)

- The mToken driver provides both a 64-bit (`C:\Windows\System32\CryptoIDA_pkcs11.dll`) and a 32-bit (`SysWOW64` and `Program Files (x86)\CryptoID`) library. 64-bit Python works with the System32 one, so the desktop app can ship as 64-bit and default to that path.
- The certificate subject has Organization = "Personal", so signatures show the HR lead's name, not the company's.
- The Windows console needed UTF-8 output; the spike now sets it.
- The spike report was not capturing Python output through the PowerShell transcript; the script now writes its own log.

## Open items

- Production timestamp authority (TSA): an Indian CA's TSA or another RFC 3161 service. To be decided after the spike.
- How backend dependencies get onto the host (installed on the host, or bundled on CI). To be decided when the deploy workflow is built.
