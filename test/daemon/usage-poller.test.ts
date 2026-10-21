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
let markedStale: string[] = []
const source: TokenSource = {
  keychain: false,
  read: () => null,
  prime: () => Promise.resolve(),
  invalidate: (id) => { invalidated.push(id) },
  markStale: (id) => { markedStale.push(id) },
  inCredentialManager: () => false,
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
  return tracked({ table, poller })
}

beforeEach(() => {
  home = freshHome()
  invalidated = []
  markedStale = []
  events.length = 0
})

/**
 * The tables and pollers a test made. They are closed and flushed before the test's home is
 * removed: a state write still waiting would otherwise create the folder again.
 */
const made: Array<{ table: LoginTable; poller: UsagePoller }> = []
function tracked<T extends { table: LoginTable; poller: UsagePoller }>(pair: T): T {
  made.push(pair)
  return pair
}

afterEach(async () => {
  for (const { table, poller } of made.splice(0)) {
    await poller.close()
    await table.flush()
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10 })
})

describe('a probe', () => {
  test('for a renewal makes the next token read wait for a new read', async () => {
    writeLogins({})
    const { poller } = setup((id) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 30) }))
    await poller.probe('claude:default', 'renewal')
    expect(invalidated).toEqual(['claude:default'])
    expect(markedStale).toEqual([])
  })

  test('stores the usage and the sign-in, and makes the next token read look again', async () => {
    writeLogins({})
    const { table, poller } = setup((id) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 30) }))
    await poller.probe('claude:default', 'request')
    expect(table.usage('claude:default')?.fiveHour?.utilization).toBe(30)
    expect(table.probedSignedIn('claude:default')).toBe(true)
    // Marked old rather than forgotten, so the next request does not wait for a new read.
    expect(markedStale).toEqual(['claude:default'])
    expect(invalidated).toEqual([])
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

  /** A table and poller on a clock the test moves. */
  function clocked(probe: ProbeFunction): { table: LoginTable; poller: UsagePoller; clock: { now: number } } {
    const clock = { now: 1_000_000 }
    const table = new LoginTable({ tokens: source, log: { write: () => undefined }, now: () => clock.now, stateWriteMs: 0 })
    table.load()
    const poller = new UsagePoller({ table, tokens: source, env: {}, log: { write: () => undefined }, now: () => clock.now,
      probeClaude: probe, probeCodex: probe })
    return tracked({ table, poller, clock })
  }

  const refusal = (observedAt: number): Parameters<LoginTable['noteObservation']>[1] => ({
    observedAt, status: 'rejected', resetsAt: null, representativeClaim: 'five_hour',
    windows: { '5h': { utilization: 1, resetsAt: null, status: 'rejected' } }, overageStatus: null, overageDisabledReason: null
  })

  test('that started before an answer\'s usage-limit refusal does not undo it', async () => {
    writeLogins({})
    let release: () => void = () => undefined
    const reset = new Date(Date.now() + 3_600_000).toISOString()
    // The probe measured the login with room left, before the refusal came.
    const { table, poller, clock } = clocked((id) => new Promise((resolve) => {
      release = () => { resolve({ ok: true, signedIn: true, usage: { ...usage(id, 40, reset), subscriptionType: 'max' } }) }
    }))
    const probing = poller.probe('claude:default', 'request')
    clock.now += 500
    // A 429 that names no reset: the login is skipped until a probe says it is back.
    table.noteObservation('claude:default', refusal(clock.now))
    table.setCooldown('claude:default', Infinity)
    table.markRefused('claude:default')
    clock.now += 500
    release()
    await probing
    const after = table.usage('claude:default')
    expect(after?.status).toBe('rejected')
    expect(after?.fiveHour?.utilization).toBe(100)
    // What the headers do not carry comes from the probe.
    expect(after?.subscriptionType).toBe('max')
    expect(table.cooldown('claude:default')).toBe(Infinity)
    expect(table.isRefused('claude:default')).toBe(true)
  })

  test('that started after an answer\'s refusal ends it as before', async () => {
    writeLogins({})
    const { table, poller, clock } = clocked((id) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 40) }))
    table.noteObservation('claude:default', refusal(clock.now))
    table.setCooldown('claude:default', Infinity)
    table.markRefused('claude:default')
    clock.now += 1_000
    await poller.probe('claude:default', 'request')
    expect(table.usage('claude:default')?.fiveHour?.utilization).toBe(40)
    expect(table.cooldown('claude:default')).toBeNull()
    expect(table.isRefused('claude:default')).toBe(false)
  })

  test('for a stale reading is remembered for a minute, whether it succeeded or not', async () => {
    writeLogins({})
    let clock = 1_000_000
    const table = new LoginTable({ tokens: source, log: { write: () => undefined }, now: () => clock, stateWriteMs: 0 })
    table.load()
    const poller = new UsagePoller({ table, tokens: source, env: {}, log: { write: () => undefined }, now: () => clock,
      probeClaude: () => Promise.resolve({ ok: false, signedIn: null, reason: 'other', error: 'No.' }), probeCodex: () => Promise.reject(new Error('no')) })
    tracked({ table, poller })
    await poller.probe('claude:default', 'request')
    expect(poller.recentStaleProbes()).toEqual(new Set())
    await poller.probe('claude:default', 'stale')
    clock += 59_000
    expect(poller.recentStaleProbes()).toEqual(new Set(['claude:default']))
    clock += 1_000
    expect(poller.recentStaleProbes()).toEqual(new Set())
  })

  test('is killed when the poller closes, and close waits until it has ended', async () => {
    writeLogins({})
    let signal: AbortSignal | undefined
    let ended = false
    const { table, poller } = setup((_id, options) => {
      signal = options.signal
      // Like a real probe, which ends only once its killed process has exited.
      return new Promise((resolve) => {
        options.signal?.addEventListener('abort', () => {
          setTimeout(() => {
            ended = true
            resolve({ ok: false, signedIn: null, reason: 'shutdown', error: 'Stopped.' })
          }, 50)
        })
      })
    })
    const running = poller.probe('claude:default', 'request')
    await poller.close()
    expect(ended).toBe(true)
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
    await poller.close()
    expect(probed.slice(0, 3).sort()).toEqual(['claude:default', 'claude:work', 'codex:default'])
    expect(probed.slice(3)).not.toContain('claude:work')
    expect(poller.pollable()).toEqual(['claude:default', 'codex:default'])
  })

  test('stops when the daemon starts to stop, while a probe asked for still runs', async () => {
    writeLogins({})
    let probes = 0
    const { poller } = setup((id) => {
      probes++
      return Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 1) })
    })
    poller.start()
    await expect.poll(() => probes).toBeGreaterThanOrEqual(4)
    poller.stopPolling()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const stoppedAt = probes
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(probes).toBe(stoppedAt)
    await poller.probe('claude:default', 'renewal')
    expect(probes).toBe(stoppedAt + 1)
    await poller.close()
  })
})
