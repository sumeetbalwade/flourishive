"""The batch runner with a fake server and a fake token: order, retries, and what stops the rest."""

import hashlib

import pytest

from flourishive_desktop.api import Appearance, Claim, Job
from flourishive_desktop.batch import BatchRunner
from flourishive_desktop.errors import Held, Offline, Rejected, ServerRefused, SigningFailed, Unpaired
from flourishive_desktop.store import History

PDF = b"%PDF-1.7 fake letter"
SHA = hashlib.sha256(PDF).hexdigest()


def job(n: int, sha: str = SHA) -> Job:
    return Job(f"j{n}", f"FS/INT/2026/{n:04d}", "OFFER", "HQ", sha, "x")


class FakeApi:
    def __init__(self):
        self.calls: list[tuple] = []
        self.claim_errors: dict[str, Exception] = {}
        self.submit_script: dict[str, list] = {}
        self.download_bytes = PDF

    def claim(self, job_id):
        self.calls.append(("claim", job_id))
        if job_id in self.claim_errors:
            raise self.claim_errors[job_id]
        return Claim(job_id, "ref", SHA, f"/in/{job_id}", "r", "http://tsa", Appearance(True, 0, (1, 2, 3, 4)))

    def download(self, claim):
        self.calls.append(("download", claim.id))
        return self.download_bytes

    def submit(self, job_id, signed):
        self.calls.append(("submit", job_id))
        script = self.submit_script.get(job_id, [{"signed": True, "test": False}])
        step = script.pop(0) if len(script) > 1 else script[0]
        if isinstance(step, Exception):
            raise step
        return step

    def fail(self, job_id, reason):
        self.calls.append(("fail", job_id, reason))

    def release(self, job_id):
        self.calls.append(("release", job_id))


def run(api, jobs, sign=lambda pdf, claim: pdf + b"SIGNED", **kw):
    events = []
    sleeps = []
    results = BatchRunner(api, sign, on_event=events.append, sleep=sleeps.append, **kw).run(jobs)
    return results, events, sleeps


def test_every_letter_goes_through_each_step_in_order():
    api = FakeApi()
    results, events, _ = run(api, [job(1), job(2)])
    assert [r.status for r in results] == ["done", "done"]
    assert [e.step for e in events if e.job_id == "j1"] == ["claiming", "downloading", "signing", "uploading", "done"]
    # one letter is finished before the next is even claimed, so a stopped batch leaves nothing held
    kinds = [c[:2] for c in api.calls]
    assert kinds == [("claim", "j1"), ("download", "j1"), ("submit", "j1"), ("claim", "j2"), ("download", "j2"), ("submit", "j2")]


def test_a_letter_that_does_not_match_its_fingerprint_is_never_signed():
    api = FakeApi()
    api.download_bytes = PDF + b" changed on the way"
    signed = []
    results, *_ = run(api, [job(1)], sign=lambda pdf, c: signed.append(1) or pdf)
    assert results[0].status == "failed" and "fingerprint" in results[0].detail
    assert signed == [] and any(c[0] == "fail" for c in api.calls)


def test_a_job_taken_elsewhere_is_skipped_and_the_rest_continue():
    api = FakeApi()
    api.claim_errors["j1"] = ServerRefused(409, "Another computer is signing this")
    results, *_ = run(api, [job(1), job(2)])
    assert [r.status for r in results] == ["skipped", "done"]


def test_a_server_refusal_is_reported_with_its_reason_and_frees_the_job():
    api = FakeApi()
    api.submit_script["j1"] = [Rejected(422, "The signing certificate has been revoked.", "revoked")]
    results, *_ = run(api, [job(1), job(2)])
    assert results[0].status == "failed" and "revoked" in results[0].detail
    assert ("fail", "j1", "Rejected: revoked") in api.calls
    assert results[1].status == "done"


def test_held_uploads_wait_and_retry_then_succeed():
    api = FakeApi()
    api.submit_script["j1"] = [Held(503, "revocation server down", "revocation-unavailable", 45), Held(503, "still down", None, 2), {"signed": True, "test": False}]
    results, events, sleeps = run(api, [job(1)])
    assert results[0].status == "done"
    assert sleeps == [45, 5]  # the server's wait, and never less than five seconds
    assert any(e.step == "waiting" for e in events)


def test_a_check_that_never_becomes_possible_gives_up_and_frees_the_job():
    api = FakeApi()
    api.submit_script["j1"] = [Held(503, "down", None, 10)]
    results, _, sleeps = run(api, [job(1)], max_hold_tries=3)
    assert results[0].status == "failed" and "later" in results[0].detail
    assert len(sleeps) == 2 and ("release", "j1") in api.calls


def test_a_token_problem_stops_the_whole_batch():
    api = FakeApi()

    def sign(pdf, claim):
        raise SigningFailed("The token is not plugged in. Plug it in and try again.")

    results, *_ = run(api, [job(1), job(2), job(3)], sign=sign)
    assert [r.status for r in results] == ["failed", "skipped", "skipped"]
    assert not any(c == ("claim", "j2") for c in api.calls)  # the others were never claimed


def test_losing_the_pairing_or_the_network_stops_the_batch():
    for exc in (Unpaired("This computer is no longer paired."), Offline("Could not reach the server.")):
        api = FakeApi()
        api.claim_errors["j1"] = exc
        results, *_ = run(api, [job(1), job(2)])
        assert [r.status for r in results] == ["failed", "skipped"]


def test_stop_between_letters_and_during_upload():
    api = FakeApi()
    state = {"n": 0}

    def cancelled():
        state["n"] += 1
        return state["n"] > 1  # let the first letter start, then stop

    results = BatchRunner(api, lambda p, c: p, cancelled=cancelled, sleep=lambda s: None).run([job(1), job(2)])
    assert results[0].status in {"skipped", "done"}
    assert results[-1].status == "skipped"


def test_test_signatures_are_labelled_and_everything_lands_in_the_history(tmp_path):
    api = FakeApi()
    api.submit_script["j1"] = [{"signed": True, "test": True}]
    h = History(tmp_path / "h.jsonl")
    results = BatchRunner(api, lambda p, c: p, history=h).run([job(1)])
    assert results[0].test and "TEST" in results[0].detail
    assert h.recent()[0].test is True
