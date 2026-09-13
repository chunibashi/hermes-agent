"""Tests for StreamingThinkScrubber.

These tests lock in the contract the scrubber must satisfy so downstream
consumers (ACP, api_server, TTS, CLI, gateway) never see reasoning
blocks leaking through the stream_delta_callback.  The scenarios map
directly to the MiniMax-M2.7 / DeepSeek / Qwen3 streaming patterns that
break the older per-delta regex strip.
"""

from __future__ import annotations

import pytest

from agent.think_scrubber import StreamingThinkScrubber


def _drive(scrubber: StreamingThinkScrubber, deltas: list[str]) -> tuple[str, str]:
    """Feed a sequence of deltas and return (visible, thinking)."""
    visible_parts: list[str] = []
    thinking_parts: list[str] = []
    for d in deltas:
        v, t = scrubber.feed(d)
        visible_parts.append(v)
        thinking_parts.append(t)
    v, t = scrubber.flush()
    visible_parts.append(v)
    thinking_parts.append(t)
    return "".join(visible_parts), "".join(thinking_parts)


class TestClosedPairs:
    """Closed <tag>...</tag> pairs are always stripped, regardless of boundary."""

    def test_closed_pair_single_delta(self) -> None:
        s = StreamingThinkScrubber()
        visible, thinking = _drive(s, ["<think>reasoning</think>Hello world"])
        assert visible == "Hello world"
        assert thinking == "reasoning"

    @pytest.mark.parametrize(
        "tag",
        ["think", "thinking", "reasoning", "thought", "REASONING_SCRATCHPAD"],
    )
    def test_all_tag_variants(self, tag: str) -> None:
        s = StreamingThinkScrubber()
        delta = f"<{tag}>x</{tag}>Hello"
        visible, thinking = _drive(s, [delta])
        assert visible == "Hello"
        assert thinking == "x"



class TestUnterminatedOpen:
    """Unterminated open tag discards all subsequent visible content."""

    def test_open_at_stream_start(self) -> None:
        s = StreamingThinkScrubber()
        visible, thinking = _drive(s, ["<think>reasoning text with no close"])
        assert visible == ""
        assert thinking == "reasoning text with no close"

    def test_prose_mentioning_tag_not_stripped(self) -> None:
        """Mid-line '<think>' in prose is preserved (no boundary)."""
        s = StreamingThinkScrubber()
        text = "Use the <think> element for reasoning"
        visible, thinking = _drive(s, [text])
        assert visible == text
        assert thinking == ""



class TestOrphanClose:
    """Orphan close tags (no prior open) are stripped without boundary check."""

    def test_orphan_close_alone(self) -> None:
        s = StreamingThinkScrubber()
        visible, thinking = _drive(s, ["Hello</think>world"])
        assert visible == "Helloworld"
        assert thinking == ""



class TestPartialTagsAcrossDeltas:
    """Partial tags at delta boundaries must be held back, not emitted raw."""

    def test_split_open_tag_held_back(self) -> None:
        """'<' arrives alone, 'think>' completes it on next delta."""
        s = StreamingThinkScrubber()
        # At stream start, last_emitted_ended_newline=True, so <think> at 0 is boundary
        visible, thinking = _drive(s, ["<", "think>reasoning</think>done"])
        assert visible == "done"
        assert thinking == "reasoning"

    def test_split_open_tag_not_at_boundary(self) -> None:
        """Mid-line split '<' + 'think>X</think>' is a closed pair.

        Closed pairs are always stripped (matching
        ``_strip_think_blocks`` case 1), even without a block
        boundary — a closed pair is an intentional bounded construct.
        """
        s = StreamingThinkScrubber()
        visible, thinking = _drive(s, ["word<", "think>prose</think>more"])
        assert visible == "wordmore"
        assert thinking == "prose"




class TestTheMiniMaxScenario:
    """The exact pattern run_agent per-delta regex strip breaks."""

    def test_minimax_split_open(self) -> None:
        """delta1='<think>', delta2='Let me check', delta3='</think>done'."""
        s = StreamingThinkScrubber()
        visible, thinking = _drive(s, ["<think>", "Let me check their config", "</think>", "done"])
        assert visible == "done"
        assert thinking == "Let me check their config"

    def test_minimax_unterminated_reasoning_at_end(self) -> None:
        """Unclosed reasoning at stream end is returned as thinking."""
        s = StreamingThinkScrubber()
        visible, thinking = _drive(s, ["<think>", "The user wants", " to know something"])
        assert visible == ""
        assert thinking == "The user wants to know something"



class TestResetAndReentry:
    def test_reset_clears_in_block_state(self) -> None:
        s = StreamingThinkScrubber()
        s.feed("<think>hanging")
        assert s._in_block is True
        s.reset()
        assert s._in_block is False
        # After reset, a new turn works cleanly
        visible, thinking = _drive(s, ["Hello world"])
        assert visible == "Hello world"
        assert thinking == ""

    def test_reset_clears_buffered_partial_tag(self) -> None:
        s = StreamingThinkScrubber()
        s.feed("word<")
        assert s._buf == "<"
        s.reset()
        assert s._buf == ""
        visible, thinking = _drive(s, ["fresh content"])
        assert visible == "fresh content"
        assert thinking == ""



class TestFlushBehaviour:



    def test_flush_restores_stream_start_boundary(self) -> None:
        """End-of-stream flush must re-arm block-boundary gating.

        Thinking-only / empty-response retries flush then stream again
        without ``reset()``.  If flush left ``_last_emitted_ended_newline``
        False (e.g. after emitting a held-back ``<``), the next stream's
        opening ``<think>`` looked mid-line and leaked into the UI.
        """
        s = StreamingThinkScrubber()
        visible, thinking = s.feed("word")
        assert visible == "word"
        assert thinking == ""
        assert s._last_emitted_ended_newline is False
        visible, thinking = s.flush()
        assert visible == ""
        assert thinking == ""
        assert s._last_emitted_ended_newline is True
        visible, thinking = _drive(s, ["<think>", "secret reasoning", "</think>", "Visible answer"])
        assert visible == "Visible answer"
        assert thinking == "secret reasoning"

    def test_flush_partial_tag_tail_does_not_poison_next_stream(self) -> None:
        """Flushing a held-back ``<`` must not make the next open tag leak."""
        s = StreamingThinkScrubber()
        s.feed("word<")
        visible, thinking = s.flush()
        assert visible == "<"
        assert thinking == ""
        assert s._last_emitted_ended_newline is True
        visible, thinking = _drive(s, ["<think>hidden</think>Hello"])
        assert visible == "Hello"
        assert thinking == "hidden"



class TestRealisticStreaming:
    """Character-by-character streaming must work as well as larger chunks."""

    def test_char_by_char_closed_pair(self) -> None:
        s = StreamingThinkScrubber()
        deltas = list("<think>x</think>Hello world")
        visible, thinking = _drive(s, deltas)
        assert visible == "Hello world"
        assert thinking == "x"

    def test_reasoning_then_real_response_first_word_preserved(self) -> None:
        """Regression: the first word of the final response must NOT be eaten.

        Stefan's screenshot bug — 'Let me check' was being rendered as
        ' me check'.  The scrubber must not consume any character of
        post-close content.
        """
        s = StreamingThinkScrubber()
        deltas = [
            "<think>",
            "User wants to know things",
            "</think>",
            "Let me check their config.",
        ]
        visible, thinking = _drive(s, deltas)
        assert visible == "Let me check their config."
        assert thinking == "User wants to know things"

    def test_no_tag_passthrough_is_identical(self) -> None:
        """Streams without any reasoning tags pass through byte-for-byte."""
        s = StreamingThinkScrubber()
        deltas = ["Hello ", "world ", "how ", "are ", "you?"]
        visible, thinking = _drive(s, deltas)
        assert visible == "Hello world how are you?"
        assert thinking == ""


class TestUnclosedBlockFlush:
    """Unterminated blocks at stream end: thinking emitted during feed, not flush."""

    def test_unclosed_at_stream_end_returns_thinking_during_feed(self) -> None:
        """Thinking content is emitted during feed(), not held back for flush()."""
        s = StreamingThinkScrubber()
        # Feed some thinking content without closing tag
        visible, thinking = s.feed("<think>unterminated reasoning")
        assert visible == ""
        # Thinking is emitted during feed so the UI can show a live timer
        assert thinking == "unterminated reasoning"
        # flush returns nothing for thinking (already emitted)
        visible, thinking = s.flush()
        assert visible == ""
        assert thinking == ""

    def test_unclosed_with_prior_visible_text(self) -> None:
        s = StreamingThinkScrubber()
        visible, thinking = s.feed("Hello ")
        assert visible == "Hello "
        assert thinking == ""
        visible, thinking = s.feed("<think>unterminated")
        # Because _last_emitted_ended_newline is False (Hello has no \n),
        # the <think> is NOT at a block boundary and passes through as prose.
        assert visible == "<think>unterminated"
        assert thinking == ""

    def test_deepseek_toolcall_scenario(self) -> None:
        """DeepSeek sends thinking in its own deltas at stream start, no close tag.

        Thinking deltas are emitted DURING streaming so the UI can show a
        live "Thinking" disclosure with a timer. The flush returns nothing
        for thinking (already emitted).
        """
        s = StreamingThinkScrubber()
        # Stream starts with thinking
        v1, t1 = s.feed("<think>")
        assert v1 == "" and t1 == ""
        v2, t2 = s.feed("The user wants me to ")
        assert v2 == "" and t2 == "The user wants me to "
        v3, t3 = s.feed("call skill_view")
        assert v3 == "" and t3 == "call skill_view"
        # No more content deltas (tool_calls begin), stream ends
        v4, t4 = s.flush()
        assert v4 == ""
        assert t4 == ""

    def test_deepseek_toolcall_full_drive(self) -> None:
        """Full drive of DeepSeek tool-call scenario matches expected totals."""
        s = StreamingThinkScrubber()
        visible, thinking = _drive(s, [
            "<think>",
            "The user wants me to ",
            "call skill_view",
        ])
        assert visible == ""
        assert thinking == "The user wants me to call skill_view"
