import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import { createClientSessionState } from '@/lib/chat-runtime'
import { requestGatewayForAgent } from '@/store/gateway'

import { $activeSessionId, $selectedStoredSessionId, $unreadFinishedSessionIds } from './session'
import {
  $sessionStates,
  clearAllSessionStates,
  LIVE_TURN_EVENT_SILENCE_MS,
  noteSessionEvent,
  publishSessionState,
  setLiveTurnBackend
} from './session-states'

vi.mock('@/store/gateway', async importActual => ({
  ...(await importActual<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn()
}))

const SILENCE_MS = LIVE_TURN_EVENT_SILENCE_MS

function liveTurn(over: Partial<ClientSessionState> = {}): ClientSessionState {
  return {
    ...createClientSessionState('s1'),
    awaitingResponse: true,
    busy: true,
    turnLive: true,
    turnStartedAt: Date.now(),
    ...over
  }
}

const statusResponse = (runtimeId: string, status: string) => ({ sessions: [{ id: runtimeId, status }] })

/**
 * The silence window is the only thing that notices a dead subscription: the
 * turn keeps running on the backend, the socket keeps answering RPCs, and no
 * error is ever raised. Before this, `onEventSilence` restarted its own clock
 * and asked again — forever — so the transcript stayed frozen until the user
 * switched away and back (which resumes, and a resume is what re-attaches the
 * event stream).
 */
describe('re-subscribing a live turn whose events stopped', () => {
  let releaseBackend: () => void = () => undefined

  beforeEach(() => {
    vi.useFakeTimers()
    clearAllSessionStates()
    $unreadFinishedSessionIds.set([])
    $selectedStoredSessionId.set(null)
    $activeSessionId.set(null)
  })

  afterEach(() => {
    releaseBackend()
    releaseBackend = () => undefined
    vi.mocked(requestGatewayForAgent).mockReset()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    clearAllSessionStates()
    $unreadFinishedSessionIds.set([])
    $selectedStoredSessionId.set(null)
    $activeSessionId.set(null)
  })

  it('resumes the session when the backend still reports the turn running', async () => {
    $activeSessionId.set('rt-live')
    publishSessionState('rt-live', liveTurn({ storedSessionId: 's-live', messages: [] }))

    const reattach = vi.fn(async () => ({}))

    releaseBackend = setLiveTurnBackend({
      request: vi.fn(async () => statusResponse('rt-live', 'working')) as never,
      reattach: reattach as never
    })

    noteSessionEvent('rt-live')
    await vi.advanceTimersByTimeAsync(SILENCE_MS)

    expect(reattach).toHaveBeenCalledTimes(1)
    expect(reattach).toHaveBeenCalledWith('rt-live', 's-live')
    // The turn itself must survive: this is a subscription repair, not a settle.
    expect($sessionStates.get()['rt-live']?.busy).toBe(true)
  })

  it('keeps asking on a later window when the resume cannot commit', async () => {
    $activeSessionId.set('rt-retry')
    publishSessionState('rt-retry', liveTurn({ storedSessionId: 's-retry', messages: [] }))

    const reattach = vi.fn(async () => {
      throw new Error('gateway draining')
    })

    releaseBackend = setLiveTurnBackend({
      request: vi.fn(async () => statusResponse('rt-retry', 'working')) as never,
      reattach: reattach as never
    })

    noteSessionEvent('rt-retry')
    await vi.advanceTimersByTimeAsync(SILENCE_MS)

    expect(reattach).toHaveBeenCalledTimes(1)
    expect($sessionStates.get()['rt-retry']?.busy).toBe(true)
  })

  it('does not resume when the backend reports the turn over', async () => {
    $activeSessionId.set('rt-ended')
    publishSessionState('rt-ended', liveTurn({ storedSessionId: 's-ended', messages: [] }))

    const reattach = vi.fn(async () => ({}))

    releaseBackend = setLiveTurnBackend({
      request: vi.fn(async () => statusResponse('rt-ended', 'idle')) as never,
      reattach: reattach as never
    })

    noteSessionEvent('rt-ended')
    await vi.advanceTimersByTimeAsync(SILENCE_MS)

    expect(reattach).not.toHaveBeenCalled()
  })

  it('does not resume when the backend gives no answer', async () => {
    $activeSessionId.set('rt-unknown')
    publishSessionState('rt-unknown', liveTurn({ storedSessionId: 's-unknown', messages: [] }))

    const reattach = vi.fn(async () => ({}))

    releaseBackend = setLiveTurnBackend({
      request: vi.fn(async () => {
        throw new Error('gateway not connected')
      }) as never,
      reattach: reattach as never
    })

    noteSessionEvent('rt-unknown')
    await vi.advanceTimersByTimeAsync(SILENCE_MS)

    expect(reattach).not.toHaveBeenCalled()
  })
})
