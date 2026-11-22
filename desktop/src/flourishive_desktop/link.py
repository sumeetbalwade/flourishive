"""The flourishive:// link the web app opens to pair this computer."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

CODE = re.compile(r"^[A-Z2-9]{4}-?[A-Z2-9]{4}$")


@dataclass(frozen=True)
class PairLink:
    code: str
    server: str


def parse_link(url: str) -> PairLink | None:
    """Returns the code and server from flourishive://pair?code=ABCD-EFGH&server=https://..., or None.

    A link is only ever used to fill in the pairing form; nothing happens until the person confirms.
    The server must be https (plain http only for this computer, while developing).
    """
    try:
        u = urlparse(url.strip())
    except ValueError:
        return None
    if u.scheme.lower() != "flourishive" or u.netloc.lower() != "pair":
        return None
    q = parse_qs(u.query)
    code = (q.get("code") or [""])[0].upper()
    server = (q.get("server") or [""])[0].rstrip("/")
    s = urlparse(server)
    local = s.hostname in {"localhost", "127.0.0.1"}
    if not CODE.match(code) or not s.hostname or not (s.scheme == "https" or (s.scheme == "http" and local)):
        return None
    return PairLink(f"{code[:4]}-{code[-4:]}", server)


def register_protocol(executable: str) -> bool:
    """Makes Windows open flourishive:// links with this program. No effect elsewhere."""
    if sys.platform != "win32":
        return False
    import winreg  # noqa: PLC0415

    base = r"Software\Classes\flourishive"
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base) as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:Flourishive")
        winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, base + r"\shell\open\command") as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, f'"{executable}" "%1"')
    return True
