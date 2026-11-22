# Phase 2 — Documents and digital signing

**Status:** Decisions approved 2026-11-21; build starting · **Depends on:** Phase 1 (and the Phase 0 signing spike) · **Unlocks:** first production go-live for Flourisense; Phase 3

## Goal

HR at Flourisense issues real intern letters end to end. A letter is generated from a template, approved, accepted by the candidate (OTP or Aadhaar eSign) where needed, signed by the HR lead's mToken DSC, delivered, and verifiable by anyone through a QR code.

## Work breakdown

### Document engine (`modules/documents`)
- [x] Letterheads per entity (portrait A4, landscape for certificates), versioned
- [x] Reference numbering per entity and letter type (for example `FS/INT/2026/0012`), configurable format, never reused
- [x] Templates, versioned; every document records the template version it used
- [x] **Path A, visual editor:** Tiptap editor with `{{placeholders}}`, headings, lists, tables and a signature box, saved as JSON and drawn by React-PDF on the letterhead (D-78 replaces the pdfmake note in D-13)
- [x] **Path B, coded layouts:** React-PDF layouts registered in code, editable text fields only
- [ ] **Path C, uploads:** plain PDF straight to signing; fillable PDF with field-to-placeholder mapping, then flattened; DOCX with placeholder filling, then converted (D-14)
- [ ] Generation and bulk generation as queue jobs; QR code and reference stamped on every page _(single generation and the stamp are done in PR 1; bulk and queue jobs come in PR 7)_

### Workflow engine v1 (`modules/workflow`)
- [x] Definitions stored as data: states, transitions, who can act, reminders _(reminder times are stored; sending them is a later PR)_
- [x] Letters flow: draft → submitted → approved / changes requested → signing → issued _(signing and issued steps are system-only; wired up in PR 3-6)_

### Signing (`modules/signing`, plan §6)
- [ ] Signature requests with ordered parties; enforce the ordering rule (content changes before the first cryptographic signature) _(OTP request, one party, and the freeze on content at "signing" are done in PR 3; multiple ordered parties arrive with the DSC step)_
- [x] **OTP e-acceptance:** email OTP, evidence (name, email, time, IP, user agent, document hash), acceptance certificate page, then the Flourishive organisation seal (D-25)
- [x] **Aadhaar eSign:** provider adapter with a mock provider (D-44): request, redirect to the provider, return, finish; anything signed with the mock is labelled TEST. Switch with `ESIGN_PROVIDER` (`none` default, `mock`). A real provider is one more class implementing `EsignProvider` (provider chosen per D-28)
- [x] **DSC (server side, PR 5):** desktop pairing (D-24, D-45), signing-job API (D-46), upload of the signed PDF, validation in Node before acceptance (D-31, D-48). The desktop app itself is PR 6. See docs/runbooks/dsc-validation.md
- [ ] Revocation and supersede, with the reason recorded
- [x] Dev-only setting `ALLOW_EXPIRED_SIGNER_CERT` (D-38): accepts signatures from the expired DSC; off by default; documents signed this way are labelled TEST

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
- [x] Look-up by reference or QR: issuer, type, date, status, signer _(signer name arrives with the DSC step in PR 5-6; acceptance time and seal are shown now)_
- [x] Upload a copy to compare its hash with the original _(also reports a changed or extended sealed file)_

### Letters module (`modules/letters`)
- [x] Four starter letters as templates (offer, experience, reference, internship certificate), installed per company with one click _(draft wording, not yet approved by HR or legal)_
- [x] Bulk issue: pick people or paste a CSV; every row checked first, then issued row by row as a resumable queue job (D-76)
- [x] Email delivery as a private 30-day link; HR clicks Email for one letter or a whole batch; links can be cancelled (D-77)
- [x] Offer-letter downloads held until an admin releases them, switchable per company (D-77)
- [ ] Offer letter end to end with a real candidate: OTP acceptance, then HR lead's DSC (needs the renewed DSC)

### File storage on Cloudflare R2 (PR 8, D-72..D-75)

Moves file bytes off the VPS. Today every file sits under `STORAGE_DIR`, and every download streams through the API (`files.controller.ts` pipes it; signing and desktop return `StreamableFile`). After this PR, files live in a private R2 bucket and downloads go straight from R2. The API still decides who may download.

**Backend**
- [x] Storage driver interface behind the existing `StorageService` (`backend/src/platform/storage/`). Callers keep using `save`, `read`, `exists`, `remove`, `sign` and `verify` unchanged.
  - `LocalDriver`: today's code.
  - `R2Driver`: `@aws-sdk/client-s3` against `https://<account-id>.r2.cloudflarestorage.com`, region `auto`.
- [x] New `config.ts` settings: `STORAGE_DRIVER` (`local` | `r2`, default `local`), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (sensitive), `R2_BUCKET`.
  - Local development and tests keep `local`.
  - These move into runtime config in Phase 2B PR 1 (D-57).
- [x] `R2Driver.save` streams to R2 (multipart for files over 8 MB) with `ContentType`.
  - Keys stay as today (tenant-prefixed `storageKey`). Never allow `..` or a leading `/`.
  - Write once: refuse to overwrite an existing key, matching today's `wx` flag.
- [x] Download by redirect (D-72): a new `StorageService.downloadUrl(key, { filename, mimeType, ttlSeconds = 300 })`.
  - With R2, it returns a presigned GET (`@aws-sdk/s3-request-presigner`) with `ResponseContentDisposition` (`attachment` or `inline`, filename RFC 5987-encoded) and `ResponseContentType`.
  - With local, it returns null and the caller streams as today.
  - Each download endpoint keeps its permission and tenant checks and the existing signed-link check, then answers `302` to the R2 URL with `Cache-Control: no-store`. This covers the file download endpoints, the signing PDF endpoints, the acceptance page's document and the desktop job download.
  - Never redirect without the checks.
- [x] Server-side reads (sealing, DSC validation, letterhead merge, `readAll` in `signing.service.ts`, `dsc-jobs.service.ts`, `documents.service.ts`) read from R2 through `read()`. Timeout is 30 seconds, with 2 retries on network errors.
- [x] Uploads stay through the API (D-73): content-type check by magic bytes and sha256 as today, then `save` to R2. The size limit is unchanged.
- [x] Read fallback during migration (D-74): `R2Driver.read`/`exists` fall back to the local disk when the object is missing.
  - Each fallback logs `storage.fallback_local` with the key (no personal data) and counts in Redis.
  - `STORAGE_LOCAL_FALLBACK=true|false`, default `true` with R2.
- [x] Migration command `node dist/cli.js storage-migrate-r2 [--dry-run]`:
  - Copies every `files` row's object that is missing in R2.
  - Re-reads it from R2 and compares the sha256 with `files.sha256`.
  - Prints a summary (copied, already present, mismatched, missing locally).
  - Safe to re-run.
  - `--delete-local` removes local copies only for files verified in R2. Use it after a week with zero fallbacks (D-74).
- [ ] Health: `/v1/health` stays fast. Add a `storage` check to an admin-only diagnostics endpoint (a HEAD on a known object).
- [x] Deletes: `remove` deletes in R2 (and locally if present). Soft delete in `files.deletedAt` stays as today.

**Clients**
- [x] Web `PdfPreview.tsx` fetches the PDF, then follows the redirect to R2. Set the bucket CORS rule for `GET`/`HEAD` from any origin, with no credentials (the URLs are presigned and expire in 5 minutes; custom tenant domains from Phase 2B mean origins can't be listed in advance).
  - Check the preview, "Download" and the verify page's compare-upload still work.
- [x] Desktop: `httpx` does not follow redirects by default. Set `follow_redirects=True` on the client used for downloads, and confirm the `Authorization` header is not sent to R2 (`httpx` drops it on a cross-origin redirect; add a test). Update `desktop/tests`.

**Infrastructure and runbook**
- [x] Runbook `docs/runbooks/r2-storage.md`, with these steps:
  1. Create the bucket (private, no public access, Asia-Pacific location hint).
  2. Create an API token limited to that bucket with Object Read & Write.
  3. Add the CORS rule.
  4. Set the env keys in `/etc/flourishive/api.env`.
  5. Run `storage-migrate-r2 --dry-run`, then a real run.
  6. Switch `STORAGE_DRIVER=r2` and restart.
  7. Watch fallbacks for a week, then run `--delete-local`.
  8. Rollback: set `STORAGE_DRIVER=local`. Local copies are kept until `--delete-local`.
- [ ] Backups: the nightly server backup no longer needs file bytes once migration is complete. Note in the runbook that R2 is the store of record, and that bucket deletion is protected only by the token's scope.

**Tests**
- [x] Driver contract tests run against both drivers. R2 uses `aws-sdk-client-mock`, so no network is needed in CI.
- [x] Presigned URL contains the disposition and expires. A download endpoint returns 302 only after its permission check; a wrong tenant still gets 404.
- [x] Fallback is used when the object is missing in R2 and is counted.
- [x] The migration command verifies sha256 and reports a mismatch.
- [x] The e2e suite stays on `local`.

_Built in PR 8 except the admin storage diagnostics check, the backup note and the live-server run, which remain open._

**Done when:** on the live server, after migration, an issued letter's download, the PDF preview, the desktop signing job and the verify compare all work. `backend/storage` is empty after `--delete-local`. Server bandwidth for downloads drops to the redirect only.

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
- [ ] CCA root and issuing CA certificates installed in `TRUSTED_ROOTS_DIR` (fingerprints checked against the CCA website), time-stamp authority in `TRUSTED_TSA_DIR` (docs/runbooks/dsc-validation.md)
- [ ] Seal key stored as a server secret (never in the repo); seal certificate published for Flourisense machines to trust
- [ ] Files on R2 (D-72): migration verified, a week with no local fallbacks, then `STORAGE_LOCAL_FALLBACK=false` and local copies removed

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

## Decisions approved 2026-11-21 for PR 5-6 (D-45..D-48)

- **D-45 Pairing:** the HR lead clicks "Pair a device" in the web app and gets a one-time code (10 minutes) plus a `flourishive://` link. The desktop app swaps the code for a **signing-only credential** that can be revoked per device. No password typed into the desktop app.
- **D-46 Job delivery:** the desktop app polls every 30 seconds while open; the web "Sign now" button also opens the app by link so it checks at once. No WebSocket or server push (poor fit for shared cPanel).
- **D-47 Seal and DSC together:** the candidate's acceptance is sealed straight away; the HR lead's DSC is added afterwards as an incremental update on top. Both signatures stay valid; the verifier treats a later signature as legitimate.
- **D-48 DSC validation:** strict and fail closed. The upload must extend the exact file we sent, the certificate must be valid at signing time (CA timestamp required), chain to a trusted Indian licensed CA (CCA root certificates shipped), and pass an OCSP revocation check; if revocation cannot be reached the upload is held, never accepted blindly. `ALLOW_EXPIRED_SIGNER_CERT` (D-38) relaxes only the dates, is development only, labels the document TEST, and is removed before go-live.

## Decisions approved 2026-11-21 for PR 6 (D-49..D-52)

- **D-49 Animation:** drawn natively in Qt in the desktop app, driven by real signing state (never a timer), honouring reduce-motion; the web keeps its React component; both read one shared set of path definitions.
- **D-50 Signature look:** a visible, designed signature stamp with a green-tick emblem (the same tick as the signing animation), placed beside the QR stamp from the letterhead's settings. A PDF is static, so a tick inside the file cannot turn red; the red cross appears in the desktop app, on the verify page, and as Adobe's own overlay on a broken signature.
- **D-51 First build without purchases:** an unsigned Windows pilot build made by CI (no signing certificate); macOS runs from the unsigned app or source. Code signing, notarisation and auto-update wait until those certificates are bought.
- **D-52 Token testing:** everything is tested with SoftHSM end to end against the real server validator; the HR lead's mToken is detected and the PIN prompt tried on the pilot build. Real signing waits for the renewed DSC (or the TEST switch).

## Decisions approved 2026-11-22 for file storage (D-72..D-75)

- **D-72 Files on Cloudflare R2, downloads by redirect:** all stored files (uploads, letterheads, generated, sealed and signed PDFs) move to a private R2 bucket behind the existing storage service. Download endpoints keep every permission and tenant check, then redirect to a 5-minute presigned R2 link, so file bytes no longer pass through the server.
- **D-73 Uploads still go through the API:** the API keeps checking file type by content and computing sha256 (used by signing and verify) before writing to R2.
- **D-74 Migration:** a re-runnable command copies existing files to R2 and verifies each sha256. Reads fall back to local disk while the switch settles. Local copies are deleted after a week with no fallbacks. Rollback is one setting until then.
- **D-75 Build order change (amends D-39):** R2 storage is Phase 2 PR 8, before bulk issue creates many PDFs. The visual editor becomes PR 9 and the Aadhaar eSign adapter PR 10.

## Decisions approved 2026-11-22 for letters (D-76, D-77)

- **D-76 Bulk issue:** HR picks people from the list (names and dates come from their record) or pastes a CSV; shared values are entered once. Every row is validated before anything is numbered. Issuing runs as a queue job, row by row, resumable, with a status page. Up to 200 rows per batch.
- **D-77 Delivery and offer hold:** HR clicks Email (one letter or a batch). The email holds a private link valid 30 days that HR can cancel; the recipient sees the letter's details and downloads the PDF through the API checks and R2. Offer letters are held: the link works but the download is locked until an admin releases it (permission `documents.release`, tenant admin only) so candidates cannot shop offers. The hold is a company setting, `documents.holdOfferDownloads`, on by default.

- **D-78 Editor PDF engine (2026-11-22):** the visual editor's JSON is drawn by React-PDF, the same engine as coded layouts, so fonts, letterhead and stamping are shared. Only bold and underline marks, headings, lists, tables, lines and a signature box are allowed.

## Open items
- How the signing animation is built on each surface (options to be presented before the desktop UI work starts, PR 6)
