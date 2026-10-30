import { describe, expect, it } from 'vitest'

import { decideLivenessForceClose, LIVENESS_PROBE_FAILURE_STREAK, probeGatewayLiveness } from './gateway-liveness-policy'

describe('decideLivenessForceClose', () => {
  it('keeps the socket on the first timeout while a turn is in flight (#95327)', () => {
    const decision = decideLivenessForceClose({ workingSessionCount: 1, consecutiveFailures: 1 })

    expect(decision.close).toBe(false)
    expect(decision.reason).toBe('in-flight-work-deferred')
  })

  it('defers for every busy session count, not just one', () => {
    for (const workingSessionCount of [1, 2, 7]) {
      const decision = decideLivenessForceClose({ workingSessionCount, consecutiveFailures: 1 })

      expect(decision).toEqual({ close: false, reason: 'in-flight-work-deferred' })
    }
  })

  it('never closes while a turn is in flight, no matter how long the streak (#分支失败 / #95327)', () => {
    // A NAP/relay turn holds the gateway's GIL-stall for 100-200s of back-to-back
    // API calls with $workingSessionIds pinned above zero the whole time. The
    // probe budget and streak are both invisible to that window: a busy-but-healthy
    // backend must KEEP its socket or the teardown rejects the in-flight RPCs.
    for (let failures = 1; failures <= LIVENESS_PROBE_FAILURE_STREAK + 2; failures += 1) {
      const decision = decideLivenessForceClose({ workingSessionCount: 3, consecutiveFailures: failures })

      expect(decision).toEqual({ close: false, reason: 'in-flight-work-deferred' })
    }
  })

  it('defers a first failure with no work in flight (single probe is not proof of death)', () => {
    const decision = decideLivenessForceClose({ workingSessionCount: 0, consecutiveFailures: 1 })

    expect(decision.close).toBe(false)
    expect(decision.reason).toBe('in-flight-work-deferred')
  })

  it('defers the first failure even with no work in flight (busy-but-healthy between turns)', () => {
    // An idle socket can fail a single probe while the gateway is GIL-stalled
    // between turns (memory commit, plugin registration) — one unanswered
    // probe is not proof of death. Only the streak closes.
    const first = decideLivenessForceClose({ workingSessionCount: 0, consecutiveFailures: 1 })

    expect(first.close).toBe(false)
    expect(first.reason).toBe('in-flight-work-deferred')

    const exhausted = decideLivenessForceClose({
      workingSessionCount: 0,
      consecutiveFailures: LIVENESS_PROBE_FAILURE_STREAK
    })

    expect(exhausted.close).toBe(true)
    expect(exhausted.reason).toBe('no-in-flight-work')
  })

  it('keeps deferring every streak failure while work is in flight', () => {
    // Busy sockets never close; the walk is a regression tripwire so a future
    // change that reintroduces streak-close-mid-turn fails loudly.
    for (let failures = 1; failures <= LIVENESS_PROBE_FAILURE_STREAK + 2; failures += 1) {
      const decision = decideLivenessForceClose({ workingSessionCount: 1, consecutiveFailures: failures })

      expect(decision.close).toBe(false)
      expect(decision.reason).toBe('in-flight-work-deferred')
    }
  })

  it('coerces malformed counters defensively instead of throwing', () => {
    // NaN/negative working count normalizes to 0; a sub-1 failure count
    // normalizes to 1 (the first failure, below the streak) → deferred.
    expect(decideLivenessForceClose({ workingSessionCount: Number.NaN, consecutiveFailures: 0 })).toEqual({
      close: false,
      reason: 'in-flight-work-deferred'
    })
    expect(decideLivenessForceClose({ workingSessionCount: -3, consecutiveFailures: -10 })).toEqual({
      close: false,
      reason: 'in-flight-work-deferred'
    })
  })
})

describe('probeGatewayLiveness', () => {
  // The backend answers `gateway.ping` on its socket reader; every other RPC, `ping` included,
  // waits behind the connection's serial control lane. A probe stuck behind a slow control RPC
  // closed a healthy socket (#145737). The reader fast path itself is pinned by
  // tests/tui_gateway/test_tui_gateway_ws.py::test_ws_ping_is_answered_while_an_earlier_rpc_blocks_dispatch.
  it('sends the reader-answered gateway.ping, never a method queued behind control RPCs', async () => {
    const gateway = {
      request: (method: string) =>
        method === 'gateway.ping' ? Promise.resolve({ ok: true }) : new Promise<unknown>(() => undefined)
    }

    await expect(probeGatewayLiveness(gateway)).resolves.toEqual({ ok: true })
  })
})
