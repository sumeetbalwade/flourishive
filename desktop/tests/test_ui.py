import hashlib
import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import Qt  # noqa: E402

from flourishive_desktop import design  # noqa: E402
from flourishive_desktop.api import Appearance, Claim, Job, Paired  # noqa: E402
from flourishive_desktop.controller import Controller  # noqa: E402
from flourishive_desktop.errors import Held, Offline, ServerRefused, Unpaired  # noqa: E402
from flourishive_desktop.store import History, MemoryCredentials, Settings, SettingsStore  # noqa: E402
from flourishive_desktop.ui import animation, workers  # noqa: E402
from flourishive_desktop.ui.main_window import MainWindow, PairPage  # noqa: E402
from flourishive_desktop.ui.sign_dialog import SignDialog  # noqa: E402
from flourishive_desktop.signing import sign_pdf  # noqa: E402


class FakeApi:
    def __init__(self, pdf: bytes, jobs: list[Job] | None = None):
        self.pdf, self._jobs = pdf, jobs or []
        self.submitted: dict[str, bytes] = {}
        self.calls: list[str] = []
        self.pair_error: Exception | None = None
        self.jobs_error: Exception | None = None
        self.submit_script: list = []

    def pair(self, code, name, platform):
        self.calls.append(f"pair {code}")
        if self.pair_error:
            raise self.pair_error
        return Paired("dev1", "c" * 43, "Flourisense")

    update_body: dict = {"updateAvailable": False}

    def update(self, platform, version):
        return self.update_body

    def jobs(self):
        if self.jobs_error:
            raise self.jobs_error
        return list(self._jobs)

    def claim(self, job_id):
        self.calls.append(f"claim {job_id}")
        return Claim(job_id, "ref", hashlib.sha256(self.pdf).hexdigest(), f"/in/{job_id}", "Issued by ref", "http://tsa.invalid", Appearance(True, 0, (321.28, 70.0, 535.28, 118.0)))

    def download(self, claim):
        return self.pdf

    def submit(self, job_id, signed):
        if self.submit_script:
            step = self.submit_script.pop(0)
            if isinstance(step, Exception):
                raise step
        self.submitted[job_id] = signed
        return {"signed": True, "test": False}

    def fail(self, job_id, reason):
        self.calls.append(f"fail {job_id}")

    def release(self, job_id):
        self.calls.append(f"release {job_id}")

    def close(self):
        pass


def make_controller(tmp_path, api, *, paired=True, library="") -> Controller:
    store = SettingsStore(tmp_path / "s.json")
    creds = MemoryCredentials()
    if paired:
        store.save(Settings(server="https://api.test", device_id="dev1", company="Flourisense", library=library, reduce_motion=True))
        creds.set("dev1", "c" * 43)
    return Controller(store, creds, History(tmp_path / "h.jsonl"), api_factory=lambda server, cred: api)


def jobs(n=2):
    return [Job(f"j{i}", f"FS/INT/2026/{i:04d}", "OFFER", "Flourisense Technology LLP", "a" * 64, "x") for i in range(1, n + 1)]


# ------------------------------------------------------------------ animation
def test_each_state_draws_something_different(qtbot):
    w = animation.SigningAnimation(96, design.DARK, reduce_motion=True)
    qtbot.addWidget(w)
    pics = {}
    for st, pr in [("idle", None), ("signing", 0.65), ("waiting", None), ("done", None), ("failed", None)]:
        w.set_state(st, pr)
        pics[st] = w.grab().toImage().bits().tobytes()
    assert len(set(pics.values())) == 5


def test_the_drawn_amount_follows_the_real_progress_not_a_clock(qtbot):
    w = animation.SigningAnimation(96, design.DARK, reduce_motion=True)
    qtbot.addWidget(w)
    w.set_state("signing", 0.2)
    assert w.drawn() == (0.2, 0.0)
    w.set_state("signing", 0.8)
    assert w.drawn() == (0.8, 0.0)
    w.set_state("done")
    assert w.drawn() == (0.0, 1.0)  # the pen line gives way to the checkmark


def test_with_motion_it_eases_to_the_target_and_with_reduced_motion_it_jumps(qtbot):
    w = animation.SigningAnimation(96, design.DARK, reduce_motion=False)
    qtbot.addWidget(w)
    w.set_state("done")
    qtbot.waitUntil(lambda: w.drawn() == (0.0, 1.0), timeout=3000)
    r = animation.SigningAnimation(96, design.DARK, reduce_motion=True)
    qtbot.addWidget(r)
    r.set_state("done")
    assert r.drawn() == (0.0, 1.0)  # immediately


def test_the_svg_shapes_become_real_paths():
    for d in (design.PEN_STROKE, design.CHECK, design.CROSS):
        assert animation.path_from_svg(d).length() > 10


# ------------------------------------------------------------------ pairing
def test_the_link_from_the_web_app_fills_the_form_and_bad_links_do_nothing(qtbot, tmp_path):
    w = MainWindow(make_controller(tmp_path, FakeApi(b""), paired=False))
    qtbot.addWidget(w)
    assert w.root.currentIndex() == 1  # not paired: the pairing page
    assert not w.handle_link("flourishive://pair?code=ABCD-EFGH&server=http://evil.test")
    assert w.pair_page.code.text() == ""
    assert w.handle_link("flourishive://pair?code=abcd-efgh&server=https%3A%2F%2Fapi.flourishive.in")
    assert (w.pair_page.code.text(), w.pair_page.server.text()) == ("ABCD-EFGH", "https://api.flourishive.in")


def test_pairing_stores_the_credential_and_moves_to_the_queue(qtbot, tmp_path):
    api = FakeApi(b"", jobs())
    c = make_controller(tmp_path, api, paired=False)
    w = MainWindow(c)
    qtbot.addWidget(w)
    w.pair_page.server.setText("https://api.test")
    w.pair_page.code.setText("ABCD-EFGH")
    qtbot.mouseClick(w.pair_page.btn, Qt.MouseButton.LeftButton)
    qtbot.waitUntil(lambda: w.root.currentIndex() == 0, timeout=3000)
    assert c.credentials.get("dev1") == "c" * 43 and c.settings.company == "Flourisense"
    assert "Flourisense" in w.company.text()
    assert "c" * 43 not in c.store.path.read_text()  # the credential is not in the settings file


def test_a_refused_code_is_explained_in_the_form(qtbot, tmp_path):
    api = FakeApi(b"")
    api.pair_error = ServerRefused(400, "That code is not right or has expired. Make a new one in the web app.")
    w = MainWindow(make_controller(tmp_path, api, paired=False))
    qtbot.addWidget(w)
    w.pair_page.server.setText("https://api.test")
    w.pair_page.code.setText("ABCD-EFGH")
    qtbot.mouseClick(w.pair_page.btn, Qt.MouseButton.LeftButton)
    qtbot.waitUntil(lambda: "not right" in w.pair_page.error.text(), timeout=3000)
    assert w.root.currentIndex() == 1 and w.pair_page.btn.isEnabled()


# ------------------------------------------------------------------ queue
def test_the_queue_lists_letters_and_counts_the_selection(qtbot, tmp_path):
    w = MainWindow(make_controller(tmp_path, FakeApi(b"", jobs(3))))
    qtbot.addWidget(w)
    qtbot.waitUntil(lambda: w.queue.table.rowCount() == 3, timeout=3000)
    assert not w.queue.sign_btn.isEnabled() and w.queue.sign_btn.text() == "Sign selected"
    qtbot.mouseClick(w.queue.all_btn, Qt.MouseButton.LeftButton)
    assert w.queue.sign_btn.isEnabled() and w.queue.sign_btn.text() == "Sign 3 selected"
    assert [j.reference for j in w.queue.selected()][0] == "FS/INT/2026/0001"


def test_an_empty_queue_says_so_and_a_lost_pairing_returns_to_the_pairing_page(qtbot, tmp_path):
    api = FakeApi(b"", [])
    w = MainWindow(make_controller(tmp_path, api))
    qtbot.addWidget(w)
    # poll() does nothing while a check is already running, so let the first one finish
    qtbot.waitUntil(lambda: not w._polling, timeout=3000)
    api.jobs_error = Offline("Could not reach the server.")
    w.poll()
    qtbot.waitUntil(lambda: "No connection" in w.banner.text(), timeout=3000)
    qtbot.waitUntil(lambda: not w._polling, timeout=3000)
    api.jobs_error = Unpaired("This computer is no longer paired.")
    w.poll()
    qtbot.waitUntil(lambda: w.root.currentIndex() == 1, timeout=3000)
    assert "no longer paired" in w.pair_page.error.text()


# ------------------------------------------------------------------ the whole signing flow
@pytest.fixture
def with_dummy_tsa(monkeypatch, timestamper):
    monkeypatch.setattr(workers, "sign_pdf", lambda pdf, signer, opts: sign_pdf(pdf, signer, opts, timestamper=timestamper))


def test_pin_once_then_every_letter_is_signed_and_the_pin_is_not_kept(qtbot, tmp_path, token, pdf, with_dummy_tsa):
    api = FakeApi(pdf, jobs(2))
    c = make_controller(tmp_path, api, library=token.library)
    d = SignDialog(c, jobs(2))
    qtbot.addWidget(d)
    d.pin.setText(token.pin)
    qtbot.mouseClick(d.start_btn, Qt.MouseButton.LeftButton)
    assert d.pin.text() == ""  # cleared the moment it is handed over
    qtbot.waitUntil(lambda: d.close_btn.isVisible() or d.close_btn.isVisibleTo(d), timeout=20000)
    assert sorted(api.submitted) == ["j1", "j2"]
    assert all(b.startswith(pdf) and b.count(b"/ByteRange") == 1 for b in api.submitted.values())
    assert d.anim.state == animation.DONE and "All 2 signed" in d.caption.text()
    assert [r.status for r in d.results] == ["done", "done"]
    assert [e.status for e in c.history.recent()] == ["done", "done"]


def test_a_wrong_pin_goes_back_to_the_pin_step_and_claims_nothing(qtbot, tmp_path, token, pdf, with_dummy_tsa):
    api = FakeApi(pdf, jobs(1))
    d = SignDialog(make_controller(tmp_path, api, library=token.library), jobs(1))
    qtbot.addWidget(d)
    d.pin.setText("000000")
    qtbot.mouseClick(d.start_btn, Qt.MouseButton.LeftButton)
    qtbot.waitUntil(lambda: "PIN is not correct" in d.pin_error.text(), timeout=20000)
    assert d.pages.currentIndex() == 0 and d.start_btn.isEnabled() and d.anim.state == animation.FAILED
    assert not any(c.startswith("claim") for c in api.calls)


def test_no_token_driver_is_explained(qtbot, tmp_path, pdf, monkeypatch):
    monkeypatch.setattr("flourishive_desktop.controller.find_libraries", lambda: [])
    d = SignDialog(make_controller(tmp_path, FakeApi(pdf, jobs(1))), jobs(1))
    qtbot.addWidget(d)
    d.pin.setText("123456")
    qtbot.mouseClick(d.start_btn, Qt.MouseButton.LeftButton)
    qtbot.waitUntil(lambda: "driver" in d.pin_error.text(), timeout=5000)


def test_a_held_upload_shows_waiting_then_finishes(qtbot, tmp_path, token, pdf, with_dummy_tsa, monkeypatch):
    api = FakeApi(pdf, jobs(1))
    api.submit_script = [Held(503, "The revocation server could not be reached.", "revocation-unavailable", 1)]
    monkeypatch.setattr("flourishive_desktop.batch.time.sleep", lambda s: None)
    d = SignDialog(make_controller(tmp_path, api, library=token.library), jobs(1))
    qtbot.addWidget(d)
    seen = []
    d.anim.set_reduce_motion(True)
    orig = d.anim.set_state
    d.anim.set_state = lambda s, p=None: (seen.append(s), orig(s, p))[1]
    d.pin.setText(token.pin)
    qtbot.mouseClick(d.start_btn, Qt.MouseButton.LeftButton)
    qtbot.waitUntil(lambda: d.close_btn.isVisibleTo(d), timeout=20000)
    assert "waiting" in seen and d.anim.state == animation.DONE and list(api.submitted) == ["j1"]


def test_a_newer_version_shows_a_bar_and_a_required_one_blocks_signing(qtbot, tmp_path):
    api = FakeApi(b"", jobs(2))
    api.update_body = {"updateAvailable": True, "latest": "9.9.9", "notes": "", "mandatory": True, "sha256": "a" * 64, "url": "https://x/y.zip", "downloadPath": None, "sentryDsn": None}
    w = MainWindow(make_controller(tmp_path, api))
    qtbot.addWidget(w)
    qtbot.waitUntil(lambda: not w.update_bar.isHidden(), timeout=3000)
    assert "9.9.9" in w.update_label.text() and "required" in w.update_label.text()
    qtbot.waitUntil(lambda: w.queue.table.rowCount() == 2, timeout=3000)
    qtbot.mouseClick(w.queue.all_btn, Qt.MouseButton.LeftButton)
    qtbot.mouseClick(w.queue.sign_btn, Qt.MouseButton.LeftButton)
    assert "too old" in w.banner.text()  # no signing dialog opened


def test_no_bar_when_up_to_date(qtbot, tmp_path):
    w = MainWindow(make_controller(tmp_path, FakeApi(b"", jobs(1))))
    qtbot.addWidget(w)
    qtbot.waitUntil(lambda: w.queue.table.rowCount() == 1, timeout=3000)
    assert w.update_bar.isHidden() and not w.update_required

