"""Phase 0 signing spike: prove a PDF can be signed with a USB DSC token.

Answers one question before any signing feature is built: can Flourishive
Desktop sign a PDF with the HR lead's mToken (Class 3 DSC) on macOS and
Windows, with a CA timestamp, so that Adobe Reader shows a valid signature?

Commands (run from the desktop/ folder):
  uv run python spikes/sign_with_token.py find-lib
  uv run python spikes/sign_with_token.py list   --lib <PKCS#11 library>
  uv run python spikes/sign_with_token.py sign   --lib <library> [--in letter.pdf]
  uv run python spikes/sign_with_token.py verify --in signed.pdf [--trust-root ca.cer]

The PIN is typed at a hidden prompt. It is never accepted as an argument,
never written to disk and never printed. (--pin-env exists only for the
automated SoftHSM self-test with a throwaway test token.)
"""

from __future__ import annotations

import argparse
import getpass
import io
import json
import os
import platform
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pkcs11
from asn1crypto import pem, x509
from pkcs11 import Attribute, ObjectClass
from pyhanko import stamp
from pyhanko.config.pkcs11 import TokenCriteria
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign import fields, signers, timestamps
from pyhanko.sign.pkcs11 import PKCS11Signer, open_pkcs11_session
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext

DEFAULT_TSA = "http://timestamp.digicert.com"
OUT_DIR = Path(__file__).parent / "out"

# Library file names used by common Indian DSC token drivers (mToken first).
LIB_NAME_PATTERN = re.compile(
    r"(mtoken|cryptoid|longmai|gclib|eps2003|epass|watchdata|wdpkcs|proxkey|"
    r"hyperpki|trustkey|safenet|etpkcs|softhsm|pkcs11|p11).*\.(dylib|so|dll)$",
    re.IGNORECASE,
)


# --------------------------------------------------------------------------- find-lib


def search_dirs() -> list[tuple[Path, int]]:
    """Folders where token drivers install their PKCS#11 library, with search depth."""
    system = platform.system()
    if system == "Darwin":
        return [
            (Path("/usr/local/lib"), 2),
            (Path("/opt/homebrew/lib"), 2),
            (Path("/Library/Frameworks"), 3),
            (Path("/Library/Application Support"), 3),
            (Path("/Applications"), 4),
        ]
    if system == "Windows":
        windir = Path(os.environ.get("WINDIR", r"C:\Windows"))
        return [
            (windir / "System32", 0),
            (windir / "SysWOW64", 0),
            (Path(os.environ.get("ProgramFiles", r"C:\Program Files")), 3),
            (Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")), 3),
        ]
    return [(Path("/usr/lib"), 3), (Path("/usr/local/lib"), 3)]


def find_libraries() -> list[Path]:
    found: list[Path] = []
    for root, max_depth in search_dirs():
        if not root.exists():
            continue
        base_depth = len(root.parts)
        for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
            if len(Path(dirpath).parts) - base_depth >= max_depth:
                dirnames[:] = []
            for name in filenames:
                if LIB_NAME_PATTERN.search(name):
                    found.append(Path(dirpath) / name)
    return sorted(set(found))


def cmd_find_lib(_: argparse.Namespace) -> int:
    libs = find_libraries()
    if not libs:
        print("No PKCS#11 libraries found. Is the mToken driver installed?")
        return 1
    print("Candidate PKCS#11 libraries (try the mToken one with `list --lib`):")
    for lib in libs:
        print(f"  {lib}")
    return 0


# --------------------------------------------------------------------------- list


def describe_cert(cert: x509.Certificate) -> dict:
    ku = cert.key_usage_value.native if cert.key_usage_value else []
    return {
        "subject": cert.subject.human_friendly,
        "issuer": cert.issuer.human_friendly,
        "serial": format(cert.serial_number, "x"),
        "valid_from": cert.not_valid_before.isoformat(),
        "valid_to": cert.not_valid_after.isoformat(),
        "key_usage": sorted(ku),
        "signing_capable": "non_repudiation" in ku or "digital_signature" in ku,
    }


def token_certificates(session: pkcs11.Session) -> list[dict]:
    certs = []
    for obj in session.get_objects({Attribute.CLASS: ObjectClass.CERTIFICATE}):
        cert = x509.Certificate.load(obj[Attribute.VALUE])
        info = describe_cert(cert)
        info["label"] = obj[Attribute.LABEL]
        info["id"] = bytes(obj[Attribute.ID]).hex()
        certs.append(info)
    return certs


def cmd_list(args: argparse.Namespace) -> int:
    lib = pkcs11.lib(args.lib)
    slots = lib.get_slots(token_present=True)
    if not slots:
        print("Library loaded, but no token is plugged in.")
        return 1
    for slot in slots:
        token = slot.get_token()
        print(f"Slot {slot.slot_id}: token '{token.label}' "
              f"({token.manufacturer_id.strip()} {token.model.strip()}, serial {token.serial.decode(errors='replace').strip()})")
        if not token.flags & pkcs11.TokenFlag.TOKEN_INITIALIZED:
            print("  (empty / uninitialised slot, skipped)")
            continue
        pin = read_pin(args) if args.login else None
        try:
            with token.open(user_pin=pin) as session:
                certs = token_certificates(session)
        except pkcs11.exceptions.PKCS11Error as exc:
            print(f"  could not open token: {type(exc).__name__}")
            continue
        if not certs:
            print("  No certificates visible. Some tokens hide them until login: retry with --login.")
        for c in certs:
            flag = "can sign" if c["signing_capable"] else "not for signing"
            print(f"  cert label='{c['label']}' id={c['id']} [{flag}]")
            print(f"    subject: {c['subject']}")
            print(f"    issuer:  {c['issuer']}")
            print(f"    valid:   {c['valid_from']} to {c['valid_to']}")
    return 0


# --------------------------------------------------------------------------- sign


def read_pin(args: argparse.Namespace) -> str:
    if getattr(args, "pin_env", None):
        pin = os.environ.get(args.pin_env)
        if not pin:
            sys.exit(f"--pin-env {args.pin_env} is set but the variable is empty")
        return pin
    return getpass.getpass("Token PIN (hidden): ")


def sample_pdf() -> bytes:
    """A one-page A4 test letter, built by hand so the spike needs no PDF library."""
    lines = [
        "Flourishive - DSC signing spike",
        "",
        "This test letter was generated on " + datetime.now().strftime("%d %b %Y %H:%M"),
        "to prove signing with a Class 3 DSC token from Flourishive Desktop.",
        "",
        "If Adobe Reader shows a valid signature with a timestamp,",
        "the spike has passed.",
    ]
    text = "BT /F1 12 Tf 72 760 Td 16 TL " + " ".join(
        f"({ln.replace('(', '[').replace(')', ']')}) Tj T*" for ln in lines
    ) + " ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text.encode("latin-1")),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def load_certs(paths: list[str] | None) -> list[x509.Certificate]:
    certs = []
    for p in paths or []:
        data = Path(p).read_bytes()
        if pem.detect(data):
            _, _, data = pem.unarmor(data)
        certs.append(x509.Certificate.load(data))
    return certs


def cmd_sign(args: argparse.Namespace) -> int:
    OUT_DIR.mkdir(exist_ok=True)
    if args.input:
        src = Path(args.input).read_bytes()
    else:
        src = sample_pdf()
        (OUT_DIR / "unsigned.pdf").write_bytes(src)
    out_path = Path(args.out) if args.out else OUT_DIR / "signed.pdf"

    criteria = TokenCriteria(label=args.token_label) if args.token_label else None
    pin = read_pin(args)
    session = open_pkcs11_session(
        args.lib, slot_no=args.slot, token_criteria=criteria, user_pin=pin
    )
    del pin
    try:
        cert_id = bytes.fromhex(args.cert_id) if args.cert_id else None
        if not cert_id and not args.cert_label:
            signing = [c for c in token_certificates(session) if c["signing_capable"]]
            if len(signing) != 1:
                print("Pick a certificate with --cert-id (see `list`):")
                for c in signing:
                    print(f"  id={c['id']}  {c['subject']}")
                return 1
            cert_id = bytes.fromhex(signing[0]["id"])

        signer = PKCS11Signer(
            session,
            cert_label=args.cert_label,
            key_label=args.cert_label,
            cert_id=cert_id,
            key_id=cert_id,
        )

        trust_roots = load_certs(args.trust_root)
        vc = ValidationContext(extra_trust_roots=trust_roots, allow_fetching=True) if args.ltv else None
        meta = signers.PdfSignatureMetadata(
            field_name="HRSignature",
            md_algorithm="sha256",
            subfilter=fields.SigSeedSubFilter.PADES,
            reason=args.reason,
            location=args.location,
            embed_validation_info=args.ltv,
            use_pades_lta=args.ltv and not args.no_tsa,
            validation_context=vc,
        )
        tsa = None if args.no_tsa else timestamps.HTTPTimeStamper(args.tsa)
        style = stamp.TextStampStyle(
            stamp_text="Digitally signed by %(signer)s\nDate: %(ts)s\nReason: " + args.reason,
        )
        pdf_signer = signers.PdfSigner(
            meta,
            signer=signer,
            timestamper=tsa,
            stamp_style=style,
            new_field_spec=fields.SigFieldSpec(
                "HRSignature", on_page=0, box=(330, 60, 560, 140)
            ),
        )
        writer = IncrementalPdfFileWriter(io.BytesIO(src))
        with out_path.open("wb") as fh:
            pdf_signer.sign_pdf(writer, output=fh)
    finally:
        session.close()

    print(f"Signed PDF written to {out_path}")
    args.input = str(out_path)
    return cmd_verify(args)


# --------------------------------------------------------------------------- verify


def cmd_verify(args: argparse.Namespace) -> int:
    trust_roots = load_certs(args.trust_root)
    with open(args.input, "rb") as fh:
        reader = PdfFileReader(fh)
        sigs = reader.embedded_signatures
        if not sigs:
            print("No signatures found.")
            return 1
        ok = True
        for sig in sigs:
            vc = ValidationContext(extra_trust_roots=trust_roots, allow_fetching=True)
            status = validate_pdf_signature(sig, vc, vc)
            report = {
                "field": sig.field_name,
                "signer": sig.signer_cert.subject.human_friendly,
                "intact": status.intact,
                "valid": status.valid,
                "trusted": status.trusted,
                "timestamped": status.timestamp_validity is not None,
                "timestamp_time": (
                    status.timestamp_validity.timestamp.astimezone(timezone.utc).isoformat()
                    if status.timestamp_validity else None
                ),
                "coverage": str(status.coverage),
                "summary": status.summary(),
            }
            print(json.dumps(report, indent=2))
            ok &= status.intact and status.valid
            if not status.trusted:
                print("Note: 'trusted' needs the CA root. For a real DSC pass the CCA India root "
                      "with --trust-root; Adobe Reader uses its own trust list.")
    print("SPIKE CHECK:", "PASS (intact and cryptographically valid)" if ok else "FAIL")
    return 0 if ok else 1


# --------------------------------------------------------------------------- cli


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("find-lib", help="locate PKCS#11 driver libraries")

    pl = sub.add_parser("list", help="show tokens and certificates")
    pl.add_argument("--lib", required=True)
    pl.add_argument("--login", action="store_true", help="log in first (some tokens hide certs)")
    pl.add_argument("--pin-env", help=argparse.SUPPRESS)

    ps = sub.add_parser("sign", help="sign a PDF (a test letter if --in is omitted)")
    ps.add_argument("--lib", required=True)
    ps.add_argument("--in", dest="input")
    ps.add_argument("--out")
    ps.add_argument("--slot", type=int)
    ps.add_argument("--token-label")
    ps.add_argument("--cert-label")
    ps.add_argument("--cert-id", help="hex id from `list`")
    ps.add_argument("--tsa", default=DEFAULT_TSA, help=f"RFC 3161 timestamp URL (default {DEFAULT_TSA})")
    ps.add_argument("--no-tsa", action="store_true")
    ps.add_argument("--ltv", action="store_true", help="embed revocation data (PAdES B-LT/LTA); needs --trust-root")
    ps.add_argument("--trust-root", action="append", help="CA root certificate file (repeatable)")
    ps.add_argument("--reason", default="Issued by Flourishive (signing spike)")
    ps.add_argument("--location", default="Maharashtra, India")
    ps.add_argument("--pin-env", help=argparse.SUPPRESS)

    pv = sub.add_parser("verify", help="validate signatures in a PDF")
    pv.add_argument("--in", dest="input", required=True)
    pv.add_argument("--trust-root", action="append")

    args = p.parse_args()
    return {"find-lib": cmd_find_lib, "list": cmd_list, "sign": cmd_sign, "verify": cmd_verify}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
