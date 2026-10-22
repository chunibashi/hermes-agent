import { expect, test } from 'vitest'

import {
  CODE_SKEW_AUTO_RESTART_COOLDOWN_MS,
  createCodeSkewAutoRestart,
  isCodeSkewRestartRequiredError
} from './backend-recycle'

// The exact shape the renderer sees when the backend answers a code-skew 503
// (mirrored from apps/desktop/src/lib/code-skew-error.test.ts).
const SKEW_503 = new Error(
  'Error invoking remote method \'hermes:api\': Error: 503: {"detail":"Restart required: This process is running code from 08b4875f4a but the checkout on disk is now 48d2528066."}'
)

test('the code-skew 503 is recognised, plain failures are not', () => {
  expect(isCodeSkewRestartRequiredError(SKEW_503)).toBe(true)
  expect(isCodeSkewRestartRequiredError('Restart required: checkout drifted')).toBe(true)
  expect(isCodeSkewRestartRequiredError(new Error('503: Service Unavailable'))).toBe(false)
  expect(isCodeSkewRestartRequiredError(new Error('Failed to load models'))).toBe(false)
  expect(isCodeSkewRestartRequiredError(null)).toBe(false)
  expect(isCodeSkewRestartRequiredError(undefined)).toBe(false)
})

test('the first skew 503 restarts once, a concurrent one is ignored while in flight', async () => {
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const restarted: string[] = []
  const trigger = createCodeSkewAutoRestart(
    async profile => {
      restarted.push(profile)
      await gate
    },
    () => undefined,
    { cooldownMs: CODE_SKEW_AUTO_RESTART_COOLDOWN_MS, now: () => 0 }
  )

  expect(trigger('default')).toBe(true)
  expect(trigger('default')).toBe(false) // same episode, restart still running

  release()
  await gate
  expect(restarted).toEqual(['default'])
})

test('after the restart settles, a fresh 503 inside the cooldown is still ignored', async () => {
  let now = 1_000
  const restarted: string[] = []
  const trigger = createCodeSkewAutoRestart(
    async profile => {
      restarted.push(profile)
    },
    () => undefined,
    { cooldownMs: 60_000, now: () => now }
  )

  expect(trigger('default')).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 0)) // settle the in-flight promise
  now = 30_000
  expect(trigger('')).toBe(false) // cooldown still active
  expect(restarted).toEqual(['default'])
})

test('a skew 503 after the cooldown restarts again', async () => {
  let now = 0
  const restarted: string[] = []
  const trigger = createCodeSkewAutoRestart(
    async profile => {
      restarted.push(profile)
    },
    () => undefined,
    { cooldownMs: 60_000, now: () => now }
  )

  expect(trigger('work')).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  now = 60_001
  expect(trigger('work')).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(restarted).toEqual(['work', 'work'])
})

test('a failed restart is logged and does not block the next episode', async () => {
  const logs: string[] = []
  const trigger = createCodeSkewAutoRestart(
    async () => {
      throw new Error('gateway restart timed out')
    },
    message => logs.push(message),
    { cooldownMs: 60_000, now: () => 0 }
  )

  expect(trigger('default')).toBe(true)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(logs).toEqual([
    '[gateway] Backend answered a code-skew 503 (Restart required); restarting it to load the checkout on disk.',
    '[gateway] Code-skew auto-restart failed: Error: gateway restart timed out'
  ])
})
