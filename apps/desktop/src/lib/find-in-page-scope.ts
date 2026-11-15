/**
 * Renderer-side find-in-page that scopes matches to the CURRENT VIEW — the
 * active chat surface — instead of the whole document.
 *
 * Background. Electron's `webContents.findInPage` searches the renderer's
 * entire DOM. The desktop chat shell mounts every ever-active chat surface
 * simultaneously (see apps/desktop/AGENTS.md and the keep-alive comment in
 * apps/desktop/src/app/chat/index.tsx), so a global search matches across
 * every conversation, every background tile, and every other pane that
 * happens to render a transcript. That is not what the user expects when
 * they press ⌘F in a chat — they expect to search the chat they are reading
 * (#81726).
 *
 * Strategy. At bar-open time, capture the active chat surface element and
 * remember it for the lifetime of the find bar. Subsequent queries highlight
 * only text inside that subtree. ⌘G / ⌘⇧G step between highlights inside the
 * same subtree. Closing the bar drops the highlights. If a keep-alive tab
 * flip hides the captured surface while the bar stays open (the route didn't
 * change, so the FindBar's pathname cleanup never ran), the scope re-resolves
 * to the new foreground surface — "find wherever the user is reading" holds
 * across a flip, not just at open time (#81726).
 *
 * "Current view" is the foreground `[data-chat-surface]` element after
 * filtering out inactive keep-alive tabs. That is the same policy every
 * other document-wide lookup obeys (see pane-visibility.ts), so this can be
 * reasoned about as "find wherever the user is reading".
 *
 * Implementation notes — READ BEFORE CHANGING THE MECHANISM.
 *
 * Highlights are painted with the CSS Custom Highlight API: one `Range` per
 * match, handed to `CSS.highlights`. This module NEVER creates, removes, or
 * reparents a node in the transcript.
 *
 * That is a correctness requirement, not a style preference. The previous
 * implementation wrapped each match in a `<mark class="find-hit">` with
 * `parent.replaceChild(fragment, textNode)` and, on teardown, merged the split
 * text nodes back with `parent.normalize()`. Those nodes belong to React: an
 * assistant answer streams through `markdown-text.tsx`, which rebuilds the
 * markdown DOM on every delta. `replaceChild` detaches the exact text node
 * React still holds a fiber for, and `normalize()` removes text nodes outright.
 * The next React commit over that region then calls `removeChild(parent, node)`
 * on a node that is no longer a child and throws
 *
 *   Failed to execute 'removeChild' on 'Node': The node to be removed is not a
 *   child of this node.
 *
 * which unwinds to the nearest error boundary — the markdown-render one, or,
 * when the throw lands outside it, the workspace pane, which blanks the whole
 * conversation. `desktop.log` carries that DOMException against
 * `[error-boundary:markdown-render]` and `[error-boundary:contrib:workspace]`
 * on the reasoning-stream list renderer (`<li>` inside `<ul>`), which is
 * exactly where a streamed delta lands on a wrapped text node.
 *
 * A Range is read-only paint: the worst a stale range can do is highlight
 * nothing, and re-collecting is a tree walk that writes nothing. So the
 * re-render watcher needs no wrap/unwrap bookkeeping, no staleness checks and
 * no re-entrancy guard (#81726, #81778) — it only RE-COLLECTS after React
 * commits.
 *
 * `CSS.highlights` / `Highlight` do not exist under jsdom, so counting and
 * stepping never depend on paint support: the ranges are the source of truth
 * and `findMatchRanges()` exposes them.
 */

import { queryVisible } from '@/components/pane-shell/pane-visibility'

const SCOPE_SELECTOR = '[data-chat-surface]'
const ROOT_ATTR = 'data-find-root'
const SKIP_SELECTOR = 'script, style, noscript, [role="search"]'
const SCROLLABLE_OVERFLOW = /(auto|scroll)/

/** Highlight registry names. Both are painted from `styles.css`. */
const HIT_HIGHLIGHT = 'hermes-find-hit'
const ACTIVE_HIGHLIGHT = 'hermes-find-active'

interface HighlightRegistryLike {
  delete(name: string): boolean
  set(name: string, highlight: unknown): void
}

interface HighlightLike {
  add(range: Range): void
}

type HighlightConstructor = new () => HighlightLike

// ── Module state ────────────────────────────────────────────────────────────
// The ranges ARE the highlight state: no DOM nodes of our own, so there is
// nothing to keep in sync with React.
let observer: MutationObserver | null = null
let scopeRoot: HTMLElement | null = null
let activeQuery = ''
let lastActiveOrdinal = 0
let matches: Range[] = []
let activeIndex = 0
let scheduled = false

/**
 * The element the open FindBar should search. Captured at bar-open time and
 * reused for every query / step until the bar closes. Reading the visible
 * chat surface here means the scope follows the user's current focus —
 * pressing ⌘F in chat A searches chat A even if the route later flips to
 * chat B before the user finishes typing (a typed query still targets A;
 * route-change cleanup in FindBar closes the bar first).
 */
export function resolveCurrentFindScope(): HTMLElement | null {
  return queryVisible<HTMLElement>(SCOPE_SELECTOR)
}

/** Capture the current view as the find scope. Called when the bar opens. */
export function captureFindScope(): HTMLElement | null {
  const root = resolveCurrentFindScope()

  if (root) {
    root.setAttribute(ROOT_ATTR, '')
  }

  resetScopeState()
  scopeRoot = root

  return root
}

/** Forget a past scope: stop watching it and drop its paint and ranges. Called
 *  whenever the bar re-opens or closes so state never leaks across searches. */
function resetScopeState(): void {
  observer?.disconnect()
  observer = null
  scopeRoot = null
  activeQuery = ''
  lastActiveOrdinal = 0
  matches = []
  activeIndex = 0
  scheduled = false
  clearPaint()
}

/**
 * The scope captured by the open bar, or null if none is active.
 *
 * When the captured surface was hidden by a keep-alive tab flip (the bar only
 * closes on a ROUTE change, so a flip keeps it open over a now-inactive pane),
 * re-resolves to the foreground surface instead of going dead — otherwise
 * every query reports 0/0 and ⌘G becomes a no-op on the surface the user is
 * actually reading (#81726).
 */
export function currentFindScope(): HTMLElement | null {
  const roots = document.querySelectorAll<HTMLElement>(`[${ROOT_ATTR}]`)

  for (const root of roots) {
    if (!isElementInHiddenPane(root)) {
      return root
    }
  }

  if (roots.length === 0) {
    // No captured scope — the bar was never opened, or releaseFindScope
    // already tore it down. Nothing to re-target to.
    return null
  }

  // Every marked root is hidden — the captured surface lost a tab flip while
  // the bar stayed open. Move the scope to the now-foreground surface.
  return retargetFindScope(roots)
}

/**
 * Move the find scope to the foreground chat surface after a keep-alive tab
 * flip hid the captured one. Drops the old paint and ranges (they'd otherwise
 * resurface as stray highlights when its tab is revisited), then stamps
 * `data-find-root` on the new surface so the walker keeps searching where the
 * user is now reading. Returns the new scope, or null when no chat surface is
 * visible (the user flipped to a non-chat pane — nothing on screen qualifies
 * as a view).
 */
function retargetFindScope(roots: NodeListOf<HTMLElement>): HTMLElement | null {
  const foreground = resolveCurrentFindScope()

  if (!foreground) {
    return null
  }

  clearPaint()
  matches = []
  activeIndex = 0

  for (const root of roots) {
    if (root !== foreground) {
      root.removeAttribute(ROOT_ATTR)
    }
  }

  // The re-render watcher is still observing the OLD root; detach it so the
  // next performScopedFind re-attaches to the new scope (ensureObserver only
  // trusts an observer whose root matches scopeRoot).
  stopObserver()
  scopeRoot = foreground
  foreground.setAttribute(ROOT_ATTR, '')

  return foreground
}

/** Same predicate pane-visibility exposes, kept local so this module is
 *  independently testable without an import cycle in the renderer. */
function isElementInHiddenPane(element: Element): boolean {
  return Boolean(element.closest('[data-pane-hidden]'))
}

// ── Matching (read-only) ────────────────────────────────────────────────────
/** Elements we never want to descend into during a search: hidden code and
 *  templates, and the FindBar's own search field (a user typing "needle" must
 *  never match the placeholder text in the input). */
function shouldSkipElement(el: Element): boolean {
  return el.closest(SKIP_SELECTOR) !== null
}

/**
 * Walk `root`'s text nodes in document order and build one Range per
 * case-insensitive occurrence of `query`.
 *
 * READ-ONLY — this must never write to the DOM (see the header). A match stays
 * inside a single text node, the same scope the previous walker had.
 */
function collectMatches(root: ParentNode, query: string): Range[] {
  const ranges: Range[] = []
  const needle = query.toLowerCase()

  if (!needle) {
    return ranges
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()

  while (node) {
    const text = node as Text
    const value = text.nodeValue ?? ''
    const parent = text.parentElement

    if (value && parent && !shouldSkipElement(parent)) {
      const lower = value.toLowerCase()
      let from = 0

      while (from <= lower.length - needle.length) {
        const index = lower.indexOf(needle, from)

        if (index === -1) {
          break
        }

        const range = document.createRange()

        range.setStart(text, index)
        range.setEnd(text, index + needle.length)
        ranges.push(range)
        from = index + needle.length
      }
    }

    node = walker.nextNode()
  }

  return ranges
}

// ── Paint (CSS Custom Highlight API) ────────────────────────────────────────
/** The `CSS.highlights` registry, or null where the platform has none (jsdom,
 *  an old runtime). Counting and stepping never depend on it. */
function highlightRegistry(): HighlightRegistryLike | null {
  const registry = (globalThis as { CSS?: { highlights?: unknown } }).CSS?.highlights

  return registry && typeof (registry as HighlightRegistryLike).set === 'function'
    ? (registry as HighlightRegistryLike)
    : null
}

function highlightConstructor(): HighlightConstructor | null {
  const ctor = (globalThis as { Highlight?: unknown }).Highlight

  return typeof ctor === 'function' ? (ctor as HighlightConstructor) : null
}

/** Paint every match, with the active one in its own registry entry. A no-op
 *  where the platform cannot paint — the ranges still drive counting. */
function paintHighlights(): void {
  const registry = highlightRegistry()
  const Highlight = highlightConstructor()

  if (!registry || !Highlight) {
    return
  }

  if (matches.length === 0) {
    clearPaint(registry)

    return
  }

  const hits = new Highlight()

  for (const range of matches) {
    hits.add(range)
  }

  registry.set(HIT_HIGHLIGHT, hits)

  const active = matches[activeIndex]

  if (active) {
    const highlight = new Highlight()

    highlight.add(active)
    registry.set(ACTIVE_HIGHLIGHT, highlight)
  } else {
    registry.delete(ACTIVE_HIGHLIGHT)
  }
}

function clearPaint(registry: HighlightRegistryLike | null = highlightRegistry()): void {
  registry?.delete(HIT_HIGHLIGHT)
  registry?.delete(ACTIVE_HIGHLIGHT)
}

/** First client rect with a size, ignoring the zero-sized rects a collapsed or
 *  hidden range reports (and the empty list jsdom returns). */
function firstRect(range: Range | undefined): DOMRect | null {
  if (!range || typeof range.getClientRects !== 'function') {
    return null
  }

  for (const rect of range.getClientRects()) {
    if (rect.width > 0 || rect.height > 0) {
      return rect
    }
  }

  return null
}

/** Nearest ancestor that actually scrolls, so a match below the fold can be
 *  revealed without moving the page itself. */
function scrollContainerFor(node: Node | null): HTMLElement | null {
  let el = node instanceof Element ? node : (node?.parentElement ?? null)

  while (el && el !== document.body) {
    const overflow = getComputedStyle(el).overflowY

    if (SCROLLABLE_OVERFLOW.test(overflow) && el.scrollHeight > el.clientHeight) {
      return el as HTMLElement
    }

    el = el.parentElement
  }

  return null
}

/** Bring the active match on screen, `nearest` so a match already visible
 *  doesn't twitch. Guarded: jsdom has no layout and no `scrollIntoView`, and
 *  the bar must keep working headless. */
function scrollRangeIntoView(range: Range | undefined): void {
  const rect = firstRect(range)
  const host = scrollContainerFor(range?.startContainer ?? null)

  if (rect && host) {
    const hostRect = host.getBoundingClientRect()

    if (rect.top < hostRect.top || rect.bottom > hostRect.bottom) {
      host.scrollTop = host.scrollTop + rect.top - hostRect.top - (hostRect.height - rect.height) / 2
    }

    return
  }

  const anchor = range?.startContainer.parentElement ?? null

  if (anchor && typeof anchor.scrollIntoView === 'function') {
    anchor.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}

// ── Public API ──────────────────────────────────────────────────────────────
/** Result of a find / step — the same shape the bar already shows. */
export interface ScopedFindResult {
  count: number
  activeOrdinal: number
}

export interface ScopedFindOptions {
  forward: boolean
  findNext: boolean
}

const DEFAULT_RESULT: ScopedFindResult = { count: 0, activeOrdinal: 0 }

/**
 * Run a scoped find against `root`. When `findNext` is true and the query is
 * unchanged, step the active match without re-collecting; otherwise collect
 * fresh ranges for `query`.
 *
 * Returns the (count, activeOrdinal) the bar should display. Returning a
 * plain object instead of pushing into the store keeps this helper testable
 * without a nanostores harness — the store wires it up.
 */
export function performScopedFind(root: Element, query: string, options: ScopedFindOptions): ScopedFindResult {
  if (!query) {
    matches = []
    activeIndex = 0
    activeQuery = ''
    lastActiveOrdinal = 0
    clearPaint()
    stopObserver()

    return DEFAULT_RESULT
  }

  // Same query again = a step, not a new search. Comparing case-insensitively
  // keeps 'Hermes'-for-'hermes' stepping instead of re-collecting on every
  // Enter (triage on #81778).
  const stepping = options.findNext && activeQuery.toLowerCase() === query.toLowerCase() && matches.length > 0

  if (stepping) {
    const step = options.forward ? 1 : -1

    activeIndex = (activeIndex + step + matches.length) % matches.length
  } else {
    matches = collectMatches(root, query)
    // Entering find mode backwards (Shift+Enter on first press) lands on the
    // last match, matching browser convention.
    activeIndex = options.forward ? 0 : Math.max(0, matches.length - 1)
  }

  if (matches.length === 0) {
    activeIndex = 0
    activeQuery = ''
    lastActiveOrdinal = 0
    clearPaint()
    stopObserver()

    return DEFAULT_RESULT
  }

  paintHighlights()
  scrollRangeIntoView(matches[activeIndex])

  // A live search must survive React re-rendering the transcript under us: a
  // re-render replaces the text nodes our ranges point at, so re-collect after
  // React commits and re-activate the same ordinal.
  activeQuery = query
  lastActiveOrdinal = activeIndex + 1
  ensureObserver(root)

  return { count: matches.length, activeOrdinal: activeIndex + 1 }
}

/** Ranges currently highlighted, in document order. Empty when nothing is
 *  highlighted. Read-only: the ranges ARE the highlight state. */
export function findMatchRanges(): readonly Range[] {
  return matches
}

/** The match the bar is parked on, or null. */
export function findActiveRange(): Range | null {
  return matches[activeIndex] ?? null
}

// ── Re-collect on React re-render ───────────────────────────────────────────
/**
 * Attach the scope watcher, if it isn't already attached. Only observes the
 * current scope; a fresh `captureFindScope` (or close) detaches it.
 */
function ensureObserver(root: Element): void {
  if (observer && scopeRoot === root) {
    return
  }

  stopObserver()
  observer = new MutationObserver(() => scheduleRecollect())
  // characterData: a streamed delta writes `nodeValue` in place, which moves
  // the text out from under an existing range.
  observer.observe(root, { characterData: true, childList: true, subtree: true })
}

function stopObserver(): void {
  observer?.disconnect()
  observer = null
}

/**
 * Coalesce a mutation burst (one streaming delta) into a single re-collect on
 * the next microtask. Nothing is written, so there is no re-entrancy to guard:
 * a mutation caused by our own paint cannot exist.
 */
function scheduleRecollect(): void {
  if (scheduled || !scopeRoot || !activeQuery) {
    return
  }

  scheduled = true

  queueMicrotask(() => {
    scheduled = false

    if (!scopeRoot || !activeQuery) {
      return
    }

    matches = collectMatches(scopeRoot, activeQuery)

    if (matches.length === 0) {
      activeIndex = 0
      clearPaint()

      return
    }

    // Keep the user on the match they were on, clamped to the new set.
    activeIndex = Math.min(Math.max(lastActiveOrdinal - 1, 0), matches.length - 1)
    paintHighlights()
  })
}

/** Drop every highlight and the scope marker — called when the bar closes. */
export function releaseFindScope(): void {
  for (const root of document.querySelectorAll<HTMLElement>(`[${ROOT_ATTR}]`)) {
    root.removeAttribute(ROOT_ATTR)
  }

  resetScopeState()
}
