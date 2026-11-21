from __future__ import annotations

import sys

from PySide6.QtCore import QObject
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtWidgets import QApplication

from . import __version__
from .controller import Controller
from .link import register_protocol
from .ui.main_window import MainWindow

SOCKET = "FlourishiveDesktop-instance"


def _send_to_running_instance(arg: str) -> bool:
    """If another copy is open, hand it the link and let this one quit."""
    s = QLocalSocket()
    s.connectToServer(SOCKET)
    if not s.waitForConnected(300):
        return False
    s.write(arg.encode("utf-8"))
    s.flush()
    s.waitForBytesWritten(500)
    s.disconnectFromServer()
    return True


class _LinkServer(QObject):
    def __init__(self, window: MainWindow) -> None:
        super().__init__(window)
        self.window = window
        QLocalServer.removeServer(SOCKET)
        self.server = QLocalServer(self)
        self.server.newConnection.connect(self._read)
        self.server.listen(SOCKET)

    def _read(self) -> None:
        conn = self.server.nextPendingConnection()
        if conn and conn.waitForReadyRead(500):
            data = bytes(conn.readAll()).decode("utf-8", errors="replace")
            self.window.handle_link(data) or (self.window.show(), self.window.raise_())


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    if "--version" in argv:
        print(f"Flourishive Desktop {__version__}")
        return 0
    if "--selftest" in argv:
        # used by the build to prove the packaged program starts: load everything, draw once, exit
        import os  # noqa: PLC0415

        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        app = QApplication(argv[:1])
        w = MainWindow(Controller())
        w.grab()
        print("selftest ok", __version__)
        del app
        return 0
    link = next((a for a in argv[1:] if a.lower().startswith("flourishive:")), "")
    app = QApplication(argv)
    app.setApplicationName("Flourishive Desktop")
    if _send_to_running_instance(link or "show"):
        return 0
    register_protocol(sys.executable if getattr(sys, "frozen", False) else sys.argv[0])
    window = MainWindow(Controller())
    _LinkServer(window)
    window.show()
    if link:
        window.handle_link(link)
    return app.exec()
