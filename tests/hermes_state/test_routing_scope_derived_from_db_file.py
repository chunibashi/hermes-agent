"""Regression: ``routing_scope_for_conn`` must derive the scope from the database file.

``advance_local_target`` / ``_commit_local_target`` run inside a bare ``conn`` callback, so they
resolve the routing namespace through ``routing_scope_for_conn``. That helper used to answer with
``SELECT scope FROM gateway_routing WHERE scope != '' LIMIT 1`` — "whatever row came first".

``gateway_routing`` legitimately holds several scopes at once: legacy ``scope=''`` rows survive a
migration, and an embedded/simulated environment that reused the real ``state.db`` writes its own
sessions dir. When an unrelated scope sorts first, the helper answers with a namespace this
database never routes, the route lookup returns ``None``, and ``advance_local_target`` raises
``admission_conflict`` — so every compression rotation aborts, the parent never ends, and the
session wedges against its model's context window while the transcript keeps growing.
"""
import json
import sqlite3

from hermes_state import SessionDB
from hermes_state_local import routing_scope_for, routing_scope_for_conn


def _insert_route(conn, scope, session_key, session_id, updated_at=1.0):
    conn.execute(
        "INSERT INTO gateway_routing (scope, session_key, entry_json, updated_at) VALUES (?, ?, ?, ?)",
        (scope, session_key, json.dumps({"session_id": session_id}), updated_at),
    )


def test_scope_comes_from_db_file_not_the_first_routing_row(tmp_path):
    """A foreign scope inserted FIRST must not become this database's namespace."""
    db = SessionDB(tmp_path / "state.db")
    own_scope = str((tmp_path / "sessions").resolve())
    foreign_scope = str((tmp_path / "elsewhere" / "sessions").resolve())

    # Earliest rowid: exactly what the old ``LIMIT 1`` guess returned.
    _insert_route(db._conn, foreign_scope, "agent:main:local:dm:foreign", "foreign-session", updated_at=1.0)
    _insert_route(db._conn, own_scope, "agent:main:local:dm:own", "own-session", updated_at=2.0)
    db._conn.commit()

    assert routing_scope_for_conn(db._conn) == own_scope


def test_own_route_still_resolves_when_a_foreign_scope_is_present(tmp_path):
    """The namespace the compression rotation looks its own route up in must be the live one."""
    db = SessionDB(tmp_path / "state.db")
    own_scope = str((tmp_path / "sessions").resolve())
    foreign_scope = str((tmp_path / "elsewhere" / "sessions").resolve())
    route = "agent:main:local:dm:local-abc123"
    parent_id = "local-abc123-parent"

    _insert_route(db._conn, foreign_scope, route, "some-other-transcript", updated_at=1.0)
    _insert_route(db._conn, own_scope, route, parent_id, updated_at=2.0)
    db._conn.commit()

    scope = routing_scope_for_conn(db._conn)
    row = db._conn.execute(
        "SELECT entry_json FROM gateway_routing WHERE scope = ? AND session_key = ?", (scope, route)
    ).fetchone()

    assert row is not None, "own route must be reachable under the resolved scope"
    assert json.loads(row[0])["session_id"] == parent_id


def test_in_memory_store_falls_back_to_its_only_namespace():
    """:memory: has no file to derive from; a fresh store holds one namespace, as before."""
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE gateway_routing (scope TEXT, session_key TEXT, entry_json TEXT, updated_at REAL)"
    )
    _insert_route(conn, "C:/scratch/sessions", "agent:main:local:dm:x", "x")
    conn.commit()

    assert routing_scope_for_conn(conn) == "C:/scratch/sessions"
    conn.close()


def test_empty_routing_table_agrees_with_the_db_handle_resolver(tmp_path):
    """Nothing routed yet: the conn-level resolver agrees with the db-handle one.

    ``routing_scope_for(db)`` derives the namespace from the store's path and never consults the
    table, so an empty index must answer the same derived scope here rather than the legacy ''.
    """
    db = SessionDB(tmp_path / "state.db")

    assert routing_scope_for_conn(db._conn) == routing_scope_for(db)
    assert routing_scope_for_conn(db._conn) == str((tmp_path / "sessions").resolve())
