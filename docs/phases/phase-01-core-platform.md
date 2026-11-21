# Phase 1 — Minimal, tenant-aware core

**Status:** Build complete and merged (PRs 1 to 10, then the Phase 1b plan changes: per-role two-step and recovery, platform settings, company addresses, app shell, configurable name and domain). Only the exit checks that need real data remain (see Exit criteria) · **Depends on:** Phase 0 · **Unlocks:** Phase 2

## Goal

The smallest platform core that signing needs, built on the final data model: Flourisense runs as tenant #1, and `tenant_id` is enforced on every table from day one (D-03, D-19). Roles, settings and the super admin console start small but are not throwaway.

## Work breakdown

### Backend: platform adapters (`backend/src/platform/`)
- [x] `config/`: typed environment config, validated with Zod at startup
- [x] `database/`: Prisma on MySQL, schema split per module, a tenant-scoping extension that injects `tenant_id` into every query
- [x] `queue/`: BullMQ on Redis; `cli.ts worker --max-seconds=55` started by cron; `job_records` in MySQL plus a reconciler (D-30)
- [x] `cache/`: Redis for the settings and permission cache, rate limits and short-lived tokens (D-32)
- [x] `storage/`: local-disk adapter outside `public_html`, streamed uploads, short-lived signed download URLs
- [x] `mail/`: adapter with ZeptoMail or SES, and Mailpit locally
- [x] `crypto/`: AES-256-GCM field encryption, HMAC helpers

### Backend: modules (`backend/src/modules/`)
- [x] `tenancy`: tenants, entities (legal companies); seed Flourisense
- [x] `identity` (tenant users; password, TOTP + recovery codes, Google, JWT + rotating refresh, sessions): email + password (argon2id); TOTP MFA with recovery codes, mandatory for HR, admins and super admin; "Sign in with Google" (D-16); 15-minute access JWT plus rotating refresh token; sessions and sign-out everywhere
- [x] `access`: roles, permissions, user roles scoped to an entity; checks by permission code. Seeded roles: Tenant Admin, HR Lead, HR Executive, Manager, Employee, Intern
- [x] `settings`: registry and the user → entity → tenant → plan → platform resolution (plan §5). First settings: branding, password policy, MFA policy, session length
- [x] `org`: departments, designations, locations (Maharashtra)
- [x] `people`: persons, engagements, intern details; CSV import with validation and a dry-run preview
- [x] `files`, `audit` (hash-chained, append-only), `notifications` (email templates per event)
- [x] `platform-admin`: super admin users kept apart from tenant users (own tables and token audience, MFA always; tenants, staff and settings API)
- [x] Redis-backed rate limits and lockouts on login and MFA (the lockout threshold is a setting)
- [x] Nightly audit integrity check: `cli.js verify-audit` (cron, see `docs/runbooks/scheduled-jobs.md`); emails platform admins if any hash chain is broken

### Frontend
- [x] `packages/schemas` (shared Zod, used by the API and the clients) and `packages/api-client` (typed fetch client with token refresh; hand-written on the shared schemas instead of generated, because the controllers use Zod pipes and have no DTO classes for an OpenAPI generator to read)
- [x] **web:** login, MFA setup and challenge, Google sign-in (switches on with `VITE_GOOGLE_CLIENT_ID`), forgot and reset password, app shell, people list and detail, import wizard, organisation, audit log, my security page
- [x] **admin:** login with forced MFA, tenants (list, create, suspend, per-tenant setting overrides, audit integrity), platform users (invite, disable), platform defaults

### Quality
- [x] Cross-tenant test harness: the model-level suite (every scoped model, schema guard) and the per-endpoint suite (`backend/test/cross-tenant-endpoints.e2e-spec.ts`): every route the app exposes must be classified, each tenant route is called as company B with company A's ids and must be refused or change nothing, nothing of A may appear in B's answers, A's data is compared before and after, and company tokens are refused on every platform route. A new route that nobody classified fails the suite
- [x] Seed scripts: Flourisense, a fake Demo Co with 12 invented people (8 employees, 4 interns, reporting lines, departments, locations), dev admins; safe to re-run

## Data introduced

`tenants`, `entities`, `locations`, `departments`, `designations`, `persons`, `engagements`, `intern_details`, `users`, `platform_users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `setting_values`, `files`, `audit_log`, `notifications`, `job_records`

## Decisions that apply

D-03, D-05, D-15, D-16, D-17, D-19, D-30, D-32, plus plan §5 and §8

## Exit criteria

Status: 3 and 4 are met in code and tests. 1 and 2 are built and tested and wait for real inputs (Google client id, real users, the employee spreadsheet).

1. The HR lead and HR staff log in with MFA, and Google sign-in works.
2. Current interns and employees are imported from CSV.
3. Every change appears in the audit log, and the hash chain verifies.
4. The cross-tenant test suite passes with a second test tenant seeded.

## Business inputs needed

- Current employee and intern list (spreadsheet), departments, designations, locations, reporting lines
- Who gets which role at Flourisense

## Risks

- Prisma on MySQL has no row-level security, so tenant isolation depends on the scoping extension. The cross-tenant suite is the safety net and must run on every pull request.
