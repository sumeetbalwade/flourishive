# Runbook: releasing Flourishive Desktop and how it updates itself

Computers that already have the app check for a newer version when they start and every six hours. If one exists the app
shows a bar with **Install and restart**. The file is checked against a SHA-256 hash from the server before anything is
replaced. A release can also set a minimum version; older computers then cannot sign until they update.

## Publish a release

1. Bump `__version__` in `desktop/src/flourishive_desktop/__init__.py` and `version` in `desktop/pyproject.toml`.
2. Run the **Desktop build** workflow (or merge a PR touching `desktop/`) and download the two zips from the run page.
3. Publish, using the R2 settings from `~/flourishive-r2-credentials.env`:

   ```
   cd desktop
   set -a; . ~/flourishive-r2-credentials.env; set +a
   uv run python packaging/publish.py --version 0.4.0 \
     --windows FlourishiveDesktop-windows.zip --macos FlourishiveDesktop-macos.zip \
     --notes "What changed" [--min-version 0.3.0] [--sentry-dsn https://...]
   ```

   The zips go to `releases/desktop/<version>/` in the R2 bucket. The manifest `releases/desktop/manifest.json` is written
   last, so nobody is offered a half-uploaded release.
4. Open the app on a computer with an older version; the bar should appear within seconds of starting.

## Crash reports (Sentry)

Reports are off unless the manifest has `sentryDsn`. Pass `--sentry-dsn` when publishing to turn them on, and publish
again without it to turn them off. Nothing personal is sent: no letters, names, email addresses, PINs, certificate
details or file paths, no local variables and no breadcrumbs.

## Limits to know

- The app is unsigned (D-51). Windows may warn "unknown publisher" on first install, and macOS needs right-click, Open the
  first time. The self-update copies files over the existing install, so it does not repeat the warning on Windows; on
  macOS the helper clears the quarantine flag.
- Updating needs the packaged program. Run from source, it only saves the download and says where.
- To roll back, publish the older zips again under a higher version number.
