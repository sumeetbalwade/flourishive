# Phase 3 — SaaS layer

**Status:** Not started · **Depends on:** Phase 2 · **Unlocks:** selling Flourishive to other companies; Phases 4–10

## Goal

A second company can sign up, pay, be configured by the super admin and issue a signed letter without developer help.

## Work breakdown

### Super admin console (`frontend/admin`, `modules/platform-admin`)
- [ ] Tenant onboarding wizard: company, entities, admin user, plan, modules, branding
- [ ] Module on/off per tenant; limits for users, storage and signatures (D-20)
- [ ] Full settings editor at every level, with "unlocked for tenant admins" switches
- [ ] Support sessions: time-limited, reason required, visible to the tenant, audit-logged
- [ ] Platform dashboards: tenants, usage against limits, failed jobs, webhook failures

### Billing (`modules/billing`, D-21)
- [ ] Plans and plan limits, editable by the super admin
- [ ] Razorpay Subscriptions behind the payment-gateway adapter: cards, UPI AutoPay, netbanking mandates
- [ ] Razorpay webhooks: verified signatures, idempotent handling
- [ ] GST invoices numbered and rendered by the document engine
- [ ] Dunning: reminders, grace period, read-only mode, suspension
- [ ] Limit enforcement in the API, with clear upgrade prompts in the web app

### Tenant features
- [ ] Per-tenant SSO through Google Workspace and Microsoft 365 (OIDC), plus allowed email domains
- [ ] Tenant branding: logo, accent colour, default theme, email sender name
- [ ] Custom fields on persons and engagements: text, number, date, select, file; role-based visibility (D-29)

### Public API and webhooks (`modules/integrations`)
- [ ] OAuth client credentials with scopes (for example `employees:read`, `letters:create`) and allowed entities
- [ ] Per-client rate limits; idempotency keys on create endpoints
- [ ] Webhooks: subscriptions, HMAC-SHA256 signing, retries with backoff, delivery log
- [ ] Integrator guide in `docs/api/`

### Infrastructure
- [ ] Move to a VPS when the first paying external customer signs, or at 300 active users (D-27)

## Data introduced

`plans`, `plan_limits`, `subscriptions`, `invoices`, `payments`, `tenant_modules`, `custom_field_definitions`, `custom_field_values`, `api_clients`, `webhook_subscriptions`, `webhook_deliveries`, `support_sessions`

## Decisions that apply

D-01, D-16, D-20, D-21, D-27, D-29

## Exit criteria

1. A test company signs up, pays through Razorpay (test mode), receives a GST invoice, and its admin issues a signed letter without developer help.
2. An external client reads employees through the public API with a scoped token and receives a signed webhook.

## Business inputs needed

- Which legal entity sells Flourishive and issues GST invoices (GSTIN, invoice series)
- Plans, prices and limits
- Terms of service, privacy policy and data processing agreement for customers (DPDP)
