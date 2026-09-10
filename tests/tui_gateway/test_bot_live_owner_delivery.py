"""Imported turns retain their receipt and cannot bypass the local FIFO."""
import logging
import threading
from queue import Empty
from types import SimpleNamespace

from tui_gateway.method_ctx import rebind
from tui_gateway import session_notifications, session_auto_continue
from tui_gateway.turn_marker import record_turn_start, read_turn_marker


def test_refused_input_commits_failed_mailbox_receipt(tmp_path):
    import contextlib
    import contextvars
    import logging
    import time
    from tui_gateway import prompt_turn
    from tools import bot_live_delivery as mailbox

    owner = dict(profile_home=str(tmp_path.resolve()), session_id="chat",
                 lease_id="lease", live_session_id="live")
    queued = mailbox.deliver_to_live_owner(tmp_path, owner, "refused input")
    mailbox.claim_pending_delivery(tmp_path, owner)
    agent = SimpleNamespace(session_id="chat")
    session = dict(agent=agent, session_key="chat", history_lock=threading.RLock(), running=True)
    retired = []
    noop = lambda *args, **kwargs: None
    submit = rebind(prompt_turn._run_prompt_submit, {
        "threading": threading, "time": time, "logger": logging.getLogger(__name__),
        "_sessions_lock": threading.RLock(), "_sessions": {},
        "_admit_prompt_turn": lambda *args: ([], agent),
        "_emit": noop, "bind_transport": noop, "reset_transport": noop,
        "_current_runtime_session_record": contextvars.ContextVar("refused_turn"),
        "_TurnRun": prompt_turn._TurnRun,
        "_record_turn_marker": lambda *args, **kwargs: "marker",
        "_prepare_turn_input": lambda *args: None,
        "_finish_turn": noop, "_clear_inflight_turn": noop,
        "_retire_turn_marker": lambda *args: retired.append(args),
        "_emit_settled_session_info": noop,
        "_routing_provenance_db": lambda _session: contextlib.nullcontext(None),
        "_reopen_routed_session_row": noop,
    })
    def terminal(outcome):
        mailbox.complete_delivery(tmp_path, queued["id"], status=outcome["status"],
                                  error=outcome.get("error", ""))
    assert submit(None, "live", session, "refused input", terminal_callback=terminal)
    session["_run_thread"].join(timeout=5)
    assert not session["_run_thread"].is_alive()
    assert mailbox.read_delivery_result(tmp_path, queued["id"])["status"] == "failed"
    assert retired and session["running"] is False


def test_imported_crash_marker_never_autocontinues(tmp_path):
    record_turn_start(tmp_path, "chat", "imported", auto_continue=False)
    marker = read_turn_marker(tmp_path, "chat")
    assert marker["auto_continue"] is False
    schedule = rebind(session_auto_continue._maybe_schedule_auto_continue, {
        "_session_home": lambda session: tmp_path,
        "read_turn_marker": read_turn_marker,
    })
    assert schedule("live", {}, "chat") is None


def test_local_work_blocks_mailbox_claim_without_consuming_envelope(monkeypatch, tmp_path):
    import tools.bot_live_delivery as mailbox
    owner = {"lease_id": "lease", "live_session_id": "live", "session_id": "chat"}
    author = {"id": "bot:coder", "name": "coder", "is_bot": True}
    pending = [{"id": "receipt", "message": "imported", "author": author}]
    monkeypatch.setattr(mailbox, "find_canonical_live_owner", lambda home: owner)
    monkeypatch.setattr(mailbox, "claim_pending_delivery", lambda home, pinned: pending.pop(0))
    receipts = []
    monkeypatch.setattr(mailbox, "complete_delivery", lambda *args, **kwargs: receipts.append((args, kwargs)))
    submitted = []
    def submit(rid, sid, session, text, **kwargs):
        submitted.append((text, kwargs.get("turn_author")))
        kwargs["terminal_callback"]({"status": "settled", "text": "reply"})
        return True
    poll = rebind(session_notifications._poll_bot_live_delivery_once, {
        "_session_home": lambda session: tmp_path,
        "_run_prompt_submit": submit,
        "_notif_release_turn": lambda session: session.update(running=False),
    })
    session = {"history_lock": threading.RLock(), "agent": object(), "session_key": "chat",
               "active_session_lease": SimpleNamespace(lease_id="lease", released=False)}
    for blocker in ("running", "queued_prompt", "queued_prompts", "_auto_continue_scheduled"):
        session[blocker] = True
        assert poll("live", session) is False
        assert pending and not submitted
        session.pop(blocker)
    assert poll("other-live", session) is False
    assert pending
    assert poll("live", session) is True
    assert submitted == [("imported", author)] and not pending
    assert receipts[0][0][1] == "receipt"
    assert receipts[0][1]["reply"] == "reply"


def test_live_delivery_poll_is_throttled_and_backs_off_on_failure(monkeypatch):
    """The mailbox poll takes the shared registry lock: the loop must NOT fire it every
    0.5s tick (a slow holder turns that into an EDEADLK warning storm and steals the lock
    from session lifecycle ops), a failing poll doubles the gap, and recovery resets it."""
    from tools.process_registry import process_registry

    schedule = [0.0, 2.0, 6.0, 14.0, 16.0, 30.0, 32.0]

    class _Clock:
        def __init__(self):
            self.i = -1

        def monotonic(self):
            self.i += 1
            return schedule[min(self.i, len(schedule) - 1)]

    clock = _Clock()
    polls: list = []
    # fail at t=2/6/14 (backoff 2->4->8->16, so t=16 must be SKIPPED), succeed at t=30/32
    outcomes = [None, None, None, False, False]

    def _flaky_poll(sid, session):
        polls.append(clock.i)
        outcome = outcomes.pop(0)
        if outcome is None:
            raise OSError(36, "Resource deadlock avoided")
        return False

    class _FakeQueue:
        def get(self, timeout=None):
            raise Empty

        def qsize(self):
            return 0

    class _StopAfter:
        def __init__(self, limit):
            self.limit = limit

        def is_set(self):
            return len(polls) >= self.limit

    monkeypatch.setattr(session_notifications, "_poll_bot_live_delivery_once", _flaky_poll)
    g = dict(session_notifications.__dict__)
    g.update({
        "time": clock,
        # ``logger`` lives on the server module's globals after bind_module; the
        # split module's own __dict__ never has it.
        "logger": logging.getLogger("test_poller_throttle"),
        "_maybe_fire_tui_loop_tick": lambda *a: None,
        "_maybe_fire_tui_heartbeat_tick": lambda *a: None,
        "_notif_poll_kanban": lambda *a: None,
        "_notif_handle_ready": lambda *a, **k: None,
    })
    loop = rebind(session_notifications._notification_poller_loop, g)
    monkeypatch.setattr(process_registry, "completion_queue", _FakeQueue(), raising=False)
    loop(_StopAfter(5), "sid", {"history_lock": threading.RLock()})
    # polls fired at loop ticks 1,2,3,5,6 (t=2,6,14,30,32) — never at tick 4 (t=16, mid-backoff)
    # and never on the 0.5s queue ticks a hot loop would have burned on
    assert polls == [1, 2, 3, 5, 6]
    assert not outcomes  # success at t=30 reset the backoff, enabling the t=32 poll


