from __future__ import annotations

from typing import Any, Callable

from PySide6.QtCore import QObject, QRunnable, QThread, Signal

from ..api import Job
from ..batch import BatchEvent, BatchRunner, JobResult
from ..controller import Controller
from ..errors import DesktopError
from ..signing import options_from, sign_pdf
from ..tokens import TokenSession


class _Signals(QObject):
    done = Signal(object)
    failed = Signal(object)


class Call(QRunnable):
    """Runs a function off the screen thread and reports back."""

    def __init__(self, fn: Callable[[], Any]) -> None:
        super().__init__()
        self.fn = fn
        self.signals = _Signals()

    def run(self) -> None:
        try:
            self.signals.done.emit(self.fn())
        except Exception as exc:  # noqa: BLE001
            self.signals.failed.emit(exc)


class BatchThread(QThread):
    """Opens the token once with the PIN, then signs the chosen letters one after another."""

    token_ready = Signal(str)  # the certificate's name
    token_failed = Signal(str)  # nothing was claimed; the PIN can be tried again
    event = Signal(object)  # BatchEvent
    finished_all = Signal(object)  # list[JobResult]

    def __init__(self, controller: Controller, jobs: list[Job], pin: str, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self._c = controller
        self._jobs = jobs
        self._pin: str | None = pin
        self._stop = False

    def stop(self) -> None:
        self._stop = True

    def run(self) -> None:
        pin, self._pin = self._pin or "", None
        try:
            choice = self._c.locate_token()
            session = TokenSession(choice.library, pin, token_label=choice.label, cert_id=self._c.settings.cert_id or None)
            pin = ""  # the session already holds what it needs
            with session as t:
                self.token_ready.emit(t.certificate.common_name if t.certificate else "")
                results = BatchRunner(
                    self._c.api(),
                    lambda pdf, claim: sign_pdf(pdf, t.signer, options_from(claim)),
                    history=self._c.history,
                    on_event=self.event.emit,
                    cancelled=lambda: self._stop,
                ).run(self._jobs)
        except DesktopError as exc:
            self.token_failed.emit(str(exc))
            return
        finally:
            pin = ""
        self.finished_all.emit(results)


__all__ = ["BatchEvent", "BatchThread", "Call", "JobResult"]
