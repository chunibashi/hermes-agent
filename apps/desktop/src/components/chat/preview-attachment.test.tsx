import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PreviewAttachment } from '@/components/chat/preview-attachment'

const TARGET = 'C:\\Users\\kurumi\\Downloads\\malsync-auto-start-yes.user.js'

// The card resolves relative/absolute paths against the session cwd; give it a
// fixed one so the copied value is deterministic.
vi.mock('@/app/chat/session-view', () => ({
  useSessionView: () => ({ $cwd: atom('D:\\proj') })
}))

describe('PreviewAttachment copy-path button', () => {
  const originalDesktop = window.hermesDesktop

  beforeEach(() => {
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { writeClipboard: vi.fn(async () => {}) }
    })
  })

  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: originalDesktop
    })
    vi.restoreAllMocks()
  })

  it('copies the absolute path for an absolute Windows MEDIA target', async () => {
    const writeClipboard = window.hermesDesktop?.writeClipboard as ReturnType<typeof vi.fn>

    render(<PreviewAttachment target={TARGET} />)

    const button = screen.getByRole('button', { name: 'Copy path' })
    button.click()

    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith(TARGET))
  })

  it('resolves a relative target against the session cwd before copying', async () => {
    const writeClipboard = window.hermesDesktop?.writeClipboard as ReturnType<typeof vi.fn>

    render(<PreviewAttachment target="notes.md" />)

    const button = screen.getByRole('button', { name: 'Copy path' })
    button.click()

    await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith('D:/proj/notes.md'))
  })

  it('flips to the "Path copied" label after a successful copy', async () => {
    render(<PreviewAttachment target={TARGET} />)

    const button = screen.getByRole('button', { name: 'Copy path' })
    button.click()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Path copied' })).toBeTruthy())
  })
})