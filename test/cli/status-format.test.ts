import { describe, expect, test } from 'vitest'
import { formatStatus as formatReport, STATUS_JSON_FORMAT, statusJson as reportJson, type StatusFormatOptions, type StatusReport } from '../../src/cli/status-format.ts'
import { CONTROL_API_VERSION, type StatusAnswer } from '../../src/core/control-api.ts'
import { accountUsage, usageWindow } from '../core/usage-fixtures.ts'
import { daemonStatus, loginStatus, statusAnswer } from './helpers.ts'
import { claudeRef, OWN_CLAUDE_REF } from '../logins.ts'

const OWN_CLAUDE_LOGIN = { ...OWN_CLAUDE_REF, alias: 'own-example' }
const WORK_CLAUDE = { ...claudeRef('workclaude'), alias: 'work-example' }

/** The text of the daemon's answer, as `kurmis status` prints it. */
const formatStatus = (answer: StatusAnswer, now: number, options: StatusFormatOptions): string =>
  formatReport(daemonStatus(answer), now, options)
const statusJson = (answer: StatusAnswer, now: number, options: StatusFormatOptions) =>
  reportJson(daemonStatus(answer), now, options)

const NOW = Date.parse('2026-09-13T01:10:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const at = (ms: number): string => new Date(NOW + ms).toISOString()

function sampleStatus() {
  return statusAnswer([
    loginStatus(OWN_CLAUDE_LOGIN, {
      sessions: 2,
      usage: accountUsage({
        accountId: 'ownclaude1',
        fetchedAt: NOW - 3 * MINUTE,
        fiveHour: usageWindow(42, at(2 * HOUR + 10 * MINUTE)),
        sevenDay: usageWindow(63.4, at(3 * 24 * HOUR + 4 * HOUR)),
        sevenDayOpus: usageWindow(12, at(3 * 24 * HOUR + 4 * HOUR)),
        // get_usage can also list the Opus window by name; it is shown once.
        modelScoped: [{ displayName: 'Opus', ...usageWindow(12, at(3 * 24 * HOUR + 4 * HOUR)) }]
      })
    }),
    loginStatus(WORK_CLAUDE, {
      fiveHourLimit: 90,
      useFirst: true,
      sessions: 1,
      email: 'work@example.com',
      probing: true,
      usage: accountUsage({
        accountId: 'workclaude',
        fetchedAt: NOW - 30_000,
        source: 'session',
        fiveHour: usageWindow(92, at(45 * MINUTE)),
        sevenDay: usageWindow(20, at(-MINUTE))
      }),
      block: { kind: 'over-limit', utilization: 92, limitPercent: 90, window: '5 hour', resetsAt: at(45 * MINUTE) }
    }),
    loginStatus(claudeRef('spareclaude'), { signedIn: null, routing: false, block: { kind: 'auto-route-off' } }),
    loginStatus(claudeRef('coolclaude'), { block: { kind: 'cooldown', until: NOW + HOUR }, cooldownUntil: NOW + HOUR }),
    loginStatus(claudeRef('goneclaude'), {
      signedIn: false,
      usage: accountUsage({
        accountId: 'goneclaude',
        fetchedAt: NOW - 2 * HOUR,
        subscriptionType: 'pro',
        fiveHour: usageWindow(0),
        sevenDay: usageWindow(0),
        error: 'claude did not answer'
      }),
      block: { kind: 'signed-out' }
    })
  ], { startedAt: NOW - 2 * HOUR - 5 * MINUTE })
}

describe('kurmis status as text', () => {
  test('one block per login, with usage, limits, routing and why a login is passed over', () => {
    expect(formatStatus(sampleStatus(), NOW, { keychain: false, timeZone: 'UTC' })).toBe(`kurmis daemon 0.1.0, pid 4242, port 40123, running for 2h 5m

Global routing is off: only "kurmis claude" goes through kurmis. Plain "claude"
does not.
Run "kurmis setup" to turn on global routing.

own-example (id ownclaude1)
  the login plain claude uses
  signed in, routing on, limits 100% 5 hour, 100% weekly,
  2 sessions in the last 7 days, plan max
  5 hour       42%  resets in 2h 10m      limit 100%
  7 day        63%  resets in 3d 4h       limit 100%
  7 day Opus   12%  resets in 3d 4h
  usage read 3m ago

work-example (id workclaude)  work@example.com
  signed in, routing on, limits 90% 5 hour, 100% weekly, use first,
  1 session in the last 7 days, plan max, reading usage now
  5 hour       92%  resets in 45m         limit 90%
  7 day         0%  reset since read      limit 100%
  usage read just now from a forwarded answer
  passed over: at its limit, the 5 hour window is at 92% of 90%; it resets in
    45m

spareclaude
  sign-in not checked yet, routing off, limits 100% 5 hour, 100% weekly,
  0 sessions in the last 7 days
  usage not read yet

coolclaude
  signed in, routing on, limits 100% 5 hour, 100% weekly,
  0 sessions in the last 7 days
  usage not read yet
  passed over: cooling down until 02:10 (in 1h)

goneclaude
  signed out, routing on, limits 100% 5 hour, 100% weekly,
  0 sessions in the last 7 days, plan pro
  5 hour        0%                        limit 100%
  7 day         0%                        limit 100%
  usage read 2h ago
  last probe failed: claude did not answer
`)
  })

  test('gives a cooldown\'s end in local time, with the date when it is on another day', () => {
    const status = (until: number) => statusAnswer([loginStatus(claudeRef('coolclaude'), { block: { kind: 'cooldown', until }, cooldownUntil: until })])
    expect(formatStatus(status(NOW + HOUR), NOW, { keychain: false, timeZone: 'Asia/Tokyo' }))
      .toContain('passed over: cooling down until 11:10 (in 1h)')
    expect(formatStatus(status(NOW + 23 * HOUR), NOW, { keychain: false, timeZone: 'Asia/Tokyo' }))
      .toContain('passed over: cooling down until 2026-09-14 09:10 (in 23h)')
    expect(formatStatus(status(NOW + HOUR), NOW, { keychain: false })).not.toContain('2026-09-13T02:10:00.000Z')
    // A cooldown with no end says so in words.
    expect(formatStatus(statusAnswer([loginStatus(claudeRef('coolclaude'), { block: { kind: 'cooldown', until: null } })]), NOW, { keychain: false }))
      .toContain('passed over: cooling down until a usage probe says it is back')
  })

  test('every line fits in 80 columns', () => {
    const text = formatStatus(sampleStatus(), NOW, { keychain: true })
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80)
  })

  test('a long window name is cut', () => {
    const usage = accountUsage({ fetchedAt: NOW, modelScoped: [{ displayName: 'A model with a very long name', ...usageWindow(5) }] })
    const text = formatStatus(statusAnswer([loginStatus(OWN_CLAUDE_REF, { usage })]), NOW, { keychain: false })
    expect(text).toContain('  A model with a very lon~    5%')
  })

  test('the Keychain wording of a block that has no token', () => {
    const status = statusAnswer([loginStatus(WORK_CLAUDE, { block: { kind: 'no-credentials' } })])
    expect(formatStatus(status, NOW, { keychain: true })).toContain('its Keychain item did not read')
    // On Windows the phrase names Credential Manager as well (routeBlockText).
    expect(formatStatus(status, NOW, { keychain: false })).toMatch(/its\s+\.credentials\.json\s+(did not read|gave one)/)
  })
})

describe('kurmis status as JSON', () => {
  test('has its own format number, ISO times, and the windows as they stand now', () => {
    const json = statusJson(sampleStatus(), NOW, { keychain: false })
    expect(json.format).toBe(STATUS_JSON_FORMAT)
    expect(json.daemon).toEqual({ version: '0.1.0', pid: 4242, port: 40123, startedAt: at(-2 * HOUR - 5 * MINUTE), older: false, newer: false })
    expect(json.source).toBe('daemon')
    expect(json.globalRouting).toBe('off')
    expect(json.logins.map((login) => login.id)).toEqual([
      'ownclaude1', 'workclaude', 'spareclaude', 'coolclaude', 'goneclaude'
    ])
    expect(json.logins[1]).toEqual({
      id: 'workclaude',
      alias: 'work-example',
      usedByPlainClaude: false,
      email: 'work@example.com',
      signedIn: true,
      credentials: null,
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
      signedIn: false,
      sessions: 0,
      blocked: { kind: 'signed-out', until: null },
      usage: { plan: 'pro', error: 'claude did not answer', windows: [{ key: 'five_hour', utilization: 0 }, { key: 'seven_day', utilization: 0 }] }
    })
    expect(json.logins[0]).toMatchObject({ id: 'ownclaude1', alias: 'own-example', usedByPlainClaude: true })
    expect(json.warnings).toEqual([])
  })

  test('has no provider and no usedByPlainCli', () => {
    const json = statusJson(sampleStatus(), NOW, { keychain: false })
    for (const login of json.logins) {
      expect(login).not.toHaveProperty('provider')
      expect(login).not.toHaveProperty('usedByPlainCli')
      expect(typeof login.usedByPlainClaude).toBe('boolean')
    }
  })
})

describe('the warning about an extra login that is the account of the login plain claude uses', () => {
  test('names both logins and the account, ignoring case', () => {
    const status = statusAnswer([
      loginStatus(OWN_CLAUDE_LOGIN, { email: 'own@example.com' }),
      loginStatus(WORK_CLAUDE, { email: 'Own@Example.com' }),
      loginStatus({ ...claudeRef('otherclaude'), alias: 'other-example' }, { email: 'other@example.com' })
    ])
    const warning = 'work-example and own-example, the login plain claude uses, are the same account ' +
      '(own@example.com), so they use one subscription. "kurmis logout work-example" removes work-example.'
    expect(statusJson(status, NOW, { keychain: false }).warnings).toEqual([warning])
    const text = formatStatus(status, NOW, { keychain: false })
    expect(text).toContain('\n\nWarning: work-example and own-example, the login plain claude uses, are the same\n  account')
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80)
  })

  test('says nothing about one email in two organizations, and compares by email when an organization is not known', () => {
    const status = statusAnswer([
      loginStatus(OWN_CLAUDE_LOGIN, { email: 'own@example.com', organizationUuid: 'org-0001' }),
      loginStatus(WORK_CLAUDE, { email: 'own@example.com', organizationUuid: 'org-0002' }),
      loginStatus({ ...claudeRef('spareclaude'), alias: 'spare-example' }, { email: 'own@example.com', organizationUuid: null })
    ])
    expect(statusJson(status, NOW, { keychain: false }).warnings).toEqual([
      'spare-example and own-example, the login plain claude uses, are the same account (own@example.com), so they ' +
        'use one subscription. "kurmis logout spare-example" removes spare-example.'
    ])
  })

  test('says nothing while the email of the login plain claude uses is not known', () => {
    const status = statusAnswer([loginStatus(OWN_CLAUDE_LOGIN), loginStatus(WORK_CLAUDE, { email: 'own@example.com' })])
    expect(statusJson(status, NOW, { keychain: false }).warnings).toEqual([])
    expect(formatStatus(status, NOW, { keychain: false })).not.toContain('Warning')
  })

  test('compares the extra logins with each other too', () => {
    const report: StatusReport = {
      daemon: null,
      source: 'files',
      logins: [
        loginStatus(OWN_CLAUDE_LOGIN, { email: 'own@example.com' }),
        loginStatus(WORK_CLAUDE, { email: 'own@example.com' }),
        loginStatus({ ...claudeRef('spareclaude'), alias: 'spare-example' }, { email: 'spare@example.com' }),
        loginStatus({ ...claudeRef('spareagain'), alias: 'spare-example-2' }, { email: 'spare@example.com' })
      ],
      credentials: new Map(),
      globalRouting: 'off',
      version: '0.1.0'
    }
    expect(reportJson(report, NOW, { keychain: false }).warnings).toEqual([
      `work-example and ${OWN_CLAUDE_LOGIN.alias}, the login plain claude uses, are the same account (own@example.com), ` +
        'so they use one subscription. "kurmis logout work-example" removes work-example.',
      'spare-example-2 and spare-example are the same account (spare@example.com), so they use one subscription. ' +
        '"kurmis logout spare-example-2" removes spare-example-2.'
    ])
  })

  test('puts an email that does not fit on the title line on a line of its own', () => {
    const login = { ...claudeRef('longclaude'), alias: 'a-very-long-alias-made-from-an-email' }
    const text = formatStatus(statusAnswer([loginStatus(login, { email: 'a.very.long.alias.made.from.an.email@example.com' })]), NOW, { keychain: false })
    expect(text).toContain('a-very-long-alias-made-from-an-email (id longclaude)\n  a.very.long.alias.made.from.an.email@example.com\n')
  })
})

describe('kurmis status without the daemon, and global routing', () => {
  /** What `kurmis status` puts together from config.json and state.json when no daemon runs. */
  function filesReport(patch: Partial<StatusReport> = {}): StatusReport {
    return {
      daemon: null,
      source: 'files',
      logins: [
        loginStatus(OWN_CLAUDE_LOGIN, {
          signedIn: null,
          email: 'own@example.com',
          sessions: 1,
          usage: accountUsage({ accountId: 'ownclaude1', fetchedAt: NOW - 3 * HOUR, fiveHour: usageWindow(42, at(-HOUR)), sevenDay: usageWindow(63, at(2 * 24 * HOUR)) })
        }),
        loginStatus(WORK_CLAUDE, { signedIn: null, email: 'own@example.com', block: null })
      ],
      credentials: new Map([['ownclaude1', true], ['workclaude', false]]),
      globalRouting: 'paused',
      version: '0.1.0',
      ...patch
    }
  }

  test('says the daemon is not running and what starts it, and shows the last usage with its age', () => {
    const text = formatReport(filesReport(), NOW, { keychain: false, timeZone: 'UTC' })
    expect(text).toBe(`The kurmis daemon is not running. It is started automatically by
  - "kurmis claude"
  - "kurmis setup"
  - "kurmis daemon start"

Global routing is paused: only "kurmis claude" goes through kurmis. Plain
"claude" does not.
Run "kurmis setup" to turn it on again.

Warning: work-example and own-example, the login plain claude uses, are the same
  account (own@example.com), so they use one subscription.
  "kurmis logout work-example" removes work-example.

Logins are read from config.json, and the usage is cached by the daemon:

own-example (id ownclaude1)  own@example.com
  the login plain claude uses
  credentials on this machine, routing on, limits 100% 5 hour, 100% weekly,
  1 session in the last 7 days, plan max
  5 hour    0%  reset since read      limit 100%
  7 day    63%  resets in 2d          limit 100%
  usage read 3h ago

work-example (id workclaude)  own@example.com
  no credentials on this machine, routing on, limits 100% 5 hour, 100% weekly,
  0 sessions in the last 7 days
  usage not read yet
`)
  })

  test('the JSON has no daemon, the credentials in place of the sign-in, and no blocks', () => {
    const json = reportJson(filesReport(), NOW, { keychain: false })
    expect(json).toMatchObject({ format: STATUS_JSON_FORMAT, daemon: null, source: 'files', globalRouting: 'paused' })
    expect(json.logins.map((login) => [login.id, login.signedIn, login.credentials, login.blocked])).toEqual([
      ['ownclaude1', null, true, null], ['workclaude', null, false, null]
    ])
    expect(json.logins[0]?.usage?.fetchedAt).toBe(at(-3 * HOUR))
    expect(json.warnings).toEqual([expect.stringContaining('"kurmis logout work-example"')])
  })

  test('warns when global routing is on and the daemon is not running', () => {
    const json = reportJson(filesReport({ globalRouting: 'on' }), NOW, { keychain: false })
    expect(json.warnings).toContain('Global routing is on, but the daemon is not running, so a plain claude and the Claude Code ' +
      'editor extensions cannot reach Anthropic. "kurmis daemon start" starts it.')
    const text = formatReport(filesReport({ globalRouting: 'on' }), NOW, { keychain: false })
    expect(text).toContain('Global routing is on: plain "claude" and the Claude Code editor extensions go\nthrough kurmis.\nRun "kurmis setup --pause" to pause it.\n')
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80)
    // While the daemon runs, there is nothing to warn about.
    expect(reportJson(daemonStatus(sampleStatus(), { globalRouting: 'on' }), NOW, { keychain: false }).warnings).toEqual([])
  })

  test('says when the daemon runs an older kurmis', () => {
    const report = daemonStatus(sampleStatus(), { version: '0.2.0' })
    expect(reportJson(report, NOW, { keychain: false }).daemon?.older).toBe(true)
    expect(formatReport(report, NOW, { keychain: false })).toContain(`kurmis daemon 0.1.0, pid 4242, port 40123, running for 2h 5m
It runs an older kurmis than this one (0.2.0). The next "kurmis claude",
"kurmis setup" or "kurmis daemon start" replaces it.

Global routing is off`)
    // A newer daemon, or one run from the source tree, is not older.
    expect(reportJson(daemonStatus(sampleStatus(), { version: 'dev' }), NOW, { keychain: false }).daemon?.older).toBe(false)
  })

  test('says when the daemon runs a newer kurmis, and what to do when this kurmis cannot use it', () => {
    const usable = daemonStatus(sampleStatus(), { version: '0.0.9' })
    expect(reportJson(usable, NOW, { keychain: false }).daemon).toMatchObject({ older: false, newer: true })
    expect(formatReport(usable, NOW, { keychain: false })).toContain(`running for 2h 5m
It runs a newer kurmis than this one (0.0.9), which this kurmis does not
replace.

Global routing is off`)
    const unusable = filesReport({ daemon: { version: '0.1.0', apiVersion: CONTROL_API_VERSION + 1, pid: 4242, port: 40123, startedAt: NOW - HOUR } })
    expect(reportJson(unusable, NOW, { keychain: false })).toMatchObject({ source: 'files', daemon: { older: false, newer: true } })
    const text = formatReport(unusable, NOW, { keychain: false })
    expect(text).toContain(`It runs a newer kurmis than this one (0.1.0), which this kurmis does not replace
and cannot use. Update this kurmis, or stop the daemon with "kurmis daemon stop"
and run the command again.`)
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80)
  })

  test('says when it cannot read the status of the daemon that runs', () => {
    const report = filesReport({ daemon: { version: '0.0.9', pid: 4242, port: 40123, startedAt: NOW - HOUR } })
    expect(reportJson(report, NOW, { keychain: false })).toMatchObject({ source: 'files', daemon: { version: '0.0.9', older: true } })
    expect(formatReport(report, NOW, { keychain: false })).toContain(`kurmis daemon 0.0.9, pid 4242, port 40123, running for 1h
It runs an older kurmis than this one (0.1.0).`)
    expect(formatReport(report, NOW, { keychain: false })).toContain('replaces it.\nThis kurmis cannot read its status.\n\nGlobal routing is paused')
    expect(formatReport(report, NOW, { keychain: false })).toContain('Logins are read from config.json, and the usage is cached by the daemon:\n')
  })
})
