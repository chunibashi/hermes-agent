import { JsonRpcGatewayClient } from '@hermes/shared'
import { afterEach, expect, test, vi } from 'vitest'

import { HermesGateway } from './client'

afterEach(() => { vi.restoreAllMocks() })

// Every request the desktop issues while serving `method`, with the budget it handed the channel.
// `session.resume` projects a whole stored transcript on the backend (1-9 s measured on an ordinary
// local conversation, more while a compaction holds the store), so a 30 s deadline expired on a
// healthy backend about to answer and the open retried from scratch ("request timed out after 30s:
// session.resume"). The shared channel's own default is 120 s.
async function budgets(method: string, params: Record<string, unknown> = {}, explicit?: number) {
  vi.spyOn(Date, 'now').mockReturnValue(1_000)
  vi.spyOn(JsonRpcGatewayClient.prototype, 'connect').mockResolvedValue()
  const calls: Array<{ method: string; timeout?: number }> = []

  vi.spyOn(JsonRpcGatewayClient.prototype, 'request').mockImplementation(async (name, _params, timeout) => {
    calls.push({ method: name, timeout })

    return { session_id: 's', messages: [], info: {}, revision: 1, execution_generation: 2 } as never
  })
  const client = new HermesGateway()

  await client.connect('ws://localhost/api/ws?native_dial=fixture&ticket=fixture')

  try { await client.request(method, params, explicit) } catch { /* the budget is what this reads */ }

  client.close()

  return calls
}

test('a session resume gets the shared channel budget, not the 30s read default', async () => {
  const calls = await budgets('session.resume', { session_id: 's' })

  expect(calls.length).toBeGreaterThan(0)
  expect(calls.every(call => call.timeout === 120_000)).toBe(true)
})

test('a control answer survives the queue behind a slow read', async () => {
  const calls = await budgets('session.interrupt', { session_id: 's' })

  expect(calls.length).toBeGreaterThan(0)
  expect(calls.every(call => call.timeout === 60_000)).toBe(true)
})

test('reads that must answer now keep the 30s default', async () => {
  const calls = await budgets('session.list', {})

  expect(calls.length).toBeGreaterThan(0)
  expect(calls.every(call => call.timeout === 30_000)).toBe(true)
})

test('an explicit caller budget still wins over both tables', async () => {
  const calls = await budgets('session.resume', { session_id: 's' }, 5_000)

  expect(calls.length).toBeGreaterThan(0)
  expect(calls.every(call => call.timeout === 5_000)).toBe(true)
})