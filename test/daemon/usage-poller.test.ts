import { readFileSync, rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { AccountUsage } from '../../src/core/claude-usage.ts'
import { emptyCodexUsage } from '../../src/core/codex-usage.ts'
import { emptyAccountUsage } from '../../src/core/usage.ts'
import { loadConfig } from '../../src/data/config.ts'
import type { ClaudeIdentity } from '../../src/data/identity.ts'
import { formatLogLine, type LogEvent, type LogFields } from '../../src/data/log.ts'
import type { LoginRef } from '../../src/data/login-id.ts'
import { configPath, statePath } from '../../src/data/paths.ts'
import { LoginTable } from '../../src/daemon/logins.ts'
import type { TokenSource } from '../../src/daemon/tokens.ts'
import { UsagePoller, type ProbeAnswer, type ProbeFunction } from '../../src/daemon/usage-poller.ts'
import { loginOf, OWN_CLAUDE, OWN_CODEX } from '../logins.ts'
import { freshHome, writeLogins } from './harness.ts'

const WORK = 'workclaude'
const WORK_CODEX = 'workcodex1'

/** The emails the stand-in identity reader answers for Claude logins, by id. */
const claudeEmails = new Map<string, string | null>()
const identity = {
  read: (login: LoginRef): ClaudeIdentity | null => {
    const email = claudeEmails.get(login.id)
    return email === undefined ? null : { accountUuid: null, email, organizationUuid: null, organizationName: null }
  }
}

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
const events: Array<{ event: LogEvent; fields: LogFields | undefined }> = []

function usage(id: string, fiveHour: number, resetsAt: string | null = null): AccountUsage {
  return { ...emptyAccountUsage(id, Date.now()), rateLimitsAvailable: true, fiveHour: { utilization: fiveHour, resetsAt } }
}

function setup(probe: ProbeFunction, codex: ProbeFunction = probe): { table: LoginTable; poller: UsagePoller } {
  const table = new LoginTable({ tokens: source, log: { write: (event, fields) => { events.push({ event, fields }) } }, now: Date.now, stateWriteMs: 0 })
  table.load()
  const poller = new UsagePoller({ table, tokens: source, identity, env: {}, log: { write: (event, fields) => { events.push({ event, fields }) } },
    now: Date.now, probeClaude: probe, probeCodex: codex, intervalMs: 50 })
  return tracked({ table, poller })
}

beforeEach(() => {
  home = freshHome()
  invalidated = []
  markedStale = []
  events.length = 0
  claudeEmails.clear()
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
    const { poller } = setup(({ id }) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 30) }))
    await poller.probe(OWN_CLAUDE, 'renewal')
    expect(invalidated).toEqual([OWN_CLAUDE])
    expect(markedStale).toEqual([])
  })

  test('stores the usage and the sign-in, and makes the next token read look again', async () => {
    writeLogins({})
    const { table, poller } = setup(({ id }) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 30) }))
    await poller.probe(OWN_CLAUDE, 'request')
    expect(table.usage(OWN_CLAUDE)?.fiveHour?.utilization).toBe(30)
    expect(table.probedSignedIn(OWN_CLAUDE)).toBe(true)
    // Marked old rather than forgotten, so the next request does not wait for a new read.
    expect(markedStale).toEqual([OWN_CLAUDE])
    expect(invalidated).toEqual([])
    expect(events.map((line) => line.event)).toEqual(expect.arrayContaining(['usage_probe_started', 'usage_probe_finished']))
  })

  test('that fails keeps the previous windows and records the error', async () => {
    writeLogins({})
    let answer: ProbeAnswer = { ok: true, signedIn: true, usage: usage(OWN_CLAUDE, 30) }
    const { table, poller } = setup(() => Promise.resolve(answer))
    await poller.probe(OWN_CLAUDE, 'request')
    answer = { ok: false, signedIn: null, reason: 'timeout', error: 'The probe timed out.' }
    await poller.probe(OWN_CLAUDE, 'request')
    expect(table.usage(OWN_CLAUDE)?.fiveHour?.utilization).toBe(30)
    expect(table.usage(OWN_CLAUDE)?.error).toBe('The probe timed out.')
    expect(table.probedSignedIn(OWN_CLAUDE)).toBe(true)
    expect(events.some((line) => line.event === 'usage_probe_failed')).toBe(true)
  })

  test('that fails with nothing before it records the error on an empty snapshot of the right provider', async () => {
    writeLogins({})
    const { table, poller } = setup(() => Promise.resolve({ ok: false, signedIn: false, reason: 'other', error: 'No.' }))
    await poller.probe(OWN_CODEX, 'request')
    expect(table.usage(OWN_CODEX)).toMatchObject({ provider: 'codex', error: 'No.' })
    expect(table.probedSignedIn(OWN_CODEX)).toBe(false)
  })

  test('runs once at a time per login; a second request waits for the running one', async () => {
    writeLogins({})
    let calls = 0
    let release: () => void = () => undefined
    const { poller } = setup(({ id }) => {
      calls++
      return new Promise((resolve) => { release = () => { resolve({ ok: true, signedIn: true, usage: usage(id, 1) }) } })
    })
    const first = poller.probe(OWN_CLAUDE, 'request')
    const second = poller.probe(OWN_CLAUDE, 'stale')
    expect(poller.isRunning(OWN_CLAUDE)).toBe(true)
    release()
    await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(poller.isRunning(OWN_CLAUDE)).toBe(false)
  })

  test('ends a cooldown of unknown length at the reset it names', async () => {
    writeLogins({})
    const reset = new Date(Date.now() + 3_600_000).toISOString()
    const { table, poller } = setup(({ id }) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 100, reset) }))
    table.setCooldown(OWN_CLAUDE, Infinity)
    await poller.probe(OWN_CLAUDE, 'request')
    expect(table.cooldown(OWN_CLAUDE)).toBe(Date.parse(reset))
  })

  test('that finds the login signed in ends a refusal of its token', async () => {
    writeLogins({})
    const { table, poller } = setup(({ id }) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 1) }))
    table.markRefused(OWN_CLAUDE)
    await poller.probe(OWN_CLAUDE, 'request')
    expect(table.isRefused(OWN_CLAUDE)).toBe(false)
  })

  /** A table and poller on a clock the test moves. */
  function clocked(probe: ProbeFunction): { table: LoginTable; poller: UsagePoller; clock: { now: number } } {
    const clock = { now: 1_000_000 }
    const table = new LoginTable({ tokens: source, log: { write: () => undefined }, now: () => clock.now, stateWriteMs: 0 })
    table.load()
    const poller = new UsagePoller({ table, tokens: source, identity, env: {}, log: { write: () => undefined }, now: () => clock.now,
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
    const { table, poller, clock } = clocked(({ id }) => new Promise((resolve) => {
      release = () => { resolve({ ok: true, signedIn: true, usage: { ...usage(id, 40, reset), subscriptionType: 'max' } }) }
    }))
    const probing = poller.probe(OWN_CLAUDE, 'request')
    clock.now += 500
    // A 429 that names no reset: the login is skipped until a probe says it is back.
    table.noteObservation(OWN_CLAUDE, refusal(clock.now))
    table.setCooldown(OWN_CLAUDE, Infinity)
    table.markRefused(OWN_CLAUDE)
    clock.now += 500
    release()
    await probing
    const after = table.usage(OWN_CLAUDE)
    expect(after?.status).toBe('rejected')
    expect(after?.fiveHour?.utilization).toBe(100)
    // What the headers do not carry comes from the probe.
    expect(after?.subscriptionType).toBe('max')
    expect(table.cooldown(OWN_CLAUDE)).toBe(Infinity)
    expect(table.isRefused(OWN_CLAUDE)).toBe(true)
  })

  test('that started after an answer\'s refusal ends it as before', async () => {
    writeLogins({})
    const { table, poller, clock } = clocked(({ id }) => Promise.resolve({ ok: true, signedIn: true, usage: usage(id, 40) }))
    table.noteObservation(OWN_CLAUDE, refusal(clock.now))
    table.setCooldown(OWN_CLAUDE, Infinity)
    table.markRefused(OWN_CLAUDE)
    clock.now += 1_000
    await poller.probe(OWN_CLAUDE, 'request')
    expect(table.usage(OWN_CLAUDE)?.fiveHour?.utilization).toBe(40)
    expect(table.cooldown(OWN_CLAUDE)).toBeNull()
    expect(table.isRefused(OWN_CLAUDE)).toBe(false)
  })

  test('for a stale reading is remembered for a minute, whether it succeeded or not', async () => {
    writeLogins({})
    let clock = 1_000_000
    const table = new LoginTable({ tokens: source, log: { write: () => undefined }, now: () => clock, stateWriteMs: 0 })
    table.load()
    const poller = new UsagePoller({ table, tokens: source, identity, env: {}, log: { write: () => undefined }, now: () => clock,
      probeClaude: () => Promise.resolve({ ok: false, signedIn: null, reason: 'other', error: 'No.' }), probeCodex: () => Promise.reject(new Error('no')) })
    tracked({ table, poller })
    await poller.probe(OWN_CLAUDE, 'request')
    expect(poller.recentStaleProbes()).toEqual(new Set())
    await poller.probe(OWN_CLAUDE, 'stale')
    clock += 59_000
    expect(poller.recentStaleProbes()).toEqual(new Set([OWN_CLAUDE]))
    clock += 1_000
    expect(poller.recentStaleProbes()).toEqual(new Set())
  })

  test('is killed when the poller closes, and close waits until it has ended', async () => {
    writeLogins({})
    let signal: AbortSignal | undefined
    let ended = false
    const { table, poller } = setup((_login, options) => {
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
    const running = poller.probe(OWN_CLAUDE, 'request')
    await poller.close()
    expect(ended).toBe(true)
    await running
    expect(signal?.aborted).toBe(true)
    // A probe that ends after close changes nothing.
    expect(table.usage(OWN_CLAUDE)).toBeNull()
  })
})

describe('the poll', () => {
  test('probes every login at start, then only those not found signed out', async () => {
    writeLogins({ claude: { [WORK]: {} } })
    const probed: string[] = []
    const { poller } = setup(({ id }) => {
      probed.push(id)
      return Promise.resolve(id === WORK
        ? { ok: true, signedIn: false, usage: emptyAccountUsage(id, Date.now()) }
        : { ok: true, signedIn: true, usage: usage(id, 1) })
    })
    poller.start()
    await expect.poll(() => probed.length).toBeGreaterThanOrEqual(6)
    await poller.close()
    expect(probed.slice(0, 3).sort()).toEqual([OWN_CLAUDE, OWN_CODEX, WORK].sort())
    expect(probed.slice(3)).not.toContain(WORK)
    expect(poller.pollable()).toEqual([OWN_CLAUDE, OWN_CODEX])
  })

  test('stops when the daemon starts to stop, while a probe asked for still runs', async () => {
    writeLogins({})
    let probes = 0
    const { poller } = setup(({ id }) => {
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
    await poller.probe(OWN_CLAUDE, 'renewal')
    expect(probes).toBe(stoppedAt + 1)
    await poller.close()
  })
})

describe("a probe and the login's email", () => {
  const claudeAnswer = (signedIn = true): ProbeFunction => ({ id }) =>
    Promise.resolve({ ok: true, signedIn, usage: usage(id, 1) })
  const codexAnswer = (answer: () => ProbeAnswer): ProbeFunction => () => Promise.resolve(answer())
  const codexUsage = (id: string): AccountUsage => emptyCodexUsage(id, Date.now())

  test('is handed the login with its provider and whether it is the login of a plain CLI', async () => {
    writeLogins({ claude: { [WORK]: {} } })
    const seen: LoginRef[] = []
    const { poller } = setup((login) => {
      seen.push(login)
      return Promise.resolve({ ok: true, signedIn: true, usage: usage(login.id, 1) })
    })
    await poller.probeMany([OWN_CLAUDE, WORK, OWN_CODEX], 'request')
    expect(seen).toEqual(expect.arrayContaining([
      { id: OWN_CLAUDE, provider: 'claude', machineOwn: true },
      { id: WORK, provider: 'claude', machineOwn: false },
      { id: OWN_CODEX, provider: 'codex', machineOwn: true }
    ]))
  })

  test('gives a Claude login the automatic alias its profile\'s email makes', async () => {
    writeLogins({ claude: { [WORK]: {} } })
    claudeEmails.set(WORK, 'work.person@example.com')
    claudeEmails.set(OWN_CLAUDE, 'own.person@example.org')
    const { table, poller } = setup(claudeAnswer())
    await poller.probeMany([OWN_CLAUDE, WORK], 'request')
    expect(table.find(WORK)?.alias).toBe('work-person-example')
    expect(loginOf(loadConfig(), OWN_CLAUDE).alias).toBe('own-person-example')
  })

  test('gives a Codex login the automatic alias the probe\'s email makes, and keeps the email in memory only', async () => {
    writeLogins({ codex: { [WORK_CODEX]: {} } })
    const { table, poller } = setup(claudeAnswer(), codexAnswer(() =>
      ({ ok: true, signedIn: true, usage: codexUsage(WORK_CODEX), email: 'codex.person@example.com' })))
    await poller.probe(WORK_CODEX, 'request')
    await table.flush()
    expect(table.find(WORK_CODEX)?.alias).toBe('codex-person-example')
    expect(table.codexEmail(WORK_CODEX)).toBe('codex.person@example.com')
    expect(readFileSync(configPath(), 'utf8')).not.toContain('@')
    expect(readFileSync(statePath(), 'utf8')).not.toContain('@')
    const log = events.map(({ event, fields }) => formatLogLine(event, fields)).join('')
    expect(log).not.toMatch(/example|person|@/)
  })

  test('follows a new email, but never an alias the person set', async () => {
    writeLogins({ claude: { [WORK]: { alias: 'chosen' } } })
    claudeEmails.set(WORK, 'someone@example.com')
    claudeEmails.set(OWN_CLAUDE, 'first@example.com')
    const { table, poller } = setup(claudeAnswer())
    await poller.probeMany([OWN_CLAUDE, WORK], 'request')
    expect(table.ownLogin('claude').alias).toBe('first-example')
    claudeEmails.set(OWN_CLAUDE, 'second@example.com')
    await poller.probeMany([OWN_CLAUDE, WORK], 'request')
    expect(table.ownLogin('claude').alias).toBe('second-example')
    expect(table.find(WORK)).toMatchObject({ alias: 'chosen', aliasSetByUser: true })
  })

  test('that failed, found the login signed out, or knows no email changes no alias', async () => {
    writeLogins({ claude: { [WORK]: {} }, codex: { [WORK_CODEX]: {} } })
    claudeEmails.set(OWN_CLAUDE, 'signed.out@example.com')
    claudeEmails.set(WORK, null)
    let codex: ProbeAnswer = { ok: true, signedIn: true, usage: codexUsage(WORK_CODEX), email: 'kept@example.com' }
    const { table, poller } = setup(({ id }) => Promise.resolve(id === OWN_CLAUDE
      ? { ok: true, signedIn: false, usage: emptyAccountUsage(id, Date.now()) }
      : { ok: true, signedIn: true, usage: usage(id, 1) }), codexAnswer(() => codex))
    await poller.probeMany([OWN_CLAUDE, WORK, WORK_CODEX], 'request')
    expect(table.ownLogin('claude').alias).toBe(OWN_CLAUDE)
    expect(table.find(WORK)?.alias).toBe(WORK)
    expect(table.find(WORK_CODEX)?.alias).toBe('kept-example')

    codex = { ok: false, signedIn: null, reason: 'timeout', error: 'The probe timed out.' }
    await poller.probe(WORK_CODEX, 'request')
    expect(table.codexEmail(WORK_CODEX)).toBe('kept@example.com')
    codex = { ok: true, signedIn: true, usage: codexUsage(WORK_CODEX), email: null }
    await poller.probe(WORK_CODEX, 'request')
    expect(table.find(WORK_CODEX)?.alias).toBe('kept-example')
    expect(table.codexEmail(WORK_CODEX)).toBeNull()
    codex = { ok: true, signedIn: false, usage: codexUsage(WORK_CODEX), email: null }
    await poller.probe(WORK_CODEX, 'request')
    expect(table.find(WORK_CODEX)?.alias).toBe('kept-example')
    expect(table.codexEmail(WORK_CODEX)).toBeNull()
  })
})
