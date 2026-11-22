# Runbook: file storage on Cloudflare R2 (D-72..D-75)

Files (uploads, letterheads, generated, sealed and signed PDFs) live in a private R2 bucket. The API still
decides who may download: it checks permission and tenant, then redirects to a link that works for 5 minutes.

## Set up

1. Cloudflare dashboard, R2: create a bucket (private, no public access, Asia-Pacific location hint).
2. Create an API token limited to that bucket with **Object Read & Write**. Keep the account id, access key id and secret.
3. Bucket settings, CORS policy (browsers fetch the preview straight from R2; links are signed and expire,
   and company domains can't be listed in advance, so any origin is allowed and no credentials are sent):

   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["*"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. Add to `/etc/flourishive/api.env`:

   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=...
   ```

   Leave `STORAGE_DRIVER=local` for now.

5. Copy the existing files and check them:

   ```
   STORAGE_DRIVER=r2 node dist/cli.js storage-migrate-r2 --dry-run
   STORAGE_DRIVER=r2 node dist/cli.js storage-migrate-r2
   ```

   It reads every copy back from R2 and compares its sha256 with the one recorded. It is safe to run again.
   Exit code 2 means a mismatch; do not switch until it is clean.

6. Set `STORAGE_DRIVER=r2` in `api.env` and restart the API.
7. Watch for a week. A read that had to use local disk logs `storage.fallback_local <key>` and adds 1 to the
   Redis counter `storage:fallback_local`. When the count stays at zero for a week, set
   `STORAGE_LOCAL_FALLBACK=false`, restart, then free the disk:

   ```
   STORAGE_DRIVER=r2 node dist/cli.js storage-migrate-r2 --delete-local
   ```

   Only files verified in R2 are removed locally.

## Roll back

Before `--delete-local`: set `STORAGE_DRIVER=local` and restart. Local copies are untouched. Files written to R2
after the switch exist only in R2, so copy them back before relying on local again.

## Things to know

- R2 is the store of record once local copies are deleted. The nightly server backup no longer covers file bytes.
- Anyone holding the token can delete objects. The token's bucket scope is the only protection; keep it in `api.env` only.
- Uploads still pass through the API (type check by content, sha256), then are written to R2.
- A file that is not in R2 yet is streamed by the API from local disk while the fallback is on.
- The desktop app follows the redirect and does not send its device credential to R2.
