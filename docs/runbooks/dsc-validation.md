# DSC validation on the server (D-48)

The server checks every certificate-signed PDF the desktop app uploads. It trusts only the
certificate authorities you put in two folders. Nothing is trusted by default.

## Settings

| Setting | Meaning |
|---|---|
| `TRUSTED_ROOTS_DIR` | Folder of PEM files (`.pem`, `.crt`, `.cer`) with the **licensed CA root and intermediate certificates** that issue the signatories' certificates. |
| `TRUSTED_TSA_DIR` | Folder of PEM files for the **time-stamp authorities** whose time-stamps are accepted. Roots from `TRUSTED_ROOTS_DIR` are also accepted here. |
| `API_URL` | Public address of the API; it goes into pairing links so the desktop app knows where to connect. |
| `ALLOW_EXPIRED_SIGNER_CERT` | Development only (D-38). Lets a signer certificate outside its dates through and labels the document TEST. Ignored when `NODE_ENV=production`. |

## What is checked, in order

1. The uploaded file begins with exactly the bytes that were sent for signing, and adds one signature covering the whole file.
2. What was added is only a signature (its field and appearance); a new content stream, an annotation or a hidden object stream is refused.
3. The signature matches the file (SHA-256 or stronger; SHA-1 is refused) and verifies with the signer's certificate.
4. A CA time-stamp is present, is about this signature, and its authority is trusted and was valid at that time.
5. The certificate may sign documents, was valid at the time-stamp time, and chains to a trusted root.
6. OCSP says the certificate is not revoked. If the revocation server cannot be reached the upload is **held** (503, the app resends after a minute); it is never accepted without an answer.

The earlier seal stays valid: later signatures are allowed after it when they only add a signature.

## Before go-live

- [ ] Download the Controller of Certifying Authorities (CCA India) root certificate and the issuing CA certificates of the signatory's certificate from the CCA and CA websites. **Check each fingerprint against the value published on the CCA website** before copying them into `TRUSTED_ROOTS_DIR`.
- [ ] Add the time-stamp authority's certificate chain to `TRUSTED_TSA_DIR`.
- [ ] Sign a real letter with the renewed DSC and confirm it is accepted; confirm an expired or revoked certificate is refused.
- [ ] `ALLOW_EXPIRED_SIGNER_CERT` removed from the environment (and its code path deleted, D-38).

## Test certificates

`backend/test/fixtures/dsc/` holds a throwaway authority and PDFs signed with pyHanko for the automated
tests. The keys there protect nothing; see `generate.py` to remake them.
