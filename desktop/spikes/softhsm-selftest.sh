#!/usr/bin/env bash
# Self-test for the signing spike using a throwaway SoftHSM token.
# Creates a test CA + "Test HR Lead" signing certificate, loads it into a
# fresh SoftHSM token, then runs list -> sign -> verify. No real DSC involved.
#
# Usage (from desktop/):  ./spikes/softhsm-selftest.sh [--no-tsa]
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$here/out/softhsm"
rm -rf "$work" && mkdir -p "$work/tokens"

LIB="${SOFTHSM_LIB:-/opt/homebrew/lib/softhsm/libsofthsm2.so}"
export SOFTHSM2_CONF="$work/softhsm2.conf"
printf 'directories.tokendir = %s\nobjectstore.backend = file\nlog.level = ERROR\n' "$work/tokens" > "$SOFTHSM2_CONF"

# Throwaway credentials for a throwaway test token only.
export SPIKE_TEST_PIN=123456
softhsm2-util --init-token --free --label FlourishiveTest --pin "$SPIKE_TEST_PIN" --so-pin 12345678 >/dev/null

cd "$work"
cat > ca.ext <<'EOF'
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
EOF
cat > signer.ext <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
EOF

openssl req -new -newkey rsa:2048 -nodes -keyout ca.key -out ca.csr \
  -subj "/C=IN/O=Flourishive Test CA/CN=Flourishive Test Root" 2>/dev/null
openssl x509 -req -in ca.csr -signkey ca.key -days 30 -sha256 -extfile ca.ext -out ca.pem 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout signer.key -out signer.csr \
  -subj "/C=IN/ST=Maharashtra/O=Flourisense/CN=Test HR Lead" 2>/dev/null
openssl x509 -req -in signer.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 30 \
  -sha256 -extfile signer.ext -out signer.pem 2>/dev/null

openssl pkcs8 -topk8 -nocrypt -in signer.key -outform DER -out signer.key.der
openssl x509 -in signer.pem -outform DER -out signer.cert.der

pkcs11-tool --module "$LIB" --login --pin "$SPIKE_TEST_PIN" --token-label FlourishiveTest \
  --write-object signer.key.der --type privkey --id 01 --label hrlead >/dev/null
pkcs11-tool --module "$LIB" --login --pin "$SPIKE_TEST_PIN" --token-label FlourishiveTest \
  --write-object signer.cert.der --type cert --id 01 --label hrlead >/dev/null
rm -f signer.key signer.key.der ca.key   # keys now live only in the test token

cd "$here/.."
echo "== list"
uv run python spikes/sign_with_token.py list --lib "$LIB"
echo "== sign + verify"
uv run python spikes/sign_with_token.py sign --lib "$LIB" --token-label FlourishiveTest \
  --pin-env SPIKE_TEST_PIN --trust-root "$work/ca.pem" --out "$here/out/signed-softhsm.pdf" "$@"
