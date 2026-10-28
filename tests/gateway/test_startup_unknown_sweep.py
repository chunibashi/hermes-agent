"""Startup unknown-admission sweep: settled AND continued for every source.

A gateway restart cuts whatever turn was in flight, leaving its admission ``unknown``.
That row pauses the session's FIFO until someone resolves it, which the desktop shows as
the red 「重启期间该轮次已丢失」 card with a Discard button.

Regression for a Telegram lane (2026-10-29): the sweep scanned ``source='local'`` only, so
a Telegram session's ``unknown`` row was neither settled nor continued. Four queued
messages sat behind it forever — 「4 条排队 — 已暂停」 — while the local-only sweep
reported success. A ``hermes update`` restarts the gateway regardless of which lane was
mid-turn, so a platform lane must be swept and woken exactly like a local one.
"""
import time

import pytest

from gateway import run_startup
from gateway.run_startup import GatewayStartupMixin


class _Runner(GatewayStartupMixin):
    """Minimal host: only the pieces ``_sweep_one_session_admissions`` touches."""

    def __init__(self):
        self.woken: list[str] = []

    def _schedule_recovery_wake_for_key(self, session_key: str) -> None:
        self.woken.append(session_key)


class _Authority:
    profile_id = "default"
    db = object()  # only ever passed through to the patched list_session_admissions

    def __init__(self):
        self.resolved: list[tuple[str, int]] = []

    def logical_owner(self, session_id: str) -> str:
        return session_id

    async def resolve_unknown_as_owner(self, ref, admission_id, generation) -> None:
        self.resolved.append((admission_id, generation))


def _admissions(status="unknown", outcome=None):
    return [{
        "admission_id": "adm-1",
        "generation": 7,
        "status": status,
        "outcome": outcome,
    }]


def _row(source: str, *, fresh: bool = True) -> dict:
    now = time.time()
    return {
        "id": f"20261029_065956_{source}",
        "session_key": f"agent:main:{source}:dm:1",
        "source": source,
        "last_activity_at": now if fresh else now - 86400 * 30,
    }


@pytest.mark.asyncio
async def test_telegram_unknown_is_settled_and_woken(monkeypatch):
    """A platform lane cut by a restart must free its FIFO AND resume the turn."""
    monkeypatch.setattr(
        "hermes_state_runtime.list_session_admissions",
        lambda *a, **k: _admissions(),
    )
    runner = _Runner()
    authority = _Authority()
    await runner._sweep_one_session_admissions(authority, _row("telegram"), 3600.0)

    assert authority.resolved == [("adm-1", 7)], "telegram unknown must be auto-settled"
    assert runner.woken == ["agent:main:telegram:dm:1"], (
        "an update restarts the gateway mid-turn on every lane — a Telegram chat must "
        "resume by itself instead of waiting for the user to ping again")


@pytest.mark.asyncio
async def test_local_unknown_is_settled_and_woken(monkeypatch):
    """Unchanged for local sessions: settle the cut turn AND continue the conversation."""
    monkeypatch.setattr(
        "hermes_state_runtime.list_session_admissions",
        lambda *a, **k: _admissions(),
    )
    runner = _Runner()
    authority = _Authority()
    await runner._sweep_one_session_admissions(authority, _row("local"), 3600.0)

    assert authority.resolved == [("adm-1", 7)]
    assert runner.woken == ["agent:main:local:dm:1"]


@pytest.mark.asyncio
async def test_stale_telegram_session_settled_without_wake(monkeypatch):
    """Staleness never blocks settling: an old orphan still frees the lane, but no wake."""
    monkeypatch.setattr(
        "hermes_state_runtime.list_session_admissions",
        lambda *a, **k: _admissions(),
    )
    runner = _Runner()
    authority = _Authority()
    await runner._sweep_one_session_admissions(
        authority, _row("telegram", fresh=False), 3600.0)

    assert authority.resolved == [("adm-1", 7)]
    assert runner.woken == []


@pytest.mark.asyncio
async def test_scan_lists_every_live_session(monkeypatch):
    """Contract: the boot sweep's session scan returns platform lanes too."""
    captured: dict[str, str] = {}

    class _Db:
        def _read_all(self, sql):
            captured["sql"] = sql
            return []

    class _Authority:
        profile_id = "default"

        def __init__(self):
            self.db = _Db()
            self.epoch = 116

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(
        "hermes_state_runtime.recover_session_inputs", _noop, raising=False)
    # ``run_startup`` imports ``all_authorities`` inside the method, so the seam is the
    # defining module, not the facade.
    monkeypatch.setattr(
        "gateway.session_authorities.all_authorities", lambda self: [_Authority()])

    async def _noop_sweep(self, authority, row, freshness):
        return None

    monkeypatch.setattr(_Runner, "_sweep_one_session_admissions", _noop_sweep,
                        raising=False)
    await _Runner()._sweep_startup_unknown_admissions()

    sql = " ".join(captured.get("sql", "").split()).lower()
    assert sql, "sweep must scan sessions"
    assert "source='local'" not in sql.replace(" ", ""), (
        "local-only scan leaves platform lanes blocked behind an unknown row: " + sql)
    assert "ended_at is null" in sql
