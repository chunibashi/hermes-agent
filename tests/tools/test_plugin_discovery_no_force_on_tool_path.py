"""Regression: the tool path must not force a plugin rescan.

``dynamic_schema_overrides`` runs on every turn's ``get_tool_definitions()``. A ``force=True``
refresh there rescanned 70+ plugins on every turn, hogging the GIL and stalling ``session.resume``
and the control RPCs (141 force rescans observed in one day, 30s timeouts on ``session.resume``).
The install/enable path owns the forced refresh; the tool path only reads the registry.
"""

from __future__ import annotations


def _spy_force_calls(monkeypatch) -> list[bool]:
    """Record every ``_ensure_plugins_discovered(force=...)`` the tool path makes."""
    import hermes_cli.plugins as plugins_mod

    calls: list[bool] = []
    real = plugins_mod._ensure_plugins_discovered

    def spy(force: bool = False):
        calls.append(bool(force))
        return real(force=force)

    monkeypatch.setattr(plugins_mod, "_ensure_plugins_discovered", spy)
    return calls


def test_video_dynamic_schema_never_forces_rescan(monkeypatch):
    import tools.video_generation_tool as vgt

    calls = _spy_force_calls(monkeypatch)
    vgt._build_dynamic_video_schema()
    assert calls and not any(calls), f"force refresh on the tool-definition path: {calls}"


def test_image_provider_lookup_never_forces_rescan(monkeypatch):
    import tools.image_generation_tool as igt

    calls = _spy_force_calls(monkeypatch)
    assert igt._get_plugin_provider("nonexistent-provider-xyz") is None
    assert calls and not any(calls), f"force refresh on the tool path: {calls}"


def test_tts_provider_lookup_never_forces_rescan(monkeypatch):
    import tools.tts_tool_plugins as tts

    calls = _spy_force_calls(monkeypatch)
    assert tts._lookup_plugin_provider("nonexistent-provider-xyz") is None
    assert calls and not any(calls), f"force refresh on the tool path: {calls}"


def test_transcription_dispatch_never_forces_rescan(monkeypatch):
    import tools.transcription_command as tc

    calls = _spy_force_calls(monkeypatch)
    assert tc._dispatch_to_plugin_provider("nonexistent-audio.wav", "nonexistent-provider-xyz") is None
    assert calls and not any(calls), f"force refresh on the tool path: {calls}"


def test_voice_mode_provider_check_never_forces_rescan(monkeypatch):
    import tools.voice_mode as vm

    calls = _spy_force_calls(monkeypatch)
    assert vm._check_plugin_stt_provider("nonexistent-provider-xyz") is False
    assert calls and not any(calls), f"force refresh on the tool path: {calls}"
