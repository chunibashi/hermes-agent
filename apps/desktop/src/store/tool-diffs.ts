import { atom, computed, type ReadableAtom } from 'nanostores'

const $toolDiffs = atom<Record<string, string>>({})

// Per-tool derived atoms, cached by toolCallId. A `ToolEntry` subscribes only
// to its own id's diff, so recording a diff for one tool re-renders that one
// row -- not every mounted tool row. computed() only notifies when the derived
// string actually changes, so unrelated writes to the map are inert here.
const inlineDiffCache = new Map<string, ReadableAtom<string>>()

export function recordToolDiff(toolCallId: string, diff: string) {
  if (!toolCallId || !diff) {
    console.log("[tool-diffs] recordToolDiff skipped: empty id or diff", { toolCallId, diffLen: diff?.length })
    return
  }

  const current = $toolDiffs.get()

  if (current[toolCallId] === diff) {
    return
  }

  console.log("[tool-diffs] recordToolDiff storing", { toolCallId, diffLen: diff.length, currentKeys: Object.keys(current) })
  $toolDiffs.set({ ...current, [toolCallId]: diff })
}

export function logToolDiffState() {
  console.log("[tool-diffs] current $toolDiffs keys:", Object.keys($toolDiffs.get()))
}

export function getToolDiff(toolCallId: string): string {
  return toolCallId ? $toolDiffs.get()[toolCallId] || '' : ''
}

export function $toolInlineDiff(toolCallId: string): ReadableAtom<string> {
  let cached = inlineDiffCache.get(toolCallId)

  if (!cached) {
    cached = computed($toolDiffs, diffs => (toolCallId ? diffs[toolCallId] || '' : ''))
    inlineDiffCache.set(toolCallId, cached)
  }

  return cached
}
