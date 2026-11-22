"""Crash reports to Sentry, only when the company's server hands us an address, and with nothing personal.

We never send letters, names, email addresses, PINs, certificate details or the local file paths. A report
carries the error, a trimmed stack and the app version.
"""

from __future__ import annotations

import re
from typing import Any

from . import __version__

_started = False
_PATH = re.compile(r"(?:[A-Za-z]:\\\\Users\\\\|/Users/|/home/)[^\\\\/\s'\"]+")


def scrub_text(text: str) -> str:
    """Hides the person's account name inside file paths."""
    return _PATH.sub(lambda m: m.group(0).split("Users")[0] + "Users/…" if "Users" in m.group(0) else "/home/…", text)


def scrub_event(event: dict[str, Any], _hint: Any = None) -> dict[str, Any] | None:
    """Removes everything that could identify a person or a document before an event leaves the computer."""
    for key in ("user", "request", "server_name", "contexts", "breadcrumbs", "extra", "modules"):
        event.pop(key, None)
    for ex in (event.get("exception") or {}).get("values", []):
        ex["value"] = scrub_text(str(ex.get("value", "")))[:300]
        for fr in (ex.get("stacktrace") or {}).get("frames", []):
            fr.pop("vars", None)
            fr.pop("pre_context", None)
            fr.pop("post_context", None)
            fr.pop("context_line", None)
            if "abs_path" in fr:
                fr["abs_path"] = scrub_text(str(fr["abs_path"]))
    if "message" in event:
        event["message"] = scrub_text(str(event["message"]))[:300]
    return event


def start(dsn: str | None) -> bool:
    """Turns reporting on once, if there is an address. Returns whether it is on."""
    global _started  # noqa: PLW0603
    if _started or not dsn:
        return _started
    import sentry_sdk  # noqa: PLC0415

    sentry_sdk.init(
        dsn=dsn,
        release=f"flourishive-desktop@{__version__}",
        send_default_pii=False,
        include_local_variables=False,
        max_breadcrumbs=0,
        traces_sample_rate=0.0,
        before_send=scrub_event,
        default_integrations=False,
    )
    _started = True
    return True
