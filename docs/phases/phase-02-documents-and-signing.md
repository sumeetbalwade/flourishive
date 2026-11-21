# Phase 2 — Documents and digital signing

**Status:** Decisions approved 2026-11-21; build starting · **Depends on:** Phase 1 (and the Phase 0 signing spike) · **Unlocks:** first production go-live for Flourisense; Phase 3

## Goal

HR at Flourisense issues real intern letters end to end. A letter is generated from a template, approved, accepted by the candidate (OTP or Aadhaar eSign) where needed, signed by the HR lead's mToken DSC, delivered, and verifiable by anyone through a QR code.

## Work breakdown

### Document engine (`modules/documents`)
- [x] Letterheads per entity (portrait A4, landscape for certificates), versioned
- [x] Reference numbering per entity and letter type (for example `FS/INT/2026/0012`), configurable format, never reused
- [x] Templates, versioned; every document records the template version it used
- [ ] **Path A, visual editor:** rich-text editor with `{{placeholders}}`, tables and a signature box, saved as JSON, rendered with pdfmake on the letterhead with pdf-lib (D-13)
- [x] **Path B, coded layouts:** React-PDF layouts registered in code, editable text fields only
- [ ] **Path C, uploads:** plain PDF straight to signing; fillable PDF with field-to-placeholder mapping, then flattened; DOCX with placeholder filling, then converted (D-14)
- [ ] Generation and bulk generation as queue jobs; QR code and reference stamped on every page _(single generation and the stamp are done in PR 1; bulk and queue jobs come in PR 7)_

### Workflow engine v1 (`modules/workflow`)
- [ ] Definitions stored as data: states, transitions, who can act, reminders
- [ ] Letters flow: draft → submitted → approved / changes requested → signing → issued

### Signing (`modules/signing`, plan §6)
- [ ] Signature requests with ordered parties; enforce the ordering rule (content changes before the first cryptographic signature)
- [ ] **OTP e-acceptance:** email OTP, evidence (name, email, time, IP, user agent, document hash), acceptance certificate page, then the Flourishive organisation seal (D-25)
- [ ] **Aadhaar eSign:** provider adapter; request → redirect → callback → signed PDF stored (provider chosen per D-28)
- [ ] **DSC:** desktop pairing (D-24), signing-job API, upload of the signed PDF, validation in Node before acceptance (D-31)
- [ ] Revocation and supersede, with the reason recorded
- [ ] Dev-only setting `ALLOW_EXPIRED_SIGNER_CERT` (D-38): accepts signatures from the expired DSC; off by default; documents signed this way are labelled TEST

### Flourishive Desktop v1 (`desktop/`, D-11, D-12)
- [ ] PySide6 UI: sign in by pairing, signing queue, PIN entry, progress, history
- [ ] Batch signing: PIN entered once for a selected batch, with the signing animation (D-37) showing real per-document progress, success and failure
- [ ] Signing animation in the web signature timeline and on the candidate OTP acceptance screen (D-37)
- [ ] Token driver detection (from the spike), with a manual library-path override
- [ ] DOCX → PDF: Word on Windows, LibreOffice on macOS
- [ ] `flourishive://` link handler, auto-update, Sentry
- [ ] Packaging: code-signed Windows installer; signed and notarised macOS app

### External DOCX conversion (D-14)
- [ ] Adapter for one conversion API, enabled per tenant by the super admin

### Verify (`frontend/verify`)
- [ ] Look-up by reference or QR: issuer, type, date, status, signer
- [ ] Upload a copy to compare its hash with the original

### Letters module (`modules/letters`)
- [ ] Intern offer letter (candidate accepts by OTP or Aadhaar eSign, then HR lead signs with DSC)
- [ ] Experience letter, reference letter, internship certificate (landscape)
- [ ] Bulk issue for a batch of interns; email delivery with secure download links

## Data introduced

`letterheads`, `templates`, `template_versions`, `numbering_schemes`, `generated_documents`, `workflow_definitions`, `workflow_instances`, `workflow_actions`, `signature_requests`, `signature_parties`, `signature_events`, `otp_challenges`, `esign_transactions`, `document_conversions`, `desktop_devices`

## Decisions that apply

D-10, D-11, D-12, D-13, D-14, D-24, D-25, D-28, D-31, D-33, D-35

## Go-live gate (D-38) — nothing real is issued until all are done

- [ ] HR lead's DSC renewed (Class 3 signing certificate) and re-run through the spike
- [ ] `ALLOW_EXPIRED_SIGNER_CERT` and its code path **removed**, not just switched off
- [ ] Full validation on: certificate validity dates, chain to a trusted root, revocation (OCSP/CRL), RFC 3161 timestamp, document hash
- [ ] A test with an expired certificate is rejected by the server
- [ ] All documents signed during development deleted or marked TEST; none sent to real candidates
- [ ] Adobe Reader shows a valid signature with a timestamp on a real letter
- [ ] Seal key stored as a server secret (never in the repo); seal certificate published for Flourisense machines to trust

## Exit criteria

1. HR issues a real DSC-signed intern letter end to end, and Adobe Reader shows it as valid with a timestamp.
2. A candidate accepts an offer letter by OTP; the sealed PDF shows modification if edited (D-41), and the verify page also reports a hash mismatch for an edited copy.
3. The verify page confirms an issued letter from its QR code.
4. A batch of 20 certificates is generated and signed with one PIN entry.

## Business inputs needed

- Letterheads for each entity as PDFs (portrait, plus landscape for certificates)
- Approved wording for each letter type, reviewed by HR or legal
- Written authorisation of the HR lead as signatory
- Existing letter numbers, so new numbers don't clash

## Purchases needed

- Windows code-signing certificate (for the desktop installer)
- Apple Developer Program membership (macOS notarisation)
- Organisation document-signing certificate for the Flourishive seal (D-25)
- Aadhaar eSign provider agreement (D-28)
- External DOCX conversion API account (only if a tenant opts in)

## Decisions approved 2026-11-21 (D-39..D-44)

- **D-39 Build order:** foundations, workflow, OTP e-acceptance, verify, then desktop pairing and DSC signing (PR 5-6), letters and bulk (PR 7), visual editor (PR 8), Aadhaar eSign adapter (PR 9).
- **D-40 Editor:** Tiptap for template Path A.
- **D-41 Self-signed organisation seal (supersedes the earlier "no seal" choice, same day):** OTP-accepted documents are sealed by the server with a Flourishive self-signed certificate plus an RFC 3161 timestamp, behind a seal adapter. Tampering is detected, but Adobe shows "valid, signer unknown" (yellow) to readers who have not trusted our certificate. Flourisense machines can install it as trusted. Green ticks come from the HR lead's DSC and Aadhaar eSign. A purchased Adobe-trusted certificate can replace the seal by configuration if a CA offers a software-key option (the usual token/HSM requirement does not suit shared hosting). Verified in a sample: seal intact, byte-flip detected.
- **D-42 Path C DOCX deferred:** plain and fillable PDF uploads only for now; no DOCX placeholder library, no DOCX conversion, no external conversion provider in this phase.
- **D-43 PDF engine:** React-PDF for coded layouts, pdf-lib for letterhead, QR and stamping; embedded fonts for Devanagari.
- **D-44 Aadhaar eSign:** adapter with a mock provider only; real provider chosen later.
- **Letters:** all four types (offer, experience, reference, internship certificate) with bulk issue.

## Open items
- How the signing animation is built on each surface (options to be presented before the desktop UI work starts)
