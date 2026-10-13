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
 * - the traversal is bounded to MESSAGE containers inside the user's current
 *   chat surface. Every tab stays mounted (keep-alive) and hidden surfaces
 *   remain in the DOM, so walking `document.body` would burn thousands of
 *   `getComputedStyle` calls per keypress AND could anchor the range inside
 *   an invisible surface. Message containers are the `user-select: text`
 *   regions by CSS contract; chrome (sidebar, rails, hidden tabs, the
 *   floating composer host) is excluded exactly as native select-all
 *   excludes it.
 */
import { useEffect } from 'react'

/** Containers whose text is selectable by CSS contract (styles.css). */
const MESSAGE_SELECTOR = [
  '[data-slot="aui_user-message-root"]',
  '[data-slot="aui_assistant-message-content"]',
  '[data-slot="aui_system-message-root"]',
  '[data-selectable-text="true"]'
].join(', ')

/**
 * Non-chat document panes whose text the user may rightfully select: the
 * preview rail (markdown / source views toggled `data-selectable-text`),
 * settings panels, tool details. A Ctrl+A aimed at one of these must select
 * THAT pane, never the chat transcript. Chat surfaces are excluded here —
 * they are handled by `surfaceOf`, which is checked first.
 */
const DOCUMENT_SELECTOR = '[data-selectable-text="true"], [data-preview-markdown]'

/** First text node inside `el`, or null when the subtree has no text. */
function firstTextNode(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)

  let node: Node | null = walker.nextNode()

  while (node) {
    const text = node as Text

    if (text.textContent?.trim()) {
      return text
    }

    node = walker.nextNode()
  }

  return null
}

/** Last text node inside `el`, or null when the subtree has no text. */
function lastTextNode(el: Element): Text | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)

  let last: Text | null = null
  let node: Node | null = walker.nextNode()

  while (node) {
    const text = node as Text

    if (text.textContent?.trim()) {
      last = text
    }

    node = walker.nextNode()
  }

  return last
}

/**
 * Select the current surface's message text — the native Ctrl+A equivalent.
 *
 * The range runs from the first text node of the FIRST message container to
 * the last text node of the LAST one (document order). Intermediate UI
 * (timestamps, action bars) is included in the range exactly like native
 * select-all includes it; Chromium copies only the selectable text.
 *
 * When `root` ITSELF is a selectable pane (the preview rail's markdown /
 * source views, which carry `data-selectable-text`), that pane is its own
 * (only) container — the range spans its first→last text node, so Ctrl+A in
 * a previewed document selects that document, not the chat transcript.
 */
function selectAllSelectable(root: Element): void {
  const selection = window.getSelection()

  if (!selection) {
    return
  }

  // A selectable root doubles as its own container (no descendant matches).
  const containers = [...root.querySelectorAll<Element>(MESSAGE_SELECTOR)]
  const allContainers = root.matches(MESSAGE_SELECTOR) ? [root, ...containers] : containers

  if (allContainers.length === 0) {
    selection.removeAllRanges()
    selection.selectAllChildren(root)

    return
  }

  const first = firstTextNode(allContainers[0])
  const last = lastTextNode(allContainers[allContainers.length - 1])

  selection.removeAllRanges()

  if (!first || !last) {
    selection.selectAllChildren(root)

    return
  }

  const range = document.createRange()

  range.setStart(first, 0)
  range.setEnd(last, last.textContent?.length ?? 0)
  selection.addRange(range)
}

/** The chat surface a given element belongs to, or null. */
function surfaceOf(el: Element | null): Element | null {
  return el?.closest('[data-chat-surface]') ?? null
}

export function useSelectAllGuard(): void {
  useEffect(() => {
    // The composer's hover-focus returns focus to the input after the user
    // clicks anywhere in the transcript, so `document.activeElement` alone
    // cannot tell "user is editing" from "user clicked a message and
    // focus-follow yanked the caret back into the input". Track the last
    // pointer gesture: Ctrl+A after clicking a message must select the
    // document, not the input's own content; Ctrl+A while the user's last
    // gesture was inside the input (or they are typing) keeps the native
    // editable select-all.
    //
    // Starts true when the input already holds focus at mount (hover-focus
    // default): a user who never clicked anywhere gets the native editable
    // select-all, matching where the caret already sits. Only a click
    // OUTSIDE the input flips it; hover-focus moving the caret into the
    // composer is not a user gesture and must not flip it.
    let lastPointerInComposer = document.activeElement?.closest?.('[data-slot="composer-rich-input"]') !== null
    // The surface the last pointer gesture landed in — the select-all scope.
    // Null until the first pointerdown; resolved lazily at keypress.
    let lastPointerSurface: Element | null = surfaceOf(document.activeElement)

    // When the pointer landed in a NON-chat document pane (preview rail, a
    // previewed markdown/source view), that pane is the select-all scope —
    // Ctrl+A there selects the document, never the chat transcript. Seeded
    // from the mount-time active element's pane (if any) so TypeScript's
    // narrowed-flow analysis sees a potentially-non-null value outside the
    // pointerdown closure (it cannot track `let` writes from another handler).
    const mountPane =
      document.activeElement instanceof Element && !surfaceOf(document.activeElement)
        ? (document.activeElement.closest<Element>(DOCUMENT_SELECTOR) ?? null)
        : null

    let lastPointerDocument: Element | null = mountPane

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null

      lastPointerSurface = surfaceOf(target)
      lastPointerInComposer = Boolean(target?.closest('[data-slot="composer-rich-input"]'))
      // A pointerdown inside a chat surface selects chat (surface above); a
      // pointerdown in any other selectable pane marks the preview/panel as the
      // document scope. Avoid matching chat internals that happen to carry
      // `data-selectable-text` (inline log panels) — the surface check wins.
      lastPointerDocument = target && !lastPointerSurface ? (target.closest<Element>(DOCUMENT_SELECTOR) ?? null) : null
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const isSelectAll =
        (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a'

      const active = document.activeElement

      const inEditable =
        active instanceof HTMLElement &&
        (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')

      if (!isSelectAll) {
        // A keystroke while the input holds focus means the user is actively
        // editing it — the next Ctrl+A selects the input's own content (the
        // native behavior). EXCEPT command chords (Ctrl/Meta/Alt held): the
        // bare modifier keydown fires BEFORE the chord's letter, and treating
        // that as "editing" would clobber the pointer-gesture record — the
        // user who clicked a message, then pressed Ctrl+A, would lose the
        // "clicked outside" signal and get the input selected instead.
        if (inEditable && !event.ctrlKey && !event.metaKey && !event.altKey) {
          lastPointerInComposer = true
        }

        return
      }

      if (inEditable && lastPointerInComposer) {
        return
      }

      // The user's attention is NOT the chat: either they hold focus outside a
      // chat surface (a previewed document's own editor/text field — native
      // select-all there is correct), or the last pointer gesture landed in a
      // non-chat document pane (preview markdown/source). In BOTH cases the
      // guard must not sweep the chat transcript. The composer itself is chat
      // chrome (hover-focus steals it when the user clicks a message) — never
      // mistake it for a foreign editable.
      const activeInComposer = active?.closest?.('[data-slot="composer-rich-input"]') != null

      if (inEditable && !activeInComposer && !surfaceOf(active)) {
        return
      }

      // Focus is in the transcript, or the user's last gesture was inside a
      // non-chat document pane — block Chromium's auto-focus into the
      // composer and select the text content of the right scope directly.
      event.preventDefault()
      event.stopImmediatePropagation()

      let root: Element | null = null

      if (lastPointerDocument) {
        root = lastPointerDocument
      } else if (lastPointerSurface) {
        root = lastPointerSurface
      } else if (active instanceof Element && !surfaceOf(active)) {
        // Keyboard navigation: focus (not a pointer gesture) may sit inside a
        // non-chat selectable pane — scope to it before falling back to chat.
        root = active.closest<Element>(DOCUMENT_SELECTOR)
      }

      selectAllSelectable(
        root ?? document.querySelector('[data-chat-surface]:not([data-chat-unfocused])') ?? document.body
      )
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])
}
