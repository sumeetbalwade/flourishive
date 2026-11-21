# Flourishive Desktop

Signs approved letters with the signatory's USB certificate token (DSC). The web app creates the work; this
program does the signing on the computer that holds the token, so the key and the PIN never leave it.

## How it works

1. **Pair** (once): in the web app choose *Pair a device*. It shows a code (valid 10 minutes) and a
   `flourishive://` link. Click the link, or type the code. The program receives a credential that can only
   reach the signing routes; it is kept in the operating system's secret store and can be revoked from the web app.
2. **To sign**: letters the HR lead sent for signature appear here (the list refreshes every 30 seconds).
3. **Sign**: tick the letters, enter the token PIN **once** for the whole batch. For each letter the program
   reserves it, downloads the exact file (checking its fingerprint), signs it on the token with a CA
   time-stamp, adds a visible stamp with a green tick, and uploads it. The server checks the signature
   (certificate, chain, time-stamp, revocation) before it counts.
4. **History** lists what this computer signed or could not sign. It never holds a PIN or a document.

The PIN is typed into a hidden field, handed to the token once, cleared from the screen at once and never
stored, logged or written to disk.

## Run from source

```
cd desktop
uv sync
uv run python -m flourishive_desktop        # the app
uv run pytest                               # tests (need SoftHSM: brew install softhsm / apt install softhsm2)
```

## Build a program (unsigned, no purchase needed)

```
./packaging/build.sh      # Windows: dist/FlourishiveDesktop/ (zip it); macOS: dist/FlourishiveDesktop.app
```

GitHub builds both on every change under `desktop/` (workflow *Desktop build*); download the zip from the run page.
Because nothing is code-signed yet, **Windows** shows "Windows protected your PC / unknown publisher" (More info,
Run anyway) and **macOS** needs right-click, Open the first time. Code signing, notarisation and automatic updates
wait until those certificates are bought (D-51).

## Token drivers

The program looks for the driver (a PKCS#11 library) of common Indian tokens (mToken/CryptoID, ePass2003,
WatchData, ProxKey, HyperPKI, SafeNet). If yours is somewhere else, set its path in *Settings*.

## Phase 0 spike

`spikes/` holds the original single-file signing test and the Windows run script. Kept for reference.
