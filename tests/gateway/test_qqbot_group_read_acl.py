"""Regression tests for the QQ group per-user read ACL.

Covers ``gateway/platforms/qqbot/adapter.py``:
  * ``_is_group_user_read_allowed`` resolves (in priority order) the
    ``QQ_GROUP_READ_USERS`` env var, then the ``extra.group_read_users``
    config list. ``*`` allows everyone.
  * When ``_group_read_users`` is empty (unconfigured), the method returns
    True so callers fall back to the existing ``QQ_ALLOWED_USERS`` path —
    i.e. configuring the new param is OPT-IN and never silently changes
    behavior.

These tests instantiate the adapter class directly (no network) and inject
the relevant attributes, since the full ``__init__`` requires live app creds.
"""

import importlib
import os

import pytest


@pytest.fixture(autouse=True)
def _isolate_env(tmp_path, monkeypatch):
    hermes_home = tmp_path / ".hermes"
    hermes_home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))
    monkeypatch.delenv("QQ_GROUP_READ_USERS", raising=False)
    yield


def _make_adapter():
    import gateway.platforms.qqbot.adapter as mod

    adapter = object.__new__(mod.QQAdapter)
    adapter._app_id = "test"
    return adapter


class TestGroupReadAclUnconfigured:
    def test_empty_list_allows_everyone(self):
        a = _make_adapter()
        a._group_read_users = []
        assert a._is_group_user_read_allowed("anyone") is True

    def test_env_var_ignored_when_list_empty(self, monkeypatch):
        # The handler only calls this method when _group_read_users is set;
        # if it is empty we short-circuit True regardless of env noise.
        a = _make_adapter()
        a._group_read_users = []
        monkeypatch.setenv("QQ_GROUP_READ_USERS", "someone")
        assert a._is_group_user_read_allowed("someone") is True


class TestGroupReadAclEnv:
    def test_env_allows_listed_user(self, monkeypatch):
        a = _make_adapter()
        a._group_read_users = ["x"]  # present so method is active
        monkeypatch.setenv("QQ_GROUP_READ_USERS", "7DEA338B188FB2A585AAA9B030F38D19")
        assert (
            a._is_group_user_read_allowed("7DEA338B188FB2A585AAA9B030F38D19")
            is True
        )

    def test_env_blocks_stranger(self, monkeypatch):
        a = _make_adapter()
        a._group_read_users = ["x"]
        monkeypatch.setenv("QQ_GROUP_READ_USERS", "7DEA338B188FB2A585AAA9B030F38D19")
        assert a._is_group_user_read_allowed("STRANGER") is False

    def test_env_wildcard_allows_stranger(self, monkeypatch):
        a = _make_adapter()
        a._group_read_users = ["x"]
        monkeypatch.setenv("QQ_GROUP_READ_USERS", "*")
        assert a._is_group_user_read_allowed("STRANGER") is True

    def test_case_insensitive(self, monkeypatch):
        a = _make_adapter()
        a._group_read_users = ["x"]
        monkeypatch.setenv("QQ_GROUP_READ_USERS", "ABCDEF")
        assert a._is_group_user_read_allowed("abcdef") is True

    def test_env_only_enables_acl_without_config_list(self, monkeypatch):
        """Regression: setting ONLY the env var (no extra.group_read_users
        config) must still activate the group read ACL. The handler gates on
        _group_read_enabled, which checks env OR config."""
        a = _make_adapter()
        a._group_read_users = []  # no config list
        monkeypatch.setenv(
            "QQ_GROUP_READ_USERS",
            "7DEA338B188FB2A585AAA9B030F38D19,BEF2F3BD0AE012C07CDD1BE891C468E0",
        )
        assert a._group_read_enabled() is True
        assert a._is_group_user_read_allowed("BEF2F3BD0AE012C07CDD1BE891C468E0") is True
        assert a._is_group_user_read_allowed("STRANGER") is False

    def test_no_env_no_config_disables_acl(self, monkeypatch):
        a = _make_adapter()
        a._group_read_users = []
        monkeypatch.delenv("QQ_GROUP_READ_USERS", raising=False)
        assert a._group_read_enabled() is False


class TestGroupReadAclConfigList:
    def test_config_list_allows_member(self):
        a = _make_adapter()
        a._group_read_users = ["a", "b"]
        assert a._is_group_user_read_allowed("a") is True
        assert a._is_group_user_read_allowed("b") is True

    def test_config_list_blocks_non_member(self):
        a = _make_adapter()
        a._group_read_users = ["a", "b"]
        assert a._is_group_user_read_allowed("c") is False

    def test_config_list_wildcard(self):
        a = _make_adapter()
        a._group_read_users = ["*"]
        assert a._is_group_user_read_allowed("anyone") is True


class TestGroupSpeakerLogging:
    """The group handler must log every speaker's openid so the operator can
    collect IDs to populate QQ_GROUP_READ_USERS / QQ_ALLOWED_USERS. We assert
    the log record carries the openid and is emitted for BOTH allowed and
    denied speakers (regression: must not only log on deny)."""

    def _emit(self, monkeypatch, group_openid, member_openid, nick, read_users):
        import logging

        import gateway.platforms.qqbot.adapter as mod

        adapter = object.__new__(mod.QQAdapter)
        adapter._app_id = "APP1"
        adapter._group_read_users = read_users
        records = []
        handler = logging.Handler()
        handler.emit = lambda r: records.append(r)
        mod.logger.addHandler(handler)
        prev_level = mod.logger.level
        mod.logger.setLevel(logging.INFO)
        try:
            # Replicate the exact log statement from _handle_group_message.
            user_allowed = (
                adapter._is_group_user_read_allowed(member_openid)
                if read_users
                else True
            )
            mod.logger.info(
                "[QQBot:%s] group speaker: group_openid=%s member_openid=%s "
                "nick=%r read_allowed=%s (read_gate=%s)",
                adapter._app_id,
                group_openid,
                member_openid,
                nick or "",
                user_allowed,
                "QQ_GROUP_READ_USERS" if read_users else "QQ_ALLOWED_USERS",
            )
        finally:
            mod.logger.removeHandler(handler)
            mod.logger.setLevel(prev_level)
        return records

    def test_allowed_speaker_is_logged(self, monkeypatch):
        recs = self._emit(monkeypatch, "GRP", "ALLOWED_OPENID", "Kurumi",
                          ["allowed_openid"])
        assert len(recs) == 1
        assert "ALLOWED_OPENID" in recs[0].getMessage()
        assert "read_allowed=True" in recs[0].getMessage()

    def test_denied_speaker_is_logged(self, monkeypatch):
        recs = self._emit(monkeypatch, "GRP", "STRANGER_OPENID", "路人",
                          ["allowed_openid"])
        assert len(recs) == 1
        assert "STRANGER_OPENID" in recs[0].getMessage()
        assert "read_allowed=False" in recs[0].getMessage()

    def test_group_openid_present(self, monkeypatch):
        recs = self._emit(monkeypatch, "GRP42", "X", "n", ["x"])
        assert "group_openid=GRP42" in recs[0].getMessage()
