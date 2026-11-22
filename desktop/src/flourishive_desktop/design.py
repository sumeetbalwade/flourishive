"""Colours and the signing-animation shapes, kept in step with the web app.

The shapes are the ones in packages/ui/src/components/signing-animation.tsx (a 96 x 96 drawing:
a ring, a pen stroke, the checkmark it settles into, and a cross for failure). A test reads that
file and fails if these drift (D-49).
"""

from __future__ import annotations

VIEWBOX = 96.0

# From packages/design-tokens/src/tokens.css (dark theme is the default; light is warm paper).
DARK = {
    "bg": "#0b0a09",
    "surface": "#14120f",
    "surface2": "#1b1814",
    "raised": "#231f1a",
    "border": "#2c2620",
    "border_strong": "#3b332b",
    "text": "#efe8de",
    "muted": "#9d9288",
    "faint": "#6e655c",
    "accent": "#c4914f",
    "accent_hi": "#e3b47c",
    "on_accent": "#1a1308",
    "success": "#7cc79a",
    "danger": "#e07a6b",
    "warning": "#d8b25a",
}
LIGHT = {
    "bg": "#f6f2ea",
    "surface": "#fffdf9",
    "surface2": "#f1ebe0",
    "raised": "#ffffff",
    "border": "#e4dccd",
    "border_strong": "#cfc4b0",
    "text": "#2a241e",
    "muted": "#6f6457",
    "faint": "#9a8f81",
    "accent": "#a8742f",
    "accent_hi": "#8a5c20",
    "on_accent": "#fffdf9",
    "success": "#2f7d52",
    "danger": "#b8493a",
    "warning": "#8f6d1c",
}

# Shapes (SVG path data, 96 x 96).
RING = (48.0, 48.0, 44.0)  # cx, cy, r
PEN_STROKE = "M20 58 C 26 34, 34 34, 36 52 S 44 70, 50 50 S 60 36, 64 52 S 72 62, 78 46"
CHECK = "M30 50 L43 63 L68 36"
CROSS = "M62 62 L74 74 M74 62 L62 74"
