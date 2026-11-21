"""The pen stroke that settles into a checkmark, drawn natively (D-49).

It follows the real signing state it is given, never a timer. With reduced motion it jumps to
the final frame and the caption carries the state.
"""

from __future__ import annotations

import re
import sys

from PySide6.QtCore import QEasingCurve, QPointF, QRectF, Qt, QVariantAnimation
from PySide6.QtGui import QColor, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import QWidget

from .. import design

IDLE, SIGNING, WAITING, DONE, FAILED = "idle", "signing", "waiting", "done", "failed"
LABEL = {IDLE: "Ready to sign", SIGNING: "Signing", WAITING: "Waiting for the token", DONE: "Signed", FAILED: "Signing failed"}


def path_from_svg(d: str) -> QPainterPath:
    """Absolute M, L, C and S commands (the only ones the design uses)."""
    tokens = re.findall(r"[MLCS]|-?\d+(?:\.\d+)?", d)
    path = QPainterPath()
    i, cmd = 0, ""
    last_c2: QPointF | None = None
    cur = QPointF(0, 0)

    def num() -> float:
        nonlocal i
        v = float(tokens[i])
        i += 1
        return v

    while i < len(tokens):
        if tokens[i] in "MLCS":
            cmd = tokens[i]
            i += 1
        if cmd == "M":
            cur = QPointF(num(), num())
            path.moveTo(cur)
            cmd = "L"
            last_c2 = None
        elif cmd == "L":
            cur = QPointF(num(), num())
            path.lineTo(cur)
            last_c2 = None
        elif cmd == "C":
            c1, c2, end = QPointF(num(), num()), QPointF(num(), num()), QPointF(num(), num())
            path.cubicTo(c1, c2, end)
            cur, last_c2 = end, c2
        elif cmd == "S":
            # the first control point is the reflection of the previous one
            c1 = QPointF(2 * cur.x() - last_c2.x(), 2 * cur.y() - last_c2.y()) if last_c2 else cur
            c2, end = QPointF(num(), num()), QPointF(num(), num())
            path.cubicTo(c1, c2, end)
            cur, last_c2 = end, c2
    return path


def system_reduces_motion() -> bool:
    """The operating system's reduce-motion setting, where it can be read."""
    try:
        if sys.platform == "win32":
            import ctypes  # noqa: PLC0415

            on = ctypes.c_int(1)
            SPI_GETCLIENTAREAANIMATION = 0x1042
            ctypes.windll.user32.SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, ctypes.byref(on), 0)
            return not on.value
        if sys.platform == "darwin":
            import subprocess  # noqa: PLC0415

            out = subprocess.run(["defaults", "read", "com.apple.universalaccess", "reduceMotion"], capture_output=True, text=True, timeout=2)
            return out.stdout.strip() == "1"
    except Exception:  # noqa: BLE001
        pass
    return False


class SigningAnimation(QWidget):
    def __init__(self, size: int = 96, palette: dict[str, str] | None = None, reduce_motion: bool | None = None, parent=None) -> None:
        super().__init__(parent)
        self._size = size
        self.setFixedSize(size, size)
        self._pal = palette or design.DARK
        self._reduce = system_reduces_motion() if reduce_motion is None else reduce_motion
        self._state = IDLE
        self._given_progress: float | None = None
        self._pen = 0.0  # how much of the pen stroke is drawn, 0..1
        self._check = 0.0  # how much of the checkmark is drawn, 0..1
        self._pulse = 1.0
        self._pen_path = path_from_svg(design.PEN_STROKE)
        self._check_path = path_from_svg(design.CHECK)
        self._cross_path = path_from_svg(design.CROSS)
        self._anim = QVariantAnimation(self)
        self._anim.setDuration(450)
        self._anim.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim.valueChanged.connect(self._tick)
        self._pulse_anim = QVariantAnimation(self)
        self._pulse_anim.setStartValue(0.45)
        self._pulse_anim.setEndValue(1.0)
        self._pulse_anim.setDuration(900)
        self._pulse_anim.setLoopCount(-1)
        self._pulse_anim.setEasingCurve(QEasingCurve.Type.InOutSine)
        self._pulse_anim.valueChanged.connect(self._set_pulse)
        self._from = (0.0, 0.0)
        self._to = (0.0, 0.0)
        self.setAccessibleName(LABEL[IDLE])

    # -- state ---------------------------------------------------------------
    @property
    def state(self) -> str:
        return self._state

    def set_reduce_motion(self, on: bool) -> None:
        self._reduce = on

    def set_palette(self, palette: dict[str, str]) -> None:
        self._pal = palette
        self.update()

    def target(self, state: str, progress: float | None) -> tuple[float, float]:
        """How much of the pen stroke and the checkmark each state shows (as in the web component)."""
        if state == DONE:
            return 0.0, 1.0  # the pen line gives way to the check
        pen = {IDLE: 0.0, WAITING: 0.35, FAILED: 0.5}.get(state, 0.65 if progress is None else max(0.0, min(1.0, progress)))
        return pen, 0.0

    def set_state(self, state: str, progress: float | None = None) -> None:
        if state == self._state and progress == self._given_progress:
            return
        self._state, self._given_progress = state, progress
        self.setAccessibleName(LABEL[state])
        self.setToolTip(LABEL[state])
        self._from = (self._pen, self._check)
        self._to = self.target(state, progress)
        if state == WAITING and not self._reduce:
            self._pulse_anim.start()
        else:
            self._pulse_anim.stop()
            self._pulse = 1.0
        if self._reduce:
            self._anim.stop()
            self._pen, self._check = self._to
            self.update()
        else:
            self._anim.stop()
            self._anim.setStartValue(0.0)
            self._anim.setEndValue(1.0)
            self._anim.start()

    def _tick(self, t) -> None:
        t = float(t)
        self._pen = self._from[0] + (self._to[0] - self._from[0]) * t
        self._check = self._from[1] + (self._to[1] - self._from[1]) * t
        self.update()

    def _set_pulse(self, v) -> None:
        self._pulse = float(v)
        self.update()

    def drawn(self) -> tuple[float, float]:
        return self._pen, self._check

    # -- painting ------------------------------------------------------------
    def _stroke(self, p: QPainter, path: QPainterPath, fraction: float, color: QColor, width: float) -> None:
        if fraction <= 0:
            return
        pen = QPen(color, width, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin)
        length = path.length()
        if fraction < 1:
            pen.setDashPattern([max(fraction * length, 0.01) / width, (length * 2) / width])
        p.setPen(pen)
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawPath(path)

    def paintEvent(self, _event) -> None:  # noqa: N802
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.scale(self._size / design.VIEWBOX, self._size / design.VIEWBOX)
        state = self._state
        color = QColor(self._pal["danger" if state == FAILED else "success" if state == DONE else "accent"])
        cx, cy, r = design.RING
        ring = QRectF(cx - r, cy - r, 2 * r, 2 * r)
        if state == DONE:
            fill = QColor(color)
            fill.setAlphaF(0.12)
            p.setBrush(fill)
            p.setPen(QPen(color, 2))
        else:
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.setPen(QPen(QColor(self._pal["border_strong"]), 2))
        p.drawEllipse(ring)
        pen_color = QColor(color)
        pen_color.setAlphaF(self._pulse if state == WAITING else max(0.0, 1.0 - self._check))
        self._stroke(p, self._pen_path, self._pen, pen_color, 3)
        self._stroke(p, self._check_path, self._check, color, 5)
        if state == FAILED:
            self._stroke(p, self._cross_path, 1.0, color, 4)
        p.end()
