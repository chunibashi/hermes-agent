"""pause-for-update control-socket verb (#92091 step 2, campaign #91277).

The updater asks a running gateway to drain and exit cleanly (releasing its
venv file handles) instead of tree-killing it mid-turn. Fallback contract:
older gateways without the verb answer nothing, and callers keep the legacy
marker/force-kill path.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from gateway.control_socket import (
    GatewayControlServer,
    pause_gateway_for_update,
    query_gateway_control,
)


def _make_server(tmp_path, handler):
    server = GatewayControlServer(
        home=tmp_path, verb_handlers={"pause-for-update": handler}
    )
    return server


def test_pause_verb_dispatches_and_returns_ack(tmp_path):
    calls = []

    def handler():
        calls.append(1)
        return {"pausing": True, "already_stopping": False, "pid": 111,
                "drain_timeout": 30.0}

    server = _make_server(tmp_path, handler)
    raw = json.dumps({"verb": "pause-for-update", "id": 7}).encode()
    response = json.loads(server.handle_request_line(raw).decode())
    assert response["ok"] is True
    assert response["result"]["pausing"] is True
    assert response["result"]["drain_timeout"] == 30.0
    assert response["id"] == 7
    assert calls == [1]


def test_unknown_verb_still_lists_pause(tmp_path):
    server = _make_server(tmp_path, dict)
    raw = json.dumps({"verb": "nope"}).encode()
    response = json.loads(server.handle_request_line(raw).decode())
    assert response["ok"] is False
    assert "pause-for-update" in response["supported_verbs"]


@pytest.mark.platforms("posix")  # unix socket transport
def test_pause_client_roundtrip_over_real_socket(tmp_path):
    """Full client→socket→handler→ACK path over a REAL unix socket."""

    async def scenario():
        acks = []

        def handler():
            acks.append(1)
            return {"pausing": True, "already_stopping": False,
                    "pid": 4242, "drain_timeout": 12.5}

        server = _make_server(tmp_path, handler)
        assert await server.start()
        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None, lambda: pause_gateway_for_update(tmp_path, timeout=5.0)
            )
        finally:
            await server.stop()
        return result, acks

    result, acks = asyncio.run(scenario())
    assert acks == [1]
    assert result is not None
    assert result["pausing"] is True and result["drain_timeout"] == 12.5


@pytest.mark.platforms("posix")  # unix socket transport
def test_pause_client_none_when_gateway_lacks_verb(tmp_path):
    """Back-compat: a step-1 gateway (identify/status only) answers ok:false
    for the unknown verb → the client returns None → caller keeps the legacy
    kill path."""

    async def scenario():
        server = GatewayControlServer(home=tmp_path)  # no pause handler
        assert await server.start()
        try:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(
                None, lambda: pause_gateway_for_update(tmp_path, timeout=5.0)
            )
        finally:
            await server.stop()

    assert asyncio.run(scenario()) is None


def test_pause_client_none_when_no_socket(tmp_path):
    assert pause_gateway_for_update(tmp_path, timeout=0.5) is None


def test_pause_verb_forwards_immediate_param_to_handler(tmp_path):
    """``pause_gateway_for_update(immediate=True)`` must reach the handler as
    ``params={"immediate": True}`` — the gateway zeroes its own after-turn wait
    cap on the loop, so a caller in a DIFFERENT process gets an immediate
    restart too (2026-10-28: a sibling probe's request fell back to the 1800s
    after-turn wait because the zeroing lived in the caller's process)."""
    seen: list[dict | None] = []

    def handler(params=None):
        seen.append(params)
        return {"pausing": True, "already_stopping": False, "pid": 222,
                "drain_timeout": 0.0, "immediate": bool((params or {}).get("immediate"))}

    server = _make_server(tmp_path, handler)
    raw = json.dumps({
        "verb": "pause-for-update", "id": 9,
        "params": {"immediate": True},
    }).encode()
    response = json.loads(server.handle_request_line(raw).decode())
    assert response["ok"] is True
    assert response["result"]["immediate"] is True
    assert seen == [{"immediate": True}]


def test_pause_verb_immediate_false_without_params(tmp_path):
    """A plain pause (no params) still invokes the handler with an empty dict —
    the default restart path is unchanged."""
    seen: list[dict | None] = []

    def handler(params=None):
        seen.append(params)
        return {"pausing": True, "already_stopping": False, "pid": 333,
                "drain_timeout": 30.0, "immediate": False}

    server = _make_server(tmp_path, handler)
    raw = json.dumps({"verb": "pause-for-update", "id": 10}).encode()
    response = json.loads(server.handle_request_line(raw).decode())
    assert response["ok"] is True
    assert response["result"]["immediate"] is False
    assert seen == [{}]


@pytest.mark.platforms("posix")  # unix socket transport
def test_pause_client_immediate_roundtrip_over_real_socket(tmp_path):
    """Client → socket → handler: immediate=True travels in params and the ACK
    carries it back (the plugin reads the ACK after the restart is accepted)."""

    async def scenario():
        seen: list[dict | None] = []

        def handler(params=None):
            seen.append(params)
            return {"pausing": True, "already_stopping": False,
                    "pid": 5555, "drain_timeout": 0.0,
                    "immediate": bool((params or {}).get("immediate"))}

        server = _make_server(tmp_path, handler)
        assert await server.start()
        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                None, lambda: pause_gateway_for_update(
                    tmp_path, timeout=5.0, immediate=True)
            )
        finally:
            await server.stop()
        return result, seen

    result, seen = asyncio.run(scenario())
    assert seen == [{"immediate": True}]
    assert result is not None
    assert result["immediate"] is True and result["drain_timeout"] == 0.0
