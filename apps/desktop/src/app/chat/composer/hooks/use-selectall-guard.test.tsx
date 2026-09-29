import { render } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSelectAllGuard } from './use-selectall-guard'

function Harness(): null {
  useSelectAllGuard()
  return null
}

/** Fake an active element — jsdom ignores focus() on plain contenteditable divs. */
function setActiveElement(el: HTMLElement | null): void {
  Object.defineProperty(document, 'activeElement', {
    configurable: true,
    get: () => el,
  })

  // jsdom does not implement isContentEditable; the guard (like Chromium)
  // treats a contenteditable host as an editable field.
  if (el) {
    Object.defineProperty(el, 'isContentEditable', {
      configurable: true,
      get: () => el.contentEditable === 'true',
    })
  }
}

function mountGuard(): void {
  render(<Harness />)
}

/** Dispatch a keydown on document with the given modifiers. */
function fireKey(key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  })

  document.dispatchEvent(event)

  return event
}

function selectableText(): string {
  return window.getSelection()?.toString() ?? ''
}

function makeComposer(): HTMLElement {
  const input = document.createElement('div')
  input.dataset.slot = 'composer-rich-input'
  input.contentEditable = 'true'
  input.textContent = 'draft text'

  document.body.appendChild(input)

  return input
}

function makeSurface(): HTMLElement {
  const surface = document.createElement('div')
  surface.dataset.chatSurface = ''
  const message = document.createElement('div')
  message.dataset.slot = 'aui_assistant-message-content'
  message.textContent = 'hello world'

  surface.appendChild(message)
  document.body.appendChild(surface)

  return surface
}

/** Non-chat selectable pane — e.g. the preview rail's markdown/source view. */
function makePreviewDocument(): HTMLElement {
  const pane = document.createElement('div')
  pane.dataset.selectableText = 'true'
  pane.textContent = 'previewed source code line 1\npreviewed line 2'

  document.body.appendChild(pane)

  return pane
}

afterEach(() => {
  document.body.innerHTML = ''
  setActiveElement(document.body)
})

describe('useSelectAllGuard', () => {
  it('registers capture-phase listeners and cleans up on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = render(<Harness />)

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(addSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true)

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true)
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true)
  })

  it('lets Ctrl+A pass through natively when focus is inside the composer input', () => {
    const input = makeComposer()
    setActiveElement(input)

    mountGuard()

    const event = fireKey('a', { ctrl: true })

    expect(event.defaultPrevented).toBe(false)
  })

  it('selects the message containers when focus is outside the composer', () => {
    mountGuard()

    makeSurface()
    setActiveElement(document.body)

    const event = fireKey('a', { ctrl: true })

    expect(event.defaultPrevented).toBe(true)
    expect(selectableText()).toContain('hello world')
  })

  it('selects the transcript instead of the input after clicking a message', () => {
    mountGuard()

    const surface = makeSurface()
    const input = makeComposer()

    // User clicked the message (pointerdown outside the composer) — hover-focus
    // then stole focus back into the input, so activeElement IS the editable.
    surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    setActiveElement(input)

    const event = fireKey('a', { ctrl: true })

    expect(event.defaultPrevented).toBe(true)
    expect(selectableText()).toContain('hello world')
  })

  it('keeps native editable select-all when the user typed in the input first', () => {
    mountGuard()

    const surface = makeSurface()
    const input = makeComposer()

    // User clicks into the input, then types a letter — editing intent.
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    setActiveElement(input)
    fireKey('h')

    const event = fireKey('a', { ctrl: true })

    expect(event.defaultPrevented).toBe(false)
  })

  it('does not clobber the outside-pointer record when the bare Ctrl key fires first', () => {
    mountGuard()

    const surface = makeSurface()
    const input = makeComposer()

    // User clicked a message; hover-focus returned focus to the input.
    surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    setActiveElement(input)

    // Real chord order: keydown for the bare Control fires before keydown 'a'.
    fireKey('Control', { ctrl: true })
    const event = fireKey('a', { ctrl: true })

    expect(event.defaultPrevented).toBe(true)
    expect(selectableText()).toContain('hello world')
  })

  it('selects a previewed document, not the chat, when the pointer is in the preview pane', () => {
    mountGuard()

    const surface = makeSurface()
    const pane = makePreviewDocument()

    // User clicked inside the previewed document (non-chat selectable pane).
    pane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))
    setActiveElement(document.body)

    const event = fireKey('a', { ctrl: true })

    expect(event.defaultPrevented).toBe(true)
    expect(selectableText()).toContain('previewed source code line 1')
    expect(selectableText()).toContain('previewed line 2')
    // The chat transcript stays OUT of the selection.
    expect(selectableText()).not.toContain('hello world')
    // And the chat surface still exists for the chat-side cases.
    expect(surface.isConnected).toBe(true)
  })

  it('lets Ctrl+A pass through natively when focus is an editable inside a preview pane', () => {
    mountGuard()

    // A non-chat selectable pane holding its own editable (spot-editor).
    const pane = makePreviewDocument()
    const editor = document.createElement('textarea')
    editor.value = 'editor content'
    pane.appendChild(editor)
    setActiveElement(editor)

    const event = fireKey('a', { ctrl: true })

    // Native select-all inside the pane's own editable — the guard does not sweep chat.
    expect(event.defaultPrevented).toBe(false)
    expect(selectableText()).toBe('')
  })
})
