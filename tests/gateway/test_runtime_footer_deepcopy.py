"""``FooteredReply`` must survive the completion envelope's deep copy.

The gateway copies every published payload (``gateway/session_events.py::SessionEvents.publish``).
A ``str`` subclass is absent from ``copy._deepcopy_dispatch``, so ``copy`` rebuilds it through
``copyreg.__newobj__`` -- which supplies the text alone and trips ``FooteredReply``'s required
``footer`` argument, failing the whole completion publish (one
``gateway.session_settlement_recovery`` ERROR per turn, and a stalled ws writer behind it).
"""

from __future__ import annotations

from copy import copy, deepcopy

from gateway.runtime_footer import FooteredReply
from gateway.session_events import SessionEvents


def test_footered_reply_copies_keep_their_footer():
    reply = FooteredReply("body", "model · 5% · /x")
    for clone in (copy(reply), deepcopy(reply)):
        assert clone == reply
        assert str(clone) == "body\n\nmodel · 5% · /x"
        assert clone.runtime_footer == "model · 5% · /x"
        assert not clone.startswith("body\n\nmodel · 5% · /x\n\n")


def test_publish_accepts_a_payload_carrying_a_footered_reply():
    events = SessionEvents()
    frames = []
    events.observers.add(frames.append)
    events.publish("session-1", {"response": FooteredReply("body", "footer line")})
    assert len(frames) == 1
    published = frames[0]["params"]["payload"]["response"]
    assert published.runtime_footer == "footer line"
    assert str(published) == "body\n\nfooter line"
