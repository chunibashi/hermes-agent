/**
 * Recycle the backend behind a code-skew 503 ("Restart required" after `hermes update`).
 *
 * Closing the local tunnel/child is not enough for SSH: `serve --isolated`
 * detaches with setsid/nohup, so a reconnect would reuse the still-alive
 * stale process via the lockfile. Kill the owned remote serve first (while
 * the SSH channel can still exec), then tear down the local child — the
 * same order as connection apply (#97046, #91668).
 *
 * A LOCAL profile attaches to the per-host gateway (`hermes gateway ensure`),
 * which Desktop never owns: dropping its descriptor only re-attached the same
 * stale process. `restartLocalGateway` runs a supervised
 * `hermes --profile P gateway restart` (a no-op for a remote profile) before
 * the descriptor drop, so the next ensure dials the replacement.
 */

export type RecycleOwnedBackendTarget = 'pool' | 'primary'

export interface RecycleOwnedBackendDeps {
  notifyApplied: () => void
  primaryProfile: string
  profile?: null | string
  restartLocalGateway: (profile: string) => Promise<void>
  teardownPool: (profile: string) => Promise<void>
  teardownPrimary: () => Promise<void>
  teardownSsh: (profile: string) => Promise<void>
}

export function recycleOwnedBackendTarget(
  profile: null | string | undefined,
  primaryProfile: string
): RecycleOwnedBackendTarget {
  const key = String(profile ?? '').trim()

  return !key || key === primaryProfile ? 'primary' : 'pool'
}

export async function recycleOwnedBackend(deps: RecycleOwnedBackendDeps): Promise<RecycleOwnedBackendTarget> {
  const target = recycleOwnedBackendTarget(deps.profile, deps.primaryProfile)
  const profile = String(deps.profile ?? '').trim()

  if (target === 'primary') {
    await deps.teardownSsh('')
    await deps.restartLocalGateway(deps.primaryProfile)
    await deps.teardownPrimary()
    deps.notifyApplied()

    return target
  }

  await deps.teardownSsh(profile)
  await deps.restartLocalGateway(profile)
  await deps.teardownPool(profile)

  return target
}

/** True when a failed IPC call is the backend's post-checkout code-skew 503 ("Restart required: …"). */
export function isCodeSkewRestartRequiredError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '')

  return /Restart required:/i.test(text)
}

/** A drain takes minutes, and a restart that did not clear the skew (the checkout moved again)
 *  must not become a restart loop — one automatic attempt per cooldown. */
export const CODE_SKEW_AUTO_RESTART_COOLDOWN_MS = 5 * 60_000

/**
 * Restart the backend once per code-skew episode.
 *
 * The 503 IS the backend asking to be restarted: it loaded a checkout that has since moved on, and
 * every risky call (the models picker included) keeps refusing until a process loads the new code.
 * Leaving recovery to someone opening Settings → Models and pressing "Restart backend" leaves that
 * refusal window open, so the failure that proves the skew also triggers the restart. The 503 still
 * reaches the renderer (the manual button stays the visible affordance); this only makes the
 * recovery happen. Never concurrent, never more than once per cooldown.
 */
export function createCodeSkewAutoRestart(
  restart: (profile: string) => Promise<void>,
  log: (message: string) => void,
  opts: { cooldownMs?: number; now?: () => number } = {}
): (profile: string) => boolean {
  const cooldownMs = opts.cooldownMs ?? CODE_SKEW_AUTO_RESTART_COOLDOWN_MS
  const now = opts.now ?? Date.now
  let lastAttemptAt: null | number = null
  let inFlight = false

  return profile => {
    if (inFlight) {
      return false
    }

    const at = now()

    if (lastAttemptAt !== null && at - lastAttemptAt < cooldownMs) {
      return false
    }

    lastAttemptAt = at
    inFlight = true
    log('[gateway] Backend answered a code-skew 503 (Restart required); restarting it to load the checkout on disk.')
    void restart(profile)
      .catch(error => log(`[gateway] Code-skew auto-restart failed: ${String(error)}`))
      .finally(() => {
        inFlight = false
      })

    return true
  }
}
