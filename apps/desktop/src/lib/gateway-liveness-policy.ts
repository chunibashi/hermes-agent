/**
 * Liveness-probe force-close policy for the primary gateway socket (#95327).
 *
 * Why this exists
 * ───────────────
 * Every window-lifecycle recovery signal (power resume, network online,
 * focus, visibility) nudges `reconnectNow()`. When the socket still reports
 * open, that path probes liveness with a short-bounded ping and FORCE-CLOSES
 * the socket when the ping times out — "a half-open TCP connection must not
 * swallow the user's next submit".
 *
 * A ping timeout proves a dead TRANSPORT, but it also fires for a live,
 * BUSY backend: a long silent tool call (a quiet build, an OCR worker, a
 * large download) starves the gateway's event loop past the probe budget
 * (#74874's GIL-stall family, amplified on Windows by AV/filter-driver
 * latency). Tearing down the renderer↔backend WebSocket at that moment is a
 * false kill: the gateway sees its client vanish mid-turn, the
 * `ws_orphan_reap` grace expires, and the running turn is interrupted into a
 * bare "Operation interrupted." placeholder — the exact #95327 report.
 *
 * Policy
 * ──────
 * Backend silence is EXPECTED while a session is working, so a probe timeout
 * is inconclusive rather than proof of death. The first such timeout is
 * deferred: keep the socket and schedule one bounded re-probe instead. Only
 * when the failure STREAK reaches `LIVENESS_PROBE_FAILURE_STREAK` (the
 * re-probe also went unanswered) do we treat the socket as genuinely dead
 * and let the normal close→backoff→redial machinery take over. The same
 * streak applies with NO work in flight: a busy-but-healthy backend can be
 * GIL-stalled between turns too (post-turn cleanup, memory commit, plugin
 * registration), and a single unanswered probe in that window is not proof
 * of death either. Worst case this adds one re-probe interval to
 * genuine-dead detection; it removes the teardown entirely for
 * busy-but-healthy backends.
 *
 * Pure and Electron-free so the streak boundaries are assertable directly
 * (mirroring gateway-liveness usage in use-gateway-boot).
 */

/**
 * Ping budget for a liveness probe (primary and secondary sockets share it).
 *
 * Raised from 5s to 30s: a NAP/relay model call can hold the gateway's event
 * loop (GIL-stall family, #74874) for far longer than 5s, so a short probe
 * budget mis-identifies a busy-but-healthy backend as dead and tears the
 * renderer↔backend socket down in the middle of the turn — the "分支失败:
 * Hermes gateway connection closed" / "Operation interrupted." symptom.
 * 30s is still well under the reconnect-backoff cadence, so genuine-dead
 * detection is only delayed by a bounded re-probe, never by this budget.
 */
export const LIVENESS_PROBE_TIMEOUT_MS = 30_000

/**
 * Consecutive unanswered probes tolerated while work is in flight.
 * The same streak applies with no work in flight (see decideLivenessForceClose).
 */
export const LIVENESS_PROBE_FAILURE_STREAK = 2

/** How long after a deferred probe we try again (bounded, coalesced). */
export const LIVENESS_REPROBE_DELAY_MS = 3_000

export interface LivenessForceCloseInput {
  /**
   * How many sessions currently report working (mid-turn). Zero means no
   * turn is riding this socket, so silence has no innocent explanation.
   */
  workingSessionCount: number
  /**
   * Length of the CURRENT unanswered-probe streak, INCLUDING the failure
   * being decided (first failure = 1).
   */
  consecutiveFailures: number
}

export type LivenessForceCloseReason = 'in-flight-work-deferred' | 'failure-streak-exhausted' | 'no-in-flight-work'

export interface LivenessForceCloseDecision {
  close: boolean
  reason: LivenessForceCloseReason
}

/**
 * Decide whether one liveness-probe failure should force the socket down.
 *
 * - Streak < max         → keep the socket; the caller schedules a bounded
 *                          re-probe ('in-flight-work-deferred').
 * - Streak ≥ max         → close ('failure-streak-exhausted' when work is in
 *                          flight, 'no-in-flight-work' when idle):
 *                          a persistently unresponsive socket must still be
 *                          rebuilt, never trusted forever.
 *
 * The STREAK — not the work state — is the death signal. An idle socket from
 * a busy-but-healthy backend can also fail a single probe: the gateway is
 * GIL-stalled between turns (memory commit, compression, plugin registration)
 * while `$workingSessionIds` already reports zero, and tearing the socket
 * down on that first failure is the false kill that produces "branch failed:
 * Hermes gateway connection closed" right after every long turn.
 */
export function decideLivenessForceClose(input: LivenessForceCloseInput): LivenessForceCloseDecision {
  const workingSessionCount = Math.max(0, Math.floor(input.workingSessionCount))
  const consecutiveFailures = Math.max(1, Math.floor(input.consecutiveFailures))

  if (consecutiveFailures < LIVENESS_PROBE_FAILURE_STREAK) {
    return { close: false, reason: 'in-flight-work-deferred' }
  }

  return workingSessionCount > 0
    ? { close: true, reason: 'failure-streak-exhausted' }
    : { close: true, reason: 'no-in-flight-work' }
}
