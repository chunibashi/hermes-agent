"""Regression: the banner's skill/toolset memos are scope-keyed per served profile.

``hermes_cli/banner.py::_memo`` used to bypass the cache entirely whenever a
``HERMES_HOME`` override was set — the TUI gateway's normal state when it serves
more than one profile. That made every ``session.resume`` re-walk the skills tree
(measured 4-6.5s) and re-probe every toolset's check_fn (~1.4-4.3s), serially per
resume, so a client's 30s RPC timeout fired. The caches are now keyed by the
serving home: one scan per profile, never a leak between profiles.
"""

from hermes_cli import banner


def _reset(monkeypatch, override):
    """Fresh scope maps for this test plus a pinned HERMES_HOME override."""
    monkeypatch.setattr(banner, "_available_skills_cache", {})
    monkeypatch.setattr(banner, "_toolset_availability_cache", {})
    monkeypatch.setattr("hermes_constants.get_hermes_home_override", lambda: override)


def test_same_scope_scans_skills_once(monkeypatch):
    """Under a served profile the skills walk must be paid once, not per resume."""
    _reset(monkeypatch, "/profiles/alpha")
    calls = []

    def fake_find_all_skills():
        calls.append(1)
        return [{"name": "skill-a", "category": "cat"}]

    monkeypatch.setattr("tools.skills_tool.find_all_skills", fake_find_all_skills)

    first = banner.get_available_skills()
    second = banner.get_available_skills()

    assert len(calls) == 1, "a served profile must not re-walk the skills tree per call"
    assert first == second == {"cat": ["skill-a"]}


def test_scopes_do_not_share_a_cached_skill_list(monkeypatch):
    """Two served profiles keep their own inventory (no cross-profile leak)."""
    _reset(monkeypatch, "/profiles/alpha")
    monkeypatch.setattr("tools.skills_tool.find_all_skills",
                        lambda: [{"name": "alpha-skill", "category": "cat"}])
    assert banner.get_available_skills() == {"cat": ["alpha-skill"]}

    # Same cache maps, different serving home: a distinct scope entry.
    monkeypatch.setattr("hermes_constants.get_hermes_home_override", lambda: "/profiles/beta")
    monkeypatch.setattr("tools.skills_tool.find_all_skills",
                        lambda: [{"name": "beta-skill", "category": "cat"}])
    assert banner.get_available_skills() == {"cat": ["beta-skill"]}

    # Back to alpha: its own cached entry, not beta's.
    monkeypatch.setattr("hermes_constants.get_hermes_home_override", lambda: "/profiles/alpha")
    assert banner.get_available_skills() == {"cat": ["alpha-skill"]}


def test_launch_profile_has_its_own_scope(monkeypatch):
    """No override (launch profile) is a scope of its own, distinct from a served one."""
    _reset(monkeypatch, None)
    monkeypatch.setattr("tools.skills_tool.find_all_skills",
                        lambda: [{"name": "launch-skill", "category": "cat"}])
    assert banner.get_available_skills() == {"cat": ["launch-skill"]}

    monkeypatch.setattr("hermes_constants.get_hermes_home_override", lambda: "/profiles/alpha")
    monkeypatch.setattr("tools.skills_tool.find_all_skills",
                        lambda: [{"name": "alpha-skill", "category": "cat"}])
    assert banner.get_available_skills() == {"cat": ["alpha-skill"]}


def test_legacy_none_reset_still_works(monkeypatch):
    """A ``= None`` cache reset (tests, `hermes skills`) must not break the scope map."""
    _reset(monkeypatch, "/profiles/alpha")
    banner._available_skills_cache = None
    monkeypatch.setattr("tools.skills_tool.find_all_skills", lambda: [{"name": "s", "category": "c"}])
    assert banner.get_available_skills() == {"c": ["s"]}


def test_toolset_availability_is_cached_per_scope_and_selection(monkeypatch):
    """The check_fn probe sweep runs once per (profile, toolset selection)."""
    _reset(monkeypatch, "/profiles/alpha")
    calls = []

    def fake_check_tool_availability(quiet=False):
        calls.append(1)
        return [], []

    monkeypatch.setattr("model_tools.check_tool_availability", fake_check_tool_availability)

    first = banner.compute_toolset_availability(["terminal"])
    banner.compute_toolset_availability(["terminal"])
    assert len(calls) == 1, "the same (scope, toolset) selection must not re-probe"

    # A different selection is a different key.
    banner.compute_toolset_availability(["web"])
    assert len(calls) == 2

    # A different profile is a different key.
    monkeypatch.setattr("hermes_constants.get_hermes_home_override", lambda: "/profiles/beta")
    banner.compute_toolset_availability(["terminal"])
    assert len(calls) == 3
    assert first == {"unavailable_toolsets": [], "lazy_tools": [], "disabled_tools": []}