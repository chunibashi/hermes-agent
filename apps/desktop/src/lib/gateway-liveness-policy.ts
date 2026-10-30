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
 * is inconclusive rather than proof of death. While work is in flight
 * (`workingSessionCount > 0`) the socket is NEVER torn down, no matter how
 * long the unanswered streak grows: a model call can hold the gateway's
 * GIL-stall for 100-200s (a NAP/relay turn, #74874's family), far past any
 * probe budget, and a mid-turn teardown rejects the in-flight RPCs and
 * interrupts the running turn. The only close path is the IDLE one: with no
 * work on the wire, a single unanswered probe is still not proof of death
 * (post-turn cleanup, memory commit, plugin registration can GIL-stall the
 * loop with `workingSessionIds` already at zero), so the failure STREAK must
 * reach `LIVENESS_PROBE_FAILURE_STREAK` before we rebuild the socket.
 * Worst case this adds one re-probe interval to genuine-dead detection;
 * it removes the teardown entirely for busy-but-healthy backends.
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
 * The probe's RPC. The backend's socket reader answers `gateway.ping` itself, while any other method
 * waits behind the connection's serial control lane: probing with `ping` timed out behind a slow RPC
 * (compression, a large resume) and closed a healthy socket (#145737). A backend older than the
 * heartbeat answers -32601, which every probe site already treats as alive.
 */
const LIVENESS_PROBE_METHOD = 'gateway.ping'

/** Send one liveness probe on `gateway`; resolves when the backend answers within the budget. */
export function probeGatewayLiveness(gateway: {
  request: (method: string, params: Record<string, unknown>, timeoutMs: number) => Promise<unknown>
}): Promise<unknown> {
  return gateway.request(LIVENESS_PROBE_METHOD, {}, LIVENESS_PROBE_TIMEOUT_MS)
}

/**
 * Consecutive unanswered probes tolerated while IDLE (`workingSessionCount` is
 * zero) before the socket is rebuilt. In-flight work never closes (see
 * decideLivenessForceClose), so this streak only gates the idle close path.
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

export type LivenessForceCloseReason = 'in-flight-work-deferred' | 'no-in-flight-work'

export interface LivenessForceCloseDecision {
  close: boolean
  reason: LivenessForceCloseReason
}

/**
 * Decide whether one liveness-probe failure should force the socket down.
 *
 * - Work in flight (`workingSessionCount > 0`)  → NEVER close. A model call
 *   holds the gateway's GIL-stall (a NAP/relay turn can be 100-200s of
 *   back-to-back API calls with `$workingSessionIds` pinned above zero the
 *   whole time). The probe budget and streak are both invisible to that
 *   window — a busy-but-healthy backend MUST keep its socket, no matter how
 *   long the streak grows, or the teardown rejects the in-flight RPCs
 *   ("分支失败: Hermes gateway connection closed") and `ws_orphan_reap`
 *   interrupts the running turn into a bare "Operation interrupted."
 * - Idle (`workingSessionCount === 0`)        → streak-gated. A single
 *   unanswered probe is not proof of death even here: the gateway can be
 *   GIL-stalled between turns (post-turn cleanup, memory commit, plugin
 *   registration) with the count already at zero. Only when the failure
 *   STREAK reaches `LIVENESS_PROBE_FAILURE_STREAK` do we treat the socket as
 *   genuinely dead and rebuild it. This is the branch after a long turn where
 *   the old immediate-close-on-idle fired.
 */
export function decideLivenessForceClose(input: LivenessForceCloseInput): LivenessForceCloseDecision {
  const workingSessionCount = Math.max(0, Math.floor(input.workingSessionCount))
  const consecutiveFailures = Math.max(1, Math.floor(input.consecutiveFailures))

  // Work is on the wire: the probe is inconclusive no matter how long the
  // streak. Keep the socket, defer. A genuinely-dead socket mid-turn will
  // surface as a per-RPC timeout (or the next turn's submit failure), which
  // the user can recover from; tearing it down here does active harm.
  if (workingSessionCount > 0) {
    return { close: false, reason: 'in-flight-work-deferred' }
  }

  if (consecutiveFailures < LIVENESS_PROBE_FAILURE_STREAK) {
    return { close: false, reason: 'in-flight-work-deferred' }
  }

  return { close: true, reason: 'no-in-flight-work' }
}
