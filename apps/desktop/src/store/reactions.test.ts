import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageReaction } from '@/types/hermes'

const reactionTestState = vi.hoisted(() => {
  const store = <T>(initial: T) => {
    let value = initial

    return {
      get: () => value,
      set: (next: T | ((current: T) => T)) => {
        value = typeof next === 'function' ? (next as (current: T) => T)(value) : next
      }
    }
  }

  const gateway = { request: vi.fn(async (..._args: any[]) => ({ row_id: 7, reactions: [] })) }

  const defaultOwnedRequest = async <T>(
    _sessionId: string | null,
    request: typeof gateway.request,
    method: string,
    params: Record<string, unknown>
  ) => request(method, params) as Promise<T>

  const notifyError = vi.fn()

  return {
    activeSessionId: store<string | null>(null),
    defaultOwnedRequest,
    gateway,
    gatewayStore: store(gateway),
    messages: store<any[]>([]),
    notifyError,
    requestForOwnedSession: vi.fn(defaultOwnedRequest),
    selectedStoredSessionId: store<string | null>(null)
  }
})

vi.mock('@/store/gateway', () => ({ $gateway: reactionTestState.gatewayStore }))
vi.mock('@/store/notifications', () => ({ notifyError: reactionTestState.notifyError }))
vi.mock('@/store/session-states', () => ({ requestForOwnedSession: reactionTestState.requestForOwnedSession }))
vi.mock('@/store/session', () => ({
  $activeSessionId: reactionTestState.activeSessionId,
  $messages: reactionTestState.messages,
  $selectedStoredSessionId: reactionTestState.selectedStoredSessionId,
  setMessages: (update: (messages: any[]) => any[]) =>
    reactionTestState.messages.set(update(reactionTestState.messages.get()))
}))

import { applyReaction, QUICK_REACTIONS, toggleMessageReaction } from '@/store/reactions'
const at = 1_700_000_000

beforeEach(() => {
  reactionTestState.activeSessionId.set(null)
  reactionTestState.selectedStoredSessionId.set(null)
  reactionTestState.messages.set([])
  reactionTestState.gateway.request.mockClear()
  // reset, not clear: a queued `mockRejectedValueOnce` that a test never consumed would otherwise
  // fire inside the next one.
  reactionTestState.requestForOwnedSession.mockReset()
  reactionTestState.requestForOwnedSession.mockImplementation(reactionTestState.defaultOwnedRequest)
  reactionTestState.notifyError.mockClear()
})

function reaction(emoji: string, author: MessageReaction['author']): MessageReaction {
  return { emoji, author, at }
}

describe('applyReaction', () => {
  it('adds a reaction to an empty message', () => {
    expect(applyReaction(undefined, '❤️', 'user')).toMatchObject([{ emoji: '❤️', author: 'user' }])
  })

  it('replaces the same author’s existing reaction (one per author)', () => {
    const next = applyReaction([reaction('❤️', 'user')], '😂', 'user')

    expect(next).toHaveLength(1)
    expect(next[0].emoji).toBe('😂')
  })

  it('retracts when the live reaction is re-sent', () => {
    expect(applyReaction([reaction('👍', 'user')], '👍', 'user')).toEqual([])
  })

  it('clears on an explicit null', () => {
    expect(applyReaction([reaction('👍', 'user')], null, 'user')).toEqual([])
  })

  it('keeps authors independent', () => {
    const next = applyReaction([reaction('🔥', 'agent')], '❤️', 'user')

    expect(next.map(r => r.author).sort()).toEqual(['agent', 'user'])
  })

  it('retracting one author leaves the other intact', () => {
    const next = applyReaction([reaction('🔥', 'agent'), reaction('❤️', 'user')], null, 'user')

    expect(next).toMatchObject([{ emoji: '🔥', author: 'agent' }])
  })

  it('never mutates the input array', () => {
    const before = [reaction('❤️', 'user')]
    const snapshot = [...before]

    applyReaction(before, '😂', 'user')

    expect(before).toEqual(snapshot)
  })
})

describe('QUICK_REACTIONS', () => {
  it('is the six iOS Tapback defaults, each distinct', () => {
    expect(QUICK_REACTIONS).toHaveLength(6)
    expect(new Set(QUICK_REACTIONS).size).toBe(6)
  })
})

describe('toggleMessageReaction session binding', () => {
  it('uses the selected stored session while its runtime id is unset', async () => {
    reactionTestState.selectedStoredSessionId.set('stored-session')

    await toggleMessageReaction({ id: 'message-1', role: 'assistant', parts: [] }, '❤️')

    expect(reactionTestState.requestForOwnedSession).toHaveBeenCalledWith(
      'stored-session',
      expect.any(Function),
      'message.react',
      expect.objectContaining({ session_id: 'stored-session', newest_role: 'assistant', emoji: '❤️' })
    )
    expect(reactionTestState.gateway.request).toHaveBeenCalledTimes(1)
  })

  it('still rejects a genuinely new draft with no session identity', async () => {
    await toggleMessageReaction({ id: 'message-1', role: 'assistant', parts: [] }, '❤️')

    expect(reactionTestState.requestForOwnedSession).not.toHaveBeenCalled()
    expect(reactionTestState.gateway.request).not.toHaveBeenCalled()
  })

  it('addresses the reply row of a folded bubble via reactionRowId, not the narration rowId', async () => {
    reactionTestState.activeSessionId.set('session-1')

    await toggleMessageReaction(
      // A folded turn: rowId anchors the first source row (the "让我数一数"
      // narration), reactionRowId names the reply row the user actually read.
      { id: 'folded', role: 'assistant', rowId: 340731, reactionRowId: 340733, parts: [] },
      '🤮'
    )

    expect(reactionTestState.requestForOwnedSession).toHaveBeenCalledWith(
      'session-1',
      expect.any(Function),
      'message.react',
      expect.objectContaining({ session_id: 'session-1', row_id: 340733, emoji: '🤮' })
    )
  })
})

describe('toggleMessageReaction after the reply timed out', () => {
  const timedOut = () => new Error('request timed out after 60s: message.react')

  it('re-sends the same absolute set once and adopts the server list instead of rolling back', async () => {
    reactionTestState.messages.set([{ id: 'message-1', parts: [], role: 'assistant', rowId: 424011 }])
    reactionTestState.requestForOwnedSession
      .mockRejectedValueOnce(timedOut())
      .mockResolvedValueOnce({ row_id: 424011, reactions: [reaction('❤️', 'user')] })

    await toggleMessageReaction(
      { id: 'message-1', parts: [], role: 'assistant', rowId: 424011 },
      '❤️',
      'user',
      'session-1'
    )

    expect(reactionTestState.requestForOwnedSession).toHaveBeenCalledTimes(2)
    const [first, second] = reactionTestState.requestForOwnedSession.mock.calls

    // Same params both times: the backend REPLACES this author's entry, so a replay converges on
    // the intended state rather than flipping the tapback off again.
    expect(second).toEqual(first)
    expect(reactionTestState.messages.get()[0].reactions).toEqual([reaction('❤️', 'user')])
    expect(reactionTestState.notifyError).not.toHaveBeenCalled()
  })

  it('rolls back and reports once when the retry fails too', async () => {
    reactionTestState.messages.set([{ id: 'message-1', parts: [], role: 'assistant', rowId: 5 }])
    reactionTestState.requestForOwnedSession.mockRejectedValueOnce(timedOut()).mockRejectedValueOnce(timedOut())

    await toggleMessageReaction({ id: 'message-1', parts: [], role: 'assistant', rowId: 5 }, '❤️', 'user', 'session-1')

    expect(reactionTestState.requestForOwnedSession).toHaveBeenCalledTimes(2)
    expect(reactionTestState.messages.get()[0].reactions).toEqual([])
    expect(reactionTestState.notifyError).toHaveBeenCalledTimes(1)
  })

  it('does not retry a refusal that is not a deadline', async () => {
    reactionTestState.messages.set([{ id: 'message-1', parts: [], role: 'assistant', rowId: 5 }])
    reactionTestState.requestForOwnedSession.mockRejectedValueOnce(new Error('message not found'))

    await toggleMessageReaction({ id: 'message-1', parts: [], role: 'assistant', rowId: 5 }, '❤️', 'user', 'session-1')

    expect(reactionTestState.requestForOwnedSession).toHaveBeenCalledTimes(1)
    expect(reactionTestState.notifyError).toHaveBeenCalledTimes(1)
  })
})
