from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem, QProgressBar, QPushButton, QStackedWidget, QVBoxLayout, QWidget

from .. import batch, design
from ..api import Job
from ..batch import BatchEvent, JobResult
from ..controller import Controller
from . import animation
from .workers import BatchThread

STEP_TEXT = {
    batch.QUEUED: "Waiting",
    batch.CLAIMING: "Reserving…",
    batch.DOWNLOADING: "Downloading…",
    batch.SIGNING: "Signing…",
    batch.UPLOADING: "Sending to the server…",
    batch.WAITING: "Waiting for the certificate check…",
    batch.DONE: "Signed",
    batch.FAILED: "Failed",
    batch.SKIPPED: "Skipped",
}


class SignDialog(QDialog):
    """Enter the PIN once, then watch each letter being signed (D-37: the animation follows real state)."""

    def __init__(self, controller: Controller, jobs: list[Job], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.c, self.jobs = controller, jobs
        self.results: list[JobResult] = []
        self._thread: BatchThread | None = None
        self.setWindowTitle("Sign letters")
        self.setMinimumWidth(520)
        pal = design.LIGHT if controller.settings.theme == "light" else design.DARK
        self.anim = animation.SigningAnimation(110, pal, reduce_motion=controller.settings.reduce_motion)
        self.caption = QLabel("")
        self.caption.setProperty("muted", True)
        self.caption.setWordWrap(True)
        self.caption.setAlignment(Qt.AlignmentFlag.AlignCenter)

        # step 1: the PIN
        self.pin = QLineEdit()
        self.pin.setEchoMode(QLineEdit.EchoMode.Password)
        self.pin.setPlaceholderText("Token PIN")
        self.pin.setObjectName("pin")
        self.pin_error = QLabel("")
        self.pin_error.setProperty("danger", True)
        self.pin_error.setWordWrap(True)
        self.start_btn = QPushButton(f"Sign {len(jobs)} letter{'s' if len(jobs) != 1 else ''}")
        self.start_btn.setProperty("primary", True)
        self.start_btn.setObjectName("start")
        self.start_btn.setDefault(True)
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.reject)
        self.pin.returnPressed.connect(self._start)
        self.start_btn.clicked.connect(self._start)
        pin_page = QWidget()
        pl = QVBoxLayout(pin_page)
        explain = QLabel(
            "Plug in the token and enter its PIN. It is asked once for this whole batch, "
            "used only to open the token, and never saved or shown again."
        )
        explain.setWordWrap(True)
        explain.setProperty("muted", True)
        pl.addWidget(explain)
        pl.addWidget(self.pin)
        pl.addWidget(self.pin_error)
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(cancel)
        row.addWidget(self.start_btn)
        pl.addLayout(row)

        # step 2: progress
        self.bar = QProgressBar()
        self.bar.setRange(0, len(jobs))
        self.bar.setTextVisible(False)
        self.list = QListWidget()
        self.list.setObjectName("progress")
        self.list.setMinimumHeight(140)
        self._items: dict[str, QListWidgetItem] = {}
        for j in jobs:
            it = QListWidgetItem(f"{j.reference}    {STEP_TEXT[batch.QUEUED]}")
            self.list.addItem(it)
            self._items[j.id] = it
        self.stop_btn = QPushButton("Stop after this letter")
        self.stop_btn.clicked.connect(self._stop)
        self.close_btn = QPushButton("Close")
        self.close_btn.setProperty("primary", True)
        self.close_btn.clicked.connect(self.accept)
        self.close_btn.hide()
        run_page = QWidget()
        rl = QVBoxLayout(run_page)
        rl.addWidget(self.bar)
        rl.addWidget(self.list)
        brow = QHBoxLayout()
        brow.addStretch(1)
        brow.addWidget(self.stop_btn)
        brow.addWidget(self.close_btn)
        rl.addLayout(brow)

        self.pages = QStackedWidget()
        self.pages.addWidget(pin_page)
        self.pages.addWidget(run_page)
        layout = QVBoxLayout(self)
        layout.addWidget(self.anim, alignment=Qt.AlignmentFlag.AlignHCenter)
        layout.addWidget(self.caption)
        layout.addWidget(self.pages)
        self.anim.set_state(animation.IDLE)
        self.caption.setText("Ready to sign")

    # -- flow ----------------------------------------------------------------
    def _start(self) -> None:
        pin = self.pin.text()
        if not pin:
            self.pin_error.setText("Enter the token PIN.")
            return
        self.pin.clear()  # gone from the screen the moment it is handed over
        self.pin_error.setText("")
        self.start_btn.setEnabled(False)
        self.caption.setText("Opening the token…")
        self.anim.set_state(animation.WAITING)
        self._thread = BatchThread(self.c, self.jobs, pin, self)
        del pin
        self._thread.token_failed.connect(self._token_failed)
        self._thread.token_ready.connect(self._token_ready)
        self._thread.event.connect(self._event)
        self._thread.finished_all.connect(self._finished)
        self._thread.start()

    def _token_failed(self, message: str) -> None:
        self.start_btn.setEnabled(True)
        self.pin_error.setText(message)
        self.caption.setText("Could not open the token")
        self.anim.set_state(animation.FAILED)
        self.pin.setFocus()

    def _token_ready(self, who: str) -> None:
        self.pages.setCurrentIndex(1)
        self.caption.setText(f"Signing as {who}" if who else "Signing")
        self.anim.set_state(animation.SIGNING, 0.0)

    def _event(self, e: BatchEvent) -> None:
        item = self._items.get(e.job_id)
        if item:
            tail = f" ({e.message})" if e.message and e.step in {batch.FAILED, batch.SKIPPED, batch.WAITING} else ""
            item.setText(f"{e.reference}    {STEP_TEXT.get(e.step, e.step)}{tail}")
        finished = sum(1 for it in self._items.values() if it.text().split("    ", 1)[-1].startswith(("Signed", "Failed", "Skipped")))
        self.bar.setValue(finished)
        if e.step == batch.WAITING:
            self.anim.set_state(animation.WAITING)
            self.caption.setText(e.message)
        elif e.step in {batch.DONE, batch.FAILED, batch.SKIPPED}:
            self.anim.set_state(animation.SIGNING, finished / max(1, len(self.jobs)))
        else:
            self.anim.set_state(animation.SIGNING, finished / max(1, len(self.jobs)))
            self.caption.setText(f"{e.reference}: {STEP_TEXT.get(e.step, e.step)}  ({e.index} of {e.total})")

    def _stop(self) -> None:
        if self._thread:
            self._thread.stop()
        self.stop_btn.setEnabled(False)
        self.caption.setText("Stopping after the current letter…")

    def _finished(self, results: list[JobResult]) -> None:
        self.results = results
        done = [r for r in results if r.status == batch.DONE]
        bad = [r for r in results if r.status == batch.FAILED]
        for r in results:
            it = self._items.get(r.job.id)
            if it:
                it.setText(f"{r.job.reference}    {r.detail or STEP_TEXT.get(r.status, r.status)}")
        self.bar.setValue(len(self.jobs))
        self.stop_btn.hide()
        self.close_btn.show()
        test = any(r.test for r in done)
        if bad or not done:
            self.anim.set_state(animation.FAILED)
            self.caption.setText(f"{len(done)} signed, {len(bad)} failed, {len(results) - len(done) - len(bad)} skipped. Check each letter below.")
        else:
            self.anim.set_state(animation.DONE)
            self.caption.setText(f"All {len(done)} signed." + (" These are TEST signatures, not genuine documents." if test else ""))
