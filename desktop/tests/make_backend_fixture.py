"""Makes backend/test/fixtures/dsc/signed-desktop.pdf: input.pdf signed by THIS app's code through a
software token, with the fixture authority's certificate. The backend test proves the server's
validator accepts what the desktop app produces. Run by hand when the signing code changes:

  uv run python tests/make_backend_fixture.py

Needs SoftHSM and the (git-ignored) fixture keys made by backend/test/fixtures/dsc/generate.py.
"""

from __future__ import annotations

import datetime as dt
import os
import subprocess
import tempfile
from pathlib import Path

import pkcs11
from asn1crypto import keys as ak
from asn1crypto import x509 as ax
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from pkcs11 import Attribute, KeyType, ObjectClass
from pyhanko.keys import load_cert_from_pemder, load_private_key_from_pemder
from pyhanko.sign.timestamps import DummyTimeStamper
from pyhanko_certvalidator.registry import SimpleCertificateStore

from flourishive_desktop.signing import SignOptions, sign_pdf
from flourishive_desktop.tokens import TokenSession
from tests.conftest import PIN, _softhsm_lib

FX = Path(__file__).resolve().parents[2] / "backend/test/fixtures/dsc"
UTC = dt.timezone.utc


def main() -> None:
    inter_key = serialization.load_pem_private_key((FX / "inter.key").read_bytes(), None)
    inter = x509.load_pem_x509_certificate((FX / "inter.pem").read_bytes())
    root = x509.load_pem_x509_certificate((FX / "root.pem").read_bytes())
    lk = rsa.generate_private_key(65537, 2048)
    now = dt.datetime.now(UTC)
    leaf = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Flourisense Test"), x509.NameAttribute(NameOID.COMMON_NAME, "Desktop SoftHSM Test")]))
        .issuer_name(inter.subject).public_key(lk.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=3000))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
        .add_extension(x509.KeyUsage(True, True, False, False, False, False, False, False, False), True)
        .sign(inter_key, hashes.SHA256())
    )
    lib = _softhsm_lib()
    with tempfile.TemporaryDirectory() as d:
        work = Path(d)
        (work / "tokens").mkdir()
        (work / "c").write_text(f"directories.tokendir = {work / 'tokens'}\nobjectstore.backend = file\nlog.level = ERROR\n")
        os.environ["SOFTHSM2_CONF"] = str(work / "c")
        subprocess.run(["softhsm2-util", "--init-token", "--free", "--label", "Fx", "--pin", PIN, "--so-pin", "12345678"], check=True, capture_output=True)
        n = lk.private_numbers(); pub = n.public_numbers
        b = lambda v: v.to_bytes((v.bit_length() + 7) // 8, "big")  # noqa: E731
        s = pkcs11.lib(lib).get_token(token_label="Fx").open(rw=True, user_pin=PIN)
        s.create_object({Attribute.CLASS: ObjectClass.PRIVATE_KEY, Attribute.KEY_TYPE: KeyType.RSA, Attribute.TOKEN: True, Attribute.PRIVATE: True, Attribute.SENSITIVE: True, Attribute.EXTRACTABLE: False, Attribute.SIGN: True, Attribute.ID: b"\x01", Attribute.LABEL: "k", Attribute.MODULUS: b(pub.n), Attribute.PUBLIC_EXPONENT: b(pub.e), Attribute.PRIVATE_EXPONENT: b(n.d), Attribute.PRIME_1: b(n.p), Attribute.PRIME_2: b(n.q), Attribute.EXPONENT_1: b(n.dmp1), Attribute.EXPONENT_2: b(n.dmq1), Attribute.COEFFICIENT: b(n.iqmp)})
        for i, c in enumerate((leaf, inter, root), start=1):  # the token also holds the authority certificates
            s.create_object({Attribute.CLASS: ObjectClass.CERTIFICATE, Attribute.CERTIFICATE_TYPE: pkcs11.CertificateType.X_509, Attribute.TOKEN: True, Attribute.ID: bytes([i]) if i > 1 else b"\x01", Attribute.LABEL: f"c{i}", Attribute.VALUE: c.public_bytes(serialization.Encoding.DER), Attribute.SUBJECT: c.subject.public_bytes()})
        s.close()
        tsa_cert = load_cert_from_pemder(str(FX / "tsa.pem"))
        tsa_key = load_private_key_from_pemder(str(FX / "tsa.key"), None)
        store = SimpleCertificateStore()
        store.register(ax.Certificate.load(inter.public_bytes(serialization.Encoding.DER)))
        store.register(ax.Certificate.load(root.public_bytes(serialization.Encoding.DER)))
        stamper = DummyTimeStamper(tsa_cert, tsa_key, certs_to_embed=store)
        src = (FX / "input.pdf").read_bytes()
        with TokenSession(lib, PIN, token_label="Fx", cert_id="01") as t:
            signed = sign_pdf(src, t.signer, SignOptions("Issued by FS/INT/2026/0012", "http://tsa.invalid", (321.28, 70.0, 535.28, 118.0)), timestamper=stamper)
    (FX / "signed-desktop.pdf").write_bytes(signed)
    print("wrote", FX / "signed-desktop.pdf", len(signed), "bytes")


if __name__ == "__main__":
    main()
