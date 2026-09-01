"""Branch seed divergence: REST tip-only read vs branch lineage read.

The desktop bubble-branch path computes ``count`` from the REST
``/api/sessions/:id/messages`` projection (a single tip session), then sends it
to ``session.branch``, which truncates its OWN display projection — the FULL
compression lineage — to that count. When a session was context-compressed
(parent -> child lineage), the REST projection only contains the child's
SUMMARY + tail, while the lineage contains every parent row too. The same
``count`` therefore addresses a DIFFERENT message in the two projections.

Real-world repro (2026-08-30):
  20260828_220711_3989d6 (parent, 128 rows) -> 20260830_131626_90d601 (branch)
The branch session contained the SAME user message ("大西王 张献忠 是谁?")
TWICE — once at the parent's original timestamp, once inside a mid-session
compaction batch. The intermediate lineage hop (20260830_085213_5d1210, no
``_branched_from`` marker) made ``get_resume_conversations`` walk the WHOLE
lineage (parent + child), so the branch seeded both the parent's full history
AND the child's duplicated compaction copy.
"""

from __future__ import annotations

import pytest

from hermes_state import SessionDB

SUMMARY = [
    {"role": "user", "content": "[CONTEXT COMPACTION] summary of turns 0-5"},
    {"role": "assistant", "content": "Continuing from the summary."},
]


@pytest.fixture
def db(tmp_path) -> SessionDB:
    d = SessionDB(tmp_path / "state.db")
    d.create_session("sess1", source="test")
    return d


def _seed(db: SessionDB, n: int = 6) -> None:
    for i in range(n):
        role = "user" if i % 2 == 0 else "assistant"
        db.append_message("sess1", role=role, content=f"turn {i}")


def _compact(db: SessionDB, parent: str, child: str, watermark=None) -> None:
    """publish_compression_child helper that acquires the lease."""
    assert db.try_acquire_compression_lock(parent, "rotator") is True
    db.publish_compression_child(
        parent_session_id=parent,
        child_session_id=child,
        source="test",
        messages=SUMMARY,
        compression_lock_holder="rotator",
        require_compression_lease=True,
        watermark=watermark,
    )


class TestBranchSeedLineageDivergence:
    def test_lineage_vs_tip_message_count(self, db: SessionDB) -> None:
        """The REST tip-only read and the branch lineage read disagree in size."""
        _seed(db, 30)  # 30 parent rows before compaction
        watermark = db.get_active_message_watermark("sess1")
        db.append_message("sess1", role="user", content="late arrival")
        _compact(db, "sess1", "child1", watermark=watermark)
        # A couple of post-compression turns land in the child (the live tip).
        db.append_message("child1", role="user", content="post-compaction ask")
        db.append_message("child1", role="assistant", content="post-compaction reply")

        # --- What the DESKTOP frontend reads (REST get_messages on the tip) ---
        tip = db.resolve_resume_session_id("sess1")
        rest_messages = db.get_messages(tip, include_compacted=True)

        # --- What session.branch's display projection reads (lineage) ---
        _, display_history = db.get_resume_conversations(tip)

        # The frontend computes `count` from the REST read; the backend truncates
        # the lineage to that count. If the projections differ, the slice lands
        # at the wrong message.
        assert len(rest_messages) != len(display_history), (
            "projections should diverge after lineage compaction "
            f"(tip-only={len(rest_messages)} vs lineage={len(display_history)})"
        )

    def test_branch_truncation_drops_history_when_count_from_tip_read(
        self, db: SessionDB
    ) -> None:
        """Simulating the desktop: count = REST prefix, truncating the lineage
        drops the pre-compaction history."""
        _seed(db, 30)
        watermark = db.get_active_message_watermark("sess1")
        _compact(db, "sess1", "child1", watermark=watermark)

        tip = db.resolve_resume_session_id("sess1")
        rest_messages = db.get_messages(tip, include_compacted=True)
        _, display_history = db.get_resume_conversations(tip)

        # Desktop: branchMessages.length == the count sent to session.branch.
        # User clicks the LAST message of the (compacted) transcript:
        count = len(rest_messages)

        # Backend: history[:count] on the lineage projection.
        truncated = display_history[:count]

        # The lineage is longer than the REST projection, so slicing to the
        # REST-derived count must truncate.
        assert len(truncated) < len(display_history)
        assert [m["content"] for m in truncated] != [
            m["content"] for m in display_history
        ]

    def test_lineage_walk_with_unmarked_intermediate_duplicates_history(
        self, db: SessionDB
    ) -> None:
        """A lineage hop whose child lacks ``_branched_from`` makes the branch
        seed both the parent's rows AND the child's copied rows — the exact
        duplicate-content bug from the 2026-08-30 real-world repro.

        ``publish_compression_child`` mirrors the real chain: sess1 -> child1
        (no explicit-branch marker on child1). Resolving conversations on
        child1 must NOT re-surface sess1's rows alongside child1's own copy.
        """
        _seed(db, 6)
        watermark = db.get_active_message_watermark("sess1")
        _compact(db, "sess1", "child1", watermark=watermark)

        # child1 is the live tip; session.branch would read its display history.
        _, display_history = db.get_resume_conversations("child1")

        # A lineage walk over the unmarked child must not duplicate the seed.
        # (The child already owns the copied SUMMARY + tail; walking to the
        # parent and re-including its rows is exactly what duplicates content.)
        contents = [m["content"] for m in display_history]
        assert len(contents) == len(set(contents)), (
            "display projection must not repeat the same logical message "
            f"({len(contents)} rows, {len(set(contents))} unique)"
        )

    def test_marked_branch_child_is_isolated_from_parent_lineage(
        self, db: SessionDB
    ) -> None:
        """The FIX A contract: once a child session carries the ``_branched_from``
        marker (written by every branch creation path, including the desktop's
        ``session.create`` lazy row create), ``get_resume_conversations`` must
        treat it as an explicit branch and NOT walk back into the parent —
        otherwise re-branching the branch duplicates the whole lineage again.

        Mirrors the real chain with the marker present:
        sess1 (parent) -> branch1 (``_branched_from``) -> branch2 would seed
        only branch1's own copied transcript, never sess1's rows a second time.
        """
        _seed(db, 6)
        watermark = db.get_active_message_watermark("sess1")
        _compact(db, "sess1", "child1", watermark=watermark)

        # The branch child is created with the marker, exactly as
        # _ensure_session_db_row / session.branch stamp it.  It copies the
        # parent's SUMMARY + tail as its own transcript.
        db.create_session(
            "branch1",
            source="desktop",
            model_config={"_branched_from": "child1"},
            parent_session_id="child1",
        )
        db.append_messages_batch(
            "branch1",
            [{"role": m["role"], "content": m["content"]} for m in SUMMARY],
        )

        # Resuming/branching branch1 must see ONLY branch1's own rows.
        _, display_history = db.get_resume_conversations("branch1")
        contents = [m["content"] for m in display_history]
        assert contents == [m["content"] for m in SUMMARY], (
            "a marked branch child must not re-inherit the parent lineage "
            f"(got {len(contents)} rows, expected {len(SUMMARY)})"
        )

    def test_row_id_cut_extends_through_consecutive_assistant_rows(
        self, db: SessionDB
    ) -> None:
        """After a tool-heavy turn the frontend merges several assistant rows
        into one ChatMessage whose row_id is the FIRST row of the merge.
        ``session.branch`` must extend the cut past the matching row through
        the rest of the consecutive assistant rows so the whole merged reply
        is preserved, not just its first chunk.
        """
        db.create_session("sess2", source="test")
        db.append_message("sess2", role="user", content="hello")
        # The assistant reply is fragmented across several rows with tool
        # results between them — the pattern the frontend merges into one bubble.
        db.append_message("sess2", role="assistant", content="thinking step 1")
        db.append_message("sess2", role="tool", content="tool result 1")
        db.append_message("sess2", role="assistant", content="thinking step 2")
        db.append_message("sess2", role="tool", content="tool result 2")
        db.append_message("sess2", role="assistant", content="thinking step 3")
        db.append_message("sess2", role="assistant", content="final answer here")

        _, raw_history = db.get_resume_conversations("sess2")

        # Apply the same filtering as _visible_branch_history.
        visible = []
        for m in raw_history:
            if m.get("role") not in {"user", "assistant"}:
                continue
            if not m.get("content", "").strip():
                continue
            visible.append(dict(m))

        # The user clicks the merged bubble (row_id = first assistant row,
        # "thinking step 1").  Find the matching row and cut.
        row_id = visible[1]["_row_id"]  # first assistant row
        cut = None
        for idx, m in enumerate(visible):
            if m.get("_row_id") == row_id:
                cut = idx
                break
        assert cut == 1, f"expected cut at index 1, got {cut}"

        # Extend through consecutive assistant rows (the fix).
        while cut + 1 < len(visible) and visible[cut + 1].get("role") == "assistant":
            cut += 1

        truncated = visible[: cut + 1]
        assert len(truncated) == 5, (
            f"cut should include all 5 user/assistant rows (user + 4 assistant), "
            f"got {len(truncated)}: {[m['role'] for m in truncated]}"
        )
        assert [m["role"] for m in truncated] == [
            "user", "assistant", "assistant", "assistant", "assistant",
        ], (
            "the assistant run should be preserved in full, not truncated "
            f"at the first row: got {[m['role'] for m in truncated]}"
        )