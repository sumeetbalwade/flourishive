"""What the screens share: settings, the credential, the server connection and the history."""

from __future__ import annotations

import platform
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .api import Api
from .errors import SigningFailed
from .store import Credentials, History, KeyringCredentials, Settings, SettingsStore
from .tokens import find_libraries, list_tokens


@dataclass(frozen=True)
class TokenChoice:
    library: str
    label: str


class Controller:
    def __init__(
        self,
        settings_store: SettingsStore | None = None,
        credentials: Credentials | None = None,
        history: History | None = None,
        api_factory: Callable[[str, str | None], Api] | None = None,
    ) -> None:
        self.store = settings_store or SettingsStore()
        self.credentials = credentials or KeyringCredentials()
        self.history = history or History()
        self._api_factory = api_factory or (lambda server, cred: Api(server, cred))
        self.settings: Settings = self.store.load()

    # -- connection ----------------------------------------------------------
    @property
    def paired(self) -> bool:
        return self.settings.paired and bool(self.credentials.get(self.settings.device_id))

    def api(self) -> Api:
        cred = self.credentials.get(self.settings.device_id) if self.settings.device_id else None
        return self._api_factory(self.settings.server, cred)

    def pair(self, server: str, code: str) -> str:
        api = self._api_factory(server.strip(), None)
        name = f"{socket.gethostname()} ({platform.system()})"
        result = api.pair(code.strip(), name[:100], platform.system().lower())
        self.credentials.set(result.device_id, result.credential)
        self.settings.server, self.settings.device_id, self.settings.company = server.strip().rstrip("/"), result.device_id, result.company
        self.store.save(self.settings)
        return result.company

    def forget_pairing(self) -> None:
        if self.settings.device_id:
            self.credentials.delete(self.settings.device_id)
        self.settings.device_id = ""
        self.settings.company = ""
        self.store.save(self.settings)

    def save(self) -> None:
        self.store.save(self.settings)

    # -- the token -----------------------------------------------------------
    def locate_token(self) -> TokenChoice:
        """The driver from Settings if set, otherwise the first driver that sees a token."""
        libs = [Path(self.settings.library)] if self.settings.library else find_libraries()
        if not libs:
            raise SigningFailed("No token driver was found. Install the driver that came with the token, or set its path in Settings.")
        last: SigningFailed | None = None
        for lib in libs:
            try:
                tokens = list_tokens(lib)
            except SigningFailed as exc:
                last = exc
                continue
            if self.settings.token_label:
                tokens = [t for t in tokens if t.label == self.settings.token_label]
            if tokens:
                return TokenChoice(str(lib), tokens[0].label)
        raise last or SigningFailed("The token is not plugged in. Plug it in and try again.")
