from __future__ import annotations

from .. import design


def stylesheet(name: str = "dark") -> str:
    c = design.LIGHT if name == "light" else design.DARK
    return f"""
* {{ font-family: "Hanken Grotesk", "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 13px; }}
QWidget {{ background: {c['bg']}; color: {c['text']}; }}
QLabel[muted="true"] {{ color: {c['muted']}; }}
QLabel[title="true"] {{ font-family: "Instrument Serif", Georgia, serif; font-size: 26px; }}
QLabel[danger="true"] {{ color: {c['danger']}; }}
QLabel[success="true"] {{ color: {c['success']}; }}
QFrame[card="true"] {{ background: {c['surface']}; border: 1px solid {c['border']}; border-radius: 14px; }}
QFrame[card="true"] QLabel {{ background: transparent; }}
QLineEdit, QSpinBox, QComboBox {{ background: {c['surface2']}; border: 1px solid {c['border_strong']}; border-radius: 10px; padding: 8px 12px; selection-background-color: {c['accent']}; }}
QLineEdit:focus {{ border-color: {c['accent']}; }}
QPushButton {{ background: {c['surface2']}; border: 1px solid {c['border_strong']}; border-radius: 10px; padding: 8px 16px; }}
QPushButton:hover {{ border-color: {c['accent']}; }}
QPushButton:disabled {{ color: {c['faint']}; }}
QPushButton[primary="true"] {{ background: {c['accent']}; color: {c['on_accent']}; border: none; font-weight: 600; }}
QPushButton[primary="true"]:disabled {{ background: {c['border_strong']}; color: {c['faint']}; }}
QPushButton[flat="true"] {{ border: none; background: transparent; color: {c['muted']}; }}
QTableWidget {{ background: {c['surface']}; border: 1px solid {c['border']}; border-radius: 12px; gridline-color: transparent; }}
QTableWidget::item {{ padding: 6px; border-bottom: 1px solid {c['border']}; }}
QHeaderView::section {{ background: {c['surface']}; color: {c['muted']}; border: none; padding: 6px; }}
QCheckBox::indicator {{ width: 16px; height: 16px; }}
QProgressBar {{ background: {c['surface2']}; border: none; border-radius: 4px; height: 8px; text-align: center; }}
QProgressBar::chunk {{ background: {c['accent']}; border-radius: 4px; }}
QListWidget {{ background: {c['surface']}; border: 1px solid {c['border']}; border-radius: 12px; }}
QListWidget::item {{ padding: 8px; border-bottom: 1px solid {c['border']}; }}
"""
