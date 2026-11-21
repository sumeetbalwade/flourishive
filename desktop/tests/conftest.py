"""Shared test material: a throwaway certificate authority, a software token (SoftHSM) holding a
signing key issued by it, a time-stamp authority, and a small PDF. Nothing here is a real certificate."""

from __future__ import annotations

import datetime as dt
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import pkcs11
import pytest
from asn1crypto import keys as ak, pem
from asn1crypto import x509 as ax
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from pkcs11 import Attribute, KeyType, ObjectClass

UTC = dt.timezone.utc
PIN = "246810"


def _name(cn: str, o: str = "Test") -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.ORGANIZATION_NAME, o), x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def _cert(subject, pub, issuer, issuer_key, *, ca=False, usage=None, eku=None, start=None, end=None):
    now = dt.datetime.now(UTC)
    b = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(pub)
        .serial_number(x509.random_serial_number())
        .not_valid_before(start or now - dt.timedelta(days=30))
        .not_valid_after(end or now + dt.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), True)
    )
    if usage:
        b = b.add_extension(usage, True)
    if eku:
        b = b.add_extension(x509.ExtendedKeyUsage(eku), True)
    return b.sign(issuer_key, hashes.SHA256())


def _ku(**k):
    d = dict(digital_signature=False, content_commitment=False, key_encipherment=False, data_encipherment=False,
             key_agreement=False, key_cert_sign=False, crl_sign=False, encipher_only=False, decipher_only=False)
    d.update(k)
    return x509.KeyUsage(**d)


def _asn1_cert(c: x509.Certificate) -> ax.Certificate:
    return ax.Certificate.load(c.public_bytes(serialization.Encoding.DER))


@dataclass
class Pki:
    root: x509.Certificate
    tsa_cert: x509.Certificate
    tsa_key: rsa.RSAPrivateKey
    leaf_key: rsa.RSAPrivateKey
    leaf: x509.Certificate


@pytest.fixture(scope="session")
def pki() -> Pki:
    rk, lk, tk = (rsa.generate_private_key(65537, 2048) for _ in range(3))
    root = _cert(_name("Test Root"), rk.public_key(), _name("Test Root"), rk, ca=True, usage=_ku(key_cert_sign=True))
    leaf = _cert(_name("Desktop Test Signer", "Flourisense Test"), lk.public_key(), root.subject, rk,
                 usage=_ku(digital_signature=True, content_commitment=True))
    tsa = _cert(_name("Test TSA"), tk.public_key(), root.subject, rk, usage=_ku(digital_signature=True),
                eku=[ExtendedKeyUsageOID.TIME_STAMPING])
    return Pki(root, tsa, tk, lk, leaf)


@dataclass
class Token:
    library: str
    label: str
    pin: str
    cert_id: str


def _softhsm_lib() -> str | None:
    for p in (
        os.environ.get("SOFTHSM_LIB", ""),
        "/opt/homebrew/lib/softhsm/libsofthsm2.so",
        "/usr/local/lib/softhsm/libsofthsm2.so",
        "/usr/lib/softhsm/libsofthsm2.so",
        "/usr/lib/x86_64-linux-gnu/softhsm/libsofthsm2.so",
        "/usr/lib/aarch64-linux-gnu/softhsm/libsofthsm2.so",
    ):
        if p and Path(p).exists():
            return p
    return None


@pytest.fixture(scope="session")
def token(pki: Pki, tmp_path_factory) -> Token:
    lib = _softhsm_lib()
    if not lib or not shutil.which("softhsm2-util"):
        pytest.skip("SoftHSM is not installed (apt install softhsm2 / brew install softhsm)")
    work = tmp_path_factory.mktemp("softhsm")
    (work / "tokens").mkdir()
    conf = work / "softhsm2.conf"
    conf.write_text(f"directories.tokendir = {work / 'tokens'}\nobjectstore.backend = file\nlog.level = ERROR\n")
    os.environ["SOFTHSM2_CONF"] = str(conf)
    label = "FlourishiveTest"
    subprocess.run(["softhsm2-util", "--init-token", "--free", "--label", label, "--pin", PIN, "--so-pin", "12345678"],
                   check=True, capture_output=True)
    # put the signing key and its certificate on the token, as a DSC token would hold them
    nums = pki.leaf_key.private_numbers()
    pub = nums.public_numbers
    b = lambda n: n.to_bytes((n.bit_length() + 7) // 8, "big")  # noqa: E731
    cid = b"\x01"
    session = pkcs11.lib(lib).get_token(token_label=label).open(rw=True, user_pin=PIN)
    try:
        session.create_object({
            Attribute.CLASS: ObjectClass.PRIVATE_KEY, Attribute.KEY_TYPE: KeyType.RSA, Attribute.TOKEN: True,
            Attribute.PRIVATE: True, Attribute.SENSITIVE: True, Attribute.EXTRACTABLE: False, Attribute.SIGN: True,
            Attribute.ID: cid, Attribute.LABEL: "signer",
            Attribute.MODULUS: b(pub.n), Attribute.PUBLIC_EXPONENT: b(pub.e), Attribute.PRIVATE_EXPONENT: b(nums.d),
            Attribute.PRIME_1: b(nums.p), Attribute.PRIME_2: b(nums.q), Attribute.EXPONENT_1: b(nums.dmp1),
            Attribute.EXPONENT_2: b(nums.dmq1), Attribute.COEFFICIENT: b(nums.iqmp),
        })
        session.create_object({
            Attribute.CLASS: ObjectClass.CERTIFICATE, Attribute.CERTIFICATE_TYPE: pkcs11.CertificateType.X_509,
            Attribute.TOKEN: True, Attribute.ID: cid, Attribute.LABEL: "signer",
            Attribute.VALUE: pki.leaf.public_bytes(serialization.Encoding.DER),
            Attribute.SUBJECT: pki.leaf.subject.public_bytes(),
        })
    finally:
        session.close()
    return Token(lib, label, PIN, cid.hex())


def make_pdf(pages: int = 2) -> bytes:
    """A small valid PDF with classic cross-reference tables, like the ones the server produces."""
    objs: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>"]
    kids = " ".join(f"{3 + i * 2} 0 R" for i in range(pages))
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>".encode())
    font_id = 3 + pages * 2
    for i in range(pages):
        text = f"BT /F1 12 Tf 72 760 Td (Offer letter FS/INT/2026/0012 page {i + 1}) Tj ET".encode()
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {4 + i * 2} 0 R >>".encode())
        objs.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(text), text))
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for n, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (n, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


@pytest.fixture
def pdf() -> bytes:
    return make_pdf()


@pytest.fixture
def timestamper(pki: Pki):
    """A time-stamp authority that runs in the test (no network)."""
    from pyhanko.sign.timestamps import DummyTimeStamper

    def private_info(key: rsa.RSAPrivateKey) -> ak.PrivateKeyInfo:
        return ak.PrivateKeyInfo.load(key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))

    return DummyTimeStamper(_asn1_cert(pki.tsa_cert), private_info(pki.tsa_key))
