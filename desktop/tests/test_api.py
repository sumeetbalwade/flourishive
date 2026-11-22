import json

import httpx
import pytest

from flourishive_desktop.api import Api
from flourishive_desktop.errors import Held, Offline, Rejected, ServerRefused, Unpaired

CRED = "c" * 43


def api(handler, credential=CRED):
    return Api("https://api.example.test", credential, transport=httpx.MockTransport(handler))


def test_pair_sends_the_code_and_reads_the_credential():
    def h(req):
        assert req.url.path == "/v1/desktop/pair" and "authorization" not in req.headers
        body = json.loads(req.content)
        assert body["code"] == "ABCD-EFGH" and body["platform"] == "windows"
        return httpx.Response(201, json={"deviceId": "d1", "credential": CRED, "company": "Flourisense"})

    p = api(h, None).pair("ABCD-EFGH", "HR laptop", "windows")
    assert (p.device_id, p.credential, p.company) == ("d1", CRED, "Flourisense")


def test_every_call_carries_the_device_credential():
    seen = []

    def h(req):
        seen.append(req.headers["authorization"])
        return httpx.Response(200, json=[])

    api(h).jobs()
    assert seen == [f"Device {CRED}"]


def test_jobs_and_claim_are_read_into_plain_objects():
    def h(req):
        if req.url.path.endswith("/jobs"):
            return httpx.Response(200, json=[{"id": "j1", "reference": "FS/INT/2026/0012", "letterType": "OFFER", "issuedBy": "HQ", "sha256": "a" * 64, "expiresAt": "x", "claimedByThisDevice": False}])
        return httpx.Response(201, json={"id": "j1", "reference": "FS/INT/2026/0012", "sha256": "a" * 64, "inputPath": "/v1/desktop/jobs/j1/input", "leaseSeconds": 600,
                                         "signature": {"reason": "Issued by FS/INT/2026/0012", "timestampUrl": "http://tsa.test", "appearance": {"visible": True, "page": 0, "box": [321.28, 70, 535.28, 118], "style": "tick"}}})

    a = api(h)
    job = a.jobs()[0]
    assert (job.id, job.letter_type, job.issued_by) == ("j1", "OFFER", "HQ")
    c = a.claim("j1")
    assert c.appearance.box == (321.28, 70.0, 535.28, 118.0) and c.timestamp_url == "http://tsa.test"


def test_errors_say_what_happened():
    def reply(status, body):
        return lambda req: httpx.Response(status, json=body)

    with pytest.raises(Unpaired):
        api(reply(401, {"message": "This computer was unpaired"})).jobs()
    with pytest.raises(Rejected) as r:
        api(reply(422, {"code": "chain", "message": "The certificate does not chain to a trusted authority."})).submit("j", b"%PDF-")
    assert r.value.code == "chain" and "trusted authority" in r.value.message
    with pytest.raises(Held) as h:
        api(reply(503, {"code": "revocation-unavailable", "message": "down", "retryAfterSeconds": 45})).submit("j", b"%PDF-")
    assert h.value.retry_after == 45
    with pytest.raises(ServerRefused) as s:
        api(reply(409, {"message": "Another computer is signing this"})).claim("j")
    assert s.value.status == 409 and "Another computer" in s.value.message
    with pytest.raises(ServerRefused) as e:
        api(reply(400, {"message": ["code must be shorter", "name is required"]})).pair("x", "y", "z")
    assert "name is required" in e.value.message


def test_a_dead_connection_is_offline_not_a_crash():
    def h(req):
        raise httpx.ConnectError("down")

    with pytest.raises(Offline):
        api(h).jobs()


def test_the_signed_file_goes_up_as_a_pdf():
    def h(req):
        assert req.method == "PUT" and req.headers["content-type"] == "application/pdf" and req.content == b"%PDF-1.7 x"
        return httpx.Response(200, json={"signed": True, "test": False})

    assert api(h).submit("j1", b"%PDF-1.7 x")["signed"] is True


def test_download_follows_a_storage_redirect_without_sending_the_credential():
    from types import SimpleNamespace

    seen = []

    def h(req):
        seen.append((req.url.host, req.headers.get("authorization")))
        if req.url.host == "api.example.test":
            return httpx.Response(302, headers={"location": "https://files.r2.example.test/k?sig=1"})
        return httpx.Response(200, content=b"%PDF-1.7 bytes")

    data = api(h).download(SimpleNamespace(input_path="/v1/desktop/jobs/j1/input"))
    assert data == b"%PDF-1.7 bytes"
    assert seen[0] == ("api.example.test", f"Device {CRED}")
    assert seen[1] == ("files.r2.example.test", None)
