import { describe, expect, test } from 'vitest'
import { formatStatus, STATUS_JSON_FORMAT, statusJson } from '../../src/cli/status-format.ts'
import { accountUsage, usageWindow } from '../core/usage-fixtures.ts'
import { codexUsage } from '../core/codex-usage-fixture.ts'
import { loginStatus, statusAnswer } from './helpers.ts'

const NOW = Date.parse('2026-09-13T01:10:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const at = (ms: number): string => new Date(NOW + ms).toISOString()

function sampleStatus() {
  return statusAnswer([
    loginStatus('claude:default', {
      sessions: 2,
      usage: accountUsage({
        accountId: 'claude:default',
        fetchedAt: NOW - 3 * MINUTE,
        fiveHour: usageWindow(42, at(2 * HOUR + 10 * MINUTE)),
        sevenDay: usageWindow(63.4, at(3 * 24 * HOUR + 4 * HOUR)),
        sevenDayOpus: usageWindow(12, at(3 * 24 * HOUR + 4 * HOUR)),
        // get_usage can also list the Opus window by name; it is shown once.
        modelScoped: [{ displayName: 'Opus', ...usageWindow(12, at(3 * 24 * HOUR + 4 * HOUR)) }]
      })
    }),
    loginStatus('claude:work', {
      label: 'Work',
      fiveHourLimit: 90,
      useFirst: true,
      sessions: 1,
      email: 'work@example.com',
      probing: true,
      usage: accountUsage({
        accountId: 'claude:work',
        fetchedAt: NOW - 30_000,
        source: 'session',
        fiveHour: usageWindow(92, at(45 * MINUTE)),
        sevenDay: usageWindow(20, at(-MINUTE))
      }),
      block: { kind: 'over-limit', utilization: 92, limitPercent: 90, window: '5 hour', resetsAt: at(45 * MINUTE) }
    }),
    loginStatus('claude:spare', { signedIn: null, routing: false, block: { kind: 'auto-route-off' } }),
    loginStatus('claude:cool', { block: { kind: 'cooldown', until: NOW + HOUR }, cooldownUntil: NOW + HOUR }),
    loginStatus('codex:default', {
      usage: codexUsage('codex:default', { fiveHour: 100, fiveHourResetsAt: at(HOUR), weekly: 30, weeklyResetsAt: at(5 * 24 * HOUR), fetchedAt: NOW - 10 * MINUTE })
    }),
    loginStatus('codex:work', {
      signedIn: false,
      usage: { ...codexUsage('codex:work', { fetchedAt: NOW - 2 * HOUR }), error: 'codex app-server did not answer' }
    })
  ], { startedAt: NOW - 2 * HOUR - 5 * MINUTE })
}

describe('kurmis status as text', () => {
  test('one block per login, with usage, limits, routing and why a login is passed over', () => {
    expect(formatStatus(sampleStatus(), NOW, { keychain: false, timeZone: 'UTC' })).toBe(`kurmis daemon 0.1.0, pid 4242, port 40123, running for 2h 5m

claude:default
  signed in, routing on, limits 100% 5 hour, 100% weekly, 2 sessions, plan max
  5 hour       42%  resets in 2h 10m      limit 100%
  7 day        63%  resets in 3d 4h       limit 100%
  7 day Opus   12%  resets in 3d 4h
  usage read 3m ago

claude:work  "Work"  work@example.com
  signed in, routing on, limits 90% 5 hour, 100% weekly, use first, 1 session,
  plan max, reading usage now
  5 hour       92%  resets in 45m         limit 90%
  7 day         0%  reset since read      limit 100%
  usage read just now from a forwarded answer
  passed over: at its limit, the 5 hour window is at 92% of 90%; it resets in
    45m

claude:spare
  sign-in not checked yet, routing off, limits 100% 5 hour, 100% weekly, 0
  sessions
  usage not read yet

claude:cool
  signed in, routing on, limits 100% 5 hour, 100% weekly, 0 sessions
  usage not read yet
  passed over: cooling down until 02:10 (in 1h)

codex:default
  signed in, routing on, limits 100% 5 hour, 100% weekly, plan plus
  Codex 5h    100%  resets in 1h          limit 100%
  Codex 7d     30%  resets in 5d          limit 100%
  usage read 10m ago
  passed over: at its limit, the Codex 5h window is at 100% of 100%; it resets
    in 1h

codex:work
  signed out, routing on, limits 100% 5 hour, 100% weekly, plan plus
  Codex 5h      0%                        limit 100%
  Codex 7d      0%                        limit 100%
  usage read 2h ago
  last probe failed: codex app-server did not answer

kurmis codex would start on codex:default. Every Codex login is at its limit;
starting on codex:default, whose usage comes back first (in 1h).
`)
  })

  test('gives a cooldown\'s end in local time, with the date when it is on another day', () => {
    const status = (until: number) => statusAnswer([loginStatus('claude:cool', { block: { kind: 'cooldown', until }, cooldownUntil: until })])
    expect(formatStatus(status(NOW + HOUR), NOW, { keychain: false, timeZone: 'Asia/Tokyo' }))
      .toContain('passed over: cooling down until 11:10 (in 1h)')
    expect(formatStatus(status(NOW + 23 * HOUR), NOW, { keychain: false, timeZone: 'Asia/Tokyo' }))
      .toContain('passed over: cooling down until 2026-09-14 09:10 (in 23h)')
    expect(formatStatus(status(NOW + HOUR), NOW, { keychain: false })).not.toContain('2026-09-13T02:10:00.000Z')
    // A cooldown with no end says so in words.
    expect(formatStatus(statusAnswer([loginStatus('claude:cool', { block: { kind: 'cooldown', until: null } })]), NOW, { keychain: false }))
      .toContain('passed over: cooling down until a usage probe says it is back')
  })

  test('every line fits in 80 columns', () => {
    const text = formatStatus(sampleStatus(), NOW, { keychain: true })
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80)
  })

  test('a long window name is cut', () => {
    const usage = codexUsage('codex:default', { fetchedAt: NOW })
    usage.windows = [{ key: 'other:primary', label: 'A model with a very long name 7d', utilization: 5, resetsAt: null, windowDurationMins: 10080 }]
    const text = formatStatus(statusAnswer([loginStatus('codex:default', { usage })]), NOW, { keychain: false })
    expect(text).toContain('  A model with a very lon~    5%')
  })

  test('the Keychain wording of a block that has no token', () => {
    const status = statusAnswer([loginStatus('claude:work', { block: { kind: 'no-credentials' } })])
    expect(formatStatus(status, NOW, { keychain: true })).toContain('its Keychain item did not read')
    expect(formatStatus(status, NOW, { keychain: false })).toContain('its .credentials.json did not read')
  })

  test('no Codex line without Codex logins', () => {
    expect(formatStatus(statusAnswer([loginStatus('claude:default')]), NOW, { keychain: false })).not.toContain('kurmis codex')
  })
})

describe('kurmis status as JSON', () => {
  test('has its own format number, ISO times, and the windows in one shape for both providers', () => {
    const json = statusJson(sampleStatus(), NOW, { keychain: false })
    expect(json.format).toBe(STATUS_JSON_FORMAT)
    expect(json.daemon).toEqual({ version: '0.1.0', pid: 4242, port: 40123, startedAt: at(-2 * HOUR - 5 * MINUTE) })
    expect(json.logins.map((login) => login.id)).toEqual([
      'claude:default', 'claude:work', 'claude:spare', 'claude:cool', 'codex:default', 'codex:work'
    ])
    expect(json.logins[1]).toEqual({
      id: 'claude:work',
      provider: 'claude',
      label: 'Work',
      email: 'work@example.com',
      signedIn: true,
      probing: true,
      routing: true,
      fiveHourLimit: 90,
      weeklyLimit: 100,
      useFirst: true,
      usage: {
        fetchedAt: at(-30_000),
        source: 'session',
        plan: 'max',
        error: null,
        windows: [
          { key: 'five_hour', label: '5 hour', durationMinutes: 300, utilization: 92, resetsAt: at(45 * MINUTE), plan: true, limitPercent: 90 },
          { key: 'seven_day', label: '7 day', durationMinutes: 10080, utilization: 0, resetsAt: at(-MINUTE), plan: true, limitPercent: 100 }
        ]
      },
      blocked: {
        kind: 'over-limit',
        text: 'at its limit, the 5 hour window is at 92% of 90%; it resets in 45m',
        until: at(45 * MINUTE)
      },
      sessions: 1
    })
    expect(json.logins[0]?.usage?.windows.find((window) => window.key === 'seven_day_opus'))
      .toMatchObject({ plan: false, limitPercent: null })
    // The Opus window that get_usage also lists by name is there once.
    expect(json.logins[0]?.usage?.windows.map((window) => window.key)).toEqual(['five_hour', 'seven_day', 'seven_day_opus'])
    expect(json.logins[2]?.usage).toBeNull()
    expect(json.logins[2]?.signedIn).toBeNull()
    expect(json.logins[3]?.blocked).toEqual({
      kind: 'cooldown', text: 'cooling down until 2026-09-13T02:10:00.000Z (in 1h)', until: at(HOUR)
    })
    expect(json.logins[4]).toMatchObject({
      sessions: null,
      blocked: { kind: 'over-limit', until: at(HOUR) },
      usage: { windows: [{ key: 'codex:primary', label: 'Codex 5h', plan: true }, { key: 'codex:secondary', label: 'Codex 7d', plan: true }] }
    })
    expect(json.logins[5]?.blocked).toMatchObject({ kind: 'signed-out', until: null })
    expect(json.codexStart).toEqual({
      login: 'codex:default',
      note: 'Every Codex login is at its limit; starting on codex:default, whose usage comes back first (in 1h).'
    })
  })

  test('no Codex start without Codex logins', () => {
    expect(statusJson(statusAnswer([loginStatus('claude:default')]), NOW, { keychain: false }).codexStart).toBeNull()
  })
})
