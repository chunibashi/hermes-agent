"""The WS control lane: an interrupt, a clarify answer, a cancel or a control read must never queue
behind a slow handler on the serial lane. Regression for the desktop 「停止失败 / 无法发送澄清响应」
family — every one of those is a control RPC parked behind a 30s read, so the client reads the
gateway as dead.

The real ``handle_ws`` dispatcher; only ``_dispatch_request`` is a gated async stand-in.
"""
import asyncio
import json

import pytest

from tui_gateway import server
from tui_gateway import ws as ws_mod


class Socket:
    def __init__(self):
        self.inbound = asyncio.Queue()
        self.received = 0
        self.sent = []

    async def accept(self):
        pass

    async def send_text(self, line):
        self.sent.append(json.loads(line))

    async def receive_text(self):
        item = await self.inbound.get()
        if item is None:
            raise ws_mod._WebSocketDisconnect()
        self.received += 1
        return json.dumps(item)

    async def close(self):
        pass


@pytest.fixture
def rig(monkeypatch):
    gates, log = {}, []

    async def dispatch(authority, req, method, transport):
        log.append(f"start:{req['id']}")
        try:
            gate = gates.get(method)
            if gate is not None:
                await gate.wait()
        except asyncio.CancelledError:
            log.append(f"cancelled:{req['id']}")
            raise
        log.append(f"done:{req['id']}")
        return {"jsonrpc": "2.0", "id": req["id"], "result": {}}

    monkeypatch.setattr(ws_mod, "_dispatch_request", dispatch)
    monkeypatch.setattr(ws_mod, "_start_backend_liveness", lambda: None)
    monkeypatch.setattr(server, "_ensure_skin_watcher", lambda: None)
    monkeypatch.setattr(server, "_ensure_lease_watcher", lambda: None)
    monkeypatch.setattr(server, "_WS_ORPHAN_REAP_GRACE_S", 0)
    monkeypatch.setattr(server, "_close_sessions_for_transport", lambda transport, end_reason: (log.append("teardown"), (0, 0))[1])
    return Socket(), gates, log


def rpc(req_id, method):
    return {"jsonrpc": "2.0", "id": req_id, "method": method, "params": {}}


async def settle(predicate, timeout=5.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() > deadline:
            return False
        await asyncio.sleep(0.01)
    return True


@pytest.mark.asyncio
async def test_control_runs_while_the_serial_lane_is_blocked(rig):
    """A slow handler holds the serial lane; the interrupt behind it still dispatches."""
    sock, gates, log = rig
    gates["session.context_breakdown"] = read_release = asyncio.Event()
    gates["prompt.submit"] = submit_release = asyncio.Event()
    task = asyncio.create_task(ws_mod.handle_ws(sock))
    sock.inbound.put_nowait(rpc("read", "session.context_breakdown"))
    sock.inbound.put_nowait(rpc("submit", "prompt.submit"))
    sock.inbound.put_nowait(rpc("stop", "session.interrupt"))
    try:
        assert await settle(lambda: "start:read" in log and "start:submit" in log)
        assert await settle(lambda: "start:stop" in log), "the interrupt parked behind the blocked lane"
        assert "done:stop" in log, "the interrupt never ran while the serial lane was held"
    finally:
        read_release.set()
        submit_release.set()
    assert await settle(lambda: "done:submit" in log)
    sock.inbound.put_nowait(None)
    await asyncio.wait_for(task, 30)
    assert "cancelled:stop" not in log


@pytest.mark.asyncio
async def test_control_lane_keeps_arrival_order(rig):
    """Two control frames keep their order among themselves."""
    sock, _, log = rig
    task = asyncio.create_task(ws_mod.handle_ws(sock))
    for n, method in enumerate(("clarify.respond", "approval.respond", "session.control.read"), start=1):
        sock.inbound.put_nowait(rpc(n, method))
    try:
        assert await settle(lambda: all(f"done:{n}" in log for n in (1, 2, 3)))
        starts = [log.index(f"start:{n}") for n in (1, 2, 3)]
        assert starts == sorted(starts), "control frames did not dispatch in arrival order"
    finally:
        sock.inbound.put_nowait(None)
    await asyncio.wait_for(task, 30)


@pytest.mark.asyncio
async def test_control_lane_drains_before_teardown(rig):
    """A queued control frame finishes before the transport is torn down."""
    sock, _, log = rig
    task = asyncio.create_task(ws_mod.handle_ws(sock))
    sock.inbound.put_nowait(rpc("answer", "clarify.respond"))
    assert await settle(lambda: "done:answer" in log)
    sock.inbound.put_nowait(None)
    await asyncio.wait_for(task, 30)
    assert log[-1] == "teardown"
