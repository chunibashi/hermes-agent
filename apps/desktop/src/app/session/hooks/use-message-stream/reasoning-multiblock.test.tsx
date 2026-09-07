import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClientSessionState } from '@/app/types'
import { clearSessionTodos } from '@/store/todos'

import { type MessageStreamHarness, renderMessageStream } from './test-harness'

const SID = 'session-1'

let stream: MessageStreamHarness

function mountStream() {
  stream = renderMessageStream(SID)
}

const start = () => act(() => stream.handleEvent({ payload: {}, session_id: SID, type: 'message.start' }))

const reasoning = (text: string) =>
  act(() =>
    stream.handleEvent({ payload: { text }, session_id: SID, type: 'reasoning.available' })
  )

const delta = (text: string) =>
  act(() => stream.handleEvent({ payload: { text }, session_id: SID, type: 'message.delta' }))

const interim = (text: string) =>
  act(() => stream.handleEvent({ payload: { text, already_streamed: true }, session_id: SID, type: 'message.interim' }))

const tool = (phase: 'running' | 'complete', name = 'search_files') =>
  act(() =>
    stream.handleEvent({
      payload: { name, tool_call_id: `tool-${name}-${phase}` },
      session_id: SID,
      type: phase === 'running' ? 'tool.start' : 'tool.complete'
    })
  )

const complete = (text: string) =>
  act(() => stream.handleEvent({ payload: { text }, session_id: SID, type: 'message.complete' }))

function getState(): ClientSessionState {
  return stream.state()
}

function allReasoningTexts(): string[] {
  return getState()
    .messages.filter(m => m.role === 'assistant')
    .flatMap(m => m.parts.filter(p => p.type === 'reasoning').map(p => p.text))
}

describe('reasoning.available across a multi-call turn (single-channel models)', () => {
  beforeEach(() => {
    clearSessionTodos(SID)
  })

  afterEach(() => {
    cleanup()
    clearSessionTodos(SID)
    vi.restoreAllMocks()
  })

  it('keeps the second thinking block when a tool call separates the two API calls', async () => {
    mountStream()
    await start()

    // API call 1: thinking + narration, then a tool call.
    await reasoning('think-1: 用户调用了 wiki-completion 技能')
    await delta('让我先加载技能')
    await interim('让我先加载技能')
    await tool('running')
    await tool('complete')

    // API call 2: fresh thinking block for the same turn.
    await reasoning('think-2: Let me understand the situation')
    await delta('查完了，现在处理')

    await complete('最终回复')

    const texts = allReasoningTexts()
    expect(texts.some(t => t.includes('think-2'))).toBe(true)
  })

  it('appends the second thinking block to the same message when no interim split it', async () => {
    mountStream()
    await start()

    await reasoning('think-1: first')
    // No delta/interim/tool between the two blocks — pure single-channel relay.
    await reasoning('think-2: second')

    await complete('done')

    const texts = allReasoningTexts()
    expect(texts.some(t => t.includes('think-2'))).toBe(true)
  })
})
