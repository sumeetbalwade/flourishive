import hashlib
import json
import sys
import zipfile
from pathlib import Path

import httpx
import pytest

from flourishive_desktop import telemetry, updater
from flourishive_desktop.api import Api

sys.path.insert(0, str(Path(__file__).parent.parent / "packaging"))
import publish  # noqa: E402

BODY = b"zip bytes"
SHA = hashlib.sha256(BODY).hexdigest()


def info(**kw):
    base = dict(latest="0.4.0", notes="", mandatory=False, sha256=SHA, url="https://files.r2.test/x.zip", download_path=None)
    base.update(kw)
    return updater.UpdateInfo(**base)


def test_parse_reads_the_servers_answer():
    assert updater.parse({"updateAvailable": False}) is None
    got = updater.parse({"updateAvailable": True, "latest": "0.4.0", "sha256": SHA.upper(), "mandatory": True, "url": "u", "downloadPath": None})
    assert got and got.latest == "0.4.0" and got.mandatory and got.sha256 == SHA


def test_download_checks_the_hash_and_sends_no_credential_to_storage(tmp_path):
    seen = []

    def h(req):
        seen.append((req.url.host, req.headers.get("authorization")))
        return httpx.Response(200, content=BODY)

    out = updater.download(info(), tmp_path / "u.zip", server="https://api.test", credential="c" * 43, transport=httpx.MockTransport(h))
    assert out.read_bytes() == BODY
    assert seen == [("files.r2.test", None)]


def test_a_download_with_the_wrong_hash_is_deleted_and_refused(tmp_path):
    dest = tmp_path / "u.zip"
    with pytest.raises(updater.UpdateFailed, match="checksum"):
        updater.download(info(sha256="0" * 64), dest, server="https://api.test", credential=None, transport=httpx.MockTransport(lambda r: httpx.Response(200, content=BODY)))
    assert not dest.exists()


def test_download_through_our_server_carries_the_device_credential(tmp_path):
    seen = []

    def h(req):
        seen.append((req.url.path, req.headers.get("authorization")))
        return httpx.Response(200, content=BODY)

    updater.download(info(url=None, download_path="/v1/desktop/update/download?platform=windows"), tmp_path / "u.zip", server="https://api.test", credential="cred", transport=httpx.MockTransport(h))
    assert seen == [("/v1/desktop/update/download", "Device cred")]


def test_a_zip_that_tries_to_escape_is_refused(tmp_path):
    evil = tmp_path / "evil.zip"
    with zipfile.ZipFile(evil, "w") as z:
        z.writestr("../../outside.txt", "x")
    with pytest.raises(updater.UpdateFailed, match="not safe"):
        updater._safe_extract(evil, tmp_path / "into")
    assert not (tmp_path / "outside.txt").exists()


def test_helper_scripts_wait_for_the_app_then_swap_and_restart():
    w = updater.windows_script(123, Path("C:/new"), Path("C:/app"), Path("C:/app/FlourishiveDesktop.exe"))
    assert 'PID eq 123' in w and "robocopy" in w and w.index("robocopy") < w.index("start")
    m = updater.macos_script(123, Path("/t/new.app"), Path("/Applications/F.app"))
    assert "kill -0 123" in m and m.index("ditto") < m.index("open ")


def test_running_from_source_never_tries_to_replace_itself(tmp_path):
    with pytest.raises(updater.UpdateFailed, match="Downloaded to"):
        updater.install_and_restart(tmp_path / "u.zip")


def test_the_api_asks_for_the_right_platform_and_version():
    seen = []

    def h(req):
        seen.append(dict(req.url.params))
        return httpx.Response(200, json={"updateAvailable": False})

    Api("https://api.test", "c" * 43, transport=httpx.MockTransport(h)).update("windows", "0.3.0")
    assert seen == [{"platform": "windows", "version": "0.3.0"}]


def test_crash_reports_carry_nothing_personal():
    event = {
        "user": {"email": "asha@example.test"},
        "request": {"url": "https://x"},
        "server_name": "ASHAS-PC",
        "breadcrumbs": [1],
        "exception": {"values": [{"value": "failed for C:\\\\Users\\\\asha\\\\Documents\\\\offer.pdf", "stacktrace": {"frames": [{"abs_path": "/Users/asha/app/x.py", "vars": {"pin": "1234"}, "context_line": "pin = '1234'"}]}}]},
    }
    out = telemetry.scrub_event(event)
    flat = json.dumps(out)
    for secret in ("asha@example.test", "ASHAS-PC", "1234", "asha"):
        assert secret not in flat
    assert telemetry.start(None) is False


def test_the_manifest_lists_hashes_and_validates_the_version(tmp_path):
    f = tmp_path / "w.zip"
    f.write_bytes(BODY)
    m = publish.build_manifest("0.4.0", {"windows": f}, "Fixes", "0.3.0", None)
    assert m["files"]["windows"] == {"key": "releases/desktop/0.4.0/FlourishiveDesktop-windows.zip", "sha256": SHA}
    assert m["minVersion"] == "0.3.0" and m["notes"] == "Fixes"
    with pytest.raises(SystemExit):
        publish.build_manifest("v4", {"windows": f}, "", None, None)
