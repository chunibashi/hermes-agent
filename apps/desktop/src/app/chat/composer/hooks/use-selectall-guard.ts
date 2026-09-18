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
 */
import { useEffect } from 'react'

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
      // auto-focus into the composer and select the document body directly.
      event.preventDefault()
      event.stopImmediatePropagation()

      const selection = window.getSelection()
      if (selection) {
        selection.selectAllChildren(document.body)
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
}
