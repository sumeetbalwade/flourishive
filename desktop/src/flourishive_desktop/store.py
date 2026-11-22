"""Settings, the device credential and the local history. Nothing here holds a PIN."""

from __future__ import annotations

import json
import os
import stat
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

import platformdirs

APP = "FlourishiveDesktop"


def data_dir() -> Path:
    p = Path(platformdirs.user_data_dir(APP, appauthor=False))
    p.mkdir(parents=True, exist_ok=True)
    return p


@dataclass
class Settings:
    server: str = ""
    device_id: str = ""
    company: str = ""
    library: str = ""  # the token driver; empty means find it automatically
    token_label: str = ""
    cert_id: str = ""
    poll_seconds: int = 30
    reduce_motion: bool | None = None  # None: follow the system
    theme: str = "dark"

    @property
    def paired(self) -> bool:
        return bool(self.server and self.device_id)


class SettingsStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or data_dir() / "settings.json"

    def load(self) -> Settings:
        try:
            raw = json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError):
            return Settings()
        known = {k: v for k, v in raw.items() if k in Settings.__dataclass_fields__}
        return Settings(**known)

    def save(self, s: Settings) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(s), indent=2), "utf-8")
        tmp.replace(self.path)


class Credentials(Protocol):
    def get(self, device_id: str) -> str | None: ...
    def set(self, device_id: str, credential: str) -> None: ...
    def delete(self, device_id: str) -> None: ...


class MemoryCredentials:
    def __init__(self) -> None:
        self._v: dict[str, str] = {}

    def get(self, device_id: str) -> str | None:
        return self._v.get(device_id)

    def set(self, device_id: str, credential: str) -> None:
        self._v[device_id] = credential

    def delete(self, device_id: str) -> None:
        self._v.pop(device_id, None)


class KeyringCredentials:
    """The operating system's secret store (Windows Credential Manager, macOS Keychain).

    Where none exists, the credential goes in a file only the current user can read. The
    credential can only reach the signing routes and is revoked from the web app.
    """

    def __init__(self, fallback: Path | None = None) -> None:
        self._fallback = fallback or data_dir() / "device.key"

    def _keyring(self):
        try:
            import keyring  # noqa: PLC0415
            from keyring.errors import NoKeyringError  # noqa: PLC0415

            keyring.get_password(APP, "probe")
            return keyring
        except (ImportError, NoKeyringError, Exception):  # noqa: BLE001
            return None

    def get(self, device_id: str) -> str | None:
        kr = self._keyring()
        if kr is not None:
            return kr.get_password(APP, device_id)
        try:
            return self._fallback.read_text("utf-8").strip() or None
        except OSError:
            return None

    def set(self, device_id: str, credential: str) -> None:
        kr = self._keyring()
        if kr is not None:
            kr.set_password(APP, device_id, credential)
            return
        self._fallback.write_text(credential, "utf-8")
        os.chmod(self._fallback, stat.S_IRUSR | stat.S_IWUSR)

    def delete(self, device_id: str) -> None:
        kr = self._keyring()
        if kr is not None:
            try:
                kr.delete_password(APP, device_id)
            except Exception:  # noqa: BLE001
                pass
        self._fallback.unlink(missing_ok=True)


@dataclass(frozen=True)
class HistoryEntry:
    at: float
    reference: str
    status: str  # done | failed | skipped
    detail: str = ""
    test: bool = False


class History:
    """One line per attempt, newest last. Kept local; it never holds a PIN or a document."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or data_dir() / "history.jsonl"

    def add(self, reference: str, status: str, detail: str = "", test: bool = False) -> None:
        entry = HistoryEntry(time.time(), reference, status, detail, test)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(asdict(entry)) + "\n")

    def recent(self, limit: int = 200) -> list[HistoryEntry]:
        try:
            lines = self.path.read_text("utf-8").splitlines()[-limit:]
        except OSError:
            return []
        out = []
        for line in reversed(lines):
            try:
                out.append(HistoryEntry(**json.loads(line)))
            except (ValueError, TypeError):
                continue
        return out

