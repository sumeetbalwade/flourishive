"""Finding the token driver (a PKCS#11 library) and the signing certificate on the USB token.

The PIN is only ever passed in by the caller for the moment it is needed. It is never stored,
logged or written anywhere.
"""

from __future__ import annotations

import os
import platform
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pkcs11
from asn1crypto import x509
from pkcs11 import Attribute, ObjectClass
from pyhanko.config.pkcs11 import TokenCriteria
from pyhanko.sign.pkcs11 import PKCS11Signer, open_pkcs11_session

from .errors import SigningFailed

# Library file names used by common Indian DSC token drivers. The mToken (Longmai CryptoID) driver
# is the one confirmed on the HR lead's token in Phase 0, so it sorts first.
LIB_NAME_PATTERN = re.compile(
    r"(cryptoid|mtoken|longmai|gclib|eps2003|epass|watchdata|wdpkcs|signaturep11|proxkey|"
    r"hyperpki|hyperpkcs|trustkey|safenet|etpkcs|softhsm|pkcs11).*\.(dylib|so|dll)$",
    re.IGNORECASE,
)
_PRIORITY = ("cryptoid", "mtoken", "longmai", "eps2003", "epass", "watchdata", "wdpkcs", "signaturep11", "proxkey")


def search_dirs() -> list[tuple[Path, int]]:
    """Folders where drivers install their library, with how deep to look."""
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


def find_libraries(dirs: list[tuple[Path, int]] | None = None) -> list[Path]:
    found: set[Path] = set()
    for root, max_depth in dirs if dirs is not None else search_dirs():
        if not root.exists():
            continue
        base = len(root.parts)
        for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
            if len(Path(dirpath).parts) - base >= max_depth:
                dirnames[:] = []
            for name in filenames:
                if LIB_NAME_PATTERN.search(name):
                    found.add(Path(dirpath) / name)

    def rank(p: Path) -> tuple[int, str]:
        n = p.name.lower()
        for i, key in enumerate(_PRIORITY):
            if key in n:
                return (i, n)
        return (len(_PRIORITY), n)

    return sorted(found, key=rank)


@dataclass(frozen=True)
class TokenInfo:
    slot: int
    label: str
    manufacturer: str
    model: str
    serial: str


@dataclass(frozen=True)
class CertInfo:
    id: str  # hex
    label: str
    subject: str
    common_name: str
    issuer: str
    valid_from: datetime
    valid_to: datetime
    signing_capable: bool

    @property
    def expired(self) -> bool:
        return self.valid_to < datetime.now(timezone.utc)


def _friendly(error: Exception) -> SigningFailed:
    """Turns a token error into words a person can act on."""
    e = pkcs11.exceptions
    if isinstance(error, e.PinIncorrect):
        return SigningFailed("The PIN is not correct. Careful: too many wrong tries lock the token.")
    if isinstance(error, e.PinLocked):
        return SigningFailed("The token is locked after too many wrong PINs. It must be unlocked by its administrator.")
    if isinstance(error, (e.PinLenRange, e.PinInvalid, e.PinExpired)):
        return SigningFailed("The token did not accept that PIN.")
    if isinstance(error, (e.TokenNotPresent, e.DeviceRemoved, e.SlotIDInvalid)):
        return SigningFailed("The token is not plugged in. Plug it in and try again.")
    if isinstance(error, (e.DeviceError, e.TokenNotRecognised)):
        return SigningFailed("The token did not respond. Unplug it, plug it in again and retry.")
    return SigningFailed(f"The token reported a problem ({type(error).__name__}).")


def _is_ca(cert: x509.Certificate) -> bool:
    bc = cert.basic_constraints_value
    return bool(bc and bc.native.get("ca"))


def list_tokens(library: str | Path) -> list[TokenInfo]:
    try:
        lib = pkcs11.lib(str(library))
        out = []
        for slot in lib.get_slots(token_present=True):
            t = slot.get_token()
            if not t.flags & pkcs11.TokenFlag.TOKEN_INITIALIZED:
                continue
            out.append(
                TokenInfo(slot.slot_id, t.label.strip(), t.manufacturer_id.strip(), t.model.strip(), t.serial.decode(errors="replace").strip())
            )
        return out
    except pkcs11.exceptions.PKCS11Error as exc:
        raise _friendly(exc) from exc
    except OSError as exc:
        raise SigningFailed("The token driver could not be loaded. Check the driver path in Settings.") from exc


def _describe(cert: x509.Certificate, obj) -> CertInfo:
    ku = cert.key_usage_value.native if cert.key_usage_value else []
    cn = ""
    for rdn in cert.subject.chosen:
        for item in rdn:
            if item["type"].native == "common_name":
                cn = item["value"].native
    return CertInfo(
        id=bytes(obj[Attribute.ID]).hex(),
        label=obj[Attribute.LABEL] or "",
        subject=cert.subject.human_friendly,
        common_name=cn,
        issuer=cert.issuer.human_friendly,
        valid_from=cert.not_valid_before,
        valid_to=cert.not_valid_after,
        signing_capable=(not ku) or "non_repudiation" in ku or "digital_signature" in ku,
    )


def list_certificates(library: str | Path, token_label: str | None, pin: str) -> list[CertInfo]:
    """The certificates on the token (some tokens only show them after the PIN)."""
    try:
        session = open_pkcs11_session(
            str(library),
            token_criteria=TokenCriteria(label=token_label) if token_label else None,
            user_pin=pin,
        )
    except pkcs11.exceptions.PKCS11Error as exc:
        raise _friendly(exc) from exc
    try:
        certs = []
        for obj in session.get_objects({Attribute.CLASS: ObjectClass.CERTIFICATE}):
            certs.append(_describe(x509.Certificate.load(obj[Attribute.VALUE]), obj))
        return certs
    finally:
        session.close()


class TokenSession:
    """One login for a whole batch: open once with the PIN, sign many files, close."""

    def __init__(self, library: str | Path, pin: str, *, token_label: str | None = None, cert_id: str | None = None) -> None:
        self._library = str(library)
        self._pin: str | None = pin
        self._token_label = token_label
        self._cert_id = cert_id
        self._session = None
        self.signer: PKCS11Signer | None = None
        self.certificate: CertInfo | None = None

    def __enter__(self) -> "TokenSession":
        try:
            self._session = open_pkcs11_session(
                self._library,
                token_criteria=TokenCriteria(label=self._token_label) if self._token_label else None,
                user_pin=self._pin,
            )
        except pkcs11.exceptions.PKCS11Error as exc:
            raise _friendly(exc) from exc
        finally:
            self._pin = None  # not kept a moment longer than the login
        found = []
        for o in self._session.get_objects({Attribute.CLASS: ObjectClass.CERTIFICATE}):
            raw = x509.Certificate.load(o[Attribute.VALUE])
            found.append((_describe(raw, o), raw))
        usable = [(c, r) for c, r in found if c.signing_capable and not _is_ca(r)]
        if self._cert_id:
            usable = [(c, r) for c, r in usable if c.id == self._cert_id]
        if len(usable) != 1:
            self._close()
            raise SigningFailed(
                "No signing certificate was found on the token."
                if not usable
                else "The token holds several signing certificates. Choose one in Settings."
            )
        self.certificate, leaf = usable[0]
        # Authority certificates stored on the token go into the signature, so a viewer can build the chain.
        chain = [r for c, r in found if _is_ca(r)]
        key_id = bytes.fromhex(self.certificate.id)
        self.signer = PKCS11Signer(self._session, cert_id=key_id, key_id=key_id, ca_chain=chain or None)
        _ = leaf
        return self

    def _close(self) -> None:
        if self._session is not None:
            try:
                self._session.close()
            except pkcs11.exceptions.PKCS11Error:
                pass
            self._session = None

    def __exit__(self, *exc) -> None:
        self._close()
        self.signer = None
