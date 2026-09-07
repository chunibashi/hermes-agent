import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useRuntimeMessageRepository } from '@/app/chat/runtime-repository'
import type { ChatMessage } from '@/lib/chat-messages'
import { reasoningPart, textPart } from '@/lib/chat-messages'
import { useIncrementalExternalStoreRuntime } from '@/lib/incremental-external-store-runtime'

import { stubThreadEnvironment, stubThreadViewportSize } from '../test-utils'

import { Thread } from '.'

// # User scenario: deepseek-v4-flash (reasoning embedded in content <think>
// tags) runs a tool-using turn. Each API call's thinking arrives as one
// whole `reasoning.available` block; tool calls append to the same streaming
// message. The user's expected label timeline:
//
//   running:  [思考了片刻] [工具×5] [已思考]   (think-1 measured, think-2 whole)
//   settle:   [思考了片刻] [工具×5] [已思考]   (labels UNCHANGED)
//
// The pre-fix behavior was "思考了片刻" flickering to "已思考" on settle
// (the remount dropped the measured duration), and think-2 was DROPPED by
// the fill-only branch entirely.

const text = (value: string) => textPart(value, 1000)

const think1 = () => reasoningPart('think-1 用户调用了 wiki-completion 技能', 1000, 'delta')
const think2 = () => reasoningPart('think-2 Let me understand the situation', 2000, 'available')

interface Controls {
  /** think-1 finished, narration streamed, tools arrived. */
  arriveThink2: () => void
  /** Final reply landed, turn over. */
  settle: () => void
}

function Harness({ onControls }: { onControls?: (controls: Controls) => void } = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'user-1', role: 'user', parts: [text('完成 wiki 任务')] },
    // Phase 1: think-1 is the streaming message's only part — the live block.
    {
      id: 'assistant-stream-1',
      role: 'assistant',
      parts: [think1()],
      pending: true
    }
  ])

  const [busy, setBusy] = useState(true)
  const startedAt = useRef(Date.now())

  onControls?.({
    arriveThink2: () => {
      startedAt.current = Date.now()
      setMessages([
        { id: 'user-1', role: 'user', parts: [text('完成 wiki 任务')] },
        // Phase 2: narration + tools + the whole think-2 block appended
        // after them. think-1 is no longer the last part (complete, its
        // duration was measured while live); think-2 arrives already whole.
        {
          id: 'assistant-stream-1',
          role: 'assistant',
          parts: [
            think1(),
            text('让我先加载技能'),
            {
              type: 'tool-call',
              toolCallId: 'tool-1',
              toolName: 'search_files',
              args: {},
              argsText: '{}',
              result: { ok: true }
            },
            think2()
          ],
          pending: true
        }
      ])
    },
    settle: () => {
      setMessages([
        { id: 'user-1', role: 'user', parts: [text('完成 wiki 任务')] },
        {
          id: 'assistant-stream-1',
          role: 'assistant',
          parts: [
            think1(),
            text('让我先加载技能'),
            {
              type: 'tool-call',
              toolCallId: 'tool-1',
              toolName: 'search_files',
              args: {},
              argsText: '{}',
              result: { ok: true }
            },
            think2(),
            text('最终回复')
          ],
          pending: false,
          completedAt: Date.now() / 1000
        }
      ])
      setBusy(false)
    }
  })

  const repository = useRuntimeMessageRepository(messages)

  const runtime = useIncrementalExternalStoreRuntime({
    isRunning: busy,
    messageRepository: repository,
    onNew: async () => undefined
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  )
}

function labels(): string[] {
  return screen.getAllByRole('button', { name: /thinking|thought/i }).map(b => b.textContent ?? '')
}

describe('single-channel multi-block turn labels (production pipeline)', () => {
  beforeEach(() => {
    stubThreadEnvironment()
    stubThreadViewportSize()
  })

  it('keeps 思考了片刻 on the measured block and 已思考 on the whole block across settle', async () => {
    let controls: Controls | null = null

    render(<Harness onControls={c => (controls = c)} />)

    // Phase 1: think-1 is the live tail — reads "Thinking".
    await waitFor(() => {
      expect(labels()).toEqual(['Thinking'])
    })

    // Give the measured block ≥1s of watched wall-clock so the duration
    // label is the "Thought for Ns" form — deterministic regardless of how
    // long the framework took to render (a sub-second gap would also be a
    // measured label, but "briefly", which is timing-fragile under load).
    await new Promise(resolve => setTimeout(resolve, 1100))

    // Phase 2: think-1 finished being watched → a MEASURED label (its
    // duration came from watching it live); tools arrived; the whole
    // think-2 block appended (never timed → the untimed 已思考 label).
    act(() => controls!.arriveThink2())

    await waitFor(() => {
      const current = labels()
      expect(current.some(l => /^Thought for \d/.test(l))).toBe(true)
      expect(current.some(l => /^Thought$/.test(l))).toBe(true)
    })

    // Phase 3: settle. The measured block keeps its measured label; the
    // whole block keeps the untimed label. NO label flips.
    act(() => controls!.settle())

    await waitFor(() => {
      expect(labels().some(l => /^Thought for \d/.test(l))).toBe(true)
    })

    const after = labels()
    expect(after.some(l => /^Thought$/.test(l))).toBe(true)
  })
})
