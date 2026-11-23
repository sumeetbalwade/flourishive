from __future__ import annotations

from PySide6.QtCore import Qt, QThreadPool
from PySide6.QtWidgets import QDialog, QHBoxLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout, QWidget

from ..api import Job
from ..controller import Controller
from ..errors import DesktopError
from .workers import Call


class ElectronicDialog(QDialog):
    """Sign without the token: one authenticator code, then each letter is stamped and sealed by the server."""

    def __init__(self, controller: Controller, jobs: list[Job], parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.c, self.jobs = controller, jobs
        self.signed = 0
        self.setWindowTitle("Sign without the token")
        self.setMinimumWidth(460)
        intro = QLabel(
            "The letters get a visible signature stamp and the organisation seal, and are marked "
            "\"Signed electronically (no DSC)\". This is not a digital signature certificate signature.\n\n"
            "Enter the 6-digit code from your authenticator app to confirm it is you."
        )
        intro.setWordWrap(True)
        intro.setProperty("muted", True)
        self.code = QLineEdit()
        self.code.setPlaceholderText("6-digit code")
        self.code.setMaxLength(6)
        self.code.setObjectName("code")
        self.code.returnPressed.connect(self._start)
        self.message = QLabel("")
        self.message.setWordWrap(True)
        self.message.setProperty("danger", True)
        self.go = QPushButton(f"Sign {len(jobs)} letter{'s' if len(jobs) != 1 else ''}")
        self.go.setProperty("primary", True)
        self.go.setObjectName("start")
        self.go.clicked.connect(self._start)
        cancel = QPushButton("Close")
        cancel.clicked.connect(self.reject)
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(cancel)
        row.addWidget(self.go)
        lay = QVBoxLayout(self)
        lay.addWidget(intro)
        lay.addWidget(self.code)
        lay.addWidget(self.message)
        lay.addLayout(row)

    def _start(self) -> None:
        code = self.code.text().strip()
        if len(code) != 6 or not code.isdigit():
            self.message.setText("Enter the 6 digits from your authenticator app.")
            return
        self.go.setEnabled(False)
        self.code.setEnabled(False)
        self.message.setText("Signing…")
        self.message.setProperty("danger", False)
        task = Call(lambda: self._run(code))
        task.signals.done.connect(self._done)
        task.signals.failed.connect(self._failed)
        QThreadPool.globalInstance().start(task)

    def _run(self, code: str) -> int:
        """Signs the letters one after another; stops at the first one that is refused."""
        api, n = self.c.api(), 0
        for job in self.jobs:
            try:
                api.sign_electronically(job.id, code)
            except Exception as exc:
                self.c.history.add(job.reference, "failed", str(exc)[:200])
                self.signed = n
                raise
            self.c.history.add(job.reference, "done", "Signed electronically (no DSC)")
            n += 1
        return n

    def _done(self, n: int) -> None:
        self.signed = n
        self.message.setProperty("danger", False)
        self.message.setText(f"Signed {n} letter{'s' if n != 1 else ''}.")
        self.go.hide()
        self.accept()

    def _failed(self, exc: Exception) -> None:
        self.go.setEnabled(True)
        self.code.setEnabled(True)
        self.message.setProperty("danger", True)
        done = f"{self.signed} signed before this. " if self.signed else ""
        self.message.setText(done + (str(exc) if isinstance(exc, DesktopError) else "That did not work. Try again."))
        self.style().unpolish(self.message)
        self.style().polish(self.message)
