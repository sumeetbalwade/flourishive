"""Signing a batch: claim, download, sign, upload, one letter after another, with one PIN entry."""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass
from typing import Callable, Protocol

from .api import Api, Claim, Job
from .errors import DesktopError, Held, Offline, Rejected, ServerRefused, SigningFailed, Unpaired
from .store import History

# What is happening to a letter right now; the screen shows this and the animation follows it.
QUEUED, CLAIMING, DOWNLOADING, SIGNING, UPLOADING, WAITING, DONE, FAILED, SKIPPED = (
    "queued",
    "claiming",
    "downloading",
    "signing",
    "uploading",
    "waiting",
    "done",
    "failed",
    "skipped",
)


class Signs(Protocol):
    def __call__(self, pdf: bytes, claim: Claim) -> bytes: ...


@dataclass(frozen=True)
class BatchEvent:
    job_id: str
    reference: str
    step: str
    index: int
    total: int
    message: str = ""
    test: bool = False


@dataclass(frozen=True)
class JobResult:
    job: Job
    status: str  # done | failed | skipped
    detail: str = ""
    test: bool = False


class BatchRunner:
    def __init__(
        self,
        api: Api,
        sign: Signs,
        *,
        history: History | None = None,
        on_event: Callable[[BatchEvent], None] | None = None,
        cancelled: Callable[[], bool] = lambda: False,
        sleep: Callable[[float], None] = time.sleep,
        max_hold_tries: int = 6,
    ) -> None:
        self.api, self.sign, self.history = api, sign, history
        self._emit = on_event or (lambda e: None)
        self._cancelled = cancelled
        self._sleep = sleep
        self._max_hold = max_hold_tries

    def run(self, jobs: list[Job]) -> list[JobResult]:
        results: list[JobResult] = []
        total = len(jobs)
        for i, job in enumerate(jobs, start=1):
            if self._cancelled():
                results += [JobResult(j, SKIPPED, "Stopped") for j in jobs[i - 1 :]]
                break
            try:
                result = self._one(job, i, total)
            except (Unpaired, Offline) as exc:
                # nothing more can be done from this computer; say so for this one and stop
                self._finish(job, FAILED, str(exc), i, total, results)
                results += [JobResult(j, SKIPPED, str(exc)) for j in jobs[i:]]
                break
            results.append(result)
            if result.status == FAILED and result.detail.startswith("TOKEN:"):
                # the token itself is the problem (removed, locked): the rest cannot be signed either
                msg = result.detail.removeprefix("TOKEN:").strip()
                results[-1] = JobResult(job, FAILED, msg)
                results += [JobResult(j, SKIPPED, msg) for j in jobs[i:]]
                break
        return results

    # ------------------------------------------------------------------ one letter
    def _event(self, job: Job, step: str, i: int, n: int, message: str = "", test: bool = False) -> None:
        self._emit(BatchEvent(job.id, job.reference, step, i, n, message, test))

    def _finish(self, job: Job, status: str, detail: str, i: int, n: int, results: list[JobResult] | None = None, test: bool = False) -> JobResult:
        self._event(job, status, i, n, detail, test)
        if self.history:
            self.history.add(job.reference, status, detail, test)
        r = JobResult(job, status, detail, test)
        if results is not None:
            results.append(r)
        return r

    def _one(self, job: Job, i: int, n: int) -> JobResult:
        self._event(job, CLAIMING, i, n)
        try:
            claim = self.api.claim(job.id)
        except ServerRefused as exc:
            return self._finish(job, SKIPPED, exc.message, i, n)

        self._event(job, DOWNLOADING, i, n)
        try:
            pdf = self.api.download(claim)
        except ServerRefused as exc:
            return self._finish(job, FAILED, exc.message, i, n)
        if hashlib.sha256(pdf).hexdigest() != claim.sha256:
            self._safely(self.api.fail, job.id, "The downloaded document did not match its fingerprint.")
            return self._finish(job, FAILED, "The downloaded document did not match its fingerprint, so it was not signed.", i, n)

        self._event(job, SIGNING, i, n)
        try:
            signed = self.sign(pdf, claim)
        except SigningFailed as exc:
            self._safely(self.api.fail, job.id, str(exc))
            kind = "TOKEN: " if _is_token_problem(str(exc)) else ""
            return self._finish(job, FAILED, f"{kind}{exc}", i, n)
        except DesktopError as exc:
            self._safely(self.api.fail, job.id, str(exc))
            return self._finish(job, FAILED, str(exc), i, n)

        self._event(job, UPLOADING, i, n)
        for attempt in range(1, self._max_hold + 1):
            if self._cancelled():
                self._safely(self.api.release, job.id)
                return self._finish(job, SKIPPED, "Stopped before the server accepted it", i, n)
            try:
                done = self.api.submit(job.id, signed)
            except Held as exc:
                self._event(job, WAITING, i, n, "Waiting for the certificate check to be possible…")
                if attempt == self._max_hold:
                    self._safely(self.api.release, job.id)
                    return self._finish(job, FAILED, f"The server could not finish checking: {exc.message} Try again later.", i, n)
                self._sleep(min(max(exc.retry_after, 5), 120))
                continue
            except Rejected as exc:
                self._safely(self.api.fail, job.id, f"Rejected: {exc.code or exc.message}")
                return self._finish(job, FAILED, exc.message, i, n)
            except ServerRefused as exc:
                return self._finish(job, FAILED, exc.message, i, n)
            test = bool(done.get("test"))
            note = "Signed (TEST: not a genuine document)" if test else "Signed"
            return self._finish(job, DONE, note, i, n, test=test)
        return self._finish(job, FAILED, "The server did not accept the file.", i, n)

    @staticmethod
    def _safely(fn, *args) -> None:
        try:
            fn(*args)
        except DesktopError:
            pass


def _is_token_problem(message: str) -> bool:
    m = message.lower()
    return any(w in m for w in ("not plugged", "locked", "did not respond", "pin"))
