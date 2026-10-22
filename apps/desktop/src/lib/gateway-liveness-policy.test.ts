import { describe, expect, it } from 'vitest'

import { decideLivenessForceClose, LIVENESS_PROBE_FAILURE_STREAK } from './gateway-liveness-policy'

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

  it('closes once the unanswered streak reaches the limit even while busy', () => {
    const decision = decideLivenessForceClose({
      workingSessionCount: 3,
      consecutiveFailures: LIVENESS_PROBE_FAILURE_STREAK
    })

    expect(decision.close).toBe(true)
    expect(decision.reason).toBe('failure-streak-exhausted')
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

  it('never lets a deferred defer outlive the streak boundary', () => {
    // Walk the whole streak: every failure below the limit defers; the limit
    // itself and anything beyond close.
    for (let failures = 1; failures <= LIVENESS_PROBE_FAILURE_STREAK + 2; failures += 1) {
      const decision = decideLivenessForceClose({ workingSessionCount: 1, consecutiveFailures: failures })

      expect(decision.close).toBe(failures >= LIVENESS_PROBE_FAILURE_STREAK)
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
