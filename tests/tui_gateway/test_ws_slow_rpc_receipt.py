"""A request the gateway answers late leaves one line naming where the time went.

Clients put their deadline on the REQUEST (30-120s), so from their side a small frame answered late
is indistinguishable from one that never arrived — and the recurring "request timed out after 30s:
session.control.read" family was diagnosed blind for exactly that reason. The receipt separates the
two after the fact: ``queued`` is time in a lane before the handler ran, ``handler`` is the work, and
NO line for a method the client reported as timed out means the frame never reached the dispatcher.
"""
import asyncio
import json

import pytest

from tui_gateway import server
from tui_gateway import ws as ws_mod


class Socket:
    def __init__(self):
        self.inbound = asyncio.Queue()
        self.sent = []

    async def accept(self):
        pass

    async def send_text(self, line):
        self.sent.append(json.loads(line))

    async def receive_text(self):
        item = await self.inbound.get()
        if item is None:
            raise ws_mod._WebSocketDisconnect()
        return json.dumps(item)

    async def close(self):
        pass


@pytest.fixture
def rig(monkeypatch):
    ran = []

    async def dispatch(authority, req, method, transport):
        ran.append(method)
        return {"jsonrpc": "2.0", "id": req.get("id"), "result": {}}

    monkeypatch.setattr(ws_mod, "_dispatch_request", dispatch)
    monkeypatch.setattr(ws_mod, "_start_backend_liveness", lambda: None)
    monkeypatch.setattr(server, "_ensure_skin_watcher", lambda: None)
    monkeypatch.setattr(server, "_ensure_lease_watcher", lambda: None)
    monkeypatch.setattr(server, "_WS_ORPHAN_REAP_GRACE_S", 0)
    monkeypatch.setattr(server, "_close_sessions_for_transport", lambda transport, end_reason: (0, 0))
    # Every dispatched request counts as late: the assertion is that the line is emitted with both
    # halves of the measurement, not that a particular wall-clock threshold was crossed.
    monkeypatch.setattr(ws_mod, "_WS_SLOW_RPC_S", 0.0)
    return Socket(), ran


async def settle(predicate, timeout=5.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() > deadline:
            return False
        await asyncio.sleep(0.01)
    return True


@pytest.mark.asyncio
async def test_a_late_control_reply_logs_its_lane_wait_and_handler_time(rig, caplog):
    sock, ran = rig
    task = asyncio.create_task(ws_mod.handle_ws(sock))
    try:
        with caplog.at_level('WARNING', logger='tui_gateway.ws'):
            sock.inbound.put_nowait({"jsonrpc": "2.0", "id": "stop", "method": "session.interrupt",
                                     "params": {"session_id": "s"}})
            assert await settle(lambda: 'session.interrupt' in ran)
            assert await settle(lambda: 'ws slow rpc' in caplog.text)
    finally:
        sock.inbound.put_nowait(None)
    await asyncio.wait_for(task, 30)

    line = next(record.getMessage() for record in caplog.records if 'ws slow rpc' in record.getMessage())
    assert 'method=session.interrupt' in line
    assert 'queued=' in line and 'handler=' in line
    assert any(frame.get('id') == 'stop' for frame in sock.sent), 'the reply itself is still written'
