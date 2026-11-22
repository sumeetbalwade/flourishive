from __future__ import annotations

from datetime import datetime, timezone

from pathlib import Path

from PySide6.QtCore import Qt, QThreadPool, QTimer
from PySide6.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QCheckBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QPushButton,
    QSpinBox,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from .. import __version__, telemetry, updater
from ..api import Job
from ..controller import Controller
from ..errors import DesktopError, Offline, Unpaired
from ..link import PairLink, parse_link
from ..tokens import find_libraries
from .sign_dialog import SignDialog
from .workers import Call

LETTER = {"OFFER": "Offer letter", "EXPERIENCE": "Experience letter", "REFERENCE": "Reference letter", "CERTIFICATE": "Internship certificate"}


def card(*children: QWidget) -> QFrame:
    f = QFrame()
    f.setProperty("card", True)
    lay = QVBoxLayout(f)
    lay.setContentsMargins(20, 18, 20, 18)
    lay.setSpacing(10)
    for c in children:
        lay.addWidget(c)
    return f


def label(text: str, *, muted=False, title=False, wrap=True) -> QLabel:
    l = QLabel(text)
    l.setWordWrap(wrap)
    if muted:
        l.setProperty("muted", True)
    if title:
        l.setProperty("title", True)
    return l


class PairPage(QWidget):
    """Pair this computer: the code (and server) usually arrive from the web app's link."""

    def __init__(self, c: Controller, on_paired) -> None:
        super().__init__()
        self.c, self.on_paired = c, on_paired
        self.server = QLineEdit(c.settings.server)
        self.server.setPlaceholderText("https://api.example.com")
        self.server.setObjectName("server")
        self.code = QLineEdit()
        self.code.setPlaceholderText("ABCD-EFGH")
        self.code.setObjectName("code")
        self.code.setMaxLength(9)
        self.error = label("")
        self.error.setProperty("danger", True)
        self.btn = QPushButton("Pair this computer")
        self.btn.setProperty("primary", True)
        self.btn.setObjectName("pair")
        self.btn.clicked.connect(self.pair)
        self.code.returnPressed.connect(self.pair)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(40, 40, 40, 40)
        lay.addStretch(1)
        lay.addWidget(label("Pair this computer", title=True))
        lay.addWidget(label("In the web app open Signing, choose Pair a device, and click the link it shows, or type the code here. The code works once for ten minutes.", muted=True))
        lay.addWidget(card(label("Server", muted=True), self.server, label("Code", muted=True), self.code, self.error, self.btn))
        lay.addStretch(2)

    def fill(self, link: PairLink) -> None:
        self.server.setText(link.server)
        self.code.setText(link.code)
        self.code.setFocus()

    def pair(self) -> None:
        self.error.setText("")
        self.btn.setEnabled(False)
        server, code = self.server.text().strip(), self.code.text().strip()
        task = Call(lambda: self.c.pair(server, code))
        task.signals.done.connect(self._ok)  # a method of this widget, so it runs on the screen thread
        task.signals.failed.connect(self._failed)
        QThreadPool.globalInstance().start(task)

    def _ok(self, company: str) -> None:
        self.btn.setEnabled(True)
        self.code.clear()
        self.on_paired(company)

    def _failed(self, exc: Exception) -> None:
        self.btn.setEnabled(True)
        self.error.setText(str(exc) if isinstance(exc, DesktopError) else "Could not pair. Check the server address and try again.")


class QueuePage(QWidget):
    def __init__(self, c: Controller, window: "MainWindow") -> None:
        super().__init__()
        self.c, self.window = c, window
        self.jobs: list[Job] = []
        self.status = label("", muted=True)
        self.table = QTableWidget(0, 4)
        self.table.setObjectName("queue")
        self.table.setHorizontalHeaderLabels(["", "Reference", "Letter", "Company"])
        self.table.verticalHeader().hide()
        self.table.setShowGrid(False)
        self.table.setSelectionMode(QAbstractItemView.SelectionMode.NoSelection)
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        self.table.itemChanged.connect(self._changed)
        self.empty = label("Nothing is waiting for your signature.\nLetters appear here when HR sends them, and this list refreshes by itself.", muted=True)
        self.empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.refresh_btn = QPushButton("Refresh")
        self.refresh_btn.clicked.connect(window.poll)
        self.all_btn = QPushButton("Select all")
        self.all_btn.clicked.connect(self._select_all)
        self.sign_btn = QPushButton("Sign selected")
        self.sign_btn.setProperty("primary", True)
        self.sign_btn.setObjectName("sign")
        self.sign_btn.setEnabled(False)
        self.sign_btn.clicked.connect(self._sign)
        top = QHBoxLayout()
        top.addWidget(label("To sign", title=True, wrap=False))
        top.addStretch(1)
        top.addWidget(self.refresh_btn)
        top.addWidget(self.all_btn)
        top.addWidget(self.sign_btn)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(28, 24, 28, 24)
        lay.addLayout(top)
        lay.addWidget(self.status)
        lay.addWidget(self.table, 1)
        lay.addWidget(self.empty, 1)

    def show_jobs(self, jobs: list[Job]) -> None:
        keep = {j.id for j in self.selected()}
        self.jobs = jobs
        self.table.blockSignals(True)
        self.table.setRowCount(len(jobs))
        for r, j in enumerate(jobs):
            check = QTableWidgetItem()
            check.setFlags(Qt.ItemFlag.ItemIsUserCheckable | Qt.ItemFlag.ItemIsEnabled)
            check.setCheckState(Qt.CheckState.Checked if j.id in keep else Qt.CheckState.Unchecked)
            check.setData(Qt.ItemDataRole.UserRole, j.id)
            self.table.setItem(r, 0, check)
            for col, text in ((1, j.reference), (2, LETTER.get(j.letter_type, j.letter_type)), (3, j.issued_by)):
                it = QTableWidgetItem(text)
                it.setFlags(Qt.ItemFlag.ItemIsEnabled)
                self.table.setItem(r, col, it)
        self.table.blockSignals(False)
        self.table.setVisible(bool(jobs))
        self.empty.setVisible(not jobs)
        self.all_btn.setEnabled(bool(jobs))
        self._changed()

    def selected(self) -> list[Job]:
        ids = set()
        for r in range(self.table.rowCount()):
            it = self.table.item(r, 0)
            if it and it.checkState() == Qt.CheckState.Checked:
                ids.add(it.data(Qt.ItemDataRole.UserRole))
        return [j for j in self.jobs if j.id in ids]

    def _changed(self, *_a) -> None:
        n = len(self.selected())
        self.sign_btn.setEnabled(n > 0)
        self.sign_btn.setText(f"Sign {n} selected" if n else "Sign selected")

    def _select_all(self) -> None:
        self.table.blockSignals(True)
        for r in range(self.table.rowCount()):
            self.table.item(r, 0).setCheckState(Qt.CheckState.Checked)
        self.table.blockSignals(False)
        self._changed()

    def _sign(self) -> None:
        jobs = self.selected()
        if not jobs:
            return
        if self.window.update_required:
            self.window.banner.setText("This version is too old to sign. Install the update first.")
            return
        self.window.timer.stop()
        dlg = SignDialog(self.c, jobs, self)
        dlg.exec()
        self.window.timer.start()
        self.window.poll()
        self.window.history.reload()


class HistoryPage(QWidget):
    def __init__(self, c: Controller) -> None:
        super().__init__()
        self.c = c
        self.list = QListWidget()
        self.list.setObjectName("history")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(28, 24, 28, 24)
        lay.addWidget(label("History", title=True))
        lay.addWidget(label("What this computer signed or could not sign. Kept only here; it holds no PINs and no documents.", muted=True))
        lay.addWidget(self.list, 1)
        self.reload()

    def reload(self) -> None:
        self.list.clear()
        for e in self.c.history.recent():
            when = datetime.fromtimestamp(e.at, tz=timezone.utc).astimezone().strftime("%d %b %Y, %H:%M")
            tag = {"done": "Signed", "failed": "Failed", "skipped": "Skipped"}.get(e.status, e.status)
            self.list.addItem(f"{when}    {e.reference}    {tag}" + (f"  ({e.detail})" if e.detail and e.status != "done" else ("  (TEST)" if e.test else "")))
        if self.list.count() == 0:
            self.list.addItem("Nothing yet.")


class SettingsPage(QWidget):
    def __init__(self, c: Controller, window: "MainWindow") -> None:
        super().__init__()
        self.c, self.window = c, window
        s = c.settings
        self.lib = QLineEdit(s.library)
        self.lib.setPlaceholderText("Automatic (looks for the token driver)")
        self.lib.setObjectName("library")
        detect = QPushButton("Find drivers")
        detect.clicked.connect(self._detect)
        browse = QPushButton("Browse…")
        browse.clicked.connect(self._browse)
        self.found = label("", muted=True)
        self.poll = QSpinBox()
        self.poll.setRange(10, 600)
        self.poll.setValue(s.poll_seconds)
        self.poll.setSuffix(" seconds")
        self.motion = QCheckBox("Reduce animation (otherwise follows the system setting)")
        self.motion.setChecked(bool(s.reduce_motion))
        self.light = QCheckBox("Light theme")
        self.light.setChecked(s.theme == "light")
        save = QPushButton("Save settings")
        save.setProperty("primary", True)
        save.clicked.connect(self._save)
        unpair = QPushButton("Forget this pairing")
        unpair.clicked.connect(self._unpair)
        row = QHBoxLayout()
        row.addWidget(self.lib, 1)
        row.addWidget(detect)
        row.addWidget(browse)
        rw = QWidget()
        rw.setLayout(row)
        row.setContentsMargins(0, 0, 0, 0)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(28, 24, 28, 24)
        lay.addWidget(label("Settings", title=True))
        lay.addWidget(card(label("Token driver", muted=True), rw, self.found, label("Check how often to look for letters", muted=True), self.poll, self.motion, self.light, save))
        lay.addWidget(card(label(f"Paired with {s.company or 'a company'}. To remove this computer completely, also unpair it in the web app (Signing, then Devices).", muted=True), unpair))
        lay.addWidget(label(f"Flourishive Desktop {__version__}", muted=True))
        lay.addStretch(1)

    def _detect(self) -> None:
        libs = find_libraries()
        self.found.setText("Found: " + ", ".join(p.name for p in libs[:5]) if libs else "No token driver found. Install the driver that came with the token.")
        if libs and not self.lib.text():
            self.lib.setText(str(libs[0]))

    def _browse(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Choose the token driver (PKCS#11 library)")
        if path:
            self.lib.setText(path)

    def _save(self) -> None:
        s = self.c.settings
        s.library = self.lib.text().strip()
        s.poll_seconds = self.poll.value()
        s.reduce_motion = True if self.motion.isChecked() else None
        s.theme = "light" if self.light.isChecked() else "dark"
        self.c.save()
        self.window.apply_settings()

    def _unpair(self) -> None:
        self.c.forget_pairing()
        self.window.refresh_state()


class MainWindow(QWidget):
    def __init__(self, controller: Controller) -> None:
        super().__init__()
        self.c = controller
        self.setWindowTitle("Flourishive Desktop")
        self.resize(900, 640)
        self.pair_page = PairPage(controller, self._paired)
        self.queue = QueuePage(controller, self)
        self.history = HistoryPage(controller)
        self.settings_page = SettingsPage(controller, self)
        self.tabs = QStackedWidget()
        for p in (self.queue, self.history, self.settings_page):
            self.tabs.addWidget(p)
        self.nav = []
        bar = QHBoxLayout()
        bar.setContentsMargins(20, 12, 20, 0)
        self.company = label("", muted=True, wrap=False)
        bar.addWidget(label("Flourishive", title=True, wrap=False))
        bar.addWidget(self.company)
        bar.addStretch(1)
        for i, name in enumerate(("To sign", "History", "Settings")):
            b = QPushButton(name)
            b.setProperty("flat", True)
            b.clicked.connect(lambda _=False, i=i: self.tabs.setCurrentIndex(i))
            bar.addWidget(b)
            self.nav.append(b)
        self.bar = QWidget()
        self.bar.setLayout(bar)
        self.banner = label("")
        self.banner.setProperty("danger", True)
        self.banner.setContentsMargins(28, 0, 28, 0)
        self.update_required = False
        self._update: updater.UpdateInfo | None = None
        self.update_bar = QWidget()
        ub = QHBoxLayout(self.update_bar)
        ub.setContentsMargins(28, 4, 28, 4)
        self.update_label = label("", wrap=False)
        self.update_button = QPushButton("Install and restart")
        self.update_button.clicked.connect(self.install_update)
        ub.addWidget(self.update_label, 1)
        ub.addWidget(self.update_button)
        self.update_bar.hide()
        self.root = QStackedWidget()
        shell = QWidget()
        sl = QVBoxLayout(shell)
        sl.setContentsMargins(0, 0, 0, 0)
        sl.addWidget(self.bar)
        sl.addWidget(self.banner)
        sl.addWidget(self.update_bar)
        sl.addWidget(self.tabs, 1)
        self.root.addWidget(shell)
        self.root.addWidget(self.pair_page)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(self.root)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.poll)
        self._polling = False
        # look for a newer version now and every six hours
        self.update_timer = QTimer(self)
        self.update_timer.setInterval(6 * 3600 * 1000)
        self.update_timer.timeout.connect(self.check_updates)
        self.refresh_state()

    # -- state ---------------------------------------------------------------
    def apply_settings(self) -> None:
        from .theme import stylesheet  # noqa: PLC0415

        self.setStyleSheet(stylesheet(self.c.settings.theme))
        self.timer.setInterval(self.c.settings.poll_seconds * 1000)

    def refresh_state(self) -> None:
        self.apply_settings()
        if self.c.paired:
            self.root.setCurrentIndex(0)
            self.company.setText(f"  {self.c.settings.company}")
            self.timer.start()
            self.poll()
            self.update_timer.start()
            self.check_updates()
        else:
            self.timer.stop()
            self.root.setCurrentIndex(1)

    # -- updates -------------------------------------------------------------
    def check_updates(self) -> None:
        if not self.c.paired:
            return
        task = Call(lambda: self.c.api().update(updater.platform_key(), __version__))
        task.signals.done.connect(self._update_answer)
        task.signals.failed.connect(lambda _e: None)  # an update check must never get in the way of signing
        QThreadPool.globalInstance().start(task)

    def _update_answer(self, body: dict) -> None:
        telemetry.start(body.get("sentryDsn"))  # crash reports only if the company's server asked for them
        info = updater.parse(body)
        self._update = info
        self.update_required = bool(info and info.mandatory)
        if not info:
            self.update_bar.hide()
            return
        self.update_label.setText(
            f"Version {info.latest} is available" + (" and is required to keep signing." if info.mandatory else ".")
        )
        self.update_button.setEnabled(True)
        self.update_button.setText("Install and restart")
        self.update_bar.show()

    def install_update(self) -> None:
        info = self._update
        if not info:
            return
        self.update_button.setEnabled(False)
        self.update_button.setText("Downloading…")
        dest = Path(__import__("tempfile").gettempdir()) / f"FlourishiveDesktop-{info.latest}.zip"
        cred = self.c.credentials.get(self.c.settings.device_id)
        task = Call(lambda: updater.download(info, dest, server=self.c.settings.server, credential=cred))
        task.signals.done.connect(self._downloaded)
        task.signals.failed.connect(self._update_failed)
        QThreadPool.globalInstance().start(task)

    def _downloaded(self, path: Path) -> None:
        try:
            updater.install_and_restart(path)
        except DesktopError as exc:
            self._update_failed(exc)
            return
        QApplication.quit()

    def _update_failed(self, exc: Exception) -> None:
        self.update_button.setEnabled(True)
        self.update_button.setText("Try again")
        self.banner.setText(str(exc) if isinstance(exc, DesktopError) else "The update could not be installed.")

    def _paired(self, company: str) -> None:
        self.refresh_state()

    def handle_link(self, url: str) -> bool:
        """A flourishive:// link fills in the pairing form. Nothing happens until the person confirms."""
        link = parse_link(url)
        if not link:
            return False
        self.root.setCurrentIndex(1)
        self.pair_page.fill(link)
        self.show()
        self.raise_()
        self.activateWindow()
        return True

    # -- polling -------------------------------------------------------------
    def poll(self) -> None:
        if self._polling or not self.c.paired:
            return
        self._polling = True
        task = Call(lambda: self.c.api().jobs())
        task.signals.done.connect(self._polled)
        task.signals.failed.connect(self._poll_failed)
        QThreadPool.globalInstance().start(task)

    def _polled(self, jobs: list[Job]) -> None:
        self._polling = False
        self.banner.setText("")
        self.queue.show_jobs(jobs)

    def _poll_failed(self, exc: Exception) -> None:
        self._polling = False
        if isinstance(exc, Unpaired):
            self.c.forget_pairing()
            self.refresh_state()
            self.pair_page.error.setText(str(exc))
        elif isinstance(exc, Offline):
            self.banner.setText("No connection. Will try again shortly.")
        else:
            self.banner.setText(str(exc) if isinstance(exc, DesktopError) else "Could not check for letters.")
