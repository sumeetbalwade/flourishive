#!/usr/bin/env bash
# Builds an UNSIGNED Flourishive Desktop for the computer it runs on (D-51: nothing bought yet).
#   Windows: dist/FlourishiveDesktop/FlourishiveDesktop.exe (zip the folder)
#   macOS:   dist/FlourishiveDesktop.app
# Windows will warn "unknown publisher" and macOS needs right-click, Open the first time.
set -euo pipefail
cd "$(dirname "$0")/.."
uv run pyinstaller --noconfirm --clean --windowed --name FlourishiveDesktop \
  --collect-all pyhanko --collect-all pyhanko_certvalidator --collect-all pkcs11 \
  --collect-submodules keyring.backends --collect-all certifi --collect-all sentry_sdk \
  --hidden-import flourishive_desktop \
  packaging/entry.py
