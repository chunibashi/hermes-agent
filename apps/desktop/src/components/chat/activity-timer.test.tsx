import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __clearTimerRegistriesForTests,
  __resetElapsedTimerRegistryForTests,
  __simulateReloadFromStorageForTests,
  reasoningContentKey,
  useElapsedSeconds,
  useMeasuredDuration
} from './activity-timer'

function Probe({ active, since, timerKey }: { active: boolean; since?: number; timerKey?: string }) {
  const elapsed = useElapsedSeconds(active, timerKey, since)

  return <span data-testid="elapsed">{elapsed}</span>
}

function DurationProbe({ active, contentKey, timerKey }: { active: boolean; contentKey?: string; timerKey: string }) {
  const measured = useMeasuredDuration(active, timerKey, contentKey)

  return <span data-testid="measured">{measured === null ? 'unknown' : measured}</span>
}

describe('useElapsedSeconds', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    __resetElapsedTimerRegistryForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    __resetElapsedTimerRegistryForTests()
  })

  it('keeps elapsed time stable across remounts for the same key', () => {
    const first = render(<Probe active timerKey="tool:abc" />)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(screen.getByTestId('elapsed').textContent).toBe('5')

    first.unmount()

    act(() => {
      vi.advanceTimersByTime(3_000)
    })

    render(<Probe active timerKey="tool:abc" />)

    expect(screen.getByTestId('elapsed').textContent).toBe('8')
  })

  it('counts from an explicit epoch rather than mount time', () => {
    const mountedAt = Date.now()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    render(<Probe active since={mountedAt + 28_000} />)

    expect(screen.getByTestId('elapsed').textContent).toBe('2')
  })

  it('re-anchors when the epoch moves', () => {
    const { rerender } = render(<Probe active since={Date.now()} />)

    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(screen.getByTestId('elapsed').textContent).toBe('10')

    rerender(<Probe active since={Date.now()} />)

    expect(screen.getByTestId('elapsed').textContent).toBe('0')
  })

  it('pauses UI ticks without focus and catches up immediately on return', () => {
    render(<Probe active timerKey="tool:background" />)
    vi.mocked(document.hasFocus).mockReturnValue(false)
    window.dispatchEvent(new Event('blur'))

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(screen.getByTestId('elapsed').textContent).toBe('0')

    vi.mocked(document.hasFocus).mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('focus')))
    expect(screen.getByTestId('elapsed').textContent).toBe('5')
  })
})

describe('useMeasuredDuration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    __resetElapsedTimerRegistryForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    __resetElapsedTimerRegistryForTests()
  })

  it('has nothing to report until it has watched something finish', () => {
    render(<DurationProbe active timerKey="reasoning:m1:0" />)

    act(() => {
      vi.advanceTimersByTime(4_000)
    })

    expect(screen.getByTestId('measured').textContent).toBe('unknown')
  })

  it('freezes the duration at the moment the thing finishes', () => {
    const { rerender } = render(<DurationProbe active timerKey="reasoning:m1:0" />)

    act(() => {
      vi.advanceTimersByTime(4_000)
    })

    rerender(<DurationProbe active={false} timerKey="reasoning:m1:0" />)

    expect(screen.getByTestId('measured').textContent).toBe('4')

    // Time keeps passing; the block is over and its duration must not creep up
    // with it.
    act(() => {
      vi.advanceTimersByTime(9_000)
    })

    expect(screen.getByTestId('measured').textContent).toBe('4')
  })

  // The thread virtualizes, so the component that watched a block finish is
  // usually gone by the time anyone scrolls back to read it.
  it('remembers the duration for a component that mounts after the fact', () => {
    const first = render(<DurationProbe active timerKey="reasoning:m1:0" />)

    act(() => {
      vi.advanceTimersByTime(6_000)
    })

    first.rerender(<DurationProbe active={false} timerKey="reasoning:m1:0" />)
    first.unmount()

    render(<DurationProbe active={false} timerKey="reasoning:m1:0" />)

    expect(screen.getByTestId('measured').textContent).toBe('6')
  })

  // The live message object is re-created on interim sealing / turn settle,
  // so the watching disclosure unmounts WITHOUT first seeing active=false.
  // The unmount cleanup must freeze the elapsed into the registry, or the
  // remounted block loses its measured duration and the label flips from
  // "thought briefly" to the untimed "thought".
  it('freezes the duration when unmounted while still watching', () => {
    const first = render(<DurationProbe active timerKey="reasoning:m1:0" />)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    first.unmount()

    render(<DurationProbe active={false} timerKey="reasoning:m1:0" />)

    expect(screen.getByTestId('measured').textContent).toBe('5')
  })

  it('measures each key separately', () => {
    const first = render(<DurationProbe active timerKey="reasoning:m1:0" />)

    act(() => {
      vi.advanceTimersByTime(3_000)
    })

    first.rerender(<DurationProbe active={false} timerKey="reasoning:m1:0" />)
    first.unmount()

    const second = render(<DurationProbe active timerKey="reasoning:m1:7" />)

    act(() => {
      vi.advanceTimersByTime(2_000)
    })

    second.rerender(<DurationProbe active={false} timerKey="reasoning:m1:7" />)

    expect(screen.getByTestId('measured').textContent).toBe('2')
  })

  it('records the real finish time even if the UI clock was paused', () => {
    const probe = render(<DurationProbe active timerKey="reasoning:background" />)
    vi.mocked(document.hasFocus).mockReturnValue(false)
    window.dispatchEvent(new Event('blur'))

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    probe.rerender(<DurationProbe active={false} timerKey="reasoning:background" />)

    expect(screen.getByTestId('measured').textContent).toBe('5')
  })

  // Reconciliation, re-hydration after a tab switch, or a settle-time store
  // rewrite can hand the identical sealed block a NEW message id. The freeze
  // ran under the old key, so a fresh mount under the new key must still
  // recover the duration from the content mirror — or the label degrades to
  // the untimed "thought" for a block the user watched being measured.
  it('recovers the duration when the message id changes but the text does not', () => {
    const text = 'The user says hello; I must load the persona skill first.'
    const contentKey = reasoningContentKey(text)
    const first = render(<DurationProbe active contentKey={contentKey} timerKey="reasoning:live-1:0" />)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    first.unmount()

    render(<DurationProbe active={false} contentKey={contentKey} timerKey="reasoning:stored-1001-1:0" />)

    expect(screen.getByTestId('measured').textContent).toBe('5')
  })

  // Streaming updates the text every token, so the content key churns with it.
  // The freeze at the end must land under the FINAL key and the recovery
  // lookup must find it there.
  it('freezes under the sealed text key when the id swap rides the same commit', () => {
    const partial = 'The user says hel'
    const sealed = 'The user says hello; I must load the persona skill first.'

    const probe = render(
      <DurationProbe active contentKey={reasoningContentKey(partial)} timerKey="reasoning:live-1:0" />
    )

    act(() => {
      vi.advanceTimersByTime(2_000)
    })

    probe.rerender(<DurationProbe active contentKey={reasoningContentKey(sealed)} timerKey="reasoning:live-1:0" />)

    act(() => {
      vi.advanceTimersByTime(3_000)
    })

    // The store swap and the settle land together: cleanup (old id) → mount
    // (new id, inactive, sealed text). Recovery must resolve to 5s, not null.
    probe.unmount()
    render(<DurationProbe active={false} contentKey={reasoningContentKey(sealed)} timerKey="reasoning:stored-2:0" />)

    expect(screen.getByTestId('measured').textContent).toBe('5')
  })

  // The duration exists nowhere in the backend — only this renderer watched
  // the block thinking. After an app restart the in-process registries are
  // empty; the storage mirror is the ONLY recovery source, so sealed
  // durations must be written through to it and reloaded by the next launch.
  it('survives an app restart via the storage mirror', () => {
    const text = 'The user says hello; I must load the persona skill first.'
    const contentKey = reasoningContentKey(text)
    const probe = render(<DurationProbe active contentKey={contentKey} timerKey="reasoning:live-1:0" />)

    act(() => {
      vi.advanceTimersByTime(4_000)
    })

    probe.rerender(<DurationProbe active={false} contentKey={contentKey} timerKey="reasoning:live-1:0" />)
    probe.unmount()

    // Simulated restart: memory forgets, storage survives, module re-loads.
    __clearTimerRegistriesForTests()
    __simulateReloadFromStorageForTests()

    render(<DurationProbe active={false} contentKey={contentKey} timerKey="reasoning:stored-3001-1:0" />)

    expect(screen.getByTestId('measured').textContent).toBe('4')
  })
})
