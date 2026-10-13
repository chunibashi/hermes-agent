import { describe, expect, it } from 'vitest'

import { preserveLocalAssistantErrors } from './chat-messages/reconciliation'
import type { ChatMessage, ChatMessagePart } from './chat-messages/types'

// Mid-turn `sessions.changed` lands while the turn is still streaming: the
// persisted assistant row has [reasoning1, tool-call] but the live bubble
// already carries [reasoning1, tool-call, reasoning2]. The stored↔live match
// pairs them via the shared tool-call id, and part pairing must line up
// reasoning1↔reasoning1 / tool↔tool — never reasoning2↔tool by index. If it
// did, the live sealed boundaries (completedAt) get dropped, the remounted
// disclosure restarts its timer, and the measured label degrades — the
// "思考了片刻/思考了 Ns → 已思考" flip reproduced live over CDP (deepseek-relay
// tool-call turn, session 20260915_072200_dedbe9).
describe('mid-turn reconcile: stored [r1, tool] vs live [r1, tool, r2]', () => {
  const R1 = 'The user says hello; I must load the persona skill first.'
  const R2 = 'Skill loaded; now respond as the character warmly.'
  const TOOL_ID = 'call_tqgt0059pgqnvbwsrfrkcu88'

  const userRow: ChatMessage = {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: '你好', timestamp: 1000 }],
    timestamp: 1000
  }

  const storedBubble: ChatMessage = {
    id: '1001-1-assistant',
    role: 'assistant',
    parts: [
      { type: 'reasoning', text: R1, timestamp: 1001 },
      { type: 'tool-call', toolCallId: TOOL_ID, toolName: 'skill_view', args: {}, argsText: '{}', timestamp: 1001 }
    ],
    timestamp: 1001
  }

  const liveBubble: ChatMessage = {
    id: 'assistant-stream-1',
    role: 'assistant',
    pending: true,
    parts: [
      { type: 'reasoning', text: R1, timestamp: 1001, completedAt: 1002, source: 'delta' },
      {
        type: 'tool-call',
        toolCallId: TOOL_ID,
        toolName: 'skill_view',
        args: {},
        argsText: '{}',
        result: true,
        timestamp: 1001,
        completedAt: 1002
      },
      { type: 'reasoning', text: R2, timestamp: 1003, completedAt: 1006, source: 'delta' }
    ] as ChatMessagePart[],
    timestamp: 1001
  }

  it('keeps the live id and the sealed reasoning boundaries', () => {
    const merged = preserveLocalAssistantErrors([userRow, storedBubble], [userRow, liveBubble])
    const assistant = merged.find(m => m.role === 'assistant')!

    expect(assistant.id).toBe('assistant-stream-1')
    const parts = assistant.parts as Array<{ type: string; completedAt?: number }>
    expect(parts.map(p => p.type)).toEqual(['reasoning', 'tool-call'])
    expect(parts[0].completedAt).toBe(1002)
  })

  it('pairs by identity when the stored row already carries the whole tail', () => {
    const storedFull: ChatMessage = {
      ...storedBubble,
      parts: [
        ...storedBubble.parts,
        { type: 'reasoning', text: R2, timestamp: 1003 } as ChatMessagePart,
        { type: 'text', text: '嗯……你好呀～', timestamp: 1007 } as ChatMessagePart
      ]
    }

    const liveFull: ChatMessage = {
      ...liveBubble,
      parts: [...liveBubble.parts, { type: 'text', text: '嗯……你好呀～', timestamp: 1007 } as ChatMessagePart]
    }

    const merged = preserveLocalAssistantErrors([userRow, storedFull], [userRow, liveFull])
    const assistant = merged.find(m => m.role === 'assistant')!
    const parts = assistant.parts as Array<{ type: string; completedAt?: number }>

    expect(assistant.id).toBe('assistant-stream-1')
    expect(parts.map(p => p.type)).toEqual(['reasoning', 'tool-call', 'reasoning', 'text'])
    expect(parts[0].completedAt).toBe(1002)
    expect(parts[2].completedAt).toBe(1006)
  })
})
