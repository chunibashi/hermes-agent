"""A re-issued open shares the projection already in flight instead of queueing another copy.

The Desktop re-issues ``session.resume`` for the same session on every reconnect and after every
timeout, and each one projects a whole stored transcript (measured live: 2.5-5.8 s on a 2.6 GB
store, two such reads allowed at once). The rest queued behind those two lanes and reached the
client ``queued=136-156s`` late — past every deadline — and the retries that followed refilled the
lane. A frame naming a session whose read is already running now answers from that read's reply.

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
    gates, started = {}, []

    async def dispatch(authority, req, method, transport):
        started.append(req["id"])
        gate = gates.get(method)
        if gate is not None:
            await gate.wait()
        return {"jsonrpc": "2.0", "id": req["id"], "result": {"messages": ["snapshot"]}}

    monkeypatch.setattr(ws_mod, "_dispatch_request", dispatch)
    monkeypatch.setattr(ws_mod, "_start_backend_liveness", lambda: None)
    monkeypatch.setattr(server, "_ensure_skin_watcher", lambda: None)
    monkeypatch.setattr(server, "_ensure_lease_watcher", lambda: None)
    monkeypatch.setattr(server, "_WS_ORPHAN_REAP_GRACE_S", 0)
    monkeypatch.setattr(server, "_close_sessions_for_transport", lambda transport, end_reason: (0, 0))
    return Socket(), gates, started


def resume(req_id, session_id="s-1"):
    return {"jsonrpc": "2.0", "id": req_id, "method": "session.resume",
            "params": {"session_id": session_id}}


async def settle(predicate, timeout=5.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() > deadline:
            return False
        await asyncio.sleep(0.01)
    return True


@pytest.mark.asyncio
async def test_a_reissued_resume_shares_the_projection_in_flight(rig):
    sock, gates, started = rig
    gates["session.resume"] = release = asyncio.Event()
    task = asyncio.create_task(ws_mod.handle_ws(sock))
    try:
        sock.inbound.put_nowait(resume("first"))
        assert await settle(lambda: started == ["first"])
        sock.inbound.put_nowait(resume("second"))
        sock.inbound.put_nowait(resume("third"))
        assert await settle(lambda: sock.inbound.empty())
    finally:
        release.set()
    sock.inbound.put_nowait(None)
    await asyncio.wait_for(task, 30)

    # Three opens of the same chat: ONE transcript projection, and every id answered from it.
    assert started == ["first"], "a re-issued open re-ran the transcript projection"
    replies = {frame["id"]: frame for frame in sock.sent if frame.get("id") in {"first", "second", "third"}}
    assert set(replies) == {"first", "second", "third"}
    assert all(reply["result"] == {"messages": ["snapshot"]} for reply in replies.values())


@pytest.mark.asyncio
async def test_a_different_session_still_gets_its_own_projection(rig):
    """Coalescing is per session: another chat's resume is never answered with this one's history."""
    sock, gates, started = rig
    gates["session.resume"] = release = asyncio.Event()
    task = asyncio.create_task(ws_mod.handle_ws(sock))
    try:
        sock.inbound.put_nowait(resume("first", "s-1"))
        sock.inbound.put_nowait(resume("other", "s-2"))
        assert await settle(lambda: started == ["first", "other"])
    finally:
        release.set()
    sock.inbound.put_nowait(None)
    await asyncio.wait_for(task, 30)


@pytest.mark.asyncio
async def test_a_later_resume_after_the_first_answered_runs_again(rig):
    """Once the producing read finished, the next open re-reads: the shared reply is gone."""
    sock, _, started = rig
    task = asyncio.create_task(ws_mod.handle_ws(sock))
    try:
        sock.inbound.put_nowait(resume("first"))
        assert await settle(lambda: "first" in {frame.get("id") for frame in sock.sent})
        sock.inbound.put_nowait(resume("again"))
        assert await settle(lambda: started == ["first", "again"])
    finally:
        sock.inbound.put_nowait(None)
    await asyncio.wait_for(task, 30)
