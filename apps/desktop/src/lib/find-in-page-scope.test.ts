/**
 * Unit tests for the renderer-side find walker.
 *
 * These tests plant DOM by hand and drive the walker directly so the
 * behavior is auditable without spinning up the React store. The end-to-
 * end behavior (open / setFindQuery / step) is covered by find-bar.test.tsx.
 *
 * The load-bearing invariant across this file: a find pass must not touch the
 * transcript's DOM. Painting goes through the CSS Custom Highlight API, so the
 * only observable effect of a search is a set of Ranges. The `<mark>`-wrapping
 * design that came before this one detached text nodes React still owned and
 * crashed the workspace pane with `Failed to execute 'removeChild' on 'Node'`
 * — see the header of find-in-page-scope.ts.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  captureFindScope,
  currentFindScope,
  findActiveRange,
  findMatchRanges,
  performScopedFind,
  releaseFindScope,
  resolveCurrentFindScope
} from './find-in-page-scope'

function plantSurface(id: string, html: string, hidden = false): HTMLElement {
  const root = document.createElement('div')

  root.id = id
  root.setAttribute('data-chat-surface', '')

  if (hidden) {
    root.setAttribute('data-pane-hidden', '')
  }

  root.innerHTML = html
  document.body.appendChild(root)

  return root
}

/** Matches currently highlighted inside `root`. */
function hitsIn(root: Element): number {
  return findMatchRanges().filter(range => root.contains(range.startContainer)).length
}

/** Matched text, in document order. */
function hitTexts(): string[] {
  return findMatchRanges().map(range => range.toString())
}

async function flushMutations(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
  releaseFindScope()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('resolveCurrentFindScope', () => {
  it('returns the foreground chat surface and skips hidden ones', () => {
    plantSurface('background', 'hidden chat', true)
    const foreground = plantSurface('foreground', 'visible chat')

    expect(resolveCurrentFindScope()?.id).toBe('foreground')
    // Marking it lets currentFindScope find it without re-resolving.
    captureFindScope()
    expect(currentFindScope()?.id).toBe('foreground')
  })

  it('returns null when no chat surface is mounted', () => {
    expect(resolveCurrentFindScope()).toBeNull()
  })

  it('returns the FIRST visible chat surface in document order', () => {
    // queryVisible follows document order — the first matching surface
    // wins. Visibility (hidden panes are skipped) is the only filter.
    plantSurface('first', 'one')
    plantSurface('second', 'two')

    expect(resolveCurrentFindScope()?.id).toBe('first')
  })
})

describe('performScopedFind', () => {
  it('finds every case-insensitive match and leaves the transcript DOM alone', () => {
    const surface = plantSurface('surface', '<p>NEEDLE needle Needle</p>')
    const markup = surface.innerHTML

    const result = performScopedFind(surface, 'needle', { forward: true, findNext: false })

    expect(result).toEqual({ count: 3, activeOrdinal: 1 })
    expect(hitTexts()).toEqual(['NEEDLE', 'needle', 'Needle'])
    // The whole point of the Custom Highlight API: not one node was inserted,
    // replaced, split or normalized. A `<mark>` here is the bug (it detaches a
    // text node React still owns and crashes the pane on the next delta).
    expect(surface.innerHTML).toBe(markup)
    expect(surface.querySelector('mark')).toBeNull()
    expect(findActiveRange()).toBe(findMatchRanges()[0])
  })

  it('returns zero counts when the query has no matches and leaves the DOM untouched', () => {
    const surface = plantSurface('surface', '<p>hello world</p>')
    const markup = surface.innerHTML

    const result = performScopedFind(surface, 'nothing', { forward: true, findNext: false })

    expect(result).toEqual({ count: 0, activeOrdinal: 0 })
    expect(findMatchRanges()).toHaveLength(0)
    expect(surface.innerHTML).toBe(markup)
    expect(surface.querySelector('p')?.textContent).toBe('hello world')
  })

  it('clears highlights and zeroes the counter when the query is empty', () => {
    const surface = plantSurface('surface', '<p>needle in a haystack</p>')
    performScopedFind(surface, 'needle', { forward: true, findNext: false })
    expect(hitsIn(surface)).toBe(1)

    const result = performScopedFind(surface, '', { forward: true, findNext: false })

    expect(result).toEqual({ count: 0, activeOrdinal: 0 })
    expect(hitsIn(surface)).toBe(0)
    // Original text restored.
    expect(surface.querySelector('p')?.textContent).toBe('needle in a haystack')
  })

  it('advances the active match on findNext and walks back on findPrevious', () => {
    const surface = plantSurface('surface', '<p>a a a a</p>')
    performScopedFind(surface, 'a', { forward: true, findNext: false })
    expect(hitsIn(surface)).toBe(4)
    expect(findActiveRange()).toBe(findMatchRanges()[0])

    // Step forward twice; the active ordinal cycles 1 → 2 → 3.
    let result = performScopedFind(surface, 'a', { forward: true, findNext: true })
    expect(result.activeOrdinal).toBe(2)
    result = performScopedFind(surface, 'a', { forward: true, findNext: true })
    expect(result.activeOrdinal).toBe(3)
    expect(findActiveRange()).toBe(findMatchRanges()[2])

    // Step backward once → 2.
    result = performScopedFind(surface, 'a', { forward: false, findNext: true })
    expect(result.activeOrdinal).toBe(2)

    // Wrap: from the last match forward wraps to 1.
    performScopedFind(surface, 'a', { forward: true, findNext: true })
    performScopedFind(surface, 'a', { forward: true, findNext: true }) // → 4
    result = performScopedFind(surface, 'a', { forward: true, findNext: true }) // → wraps to 1
    expect(result.activeOrdinal).toBe(1)

    // Backward wrap: from 1 → 4.
    result = performScopedFind(surface, 'a', { forward: false, findNext: true })
    expect(result.activeOrdinal).toBe(4)
  })

  it('lands on the LAST match when entering find mode backwards', () => {
    const surface = plantSurface('surface', '<p>a a a</p>')
    const result = performScopedFind(surface, 'a', { forward: false, findNext: false })

    expect(result.activeOrdinal).toBe(3)
  })

  it('does not re-collect when stepping with the same query (findNext fast path)', () => {
    const surface = plantSurface('surface', '<p>a a a a</p>')
    performScopedFind(surface, 'a', { forward: true, findNext: false })

    const before = [...findMatchRanges()]
    const result = performScopedFind(surface, 'a', { forward: true, findNext: true })
    const after = [...findMatchRanges()]

    // Same range objects — the walker advanced the active index rather than
    // rebuilding the match set.
    expect(after).toHaveLength(before.length)
    expect(after.every((range, index) => range === before[index])).toBe(true)
    expect(result.count).toBe(4)
    expect(result.activeOrdinal).toBe(2)
  })

  it('does not re-collect when the query differs only in case (fast path, triage #81778)', () => {
    // The match set is derived from the SOURCE text, so a byte-equality
    // fast path is fine here — but the comparison must stay case-insensitive so
    // that typing 'hermes' then Enter does not reset the ordinal to 1 forever.
    const surface = plantSurface('surface', '<p>Hermes Hermes</p>')
    performScopedFind(surface, 'hermes', { forward: true, findNext: false })

    const before = [...findMatchRanges()]
    const result = performScopedFind(surface, 'hermes', { forward: true, findNext: true })
    const after = [...findMatchRanges()]

    expect(after.every((range, index) => range === before[index])).toBe(true)
    expect(result.count).toBe(2)
    expect(result.activeOrdinal).toBe(2)
  })

  it('re-collects after content changed under the open search (#81778 review)', async () => {
    // A live search must cover the CURRENT text, not the text it saw when the
    // query was typed: streamed deltas and appended messages add occurrences.
    const surface = plantSurface('surface', '<p>hermes</p>')
    captureFindScope()
    performScopedFind(surface, 'hermes', { forward: true, findNext: false })
    expect(hitsIn(surface)).toBe(1)

    surface.querySelector('p')!.textContent = 'beta'
    surface.insertAdjacentHTML('beforeend', '<p>hermes</p>')
    await flushMutations()

    const result = performScopedFind(surface, 'hermes', { forward: true, findNext: true })

    expect(result.count).toBe(1)
    expect(hitTexts()).toEqual(['hermes'])
  })

  it('picks up content appended after the last search', async () => {
    const surface = plantSurface('surface', '<p>needle</p>')
    captureFindScope()
    performScopedFind(surface, 'needle', { forward: true, findNext: false })
    expect(hitsIn(surface)).toBe(1)

    surface.insertAdjacentHTML('beforeend', '<p>needle</p>')
    await flushMutations()

    performScopedFind(surface, 'needle', { forward: true, findNext: true })

    expect(hitsIn(surface)).toBe(2)
    expect(hitTexts()).toEqual(['needle', 'needle'])
  })

  it('re-collects when the query changes', () => {
    const surface = plantSurface('surface', '<p>alpha beta alpha</p>')
    const markup = surface.innerHTML
    performScopedFind(surface, 'alpha', { forward: true, findNext: false })
    expect(hitsIn(surface)).toBe(2)

    performScopedFind(surface, 'beta', { forward: true, findNext: false })

    expect(hitTexts()).toEqual(['beta'])
    expect(surface.innerHTML).toBe(markup)
    expect(surface.querySelector('p')?.textContent).toBe('alpha beta alpha')
  })

  it('ignores text inside the FindBar search input itself (no self-match)', () => {
    // The walker skips any subtree that carries role="search" so a user
    // typing "needle" never matches the placeholder text in the input.
    const surface = plantSurface('surface', '')

    surface.innerHTML = `
      <div role="search"><input placeholder="needle placeholder" /></div>
      <p>needle haystack</p>
    `

    const result = performScopedFind(surface, 'needle', { forward: true, findNext: false })

    expect(result.count).toBe(1)
    expect(hitsIn(surface)).toBe(1)
    // The match lives inside the <p>, not inside the search overlay.
    expect(findMatchRanges()[0].startContainer.parentElement?.closest('p')).toBeTruthy()
  })

  it('does not match inside <script> / <style> nodes', () => {
    const surface = plantSurface('surface', '')

    surface.innerHTML = `
      <script>const needle = 'literal'</script>
      <style>.needle { color: red }</style>
      <p>needle visible</p>
    `

    const result = performScopedFind(surface, 'needle', { forward: true, findNext: false })

    expect(result.count).toBe(1)
    expect(hitTexts()).toEqual(['needle'])
    expect(findMatchRanges()[0].startContainer.parentElement?.tagName).toBe('P')
  })

  it('searches sibling subtrees after a text node that ends exactly on a match', () => {
    // Regression (#81778 review): a text node fully consumed by a match used to
    // terminate the walk and skip its following siblings —
    // `<div>needle<span>needle</span></div>` matched only the first.
    const surface = plantSurface('surface', '<div>needle<span>needle</span></div><p>needle</p>')

    const result = performScopedFind(surface, 'needle', { forward: true, findNext: false })

    expect(result.count).toBe(3)
    expect(hitsIn(surface)).toBe(3)
  })
})

describe('scope lifecycle', () => {
  it('captureFindScope marks the foreground surface for the walker', () => {
    const surface = plantSurface('surface', 'needle')
    captureFindScope()

    expect(currentFindScope()).toBe(surface)
    expect(surface.hasAttribute('data-find-root')).toBe(true)
  })

  it('releaseFindScope drops every highlight and the scope marker', () => {
    const surface = plantSurface('surface', '<p>needle in a haystack</p>')
    captureFindScope()
    performScopedFind(surface, 'needle', { forward: true, findNext: false })
    expect(hitsIn(surface)).toBe(1)

    releaseFindScope()

    expect(findMatchRanges()).toHaveLength(0)
    expect(surface.querySelector('[data-find-root]')).toBeNull()
    expect(currentFindScope()).toBeNull()
    // Original text still intact.
    expect(surface.querySelector('p')?.textContent).toBe('needle in a haystack')
  })

  it('keeps the scope targeting the FOREGROUND surface even when a hidden one matches the selector first', () => {
    // Regression (#81726): the visible chat is the SECOND surface in
    // document order, but it must still win the scope resolution.
    plantSurface('background', '<p>background needle</p>', true)
    const foreground = plantSurface('foreground', '<p>foreground needle</p>')

    captureFindScope()
    expect(currentFindScope()).toBe(foreground)

    const result = performScopedFind(foreground, 'needle', { forward: true, findNext: false })
    expect(result.count).toBe(1)
  })

  it('re-targets the scope to the foreground surface after a keep-alive flip hides the captured one', () => {
    // Regression (#81726): the bar stays open across a tab flip (the route
    // doesn't change, so the FindBar's pathname cleanup never runs). The
    // captured surface's pane layer goes `data-pane-hidden` and the flipped-
    // to surface is left unmarked — currentFindScope must re-resolve to the
    // new foreground surface instead of going dead (0/0 forever).
    const a = plantSurface('a', '<p>needle in A</p>')
    const b = plantSurface('b', '<p>needle in B</p>')

    captureFindScope()
    expect(currentFindScope()).toBe(a)
    expect(a.hasAttribute('data-find-root')).toBe(true)

    // Keep-alive tab flip: A's pane layer hides, B becomes the foreground.
    a.setAttribute('data-pane-hidden', '')

    const scope = currentFindScope()

    // The scope re-targeted to B and the marker moved with it.
    expect(scope).toBe(b)
    expect(b.hasAttribute('data-find-root')).toBe(true)
    expect(a.hasAttribute('data-find-root')).toBe(false)

    // The walker searches the new surface — and the old one is left clean.
    const result = performScopedFind(scope!, 'needle', { forward: true, findNext: false })

    expect(result.count).toBe(1)
    expect(hitsIn(b)).toBe(1)
    expect(hitsIn(a)).toBe(0)
  })

  it('re-targeting drops the previous surface highlights', () => {
    const a = plantSurface('a', '<p>needle in A</p>')
    plantSurface('b', '<p>needle in B</p>')

    captureFindScope()
    performScopedFind(a, 'needle', { forward: true, findNext: false })
    expect(hitsIn(a)).toBe(1)

    a.setAttribute('data-pane-hidden', '')
    const scope = currentFindScope()

    // Re-targeting clears the paint: the hidden surface must not carry stray
    // highlights into its next visit.
    expect(findMatchRanges()).toHaveLength(0)
    expect(hitsIn(a)).toBe(0)
    expect(scope?.id).toBe('b')
  })

  it('re-targeting to a non-chat pane resolves to no scope (nothing on screen is a view)', () => {
    // The user flipped to a pane that isn't a chat surface — nothing to
    // search, matching the existing "no chat surface" contract. A later flip
    // back to a visible surface re-targets again.
    const a = plantSurface('a', 'needle')

    captureFindScope()
    a.setAttribute('data-pane-hidden', '')

    expect(currentFindScope()).toBeNull()
  })
})

describe('scoped find survives React re-render', () => {
  // The transcript is React-owned: assistant answers stream, and a new message
  // is appended whenever the assistant replies. A re-render replaces the text
  // nodes the ranges point at, so the scope watcher must re-collect. jsdom
  // delivers observer callbacks + our queueMicrotask re-collect as microtasks,
  // so awaiting a macrotask drains them all.
  it('re-collects content React re-allocated, keeping the active position', async () => {
    const surface = plantSurface('surface', '<p>needle hay needle</p>')

    captureFindScope()
    performScopedFind(surface, 'needle', { forward: true, findNext: false })
    expect(hitsIn(surface)).toBe(2)

    // Step onto match #2, then mock a React re-render that rebuilds the
    // paragraph while the matching text remains.
    performScopedFind(surface, 'needle', { forward: true, findNext: true })
    expect(findActiveRange()).toBe(findMatchRanges()[1])

    surface.querySelector('p')!.textContent = 'needle hay needle'
    await flushMutations()

    expect(hitsIn(surface)).toBe(2)
    expect(findActiveRange()).toBe(findMatchRanges()[1])
    expect(surface.querySelector('p')!.textContent).toBe('needle hay needle')
  })

  it('keeps existing highlights and finds a newly appended message', async () => {
    // The target scenario: the bar is open with highlights, then the assistant
    // appends a NEW message while the list stays mounted.
    const surface = plantSurface('surface', '<p>needle in the first message</p>')

    captureFindScope()
    performScopedFind(surface, 'needle', { forward: true, findNext: false })
    expect(hitsIn(surface)).toBe(1)

    const next = document.createElement('div')

    next.textContent = 'second message needle'
    surface.appendChild(next)
    await flushMutations()

    expect(hitsIn(surface)).toBe(2)
    expect(surface.querySelector('p')!.textContent).toBe('needle in the first message')
    expect(next.textContent).toBe('second message needle')
  })

  it('does not resurrect highlights after the query was cleared', async () => {
    const surface = plantSurface('surface', '<p>needle</p>')

    captureFindScope()
    performScopedFind(surface, 'needle', { forward: true, findNext: false })
    expect(hitsIn(surface)).toBe(1)

    // Clearing the query tears the watcher down; a later write that would
    // normally re-collect must NOT resurrect highlights (the bar is empty).
    performScopedFind(surface, '', { forward: true, findNext: false })
    surface.querySelector('p')!.textContent = 'needle again'
    await flushMutations()

    expect(findMatchRanges()).toHaveLength(0)
    expect(surface.querySelector('p')!.textContent).toBe('needle again')
  })

  it('releaseFindScope detaches the watcher so no write can re-highlight', async () => {
    const surface = plantSurface('surface', '<p>needle</p>')

    captureFindScope()
    performScopedFind(surface, 'needle', { forward: true, findNext: false })
    expect(hitsIn(surface)).toBe(1)

    releaseFindScope()
    surface.querySelector('p')!.textContent = 'needle needle'
    await flushMutations()

    expect(findMatchRanges()).toHaveLength(0)
  })
})

describe('highlight paint (CSS Custom Highlight API)', () => {
  function stubHighlightRegistry(): Map<string, { ranges: Range[] }> {
    const registry = new Map<string, { ranges: Range[] }>()

    class FakeHighlight {
      ranges: Range[] = []

      add(range: Range) {
        this.ranges.push(range)
      }
    }

    vi.stubGlobal('Highlight', FakeHighlight)
    vi.stubGlobal('CSS', {
      highlights: {
        delete: (name: string) => registry.delete(name),
        set: (name: string, highlight: { ranges: Range[] }) => registry.set(name, highlight)
      }
    })

    return registry
  }

  it('hands every match and the active one to the registry', () => {
    const registry = stubHighlightRegistry()
    const surface = plantSurface('surface', '<p>needle hay needle</p>')

    performScopedFind(surface, 'needle', { forward: true, findNext: false })

    expect(registry.get('hermes-find-hit')?.ranges).toHaveLength(2)
    expect(registry.get('hermes-find-active')?.ranges).toEqual([findActiveRange()])
  })

  it('moves the active entry when the user steps, without recollecting', () => {
    const registry = stubHighlightRegistry()
    const surface = plantSurface('surface', '<p>needle needle</p>')

    performScopedFind(surface, 'needle', { forward: true, findNext: false })
    const hits = registry.get('hermes-find-hit')?.ranges ?? []

    performScopedFind(surface, 'needle', { forward: true, findNext: true })

    expect(registry.get('hermes-find-active')?.ranges).toEqual([findMatchRanges()[1]])
    // Same range objects — stepping moved the active index, it did not
    // re-collect the match set.
    expect(registry.get('hermes-find-hit')?.ranges[0]).toBe(hits[0])
    expect(registry.get('hermes-find-hit')?.ranges[1]).toBe(hits[1])
  })

  it('clears both entries when the search is released', () => {
    const registry = stubHighlightRegistry()
    const surface = plantSurface('surface', '<p>needle</p>')

    captureFindScope()
    performScopedFind(surface, 'needle', { forward: true, findNext: false })
    expect(registry.size).toBe(2)

    releaseFindScope()

    expect(registry.size).toBe(0)
  })
})
