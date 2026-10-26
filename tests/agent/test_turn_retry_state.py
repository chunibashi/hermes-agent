"""Provider detection used by the turn-retry credential-refresh gates."""

from __future__ import annotations

from dataclasses import fields
from types import SimpleNamespace
from unittest.mock import patch

from agent.turn_retry_state import TurnRetryState
from providers.base import ProviderProfile


EXPECTED_FIELDS = {
    "codex_auth_retry_attempted",
    "anthropic_auth_retry_attempted",
    "nous_auth_retry_attempted",
    "nous_paid_entitlement_refresh_attempted",
    "welcome_model_switch_attempted",
    "welcome_route_heal_attempted",
    "copilot_auth_retry_attempted",
    "copilot_stale_cred_retry_attempted",
    "vertex_auth_retry_attempted",
    "thinking_sig_retry_attempted",
    "invalid_encrypted_content_retry_attempted",
    "native_compaction_reject_retry_attempted",
    "image_shrink_retry_attempted",
    "multimodal_tool_content_retry_attempted",
    "reasoning_mandatory_retry_attempted",
    "oauth_1m_beta_retry_attempted",
    "llama_cpp_grammar_retry_attempted",
    "primary_recovery_attempted",
    "has_retried_429",
    "auth_failover_attempted",
    "auto_recovery_cycles_used",
    "restart_with_compressed_messages",
    "restart_with_length_continuation",
    "restart_with_rebuilt_messages",
    "rebuilt_by_fallback",
    "restart_with_redirected_messages",
}




def test_field_set_matches_contract():
    names = {f.name for f in fields(TurnRetryState)}
    assert names == EXPECTED_FIELDS, (
        f"unexpected drift: missing={EXPECTED_FIELDS - names} extra={names - EXPECTED_FIELDS}"
    )




def test_guards_are_independently_mutable():
    s = TurnRetryState()
    s.codex_auth_retry_attempted = True
    s.restart_with_compressed_messages = True
    assert s.codex_auth_retry_attempted is True
    assert s.restart_with_compressed_messages is True
    # untouched guards stay False
    assert s.has_retried_429 is False
    assert s.anthropic_auth_retry_attempted is False


class _RefreshingProfile(ProviderProfile):
    def refresh_runtime_credentials(self, *, reason: str):
        return None


def test_refresh_provider_check_accepts_alias_spellings():
    """`/model` and profile configs can leave an alias (any case) as the
    provider spelling; the recovery gates must not silently skip them."""
    import providers
    from agent.conversation_loop import _credential_refresh_profile

    providers.list_providers()  # discover first so the patched registry restores to the real one
    acme = _RefreshingProfile(name="acme-refresh", aliases=("acme-cloud-refresh", "acme"),
                              base_url="https://api.acme-refresh.test", hostnames=("acme-refresh.test",))

    def _owner(provider, base_url=""):
        profile = _credential_refresh_profile(SimpleNamespace(provider=provider, base_url=base_url))
        return profile.name if profile else None

    with patch.dict(providers._REGISTRY, {acme.name: acme}), \
            patch.dict(providers._ALIASES, {alias: acme.name for alias in acme.aliases}), \
            patch.object(providers, "_PROVIDER_LIST_CACHE", None):
        assert _owner("acme-refresh") == "acme-refresh"
        assert _owner("acme-cloud-refresh") == "acme-refresh"
        assert _owner("ACME-Cloud-Refresh") == "acme-refresh"
        assert _owner("acme") == "acme-refresh"
        # URL fallback: unnormalized provider but the profile's base URL.
        assert _owner("custom", "https://api.acme-refresh.test") == "acme-refresh"
        assert _owner("openrouter", "https://openrouter.ai/api/v1") is None
