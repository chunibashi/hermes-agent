"""A rotated local transcript is addressed by its conversation's identity (not its segment id).

A compression or reset rotation mints a fresh row for the conversation while the local receipt stays
keyed by the creation id (``local-<hash>``, the row's ``chat_id``). A client that keeps sending the
transcript id it last opened — the Desktop tile does — then reads a receipt that is not there:
``local_receipt`` raises ``storage_unavailable`` for the rest of the conversation's life, the restore
that a request's first read performs refuses forever, and the gateway only ever logged
``Local session <segment> receipt refused: storage_unavailable`` while the client retried the open
until its request deadline expired. Dispatch re-addresses such a request once, by this ladder.
"""
from types import SimpleNamespace

import pytest
import pytest_asyncio


@pytest_asyncio.fixture
async def rotated(tmp_path, monkeypatch):
    from gateway import run
    from gateway.config import GatewayConfig
    from gateway.session import SessionStore
    from gateway.session_authority import initialize_session_authority
    from gateway.session_contract import Principal
    from gateway.session_local import create_local_session
    from gateway.session_mutations import mutate_session
    from hermes_state import SessionDB

    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setattr(run, '_load_gateway_config', lambda: {'platform_toolsets': {'cli': []}})
    store = SessionStore(tmp_path / 'sessions', GatewayConfig())
    store._db = SessionDB(db_path=tmp_path / 'state.db')
    runner = SimpleNamespace(session_store=store, _session_db=store._db, adapters={}, _draining=False,
                             _evict_cached_agent=lambda route: None)
    runner._adapter_for_source = lambda source: runner.adapters.get(source.platform)
    authority = await initialize_session_authority(runner, profile_id='default', instance_id='fixture')
    authority._schedule = lambda ref: None
    owner = Principal('uid:1000', 'default', frozenset({'session:create', 'session:read', 'session:submit',
                                                        'session:control'}), 'native')
    ref = create_local_session(authority, owner, {'request_id': 'r', 'source': 'gui', 'cwd': str(tmp_path),
                                                  'model': 'fixture', 'toolsets': []})
    authority.db.append_message(ref.session_id, 'user', 'before rotation')
    row = authority.db.get_session(ref.session_id)
    moved = await mutate_session(authority, owner, ref, dict(
        session_id=ref.session_id, request_id='reset', expected_revision=row['runtime_revision'],
        expected_generation=row['runtime_generation'], operation='reset', payload={}))
    authority.db.append_message(moved['target_session_id'], 'user', 'after rotation')
    yield SimpleNamespace(authority=authority, owner=owner, identity=ref.session_id,
                          segment=moved['target_session_id'])
    store._db.close()


@pytest.mark.asyncio
async def test_rotated_segment_reads_its_receipt_under_the_conversation_identity(rotated):
    """The shape the ladder exists for: a segment row whose chat_id is the receipt's key."""
    from hermes_state_local import local_receipt
    from hermes_state_runtime import RuntimeStoreError

    t = rotated
    if t.segment == t.identity:
        pytest.skip('this build rotates in place; there is no segment id to re-address')
    assert t.authority.db.get_session(t.segment)['chat_id'] == t.identity
    with pytest.raises(RuntimeStoreError) as refused:
        local_receipt(t.authority.db, t.segment)
    assert getattr(refused.value, 'reason', '') == 'storage_unavailable'
    assert local_receipt(t.authority.db, t.identity)['entry']['session_id'] == t.segment


@pytest.mark.asyncio
async def test_dispatch_re_addresses_a_rotated_segment_to_its_identity(rotated):
    """Resume/mutate/submit reach the conversation instead of refusing on the segment id."""
    from gateway.session_local_migration import local_identity_for

    t = rotated
    if t.segment == t.identity:
        pytest.skip('this build rotates in place; there is no segment id to re-address')
    assert local_identity_for(t.authority, t.segment) == t.identity
    # Already the identity: unchanged (and no receipt read is needed to say so).
    assert local_identity_for(t.authority, t.identity) == t.identity
    # Not a stored row at all: left exactly as given.
    assert local_identity_for(t.authority, '20260101_000000_absent') == '20260101_000000_absent'


@pytest.mark.asyncio
async def test_the_identity_is_what_authorize_can_restore(rotated):
    """The segment id refuses (that was the wedge); the identity the ladder returns restores."""
    from gateway.session_contract import SessionRef
    from gateway.session_local_migration import local_identity_for
    from hermes_state_runtime import RuntimeStoreError

    t = rotated
    if t.segment == t.identity:
        pytest.skip('this build rotates in place; there is no segment id to re-address')
    identity = local_identity_for(t.authority, t.segment)
    with pytest.raises(RuntimeStoreError) as refused:
        t.authority.authorize(t.owner, SessionRef('default', t.segment), 'session:read')
    assert getattr(refused.value, 'reason', '') == 'storage_unavailable'
    t.authority.authorize(t.owner, SessionRef('default', identity), 'session:read')
    assert identity in t.authority.sessions


@pytest.mark.asyncio
async def test_a_control_read_addressed_by_the_segment_id_answers(rotated):
    """The RPC the Desktop actually sends ('session.control.read', the segment id it last opened).

    Dispatch re-addresses it to the conversation identity once, so the owner answers the control
    snapshot; without that, the handler runs on an id nothing published and the client retries until
    its request deadline expires.
    """
    from gateway.session_controls import AuthorityConnection

    t = rotated
    if t.segment == t.identity:
        pytest.skip('this build rotates in place; there is no segment id to re-address')
    connection = AuthorityConnection(t.authority, SimpleNamespace(), {
        'user_id': 'uid:1000', 'provider': 'local', 'profile_id': 'default',
        'instance_id': t.authority.instance_id}, operator=True)
    reply = await connection.dispatch({'jsonrpc': '2.0', 'id': 1, 'method': 'session.control.read',
                                       'params': {'session_id': t.segment}})
    assert reply is not None and 'error' not in reply, reply
    assert 'control' in reply['result']
