# Runbook: DSC signing spike with the mToken

**Goal:** prove Flourishive Desktop can sign a PDF with the HR lead's mToken (Class 3 DSC) on macOS and on Windows, with a CA timestamp, and that Adobe Reader shows the signature as valid. This is the Phase 0 exit check for signing (plan §6.5, D-36).

**Already proven (8 Nov 2026):** the same code passes against a SoftHSM test token. Signature intact, valid, trusted, timestamped, entire file covered. Re-run any time with `./spikes/softhsm-selftest.sh` from `desktop/`.

## Safety rules

- The PIN is typed only at the hidden `Token PIN (hidden):` prompt, by the HR lead. Never put it in a command, file, chat or screenshot.
- mTokens lock after several wrong PINs. If unsure of the PIN, stop and confirm it first.
- The spike signs only its own test letter (or a PDF you pass with `--in`). It doesn't send anything anywhere except the timestamp request, which contains only a hash.

## Pass criteria

1. `list` shows the HR lead's certificate marked `[can sign]`.
2. `sign` prints `SPIKE CHECK: PASS`, with `"timestamped": true`.
3. `spikes/out/signed.pdf` opened in **Adobe Acrobat Reader** shows the signature panel with the HR lead's name and a timestamp. If Adobe says the signer's identity is "unknown", note it: that is a trust-list setting, not a signing failure.

## macOS (this Mac)

1. Install the **mToken macOS driver** from your DSC provider's download page, then plug in the token.
2. In Terminal, from the `desktop/` folder:
   ```bash
   uv run python spikes/sign_with_token.py find-lib
   ```
   Look for a new library that isn't `opensc`, `p11-kit` or `softhsm`. That's the mToken driver.
3. List the token and certificates:
   ```bash
   uv run python spikes/sign_with_token.py list --lib "/path/from/step2"
   ```
   If no certificates show, add `--login` (asks for the PIN).
4. Sign the test letter (HR lead types the PIN):
   ```bash
   uv run python spikes/sign_with_token.py sign --lib "/path/from/step2"
   ```
   If more than one signing certificate is listed, add `--cert-id <id from step 3>`.
5. Open `desktop/spikes/out/signed.pdf` in Adobe Acrobat Reader and take a screenshot of the signature panel.

If the mToken has **no macOS driver**, record that. D-12 (macOS at launch) then needs a decision.

## Windows laptop

1. Install the **mToken Windows driver** from your DSC provider and plug in the token.
2. Install uv (PowerShell):
   ```powershell
   powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
   ```
3. Copy the `desktop/` folder to the laptop (skip `.venv` and `spikes/out`).
4. In PowerShell inside that folder, run the same commands as macOS steps 2–4. Library paths look like `C:\Windows\System32\<name>.dll`.
5. Open `spikes\out\signed.pdf` in Adobe Acrobat Reader and take a screenshot of the signature panel.

## Report back

Paste the output of `find-lib`, `list` and `sign` (no PIN appears in them) and the Adobe screenshots, for each OS.
