import stat
import sys

from flourishive_desktop.link import PairLink, parse_link
from flourishive_desktop.store import History, KeyringCredentials, MemoryCredentials, Settings, SettingsStore


def test_a_good_link_fills_in_the_form():
    assert parse_link("flourishive://pair?code=abcd-efgh&server=https%3A%2F%2Fapi.flourishive.in") == PairLink("ABCD-EFGH", "https://api.flourishive.in")
    assert parse_link("flourishive://pair?code=ABCDEFGH&server=http://localhost:3000") == PairLink("ABCD-EFGH", "http://localhost:3000")


def test_anything_odd_is_ignored():
    for bad in (
        "https://pair?code=ABCD-EFGH&server=https://a.test",  # not our scheme
        "flourishive://sign?code=ABCD-EFGH&server=https://a.test",  # not the pair action
        "flourishive://pair?code=ABCD-EFGH&server=http://evil.test",  # plain http to a real host
        "flourishive://pair?code=ABCD-EFGH",  # no server
        "flourishive://pair?code=0000-1111&server=https://a.test",  # characters never used in codes
        "flourishive://pair?code=ABCD-EFGH&server=javascript:alert(1)",
        "not a url",
    ):
        assert parse_link(bad) is None, bad


def test_settings_survive_a_restart_and_ignore_unknown_keys(tmp_path):
    store = SettingsStore(tmp_path / "s.json")
    assert not store.load().paired
    store.save(Settings(server="https://a.test", device_id="d1", company="Flourisense", cert_id="01"))
    # a file written by a newer version with an option this one does not know is still readable
    raw = (tmp_path / "s.json").read_text()
    (tmp_path / "s.json").write_text(raw.rstrip().rstrip("}") + ', "future_option": 1}')
    s = store.load()
    assert s.paired and s.company == "Flourisense" and s.cert_id == "01"


def test_history_is_newest_first_and_holds_no_secrets(tmp_path):
    h = History(tmp_path / "h.jsonl")
    h.add("FS/INT/2026/0012", "done")
    h.add("FS/INT/2026/0013", "failed", "The token is not plugged in.")
    h.add("FS/INT/2026/0014", "done", "Signed (TEST)", test=True)
    got = h.recent()
    assert [e.reference for e in got] == ["FS/INT/2026/0014", "FS/INT/2026/0013", "FS/INT/2026/0012"]
    assert got[0].test and got[1].detail.startswith("The token")


def test_credentials_in_memory_and_in_the_fallback_file(tmp_path, monkeypatch):
    m = MemoryCredentials()
    m.set("d1", "secret")
    assert m.get("d1") == "secret"
    m.delete("d1")
    assert m.get("d1") is None
    # no operating-system store: a file only the owner can read
    k = KeyringCredentials(tmp_path / "device.key")
    monkeypatch.setattr(k, "_keyring", lambda: None)
    k.set("d1", "secret")
    assert k.get("d1") == "secret"
    if sys.platform != "win32":
        assert (tmp_path / "device.key").stat().st_mode & 0o777 == stat.S_IRUSR | stat.S_IWUSR
    k.delete("d1")
    assert k.get("d1") is None
