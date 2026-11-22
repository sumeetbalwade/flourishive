"""Colours and the signing-animation shapes, kept in step with the web app.

The shapes are the ones in packages/ui/src/components/signing-animation.tsx (a 96 x 96 drawing:
a ring, a pen stroke, the checkmark it settles into, and a cross for failure). A test reads that
file and fails if these drift (D-49).
"""

from __future__ import annotations

VIEWBOX = 96.0

# From packages/design-tokens/src/tokens.css (light is the default; dark is a deep green-black).
DARK = {
    "bg": "#0b1210",
    "surface": "#121b18",
    "surface2": "#19251f",
    "raised": "#1f2d27",
    "border": "#243630",
    "border_strong": "#324840",
    "text": "#e9f2ee",
    "muted": "#9bb0a7",
    "faint": "#697e75",
    "accent": "#6fcf8a",
    "accent_hi": "#9ae3b0",
    "on_accent": "#07210f",
    "success": "#7fd29e",
    "danger": "#ee8878",
    "warning": "#e0b95e",
}
LIGHT = {
    "bg": "#eef3f1",
    "surface": "#ffffff",
    "surface2": "#f2f6f5",
    "raised": "#ffffff",
    "border": "#e1e9e6",
    "border_strong": "#cbd8d4",
    "text": "#11201b",
    "muted": "#55675f",
    "faint": "#839690",
    "accent": "#2a9158",
    "accent_hi": "#1d7444",
    "on_accent": "#ffffff",
    "success": "#217a4a",
    "danger": "#bd4338",
    "warning": "#96700f",
}

# Shapes (SVG path data, 96 x 96).
RING = (48.0, 48.0, 44.0)  # cx, cy, r
PEN_STROKE = "M20 58 C 26 34, 34 34, 36 52 S 44 70, 50 50 S 60 36, 64 52 S 72 62, 78 46"
CHECK = "M30 50 L43 63 L68 36"
CROSS = "M62 62 L74 74 M74 62 L62 74"
