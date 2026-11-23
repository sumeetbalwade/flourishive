"""The server's desktop API (backend/src/modules/desktop)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from . import __version__
from .errors import Held, Offline, Rejected, ServerRefused, Unpaired


@dataclass(frozen=True)
class Job:
    id: str
    reference: str
    letter_type: str
    issued_by: str
    sha256: str
    expires_at: str
    claimed_by_this_device: bool = False
    electronic_allowed: bool = False  # the company lets signatories sign without the token


@dataclass(frozen=True)
class Appearance:
    visible: bool
    page: int
    box: tuple[float, float, float, float]
    style: str = "tick"


@dataclass(frozen=True)
class Claim:
    id: str
    reference: str
    sha256: str
    input_path: str
    reason: str
    timestamp_url: str
    appearance: Appearance
    lease_seconds: int = 600
    raw: dict[str, Any] = field(default_factory=dict, compare=False)


@dataclass(frozen=True)
class Paired:
    device_id: str
    credential: str
    company: str


def _message(body: Any, fallback: str) -> tuple[str, str | None]:
    """Nest answers with {message: str | [str]} or, where we send a code, {code, message}."""
    if isinstance(body, dict):
        m = body.get("message")
        code = body.get("code")
        if isinstance(m, dict):
            code = m.get("code", code)
            m = m.get("message")
        if isinstance(m, list):
            m = " ".join(str(x) for x in m)
        if isinstance(m, str) and m:
            return m, code if isinstance(code, str) else None
    return fallback, None


class Api:
    """Thin client. One instance per paired computer (or none yet, to pair)."""

    def __init__(
        self,
        server: str,
        credential: str | None = None,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.server = server.rstrip("/")
        self._http = httpx.Client(
            base_url=self.server,
            transport=transport,
            timeout=timeout,
            headers={"User-Agent": f"FlourishiveDesktop/{__version__}"},
        )
        self._credential = credential

    def close(self) -> None:
        self._http.close()

    def _request(self, method: str, path: str, **kw: Any) -> httpx.Response:
        headers = dict(kw.pop("headers", {}))
        if self._credential:
            headers["Authorization"] = f"Device {self._credential}"
        try:
            res = self._http.request(method, path, headers=headers, **kw)
        except httpx.HTTPError as exc:
            raise Offline("Could not reach the server. Check the internet connection and try again.") from exc
        if res.status_code == 401 and self._credential:
            raise Unpaired("This computer is no longer paired. Pair it again from the web app.")
        return res

    def _json(self, res: httpx.Response) -> Any:
        try:
            body = res.json() if res.content else None
        except ValueError:
            body = None
        if res.status_code == 422:
            message, code = _message(body, "The server did not accept the signed file.")
            raise Rejected(422, message, code)
        if res.status_code == 503:
            message, code = _message(body, "The server could not finish checking. Try again shortly.")
            retry = body.get("retryAfterSeconds") if isinstance(body, dict) else None
            if retry is None and isinstance(body, dict) and isinstance(body.get("message"), dict):
                retry = body["message"].get("retryAfterSeconds")
            raise Held(503, message, code, int(retry or 60))
        if res.status_code >= 400:
            message, code = _message(body, f"The server answered {res.status_code}.")
            raise ServerRefused(res.status_code, message, code)
        return body

    # -- updates -------------------------------------------------------------
    def update(self, platform: str, version: str) -> dict[str, Any]:
        body = self._json(self._request("GET", "/v1/desktop/update", params={"platform": platform, "version": version}))
        return body if isinstance(body, dict) else {}

    # -- pairing -------------------------------------------------------------
    def pair(self, code: str, name: str, platform: str) -> Paired:
        body = self._json(
            self._request(
                "POST",
                "/v1/desktop/pair",
                json={"code": code, "name": name, "platform": platform, "appVersion": __version__},
            )
        )
        return Paired(body["deviceId"], body["credential"], body.get("company", ""))

    def me(self) -> dict[str, Any]:
        return self._json(self._request("GET", "/v1/desktop/me"))

    # -- jobs ----------------------------------------------------------------
    def jobs(self) -> list[Job]:
        rows = self._json(self._request("GET", "/v1/desktop/jobs"))
        return [
            Job(
                id=r["id"],
                reference=r["reference"],
                letter_type=r["letterType"],
                issued_by=r.get("issuedBy", ""),
                sha256=r["sha256"],
                expires_at=r["expiresAt"],
                claimed_by_this_device=bool(r.get("claimedByThisDevice")),
                electronic_allowed=bool(r.get("electronicAllowed")),
            )
            for r in rows
        ]

    def sign_electronically(self, job_id: str, code: str) -> dict[str, Any]:
        """Signs without the token, confirmed by the signatory's authenticator code (only if the company allows it)."""
        return self._json(self._request("POST", f"/v1/desktop/jobs/{job_id}/sign-electronically", json={"code": code}))

    def claim(self, job_id: str) -> Claim:
        b = self._json(self._request("POST", f"/v1/desktop/jobs/{job_id}/claim"))
        sig = b["signature"]
        ap = sig["appearance"]
        return Claim(
            id=b["id"],
            reference=b["reference"],
            sha256=b["sha256"],
            input_path=b["inputPath"],
            reason=sig["reason"],
            timestamp_url=sig["timestampUrl"],
            appearance=Appearance(bool(ap["visible"]), int(ap["page"]), tuple(float(n) for n in ap["box"]), ap.get("style", "tick")),  # type: ignore[arg-type]
            lease_seconds=int(b.get("leaseSeconds", 600)),
            raw=b,
        )

    def download(self, claim: Claim) -> bytes:
        # The server may answer with a redirect to a short-lived storage link (D-72). httpx drops the
        # Authorization header when the redirect leaves the server's origin.
        res = self._request("GET", claim.input_path, follow_redirects=True)
        if res.status_code >= 400:
            self._json(res)
        return res.content

    def submit(self, job_id: str, signed: bytes) -> dict[str, Any]:
        return self._json(
            self._request(
                "PUT",
                f"/v1/desktop/jobs/{job_id}/signed",
                content=signed,
                headers={"Content-Type": "application/pdf"},
                timeout=120.0,
            )
        )

    def release(self, job_id: str) -> None:
        self._json(self._request("POST", f"/v1/desktop/jobs/{job_id}/release"))

    def fail(self, job_id: str, reason: str) -> None:
        self._json(self._request("POST", f"/v1/desktop/jobs/{job_id}/fail", json={"reason": reason[:300]}))
