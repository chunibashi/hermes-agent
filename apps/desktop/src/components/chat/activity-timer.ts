import { useEffect, useRef, useState } from 'react'

import { useViewedInterval } from '@/hooks/use-viewed-interval'

// Module-level registry so timers survive component unmount/remount (e.g.
// when a tool row scrolls out and back). Keyed by caller-supplied timerKey;
// anonymous timers (no key) start fresh each mount.
const startedAtByKey = new Map<string, number>()

// Durations of things that have already finished, kept beside the origins that
// measured them. See `useMeasuredDuration`.
const durationByKey = new Map<string, number>()

// The same durations indexed by the reasoning text itself. A message id is an
// accident of which renderer painted it first: background reconciliation,
// re-hydration after a tab switch, or a settle-time store rewrite can hand the
// identical sealed block a new id, and a duration remembered only under the
// old one reads as `null` — the label silently degrades to the untimed
// "已思考". Content survives every id swap, so measured blocks are mirrored
// here and consulted when the id lookup misses. The key is the text's length
// plus its tail: length changes at every streamed token (so partial blocks can
// never collide with the final seal) while the tail stays cheap to slice.
//
// The mirror is also persisted (localStorage): the duration exists nowhere in
// the backend — the turn record stores the text the model thought, never how
// long the client watched it thinking — so a restarted app can only recover a
// measured label from this own-window cache. This is pure renderer
// presentation state: a machine that never watched the block has no duration
// to show, and says so with the untimed label.
const durationByContentKey = new Map<string, number>()

const DURATIONS_STORAGE_KEY = 'hermes.thinking-durations.v1'
const MAX_PERSISTED_DURATIONS = 800

export function reasoningContentKey(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')

  return normalized ? `reasoning-content:${normalized.length}:${normalized.slice(-120)}` : ''
}

function rememberDuration(timerKey: string, seconds: number, contentKey?: string): void {
  durationByKey.set(timerKey, seconds)

  if (contentKey) {
    // Re-insert so the Map's iteration order tracks recency; the persistence
    // slice below keeps the newest entries when the cache hits its cap.
    durationByContentKey.delete(contentKey)
    durationByContentKey.set(contentKey, seconds)
    persistDurations()
  }
}

function persistDurations(): void {
  try {
    const entries = [...durationByContentKey].slice(-MAX_PERSISTED_DURATIONS)

    localStorage.setItem(DURATIONS_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage full or unavailable (quota, private context): the in-memory
    // registry still serves this session; only cross-restart recovery is lost.
  }
}

function restoreDurations(): void {
  try {
    const raw = localStorage.getItem(DURATIONS_STORAGE_KEY)

    if (!raw) {
      return
    }

    const parsed: unknown = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return
    }

    for (const entry of parsed) {
      const [key, seconds] = Array.isArray(entry) ? entry : []

      if (typeof key === 'string' && typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
        durationByContentKey.set(key, seconds)
      }
    }
  } catch {
    // Corrupt or unreadable cache: start empty; seals re-populate it.
  }
}

restoreDurations()

// Test seam: forget everything currently watched in memory (both registries)
// while leaving the storage mirror alone — the first half of a simulated app
// restart. Pair with `__simulateReloadFromStorageForTests` for the second.
export function __clearTimerRegistriesForTests(): void {
  startedAtByKey.clear()
  durationByKey.clear()
  durationByContentKey.clear()
}

// Test seam: reload the content mirror purely from the storage mirror — the
// restart path for a module that was already loaded once.
export function __simulateReloadFromStorageForTests(): void {
  durationByContentKey.clear()
  restoreDurations()
}

function recallDuration(timerKey: string, contentKey?: string): number | undefined {
  const byId = durationByKey.get(timerKey)

  if (byId !== undefined) {
    return byId
  }

  return contentKey ? durationByContentKey.get(contentKey) : undefined
}

function startedAt(key?: string): number {
  if (!key) {
    return Date.now()
  }

  const existing = startedAtByKey.get(key)

  if (existing !== undefined) {
    return existing
  }

  const now = Date.now()
  startedAtByKey.set(key, now)

  return now
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Seconds since the timer's origin, reported once a second while `active`.
 *
 * Origin, in order: an explicit `since` timestamp, else the `timerKey`'s
 * registry entry (survives unmount/remount), else mount time. Pass `since` when
 * the thing being measured started at a moment the caller knows and that moment
 * isn't the mount — otherwise an anonymous timer reports the component's age,
 * which is only the same number by accident.
 */
export function useElapsedSeconds(active = true, timerKey?: string, since?: number): number {
  const start = useRef(since ?? startedAt(timerKey))
  const lastKey = useRef(timerKey)
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - start.current) / 1000)))

  if (lastKey.current !== timerKey) {
    start.current = since ?? startedAt(timerKey)
    lastKey.current = timerKey
  }

  // eslint-disable-next-line no-restricted-syntax -- timer origin is imperative state, not an atom mirror
  useEffect(() => {
    if (since !== undefined) {
      start.current = since
    } else if (timerKey) {
      start.current = startedAt(timerKey)
    }

    if (active) {
      setElapsed(Math.max(0, Math.floor((Date.now() - start.current) / 1000)))
    }
  }, [active, since, timerKey])

  useViewedInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - start.current) / 1000))), 1000, active)

  return elapsed
}

/**
 * How long something took, measured by watching it finish and remembered
 * afterwards. `null` until it has been watched at least once.
 *
 * Some durations exist nowhere but in the watching. A reasoning block is the
 * case this was written for: the persisted turn records the text the model
 * thought, never how long it spent thinking it, so the only way to know is to
 * have been there. Watching alone isn't enough either — the thread virtualizes,
 * so the component that saw a block finish is usually gone by the time anyone
 * scrolls back to read it. Keeping the number in the same registry as the
 * timer's origin lets it outlive the component that measured it.
 *
 * A block that was never watched running — history loaded from an earlier app
 * session, or reasoning that arrived already complete — has no duration and
 * says so, rather than reporting a timer that never ran.
 */
export function useMeasuredDuration(
  active: boolean,
  timerKey: string,
  contentKey?: string
): null | number {
  const elapsed = useElapsedSeconds(active, timerKey)
  const [measured, setMeasured] = useState<null | number>(() => recallDuration(timerKey, contentKey) ?? null)
  // Imperative flag for the unmount cleanup below: was a measurement in
  // flight when this component went away? React state is already gone by
  // teardown time, so the cleanup reads this ref (written directly in the
  // effect body below, never mirrored from state).
  const watchingRef = useRef(false)

  // Not an atom mirror: an imperative in-flight flag the unmount cleanup
  // reads after React state is already gone (prop-mirror exemption class).
  // eslint-disable-next-line no-restricted-syntax -- watchingRef is written imperatively inside the effect
  useEffect(() => {
    if (active) {
      watchingRef.current = true
    } else if (watchingRef.current) {
      const finalElapsed = Math.max(elapsed, Math.floor((Date.now() - startedAt(timerKey)) / 1000))

      watchingRef.current = false
      rememberDuration(timerKey, finalElapsed, contentKey)
      setMeasured(finalElapsed)
    } else if (measured === null) {
      // An id swap that lands in the same commit as the settle runs the
      // previous render's cleanup FIRST — that freeze stored the duration
      // under the old keys and cleared watchingRef, so the transition branch
      // above can no longer fire for this component instance. The block's
      // text is unchanged across the swap, so recover it from the registry
      // by content key instead of degrading to the untimed label.
      const recovered = recallDuration(timerKey, contentKey)

      if (recovered !== undefined) {
        setMeasured(recovered)
      }
    }
    // `watching` state is no longer read here — the ref above is the single
    // source of the in-flight flag, so the label flip and the unmount freeze
    // can never disagree about whether the block was being measured.
  }, [active, contentKey, elapsed, measured, timerKey])

  // Unmount while still watching: the message object identity changes on
  // settle/interim sealing (new ChatMessage → new ThreadMessage), remounting
  // every disclosure. Without freezing the elapsed here, the remounted block
  // finds no duration in the registry and silently degrades to the untimed
  // "已思考" label — the "思考了片刻 → 已思考" flip the user reported.
  useEffect(
    () => () => {
      if (watchingRef.current) {
        rememberDuration(timerKey, Math.max(0, Math.floor((Date.now() - startedAt(timerKey)) / 1000)), contentKey)
      }
    },
    [contentKey, timerKey]
  )

  return measured
}

export function __resetElapsedTimerRegistryForTests() {
  startedAtByKey.clear()
  durationByKey.clear()
  durationByContentKey.clear()

  try {
    localStorage.removeItem(DURATIONS_STORAGE_KEY)
  } catch {
    // jsdom-free environments have no storage; nothing to reset.
  }
}
