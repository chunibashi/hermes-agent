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
 * The manual select maps to the SAME semantic as the native command: it
 * selects the selectable text content of the document. It must NOT use
 * selectAllChildren(document.body) — that range includes every `user-select:
 * none` chrome node (sidebar, hidden tabs, the floating composer host), and
 * Chromium treats a "copy" of such a range as empty/failed. Instead, select
 * child-BY-child, walking text nodes and skipping non-selectable ones: the
 * selection then contains exactly what the native Ctrl+A would have selected
 * (message bodies, code blocks), and Ctrl+C / right-click Copy works.
 */
import { useEffect } from 'react'

/** True when the element (or its subtree) is not opted out of selection. */
function isSelectableElement(el: Element | null): boolean {
  if (!el) {
    return false
  }

  let node: Element | null = el

  while (node) {
    const style = window.getComputedStyle(node)
    const userSelect = style.userSelect || style.webkitUserSelect || ''

    if (userSelect === 'none') {
      return false
    }

    node = node.parentElement
  }

  return true
}

/** Select the document's selectable text — the native Ctrl+A equivalent. */
function selectAllSelectable(): void {
  const selection = window.getSelection()

  if (!selection) {
    return
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const ranges: Range[] = []

  let node: Node | null = walker.nextNode()

  while (node) {
    const text = node as Text
    const parent = text.parentElement

    if (text.textContent && isSelectableElement(parent)) {
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, text.textContent.length)
      ranges.push(range)
    }

    node = walker.nextNode()
  }

  selection.removeAllRanges()

  for (const range of ranges) {
    selection.addRange(range)
  }

  if (selection.rangeCount === 0) {
    // No selectable text at all — fall back to the whole document so the
    // keyboard gesture still does something visible.
    selection.selectAllChildren(document.body)
  }
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