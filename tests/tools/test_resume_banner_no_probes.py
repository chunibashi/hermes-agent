"""Regression: a resume's banner inventory must never run cold ``check_fn`` probes.

``gateway/session_local_inventory._policy_tools`` builds the resume banner's tool
inventory with ``model_tools.get_tool_definitions(..., skip_checks=True)``. Before
``skip_checks`` existed it ran the full probe sweep on every ``session.resume`` —
measured 2.9s for the enabled set (4.2s for all 30 probes) while holding the GIL,
which is what made the desktop's 30s RPC timeout fire. This pins the two contracts:
skip_checks never CALLS a check_fn, and a cached False verdict still drops the tool
so a warm process's count tracks reality.
"""

from tools import registry as _registry_mod
from tools.registry import ToolRegistry


def _make_schema(name):
    return {"name": name, "description": f"tool {name}", "parameters": {"type": "object"}}


def test_skip_checks_never_runs_a_probe():
    """With skip_checks=True, a check_fn that would raise must never be called."""
    calls = {"n": 0}

    def explosive_check():
        calls["n"] += 1
        raise AssertionError("probe ran under skip_checks")

    reg = ToolRegistry()
    reg.register(name="x_probe_tool", toolset="core", schema=_make_schema("x_probe_tool"),
                 handler=lambda **kw: "{}", check_fn=explosive_check)
    # Cold cache + skip_checks -> no call, tool listed anyway.
    _registry_mod.invalidate_check_fn_cache()
    got = reg.get_definitions({"x_probe_tool"}, skip_checks=True)
    assert calls["n"] == 0, "skip_checks must not run check_fn"
    assert [t["function"]["name"] for t in got] == ["x_probe_tool"]


def test_skip_checks_honours_a_cached_false_verdict():
    """A cached False still drops the tool under skip_checks (warm count stays honest)."""
    calls = {"n": 0}

    def false_check():
        calls["n"] += 1
        return False

    reg = ToolRegistry()
    reg.register(name="y_probe_tool", toolset="core", schema=_make_schema("y_probe_tool"),
                 handler=lambda **kw: "{}", check_fn=false_check)
    # Warm the TTL cache with the real (False) verdict.
    got = reg.get_definitions({"y_probe_tool"})
    assert calls["n"] == 1 and got == []
    # skip_checks now must read the cached verdict, not re-probe, and still drop it.
    got = reg.get_definitions({"y_probe_tool"}, skip_checks=True)
    assert calls["n"] == 1, "skip_checks must reuse the cached verdict"
    assert got == []


def test_policy_tools_banner_inventory_skips_probes(monkeypatch):
    """The resume banner's inventory call site asks for skip_checks (behavioural pin on
    the call that used to cost 2.9s per resume)."""
    from gateway import session_local_inventory
    import model_tools

    seen = {}

    def fake_get_definitions(**kw):
        seen.update(kw)
        return []

    monkeypatch.setattr(model_tools, "get_tool_definitions", fake_get_definitions)

    class Policy:
        platform = "cli"
        source = "cli"

        def current_toolsets(self, config):
            return ["terminal"]

    session_local_inventory._policy_tools(Policy(), {})
    assert seen.get("skip_checks") is True, (
        "_policy_tools must request skip_checks=True or every resume re-pays the probe sweep")
