from __future__ import annotations


class DesktopError(Exception):
    """Something went wrong that the person can be told about in plain words."""


class Offline(DesktopError):
    """The server could not be reached."""


class Unpaired(DesktopError):
    """This computer's pairing was removed, or never existed."""


class ServerRefused(DesktopError):
    def __init__(self, status: int, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class Rejected(ServerRefused):
    """The signed file failed the server's checks (the signature will not be accepted as it is)."""


class Held(ServerRefused):
    """The server could not finish checking (for example the revocation server is down); try again."""

    def __init__(self, status: int, message: str, code: str | None, retry_after: int) -> None:
        super().__init__(status, message, code)
        self.retry_after = retry_after


class SigningFailed(DesktopError):
    """The token or the file could not be signed (wrong PIN, token removed, ...)."""
