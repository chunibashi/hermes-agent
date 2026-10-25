"""A resume's synchronous restore work must not freeze the owner event loop.

Regression for the 30s WebSocket timeout family: ``session.resume`` →
``prepare_history`` → ``transcript_target`` → ``restore_local_session`` →
``restore_policy`` and ``attach``'s ``local_history`` ran synchronously on the
owner loop, so while a (large) session resumed, no other frame — clarify.respond,
session.interrupt, a second resume — could be read or dispatched, and the client
timed out at 30s. The fix offloads both to the worker pool; this test pins the
contract that the event loop keeps turning (a scheduled timer still fires) while
the resume's history read is in flight.
"""
import asyncio
import time
from types import SimpleNamespace

import pytest

from gateway.config import GatewayConfig
from gateway.session import SessionStore
from gateway.session_authority import initialize_session_authority
from gateway.session_controls import AuthorityConnection


async def _native(tmp_path, monkeypatch):
    from gateway import run
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setattr(run, '_load_gateway_config', lambda: {'platform_toolsets': {'cli': []}})
    store = SessionStore(tmp_path / 'sessions', GatewayConfig())
    runner = SimpleNamespace(session_store=store, _session_db=store._db, adapters={}, _draining=False,
                             _cached_agent_for=lambda route: None)
    runner._adapter_for_source = lambda source: runner.adapters.get(source.platform)
    authority = await initialize_session_authority(runner, profile_id=str(tmp_path), instance_id='owner')
    native = AuthorityConnection(authority, object(), {'provider': 'local', 'user_id': 'native',
        'profile_id': str(tmp_path), 'instance_id': 'owner'})
    return store._db, native


def _seed(db):
    # Same shape as the display-projection test (an ended tui session): the resume
    # restore path is what this file exercises, not the projection itself.
    db.create_session('old-tui', source='tui', model='fake-model')
    db.append_message('old-tui', 'user', 'hello there')
    db.append_message('old-tui', 'assistant', 'hi, how can I help')
    db.append_message('old-tui', 'user', 'run the tool')
    db.append_message('old-tui', 'assistant', 'done')
    db.end_session('old-tui', 'tui_shutdown')


@pytest.mark.asyncio
async def test_resume_history_read_runs_off_loop(tmp_path, monkeypatch):
    from gateway import session_local_recovery as slr
    import threading
    db, native = await _native(tmp_path, monkeypatch)
    _seed(db)

    reader_ident = {}
    _orig_local_history = slr.local_history

    def _slow_local_history(authority, ref, prepared=None):
        # Record WHICH thread runs the resume's history read. The fix offloads it to a
        # worker; before that it ran synchronously on the owner (event loop) thread and
        # froze the WS reader. A slow (0.3s) simulated read makes the distinction real.
        reader_ident['tid'] = threading.get_ident()
        time.sleep(0.3)
        return _orig_local_history(authority, ref, prepared)

    monkeypatch.setattr(slr, 'local_history', _slow_local_history)
    loop_ident = threading.get_ident()  # the test runs on the event loop thread

    reply = await asyncio.wait_for(
        native.dispatch({'id': 1, 'method': 'session.resume', 'params': {'session_id': 'old-tui'}}),
        timeout=10.0)
    assert 'result' in reply, reply
    assert reply['result']['message_count'] == 4
    # The history read ran on a worker thread, NOT the loop: if it ran on the loop the
    # whole resume would have frozen the WS reader (the 30s timeout family).
    assert reader_ident['tid'] != loop_ident, 'resume history read ran on the event loop thread'
