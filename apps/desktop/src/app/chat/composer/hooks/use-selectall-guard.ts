/**
 * Select-all guard — stops Chromium from stealing Ctrl+A into the composer.
 *
 * Electron's browser shim auto-focuses the first focusable element on Ctrl+A.
 * With a composer input mounted (even `tabIndex={-1}`), that means the caret
 * jumps into the editor and the user's select-all collapses to an insertion
 * point before they can copy.
 *
 * Capture-phase intercept: if focus is NOT already in an editable field when
 * Ctrl+A fires, prevent the default focus-shift and run selectAll manually.
 *
 * The manual select maps to the SAME semantic as the native command:
 *
 * - it selects a SINGLE range whose boundaries sit on text nodes (the first
 *   and last selectable text node), spanning everything between — this is
 *   what Chromium's own Ctrl+A produces, and it is what Ctrl+C / right-click
 *   Copy can serialize. A range that starts/ends on an ELEMENT node (as
 *   `selectAllChildren(document.body)` produces) makes Chromium treat the
 *   copy as empty/failed.
 * - selectability is read from each text node's parent computed style —
 *   `getComputedStyle` already folds in user-select propagation, so chrome
 *   (sidebar, buttons, rails, hidden tabs, the floating composer host) is
 *   excluded exactly as native select-all excludes it, WITHOUT walking the
 *   ancestor chain (that walk would wrongly hit body's user-select:none).
 */
import { useEffect } from 'react'

/** True when the text node's parent is not opted out of selection. */
function isSelectableTextNode(text: Text): boolean {
  const parent = text.parentElement

  if (!parent || !text.textContent) {
    return false
  }

  const style = window.getComputedStyle(parent)
  const userSelect = style.userSelect || style.webkitUserSelect || ''

  return userSelect !== 'none'
}

/** Select the document's selectable text — the native Ctrl+A equivalent. */
function selectAllSelectable(): void {
  const selection = window.getSelection()

  if (!selection) {
    return
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const selectable: Text[] = []

  let node: Node | null = walker.nextNode()

  while (node) {
    const text = node as Text

    if (isSelectableTextNode(text)) {
      selectable.push(text)
    }

    node = walker.nextNode()
  }

  selection.removeAllRanges()

  if (selectable.length === 0) {
    // No selectable text at all — fall back to the whole document so the
    // keyboard gesture still does something visible.
    selection.selectAllChildren(document.body)

    return
  }

  // One contiguous range from the first selectable text node to the last.
  // Text-node boundaries keep the selection serializable by Chromium's copy
  // pipeline; intermediate non-selectable nodes are fine (native Ctrl+A
  // includes them in the range too, copying only the selectable text).
  const first = selectable[0]
  const last = selectable[selectable.length - 1]
  const range = document.createRange()

  range.setStart(first, 0)
  range.setEnd(last, last.textContent?.length ?? 0)
  selection.addRange(range)
}

export function useSelectAllGuard(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a')) {
        return
      }

      const active = document.activeElement
      const inEditable =
        active instanceof HTMLElement &&
        (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')

      if (inEditable) {
        return
      }

      // Focus is in the transcript (or nowhere editable) — block Chromium's
      // auto-focus into the composer and select the text content directly.
      event.preventDefault()
      event.stopImmediatePropagation()

      selectAllSelectable()
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
}