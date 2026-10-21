import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { AccountUsage } from '../../src/core/claude-usage.ts'
import { emptyAccountUsage } from '../../src/core/usage.ts'
import { LoginTable } from '../../src/daemon/logins.ts'
import type { TokenSource } from '../../src/daemon/tokens.ts'
import { UsagePoller, type ProbeAnswer, type ProbeFunction } from '../../src/daemon/usage-poller.ts'
import { freshHome, writeLogins } from './harness.ts'

let home = ''
let invalidated: string[] = []
const source: TokenSource = {
  keychain: false,
  read: () => null,
  prime: () => Promise.resolve(),
  invalidate: (id) => { invalidated.push(id) },
  clear: () => undefined
}
const events: Array<{ event: string; fields: unknown }> = []

function usage(id: string, fiveHour: number, resetsAt: string | null = null): AccountUsage {
  return { ...emptyAccountUsage(id, Date.now()), rateLimitsAvailable: true, fiveHour: { utilization: fiveHour, resetsAt } }
}

function setup(probe: ProbeFunction, codex: ProbeFunction = probe): { table: LoginTable; poller: UsagePoller } {
  const table = new LoginTable({ tokens: source, log: { write: (event, fields) => { events.push({ event, fields }) } }, now: Date.now, stateWriteMs: 0 })
  table.load()
  const poller = new UsagePoller({ table, tokens: source, env: {}, log: { write: (event, fields) => { events.push({ event, fields }) } },
    now: Date.now, probeClaude: probe, probeCodex: codex, intervalMs: 50 })
  return { table, poller }
}

beforeEach(() => {
  home = freshHome()
  invalidated = []
  events.length = 0
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('a probe', () => {
  test('stores the usage and the sign-in, and makes the next token read look again', async () => {
    writeLogins({})
    const { table, poller } = setup((id) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 30) }))
    await poller.probe('claude:default', 'request')
    expect(table.usage('claude:default')?.fiveHour?.utilization).toBe(30)
    expect(table.probedSignedIn('claude:default')).toBe(true)
    expect(invalidated).toEqual(['claude:default'])
    expect(events.map((line) => line.event)).toEqual(expect.arrayContaining(['usage_probe_started', 'usage_probe_finished']))
  })

  test('that fails keeps the previous windows and records the error', async () => {
    writeLogins({})
    let answer: ProbeAnswer = { ok: true, signedIn: true, usage: usage('claude:default', 30) }
    const { table, poller } = setup(() => Promise.resolve(answer))
    await poller.probe('claude:default', 'request')
    answer = { ok: false, signedIn: null, reason: 'timeout', error: 'The probe timed out.' }
    await poller.probe('claude:default', 'request')
    expect(table.usage('claude:default')?.fiveHour?.utilization).toBe(30)
    expect(table.usage('claude:default')?.error).toBe('The probe timed out.')
    expect(table.probedSignedIn('claude:default')).toBe(true)
    expect(events.some((line) => line.event === 'usage_probe_failed')).toBe(true)
  })

  test('that fails with nothing before it records the error on an empty snapshot of the right provider', async () => {
    writeLogins({})
    const { table, poller } = setup(() => Promise.resolve({ ok: false, signedIn: false, reason: 'other', error: 'No.' }))
    await poller.probe('codex:default', 'request')
    expect(table.usage('codex:default')).toMatchObject({ provider: 'codex', error: 'No.' })
    expect(table.probedSignedIn('codex:default')).toBe(false)
  })

  test('runs once at a time per login; a second request waits for the running one', async () => {
    writeLogins({})
    let calls = 0
    let release: () => void = () => undefined
    const { poller } = setup((id) => {
      calls++
      return new Promise((resolve) => { release = () => { resolve({ ok: true, signedIn: true, usage: usage(id, 1) }) } })
    })
    const first = poller.probe('claude:default', 'request')
    const second = poller.probe('claude:default', 'stale')
    expect(poller.isRunning('claude:default')).toBe(true)
    release()
    await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(poller.isRunning('claude:default')).toBe(false)
  })

  test('ends a cooldown of unknown length at the reset it names', async () => {
    writeLogins({})
    const reset = new Date(Date.now() + 3_600_000).toISOString()
    const { table, poller } = setup((id) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 100, reset) }))
    table.setCooldown('claude:default', Infinity)
    await poller.probe('claude:default', 'request')
    expect(table.cooldown('claude:default')).toBe(Date.parse(reset))
  })

  test('that finds the login signed in ends a refusal of its token', async () => {
    writeLogins({})
    const { table, poller } = setup((id) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 1) }))
    table.markRefused('claude:default')
    await poller.probe('claude:default', 'request')
    expect(table.isRefused('claude:default')).toBe(false)
  })

  test('for a stale reading is remembered for a minute, whether it succeeded or not', async () => {
    writeLogins({})
    let clock = 1_000_000
    const table = new LoginTable({ tokens: source, log: { write: () => undefined }, now: () => clock, stateWriteMs: 0 })
    table.load()
    const poller = new UsagePoller({ table, tokens: source, env: {}, log: { write: () => undefined }, now: () => clock,
      probeClaude: () => Promise.resolve({ ok: false, signedIn: null, reason: 'other', error: 'No.' }), probeCodex: () => Promise.reject(new Error('no')) })
    await poller.probe('claude:default', 'request')
    expect(poller.recentStaleProbes()).toEqual(new Set())
    await poller.probe('claude:default', 'stale')
    clock += 59_000
    expect(poller.recentStaleProbes()).toEqual(new Set(['claude:default']))
    clock += 1_000
    expect(poller.recentStaleProbes()).toEqual(new Set())
  })

  test('is killed when the poller closes', async () => {
    writeLogins({})
    let signal: AbortSignal | undefined
    const { table, poller } = setup((_id, options) => {
      signal = options.signal
      return new Promise((resolve) => {
        options.signal?.addEventListener('abort', () => { resolve({ ok: false, signedIn: null, reason: 'shutdown', error: 'Stopped.' }) })
      })
    })
    const running = poller.probe('claude:default', 'request')
    poller.close()
    await running
    expect(signal?.aborted).toBe(true)
    // A probe that ends after close changes nothing.
    expect(table.usage('claude:default')).toBeNull()
  })
})

describe('the poll', () => {
  test('probes every login at start, then only those not found signed out', async () => {
    writeLogins({ logins: { 'claude:work': {} } })
    const probed: string[] = []
    const { poller } = setup((id) => {
      probed.push(id)
      return Promise.resolve(id === 'claude:work'
        ? { ok: true, signedIn: false, usage: emptyAccountUsage(id, Date.now()) }
        : { ok: true, signedIn: true, usage: usage(id, 1) })
    })
    poller.start()
    await expect.poll(() => probed.length).toBeGreaterThanOrEqual(6)
    poller.close()
    expect(probed.slice(0, 3).sort()).toEqual(['claude:default', 'claude:work', 'codex:default'])
    expect(probed.slice(3)).not.toContain('claude:work')
    expect(poller.pollable()).toEqual(['claude:default', 'codex:default'])
  })
})
