"""A reply is encoded OFF the event loop: one big frame must never stop the gateway.

``json.dumps`` runs inside json's C encoder, which holds the GIL for the whole call. Encoded inline
by ``write_async`` on the loop thread, a large reply (a coalesced ``session.resume`` projecting a
whole transcript) froze every other peer's writes, the Discord heartbeat and both dispatch lanes
for ~90s (live 2026-11-16 15:12-15:14). ``message.react`` frames were never even read before the
desktop's 60s deadline, and the reaction write landed 1.4s after the client rolled it back.

The contract these tests pin: the encoding happens off the loop, and the loop keeps turning while
one is in flight.
"""

from __future__ import annotations

import asyncio
import json
import threading

from tests.waiting import async_wait_until
from tui_gateway.ws import WSTransport


class _FastWS:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, line: str) -> None:
        self.sent.append(line)


def test_write_async_encodes_off_the_event_loop(monkeypatch):
    encoded_on: list[threading.Thread] = []

    def recording_serialize(obj, peer, log):
        encoded_on.append(threading.current_thread())
        return json.dumps(obj)

    monkeypatch.setattr("tui_gateway.ws.serialize_frame", recording_serialize)

    async def _run() -> None:
        loop_thread = threading.current_thread()
        ws = _FastWS()
        transport = WSTransport(ws, asyncio.get_running_loop(), peer="127.0.0.1:1")
        assert await transport.write_async({"id": "r1", "result": {"ok": True}})

        assert len(encoded_on) == 1, "the reply must be encoded exactly once"
        assert encoded_on[0] is not loop_thread, (
            "the reply was encoded on the event-loop thread: a big frame freezes every peer, the "
            "heartbeat and both dispatch lanes"
        )
        assert json.loads(ws.sent[0])["id"] == "r1"

    asyncio.run(_run())


def test_an_ordered_batch_keeps_its_order_while_encoded_off_loop(monkeypatch):
    def slow_serialize(obj, peer, log):
        return json.dumps(obj)

    monkeypatch.setattr("tui_gateway.ws.serialize_frame", slow_serialize)

    async def _run() -> None:
        ws = _FastWS()
        transport = WSTransport(ws, asyncio.get_running_loop(), peer="127.0.0.1:1")
        frames = [{"id": "a", "result": {}}, {"id": "b", "result": {}}, {"id": "c", "result": {}}]
        assert await transport.write_many_async(frames)

        assert [json.loads(line)["id"] for line in ws.sent] == ["a", "b", "c"], (
            "an off-loop encode must not reorder a caller's ordered batch"
        )

    asyncio.run(_run())


def test_the_loop_keeps_turning_while_a_frame_is_encoded(monkeypatch):
    gate = threading.Event()
    encoding_started = threading.Event()

    def gated_serialize(obj, peer, log):
        encoding_started.set()
        assert gate.wait(10), "the test's own gate never opened"
        return json.dumps(obj)

    monkeypatch.setattr("tui_gateway.ws.serialize_frame", gated_serialize)

    async def _run() -> None:
        ws = _FastWS()
        transport = WSTransport(ws, asyncio.get_running_loop(), peer="127.0.0.1:1")
        reply = asyncio.create_task(transport.write_async({"id": "big", "result": {"x": 1}}))

        # Encoding is stuck in a worker: the LOOP itself must still schedule work (this is the
        # property whose absence killed the react RPC — the frame was never even read).
        await async_wait_until(encoding_started.is_set, what="the frame encode started")
        loop_kept_running = False

        async def _other_work() -> None:
            nonlocal loop_kept_running
            loop_kept_running = True

        await asyncio.create_task(_other_work())
        assert loop_kept_running, "the event loop did not schedule another task while a frame encoded"
        assert not reply.done(), "the reply cannot be on the wire before its encode is released"

        gate.set()
        assert await reply
        assert json.loads(ws.sent[0])["id"] == "big"

    try:
        asyncio.run(_run())
    finally:
        gate.set()
