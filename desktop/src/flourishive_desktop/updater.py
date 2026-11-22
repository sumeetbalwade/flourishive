"""Self-update: ask the server for a newer release, download it, check its hash, and swap it in.

The server tells us the newest version, a download address and the file's SHA-256. We refuse a file
whose hash differs. Replacing a running program is done by a small script that waits for this one to
exit, copies the new files over, and starts the app again.
"""

from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import httpx

from . import __version__
from .errors import DesktopError


class UpdateFailed(DesktopError):
    """The update could not be downloaded, checked or installed."""


@dataclass(frozen=True)
class UpdateInfo:
    latest: str
    notes: str
    mandatory: bool
    sha256: str
    url: str | None  # a direct link, or
    download_path: str | None  # a path on our own server


def platform_key() -> str:
    return "macos" if sys.platform == "darwin" else "windows"


def parse(body: dict) -> UpdateInfo | None:
    """Reads the server's answer. None means up to date (or nothing published for this computer)."""
    if not body.get("updateAvailable"):
        return None
    return UpdateInfo(
        latest=str(body["latest"]),
        notes=str(body.get("notes") or ""),
        mandatory=bool(body.get("mandatory")),
        sha256=str(body["sha256"]).lower(),
        url=body.get("url"),
        download_path=body.get("downloadPath"),
    )


def download(
    info: UpdateInfo,
    dest: Path,
    *,
    server: str,
    credential: str | None,
    transport: httpx.BaseTransport | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> Path:
    """Downloads the release zip and verifies its SHA-256. A file that does not match is deleted."""
    if info.url:
        url, headers = info.url, {}  # a short-lived storage link; no credential is sent to it
    elif info.download_path:
        url = server.rstrip("/") + info.download_path
        headers = {"Authorization": f"Device {credential}"} if credential else {}
    else:
        raise UpdateFailed("The server did not say where to download the update.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    try:
        with httpx.Client(transport=transport, timeout=60.0, follow_redirects=True) as client:
            with client.stream("GET", url, headers=headers) as res:
                if res.status_code >= 400:
                    raise UpdateFailed(f"The download failed ({res.status_code}).")
                total = int(res.headers.get("content-length") or 0)
                done = 0
                with dest.open("wb") as out:
                    for chunk in res.iter_bytes(1 << 16):
                        out.write(chunk)
                        digest.update(chunk)
                        done += len(chunk)
                        if progress:
                            progress(done, total)
    except httpx.HTTPError as exc:
        dest.unlink(missing_ok=True)
        raise UpdateFailed("Could not download the update. Check the internet connection.") from exc
    if digest.hexdigest() != info.sha256:
        dest.unlink(missing_ok=True)
        raise UpdateFailed("The downloaded update did not match its checksum, so it was not installed.")
    return dest


def _safe_extract(zip_path: Path, into: Path) -> None:
    """Unzips, refusing any entry that would land outside the target folder."""
    root = into.resolve()
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            target = (into / name).resolve()
            if root != target and root not in target.parents:
                raise UpdateFailed("The update file is not safe to unpack.")
        z.extractall(into)


def windows_script(pid: int, new_dir: Path, install_dir: Path, exe: Path) -> str:
    return (
        "@echo off\r\n"
        f":wait\r\ntasklist /FI \"PID eq {pid}\" 2>NUL | find \"{pid}\" >NUL\r\n"
        "if not errorlevel 1 (timeout /t 1 /nobreak >NUL & goto wait)\r\n"
        f'robocopy "{new_dir}" "{install_dir}" /E /IS /IT /NFL /NDL /NJH /NJS >NUL\r\n'
        f'start "" "{exe}"\r\n'
        'del "%~f0"\r\n'
    )


def macos_script(pid: int, new_app: Path, install_app: Path) -> str:
    return (
        "#!/bin/bash\n"
        f"while kill -0 {pid} 2>/dev/null; do sleep 1; done\n"
        f'rm -rf "{install_app}"\n'
        f'ditto "{new_app}" "{install_app}"\n'
        f'xattr -dr com.apple.quarantine "{install_app}" 2>/dev/null\n'
        f'open "{install_app}"\n'
        'rm -- "$0"\n'
    )


def install_and_restart(zip_path: Path) -> None:
    """Unpacks the release and starts the helper that swaps it in. The caller must then quit the app.

    Only works for the packaged program. Run from source it just leaves the file for the person.
    """
    if not getattr(sys, "frozen", False):
        raise UpdateFailed(f"Downloaded to {zip_path}. Unpack it over the installed program to update.")
    work = Path(tempfile.mkdtemp(prefix="flourishive-update-"))
    _safe_extract(zip_path, work)
    exe = Path(sys.executable)
    pid = os.getpid()
    if sys.platform == "darwin":
        install_app = exe.parents[2]  # .../FlourishiveDesktop.app/Contents/MacOS/FlourishiveDesktop
        new_app = work / "FlourishiveDesktop.app"
        script = work / "update.sh"
        script.write_text(macos_script(pid, new_app, install_app))
        script.chmod(script.stat().st_mode | stat.S_IXUSR)
        subprocess.Popen(["/bin/bash", str(script)], start_new_session=True)  # noqa: S603
    else:
        install_dir = exe.parent
        script = work / "update.bat"
        script.write_text(windows_script(pid, work / "FlourishiveDesktop", install_dir, exe))
        subprocess.Popen(  # noqa: S603
            ["cmd", "/c", str(script)],
            creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )


def current_version() -> str:
    return __version__
