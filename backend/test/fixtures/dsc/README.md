# DSC test fixtures

Throwaway authority and PDFs used by the DSC validator tests. Nothing here is a real certificate or secret.

- `trust/root.pem`: the test root the server is told to trust (`TRUSTED_ROOTS_DIR`, `TRUSTED_TSA_DIR`).
- `input.pdf`: a two-page letter sealed with the fixture seal (`seal.pem`, `seal.key`).
- `signed-ok.pdf`: `input.pdf` plus an incremental certificate signature with a time-stamp (made by pyHanko).
- `signed-no-timestamp.pdf`, `signed-expired.pdf`, `signed-untrusted.pdf`: the same, but without a time-stamp, with an expired signer certificate, and from an authority the server does not trust.
- `inter.key`: signs the fake revocation answers in `ocsp.spec.ts`.

To remake everything (new keys, new time-stamps):

```
python generate.py certs
# seal a new input.pdf with seal.key/seal.pem (see the script that made the first one), then
python generate.py sign
```

Needs `pip install pyhanko pyhanko-certvalidator cryptography`. The other `*.key` files are git-ignored.
