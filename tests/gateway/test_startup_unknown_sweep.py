"""Startup unknown-admission sweep: settled AND continued for every source.

A gateway restart cuts whatever turn was in flight, leaving its admission ``unknown``.
That row pauses the session's FIFO until someone resolves it, which the desktop shows as
the red 「重启期间该轮次已丢失」 card with a Discard button.

Regression for a Telegram lane (2026-10-29): the sweep scanned ``source='local'`` only, so
a Telegram session's ``unknown`` row was neither settled nor continued. Four queued
messages sat behind it forever — 「4 条排队 — 已暂停」 — while the local-only sweep
reported success. A ``hermes update`` restarts the gateway regardless of which lane was
mid-turn, so a platform lane must be swept and woken exactly like a local one.

Reads/writes go through the storage interface (``authority_persistence``): the boot sweep
uses ``admissions.recover`` (started -> unknown), ``admissions.list`` (the session's rows)
and ``sessions.list_gateway_sessions`` (every live routing key, all sources).
"""
import time
from types import SimpleNamespace

import pytest

from gateway import run_startup
from gateway.run_startup import GatewayStartupMixin


class _Runner(GatewayStartupMixin):
    """Minimal host: only the pieces ``_sweep_one_session_admissions`` touches."""

    def __init__(self):
        self.woken: list[str] = []

    def _schedule_recovery_wake_for_key(self, session_key: str) -> None:
        self.woken.append(session_key)


class _Admissions:
    def __init__(self, rows):
        self._rows = rows
        self.recovered: list[int] = []

    def list(self, *, session_id, pending_only=True):
        return self._rows

    def recover(self, *, epoch):
        self.recovered.append(epoch)
        return 0


class _Sessions:
    def __init__(self, entries):
        self._entries = entries

    def list_gateway_sessions(self, *, active_only=True):
        return self._entries


class _Store:
    def __init__(self, rows, entries=()):
        self.admissions = _Admissions(rows)
        self.sessions = _Sessions(entries)


class _Authority:
    profile_id = "default"
    epoch = 116

    def __init__(self):
        self.resolved: list[tuple[str, int]] = []

    def logical_owner(self, session_id: str) -> str:
        return session_id

    async def resolve_unknown_as_owner(self, ref, admission_id, generation) -> None:
        self.resolved.append((admission_id, generation))


def _admissions(status="unknown", outcome=None):
    return [SimpleNamespace(admission_id="adm-1", generation=7, status=status, outcome=outcome)]


def _session(source: str) -> SimpleNamespace:
    return SimpleNamespace(
        session_id=f"20261029_065956_{source}",
        session_key=f"agent:main:{source}:dm:1",
        source=source,
    )


@pytest.fixture
def store_of(monkeypatch):
    """Patch the seam the sweep imports inside the method (the defining module)."""

    def _install(store):
        monkeypatch.setattr("gateway.session_persistence.authority_persistence", lambda authority: store)
        return store

    return _install


@pytest.mark.asyncio
async def test_telegram_unknown_is_settled_and_woken(store_of):
    """A platform lane cut by a restart must free its FIFO AND resume the turn."""
    store_of(_Store(_admissions()))
    runner = _Runner()
    authority = _Authority()
    await runner._sweep_one_session_admissions(authority, _session("telegram"), time.time(), 3600.0)

    assert authority.resolved == [("adm-1", 7)], "telegram unknown must be auto-settled"
    assert runner.woken == ["agent:main:telegram:dm:1"], (
        "an update restarts the gateway mid-turn on every lane — a Telegram chat must "
        "resume by itself instead of waiting for the user to ping again")


@pytest.mark.asyncio
async def test_local_unknown_is_settled_and_woken(store_of):
    """Unchanged for local sessions: settle the cut turn AND continue the conversation."""
    store_of(_Store(_admissions()))
    runner = _Runner()
    authority = _Authority()
    await runner._sweep_one_session_admissions(authority, _session("local"), time.time(), 3600.0)

    assert authority.resolved == [("adm-1", 7)]
    assert runner.woken == ["agent:main:local:dm:1"]


@pytest.mark.asyncio
async def test_stale_telegram_session_settled_without_wake(store_of):
    """Staleness never blocks settling: an old orphan still frees the lane, but no wake."""
    store_of(_Store(_admissions()))
    runner = _Runner()
    authority = _Authority()
    await runner._sweep_one_session_admissions(
        authority, _session("telegram"), time.time() - 86400 * 30, 3600.0)

    assert authority.resolved == [("adm-1", 7)]
    assert runner.woken == []


@pytest.mark.asyncio
async def test_scan_lists_every_live_session(monkeypatch):
    """Contract: the boot sweep's session scan returns platform lanes too."""
    scanned: dict[str, bool] = {}
    store = _Store(_admissions(), entries=[SimpleNamespace(session=_session("telegram"),
                                                         last_active=time.time())])
    monkeypatch.setattr("gateway.session_persistence.authority_persistence", lambda authority: store)
    monkeypatch.setattr("gateway.session_authorities.all_authorities", lambda self: [_Authority()])

    seen: list[str] = []

    async def _record(self, authority, session, last_active, freshness):
        seen.append(session.session_key)

    monkeypatch.setattr(_Runner, "_sweep_one_session_admissions", _record, raising=False)
    await _Runner()._sweep_startup_unknown_admissions()

    assert store.admissions.recovered == [_Authority.epoch], "the started->unknown pass runs first"
    assert seen == ["agent:main:telegram:dm:1"], (
        "a source predicate would re-create the platform dead stop; every live routing key is swept")


# --- one restart, one 「[系统恢复]」 ------------------------------------------------
#
# Two independent boot paths wake a session: the legacy resume-pending sweep
# (``_maybe_recovery_wake``) and the durable-FIFO route (``_recovery_wake_for_session_key``,
# fed by ``restart_recovery_pending.json`` and the startup unknown-sweep). Both admit a
# prompt into the same FIFO, and the second path's ``_is_session_running`` gate is still
# false while the first wake waits its turn — one restart produced two messages on
# 2026-10-29 (16:07 delivered, 16:10 the duplicate after a 156 s turn).


def test_claim_recovery_wake_is_once_per_boot():
    runner = _Runner()
    assert runner._claim_recovery_wake("agent:main:telegram:dm:1") is True
    assert runner._claim_recovery_wake("agent:main:telegram:dm:1") is False
    # Another session is independent.
    assert runner._claim_recovery_wake("agent:main:local:dm:2") is True
    # A wake that never committed must free the claim so a later path can try.
    runner._release_recovery_wake("agent:main:telegram:dm:1")
    assert runner._claim_recovery_wake("agent:main:telegram:dm:1") is True


@pytest.mark.asyncio
async def test_second_wake_path_does_not_double_deliver(monkeypatch):
    """The legacy sweep and the FIFO route must not both speak: one restart, one wake."""
    from types import SimpleNamespace

    delivered: list[str] = []
    key = "agent:main:telegram:dm:1"

    entry = SimpleNamespace(session_key=key, last_resume_marked_at=None,
                            updated_at=time.time())

    class _Runner2(GatewayStartupMixin):
        def __init__(self):
            self.session_store = SimpleNamespace(
                lookup_by_session_key=lambda k: entry)

        def _restored_source(self, e):
            return SimpleNamespace(platform="telegram")

        def _delivery_adapter_for(self, source):
            return object()

        def _is_session_running(self, session_key):
            return False

    async def _admit_internal(adapter, event):
        delivered.append("clean-restart")

    async def _admit_route(*args, **kwargs):
        delivered.append("fifo-route")
        return True

    class _Event:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setattr("gateway.wake.admit_internal_event", _admit_internal,
                        raising=False)
    monkeypatch.setattr("gateway.session_automation.admit_route_wake", _admit_route,
                        raising=False)
    monkeypatch.setattr("gateway.platforms.event.MessageEvent", _Event, raising=False)
    monkeypatch.setattr("gateway.session_authorities.active_authority",
                        lambda runner: object(), raising=False)

    runner = _Runner2()
    await runner._maybe_recovery_wake(entry)
    await runner._recovery_wake_for_session_key(key)

    assert delivered == ["clean-restart"], (
        "the second wake path re-admitted the same 系统恢复 prompt; a single restart must "
        "produce exactly one wake per session")
