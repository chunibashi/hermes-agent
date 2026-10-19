"""``reset_by_platform`` / ``reset_by_type`` in config.yaml actually reach the reset policy.

The priority ladder in ``gateway.config.GatewayConfig.get_reset_policy``
(platform override > type override > default) was unreachable from a user's
config.yaml: ``_TOPLEVEL_BRIDGE`` only carried ``session_reset`` → the default
policy, so ``reset_by_platform: {telegram: {mode: both}}`` parsed to nothing and
every platform fell back to the (often ``none``) default. This is the regression
that let a global ``session_reset.mode`` change silently kill per-platform
reset — a desktop (``local``) conversation kept getting rotated into
``stale_generation`` while the operator only meant to toggle the messaging
gateways.
"""
import pytest

from gateway.config import Platform, load_gateway_config


@pytest.fixture
def reset_home(tmp_path, monkeypatch):
    """A temp HERMES_HOME whose config.yaml splits default vs per-platform reset."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "config.yaml").write_text(
        "session_reset:\n"
        "  mode: none\n"
        "  at_hour: 4\n"
        "  idle_minutes: 1440\n"
        "reset_by_platform:\n"
        "  telegram:\n"
        "    mode: both\n"
        "    at_hour: 4\n"
        "    idle_minutes: 1440\n"
        "  discord:\n"
        "    mode: both\n",
        encoding="utf-8")
    return tmp_path


def test_per_platform_reset_reaches_get_reset_policy(reset_home):
    """A platform override wins over the (none) default; an unlisted platform
    (the desktop's ``local``) keeps the default."""
    cfg = load_gateway_config()
    assert cfg.default_reset_policy.mode == "none"
    assert cfg.get_reset_policy(platform=Platform.LOCAL).mode == "none"
    assert cfg.get_reset_policy(platform=Platform.TELEGRAM).mode == "both"
    assert cfg.get_reset_policy(platform=Platform.DISCORD).mode == "both"


def test_platform_override_feeds_the_reset_reason(reset_home):
    """The reset verdict is per platform: an old conversation gets a verdict on
    telegram (both) and never on local (desktop, default none). Asserted as a
    set because ``_policy_reset_reason`` reads the real clock — which of
    idle/daily fires first is a time-of-day artifact, not the contract."""
    from datetime import datetime, timedelta

    from gateway.session_lifecycle import SessionLifecycleMixin

    cfg = load_gateway_config()
    f = SessionLifecycleMixin._policy_reset_reason
    stale = datetime.now() - timedelta(days=2)
    assert f(cfg.get_reset_policy(platform=Platform.TELEGRAM), stale) in ("idle", "daily")
    assert f(cfg.get_reset_policy(platform=Platform.LOCAL), stale) is None


def test_no_override_keeps_legacy_global_behavior(tmp_path, monkeypatch):
    """Configs without the new blocks behave exactly as before the bridge:
    the default policy rules every platform."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "config.yaml").write_text(
        "session_reset:\n  mode: both\n  at_hour: 4\n  idle_minutes: 1440\n",
        encoding="utf-8")
    cfg = load_gateway_config()
    assert cfg.get_reset_policy(platform=Platform.LOCAL).mode == "both"
    assert cfg.get_reset_policy(platform=Platform.TELEGRAM).mode == "both"