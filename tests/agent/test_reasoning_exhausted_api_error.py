"""Regression tests for reasoning-exhausted API errors (surfaced as API errors, not
truncated responses).

nap/New-API relaykit surfaces "Model used all output tokens on reasoning with none
left for the response" as a RuntimeError from the API call itself, NOT as a
finish_reason='length' response. The error classifier's ``max_tokens`` pattern
misroutes that text to context_overflow → compression, which cannot fix a burned
output budget: every retry re-burns thinking and the turn dies.

The fix: recover_before_classification recognizes the message and arms the
one-shot reasoning-off override (agent._ephemeral_reasoning_off) so the retry
goes out with thinking disabled and the budget goes to the answer.
"""

from __future__ import annotations

from types import SimpleNamespace

from agent.turn_recovery import recover_before_classification

_REASONING_EXHAUSTED = (
    "Model used all output tokens on reasoning with none left for the response. "
    "Try lowering reasoning effort or increasing max_tokens."
)


def _agent(**overrides):
    printed = []
    defaults = dict(
        model="deepseek-v4-flash",
        provider="nap",
        log_prefix="",
        _vprint=lambda *a, **k: printed.append(" ".join(str(x) for x in a)),
        _ephemeral_reasoning_off=False,
        _reasoning_disable_rejected=False,
        _image_rejecting_models=set(),
        _unicode_sanitization_passes=0,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults), printed


class TestReasoningExhaustedApiError:
    def test_arms_reasoning_off_and_retries(self):
        """The exhausted-budget API error must arm the one-shot reasoning-off
        override and retry now — NOT fall through to the classifier, where the
        ``max_tokens`` pattern would misroute it to context_overflow/compression."""
        agent, printed = _agent()
        retry, prompt = recover_before_classification(
            agent, RuntimeError(_REASONING_EXHAUSTED),
            messages=[], api_messages=[], api_kwargs={}, active_system_prompt="sys",
        )
        assert (retry, prompt) == (True, "sys")
        assert agent._ephemeral_reasoning_off is True
        assert any("thinking off" in line for line in printed)

    def test_other_runtime_errors_unchanged(self):
        """Unrelated RuntimeErrors must not arm the override — the classifier
        still decides their fate."""
        agent, _ = _agent()
        retry, _ = recover_before_classification(
            agent, RuntimeError("random failure"),
            messages=[], api_messages=[], api_kwargs={}, active_system_prompt="sys",
        )
        assert retry is False
        assert agent._ephemeral_reasoning_off is False

    def test_no_rearm_while_override_pending(self):
        """While the one-shot override is still armed (pending the next wire
        request), a repeated exhausted-budget error must NOT re-arm — one retry
        per error event, no stacking."""
        agent, _ = _agent(_ephemeral_reasoning_off=True)
        retry, _ = recover_before_classification(
            agent, RuntimeError(_REASONING_EXHAUSTED),
            messages=[], api_messages=[], api_kwargs={}, active_system_prompt="sys",
        )
        assert retry is False, "pending override must block a second arm"
        assert agent._ephemeral_reasoning_off is True

    def test_consumed_override_allows_next_error_to_arm(self):
        """After the wire consumes the override (as _reasoning_config_for_wire
        does), a fresh exhausted-budget error may arm one more reasoning-off
        retry — the guard is per-pending-override, not per-session."""
        agent, _ = _agent(_ephemeral_reasoning_off=False)
        retry, _ = recover_before_classification(
            agent, RuntimeError(_REASONING_EXHAUSTED),
            messages=[], api_messages=[], api_kwargs={}, active_system_prompt="sys",
        )
        assert retry is True and agent._ephemeral_reasoning_off is True
        # Wire consumes it exactly once (chat_completion_helpers._consume_ephemeral_reasoning_off).
        agent._ephemeral_reasoning_off = False
        retry, _ = recover_before_classification(
            agent, RuntimeError(_REASONING_EXHAUSTED),
            messages=[], api_messages=[], api_kwargs={}, active_system_prompt="sys",
        )
        assert retry is True
        assert agent._ephemeral_reasoning_off is True

    def test_skip_when_reasoning_disable_was_rejected(self):
        """A route that already rejected 'thinking cannot be disabled' must not
        arm the override — the retry would 400 identically and waste the attempt."""
        agent, _ = _agent(_reasoning_disable_rejected=True)
        retry, _ = recover_before_classification(
            agent, RuntimeError(_REASONING_EXHAUSTED),
            messages=[], api_messages=[], api_kwargs={}, active_system_prompt="sys",
        )
        assert retry is False
        assert agent._ephemeral_reasoning_off is False
