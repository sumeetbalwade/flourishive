"""The desktop animation shapes must match the web component (D-49)."""

import re
from pathlib import Path

from flourishive_desktop import design

TSX = Path(__file__).resolve().parents[2] / "packages/ui/src/components/signing-animation.tsx"


def _web_paths() -> list[str]:
    return re.findall(r'\bd="([^"]+)"', TSX.read_text("utf-8"))


def test_the_pen_stroke_check_and_cross_match_the_web_component():
    paths = _web_paths()
    assert design.PEN_STROKE in paths
    assert design.CHECK in paths
    assert design.CROSS in paths


def test_the_ring_matches():
    cx, cy, r = design.RING
    assert f'cx="{cx:g}"' in TSX.read_text("utf-8") and f'cy="{cy:g}"' in TSX.read_text("utf-8") and f'r="{r:g}"' in TSX.read_text("utf-8")


def test_the_colours_are_the_design_tokens():
    css = (TSX.parents[3] / "design-tokens/src/tokens.css").read_text("utf-8").lower()
    for key in ("accent", "success", "danger", "bg", "text"):
        assert design.DARK[key].lower() in css, key
