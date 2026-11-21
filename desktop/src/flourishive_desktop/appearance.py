"""The visible signature stamp: a green-tick emblem and who signed, when (D-50).

The tick is the same shape as the one in the signing animation. A PDF is static, so the stamp
always shows the tick; whether the signature is still intact is shown by the PDF viewer's own
overlay and by the verify page, which turn red when something was changed.
"""

from __future__ import annotations

import re

from pyhanko.pdf_utils import content
from pyhanko.pdf_utils.font.basic import SimpleFontEngineFactory
from pyhanko.pdf_utils.layout import AxisAlignment, BoxConstraints, InnerScaling, Margins, SimpleBoxLayoutRule
from pyhanko.pdf_utils.text import TextBoxStyle
from pyhanko.stamp import TextStampStyle

from . import design

EMBLEM = 40.0  # points
GREEN = (0.184, 0.490, 0.322)  # a printable green; the light theme's success colour
GREEN_TINT = (0.88, 0.95, 0.91)
INK = (0.16, 0.14, 0.12)


def _numbers(path: str) -> list[float]:
    return [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", path)]


def emblem_operators() -> bytes:
    """PDF drawing operators for the ring and the tick, scaled from the 96-unit design to EMBLEM points."""
    s = EMBLEM / design.VIEWBOX
    cx, cy, r = (v * s for v in design.RING)
    # a circle from four Bezier curves
    k = 0.5522847498 * r
    ring = (
        f"{cx + r:.3f} {cy:.3f} m "
        f"{cx + r:.3f} {cy + k:.3f} {cx + k:.3f} {cy + r:.3f} {cx:.3f} {cy + r:.3f} c "
        f"{cx - k:.3f} {cy + r:.3f} {cx - r:.3f} {cy + k:.3f} {cx - r:.3f} {cy:.3f} c "
        f"{cx - r:.3f} {cy - k:.3f} {cx - k:.3f} {cy - r:.3f} {cx:.3f} {cy - r:.3f} c "
        f"{cx + k:.3f} {cy - r:.3f} {cx + r:.3f} {cy - k:.3f} {cx + r:.3f} {cy:.3f} c h"
    )
    pts = _numbers(design.CHECK)  # M x y L x y L x y
    xy = [(pts[i] * s, (design.VIEWBOX - pts[i + 1]) * s) for i in range(0, 6, 2)]  # PDF y points up
    tick = f"{xy[0][0]:.3f} {xy[0][1]:.3f} m {xy[1][0]:.3f} {xy[1][1]:.3f} l {xy[2][0]:.3f} {xy[2][1]:.3f} l"
    g, t = GREEN, GREEN_TINT
    return (
        f"q {t[0]} {t[1]} {t[2]} rg {g[0]} {g[1]} {g[2]} RG {2 * s:.3f} w {ring} B Q\n"
        f"q {g[0]} {g[1]} {g[2]} RG {5 * s:.3f} w 1 J 1 j {tick} S Q\n"
    ).encode("ascii")


def emblem() -> content.RawContent:
    return content.RawContent(emblem_operators(), box=BoxConstraints(width=EMBLEM, height=EMBLEM))


def stamp_style() -> TextStampStyle:
    """Tick on the left, then the signer and the time, inside a thin green border."""
    return TextStampStyle(
        stamp_text="Digitally signed\n%(signer)s\n%(ts)s",
        timestamp_format="%d %b %Y, %H:%M %Z",
        border_width=1,
        border_color=GREEN,
        background=emblem(),
        background_opacity=1.0,
        background_layout=SimpleBoxLayoutRule(
            x_align=AxisAlignment.ALIGN_MIN,
            y_align=AxisAlignment.ALIGN_MID,
            margins=Margins(left=6, right=0, top=0, bottom=0),
            inner_content_scaling=InnerScaling.NO_SCALING,
        ),
        inner_content_layout=SimpleBoxLayoutRule(
            x_align=AxisAlignment.ALIGN_MIN,
            y_align=AxisAlignment.ALIGN_MID,
            margins=Margins(left=50, right=6, top=4, bottom=4),
            inner_content_scaling=InnerScaling.SHRINK_TO_FIT,
        ),
        text_box_style=TextBoxStyle(
            font=SimpleFontEngineFactory("Helvetica", 0.52),
            font_size=8,
            leading=10,
            text_color=INK,
        ),
    )
