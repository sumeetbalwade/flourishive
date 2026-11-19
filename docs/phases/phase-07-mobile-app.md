# Phase 7 — Mobile app

**Status:** Not started · **Depends on:** Phase 6 (D-23) · **Detailed before the phase starts, with your approval**

## Goal

A native iOS and Android app for employees, interns and managers, using the same `/v1` API, schemas and API client as the web app.

## Scope

- [ ] React Native with Expo (`mobile/`), sharing `packages/schemas` and `packages/api-client`
- [ ] Sign-in (password + MFA, Google), biometric unlock, tokens in secure storage
- [ ] Profile, documents (view and download signed letters), notifications
- [ ] OTP acceptance and Aadhaar eSign on the phone
- [ ] Leave requests and balances; attendance check-in (with optional location)
- [ ] Manager approvals; DSC items show "Sign on desktop"
- [ ] Push notifications through Expo (FCM and APNs); device list with remote sign-out
- [ ] Builds and store releases through Expo EAS

## Purchases needed

- Apple Developer Program (already bought in Phase 2 for macOS notarisation)
- Google Play Console account in the company's name

## Data introduced

`devices` (push tokens, app version, last seen, revoked)

## Exit criteria

1. The app is live on both stores; an employee applies for leave and downloads a signed letter from the phone.
