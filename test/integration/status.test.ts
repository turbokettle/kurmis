// `kurmis status --json` (and the text form) end to end: the real bundle starts the real daemon,
// whose usage probes run the fake claude and the fake codex app-server against each login's own
// folder. Each login's `get_usage` and rate-limit answers come from the scenario file in that
// folder (`~/.claude` and `~/.codex` of the world's HOME for the default logins).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  reply,
  writeClaudeIdentity,
  writeClaudeScenario,
  writeCodexAuth,
  writeCodexScenario
} from '../fakes/index.ts'
import { createWorld, PACKAGE_VERSION, waitUntil, type StatusJson, type World } from './harness.ts'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const SESSION_A = '0b7c0a52-1111-4222-8333-94444555aaaa'

type StatusLogin = StatusJson['logins'][number]

function loginOf(status: StatusJson, id: string): StatusLogin {
  const login = status.logins.find((row) => row.id === id)
  if (login === undefined) throw new Error(`${id} is not in the status`)
  return login
}

function windowOf(login: StatusLogin, key: string): NonNullable<StatusLogin['usage']>['windows'][number] | undefined {
  return login.usage?.windows.find((window) => window.key === key)
}

/** An ISO time `ms` from now. */
function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

/** The ISO form of a time the API or app-server sends in whole unix seconds. */
function isoSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

async function statusJson(world: World): Promise<StatusJson> {
  const result = await world.kurmis(['status', '--json'])
  expect(result, JSON.stringify(result)).toMatchObject({ code: 0, stderr: '' })
  return JSON.parse(result.stdout) as StatusJson
}

/**
 * `kurmis status --json` once every login has been probed. `status` waits for a probe only while
 * no login has usage at all, so a first call can come back while some probes still run.
 */
async function probedStatus(world: World): Promise<StatusJson> {
  let status = await statusJson(world)
  await waitUntil(async () => {
    if (status.logins.every((login) => login.usage !== null && !login.probing)) return true
    status = await statusJson(world)
    return false
  }, 30_000, 'every login to be probed')
  return status
}

describe.skipIf(process.platform === 'win32')('kurmis status, end to end', () => {
  it("shows every Claude and Codex login's probed usage, limits and blocks", async () => {
    const world = await createWorld()
    const nowSeconds = Math.floor(Date.now() / 1000)

    // claude:default: the machine's own login, its usage read through ~/.claude.
    world.signInDefaultClaude()
    writeClaudeIdentity(join(world.home, '.claude.json'), { email: 'default@example.com' })
    const defaultFiveHourReset = isoIn(2 * HOUR_MS)
    const defaultWeekReset = isoIn(DAY_MS)
    writeClaudeScenario(join(world.home, '.claude'), {
      fiveHour: { utilization: 61, resetsAt: defaultFiveHourReset },
      sevenDay: { utilization: 20, resetsAt: defaultWeekReset }
    })

    // claude:work: over the weekly limit it is given below.
    await world.addClaudeLogin('work', { label: 'Work', email: 'work@example.com' })
    const workWeekReset = isoIn(3 * DAY_MS)
    writeClaudeScenario(world.loginFolder('claude:work'), {
      fiveHour: 7,
      sevenDay: { utilization: 95, resetsAt: workWeekReset },
      usage: { subscription_type: 'team' }
    })
    expect((await world.kurmis(['set', 'claude:work', '--five-hour', '80', '--weekly', '90'])).code).toBe(0)

    // codex:default: ~/.codex.
    writeCodexAuth(join(world.home, '.codex'), { email: 'codex-default@example.com', planType: 'plus' })
    writeCodexScenario(join(world.home, '.codex'), {
      primary: { usedPercent: 30, resetsAt: nowSeconds + 3600 },
      secondary: { usedPercent: 50, resetsAt: nowSeconds + 5 * 86_400 }
    })

    // codex:spare: signed in before `kurmis login` looks, since the fake `codex login` writes no
    // auth.json. Over the five-hour limit it is given below.
    writeCodexAuth(world.loginFolder('codex:spare'), { email: 'codex-spare@example.com', planType: 'pro' })
    writeCodexScenario(world.loginFolder('codex:spare'), { primary: { usedPercent: 99, resetsAt: nowSeconds + 1800 } })
    const added = await world.kurmis(['login', 'codex', '--name', 'spare', '--label', 'Spare'])
    expect(added, JSON.stringify(added)).toMatchObject({ code: 0 })
    expect((await world.kurmis(['set', 'codex:spare', '--five-hour', '90'])).code).toBe(0)

    // Nothing has started a daemon yet: `status` starts one and waits for its first probes.
    expect(world.daemonInfo()).toBeNull()
    const startedAround = Date.now()
    const status = await probedStatus(world)
    const daemon = world.daemonInfo()
    expect(daemon).not.toBeNull()

    expect(status.format).toBe(1)
    expect(status.daemon).toEqual({ version: PACKAGE_VERSION, pid: daemon?.pid, port: world.port, startedAt: new Date(daemon?.startedAt ?? 0).toISOString() })
    expect(Math.abs(Date.parse(status.daemon.startedAt) - startedAround)).toBeLessThan(MINUTE_MS)
    expect(status.logins.map((login) => login.id)).toEqual(['claude:default', 'codex:default', 'claude:work', 'codex:spare'])
    for (const login of status.logins) {
      expect(login, login.id).toMatchObject({ signedIn: true, probing: false, routing: true, useFirst: false })
      expect(login.usage, login.id).toMatchObject({ source: 'probe', error: null })
      expect(Math.abs(Date.parse(login.usage?.fetchedAt ?? '') - Date.now()), login.id).toBeLessThan(5 * MINUTE_MS)
    }

    const claudeDefault = loginOf(status, 'claude:default')
    expect(claudeDefault).toMatchObject({ provider: 'claude', label: 'default', email: 'default@example.com', fiveHourLimit: 100, weeklyLimit: 100, blocked: null, sessions: 0 })
    expect(windowOf(claudeDefault, 'five_hour')).toEqual({
      key: 'five_hour', label: '5 hour', durationMinutes: 300, utilization: 61, resetsAt: defaultFiveHourReset, plan: true, limitPercent: 100
    })
    expect(windowOf(claudeDefault, 'seven_day')).toEqual({
      key: 'seven_day', label: '7 day', durationMinutes: 10080, utilization: 20, resetsAt: defaultWeekReset, plan: true, limitPercent: 100
    })
    // The fake's Opus window meters one model, so no routing limit applies to it.
    expect(windowOf(claudeDefault, 'seven_day_opus')).toMatchObject({ utilization: 4, plan: false, limitPercent: null })

    const work = loginOf(status, 'claude:work')
    expect(work).toMatchObject({ provider: 'claude', label: 'Work', email: 'work@example.com', fiveHourLimit: 80, weeklyLimit: 90, sessions: 0 })
    expect(work.usage?.plan).toBe('team')
    expect(windowOf(work, 'five_hour')).toMatchObject({ utilization: 7, limitPercent: 80 })
    expect(windowOf(work, 'seven_day')).toMatchObject({ utilization: 95, resetsAt: workWeekReset, limitPercent: 90 })
    expect(work.blocked).toMatchObject({ kind: 'over-limit', until: workWeekReset })

    const codexDefault = loginOf(status, 'codex:default')
    expect(codexDefault).toMatchObject({ provider: 'codex', label: 'default', fiveHourLimit: 100, weeklyLimit: 100, blocked: null, sessions: null })
    expect(codexDefault.usage?.plan).toBe('plus')
    expect(codexDefault.usage?.windows).toEqual([
      { key: 'codex:primary', label: 'Codex 5h', durationMinutes: 300, utilization: 30, resetsAt: isoSeconds(nowSeconds + 3600), plan: true, limitPercent: 100 },
      { key: 'codex:secondary', label: 'Codex 7d', durationMinutes: 10080, utilization: 50, resetsAt: isoSeconds(nowSeconds + 5 * 86_400), plan: true, limitPercent: 100 }
    ])

    const spare = loginOf(status, 'codex:spare')
    expect(spare).toMatchObject({ provider: 'codex', label: 'Spare', fiveHourLimit: 90, weeklyLimit: 100, sessions: null })
    expect(spare.usage?.plan).toBe('pro')
    expect(windowOf(spare, 'codex:primary')).toMatchObject({ utilization: 99, resetsAt: isoSeconds(nowSeconds + 1800), limitPercent: 90 })
    expect(spare.blocked).toMatchObject({ kind: 'over-limit', until: isoSeconds(nowSeconds + 1800) })
    expect(status.codexStart).toEqual({ login: 'codex:default', note: null })

    // Each Codex login was probed in its own home: codex:default with CODEX_HOME left unset.
    const probedHomes = world.codexRecord()
      .filter((line) => line.event === 'start' && line.mode === 'app-server')
      .map((line) => line.event === 'start' ? line.codexHome : undefined)
    expect(new Set(probedHomes)).toEqual(new Set([null, world.loginFolder('codex:spare')]))

    // The text form says the same.
    const text = await world.kurmis(['status'])
    expect(text.code).toBe(0)
    expect(text.stdout).toContain(`kurmis daemon ${PACKAGE_VERSION}, pid ${String(daemon?.pid)}, port ${String(world.port)}`)
    expect(text.stdout).toContain('claude:default  default@example.com\n')
    expect(text.stdout).toContain('claude:work  "Work"  work@example.com\n  signed in, routing on, limits 80% 5 hour, 90% weekly, 0 sessions, plan team\n')
    expect(text.stdout).toMatch(/\n {2}7 day +95% {2}resets in [^\n]+limit 90%\n/)
    expect(text.stdout).toContain('codex:spare  "Spare"\n')
    expect(text.stdout).toMatch(/\n {2}Codex 5h +99% {2}resets in [^\n]+limit 90%\n/)
    expect(text.stdout).toContain('kurmis codex would start on codex:default.')
    expect((text.stdout.match(/\n {2}passed over: /g) ?? []).length).toBe(2)

    // Emails are shown, never kept by the daemon.
    for (const file of ['daemon.log', 'state.json', 'config.json']) {
      expect(readFileSync(join(world.data, file), 'utf8'), file).not.toContain('@example.com')
    }
  }, 120_000)

  it('shows signed-out logins, a failed probe, and what forwarded answers and a usage-limit 429 told the daemon', async () => {
    const world = await createWorld()
    // claude:default and codex:default have no credentials at all.
    const work = await world.addClaudeLogin('work')
    const spare = await world.addClaudeLogin('spare')
    writeClaudeScenario(world.loginFolder('claude:spare'), { getUsage: 'error' })

    const first = await probedStatus(world)
    expect(loginOf(first, 'claude:default')).toMatchObject({
      signedIn: false, email: null, blocked: { kind: 'signed-out', until: null }, usage: { windows: [], error: null }
    })
    expect(loginOf(first, 'codex:default')).toMatchObject({ signedIn: false, blocked: { kind: 'signed-out' } })
    expect(loginOf(first, 'claude:spare')).toMatchObject({ signedIn: true, blocked: null, usage: { source: 'probe', windows: [] } })
    expect(loginOf(first, 'claude:spare').usage?.error).toEqual(expect.any(String))
    expect(loginOf(first, 'claude:work')).toMatchObject({ signedIn: true, blocked: null, sessions: 0, usage: { source: 'probe', error: null } })
    expect(first.codexStart).toEqual({ login: 'codex:default', note: expect.stringContaining('No Codex login') as string })

    // A forwarded answer's rate-limit headers update the usage of the login that served it.
    const fiveHourReset = Math.floor((Date.now() + HOUR_MS) / 1000)
    const weekReset = Math.floor((Date.now() + DAY_MS) / 1000)
    world.api.scriptFor(work, reply.ok({
      text: 'From work',
      unified: { fiveHour: { utilization: 0.5, resetsAt: fiveHourReset * 1000 }, sevenDay: { utilization: 0.25, resetsAt: weekReset * 1000 } }
    }))
    expect(await world.kurmis(['claude', '-p', 'hi', '--session-id', SESSION_A])).toMatchObject({ code: 0, stdout: 'From work\n' })
    const afterAnswer = loginOf(await statusJson(world), 'claude:work')
    expect(afterAnswer).toMatchObject({ sessions: 1, blocked: null, usage: { source: 'session' } })
    expect(windowOf(afterAnswer, 'five_hour')).toMatchObject({ utilization: 50, resetsAt: isoSeconds(fiveHourReset) })
    expect(windowOf(afterAnswer, 'seven_day')).toMatchObject({ utilization: 25, resetsAt: isoSeconds(weekReset) })

    // A usage-limit 429 starts a cooldown until the reset it names; the request goes on to spare.
    const quotaReset = Math.floor((Date.now() + 2 * HOUR_MS) / 1000)
    world.api.scriptFor(work, reply.quota({ claim: 'five_hour', resetsAt: quotaReset * 1000 }))
    world.api.scriptFor(spare, reply.ok({ text: 'From spare' }))
    expect(await world.kurmis(['claude', '-p', 'hi'])).toMatchObject({ code: 0, stdout: 'From spare\n' })
    const afterQuota = await statusJson(world)
    const cooled = loginOf(afterQuota, 'claude:work')
    expect(cooled.blocked).toMatchObject({ kind: 'cooldown', until: isoSeconds(quotaReset) })
    expect(windowOf(cooled, 'five_hour')).toMatchObject({ utilization: 100, resetsAt: isoSeconds(quotaReset) })
    expect(loginOf(afterQuota, 'claude:spare')).toMatchObject({ sessions: 1, blocked: null, usage: { source: 'session', error: null } })

    const text = await world.kurmis(['status'])
    expect(text.stdout).toContain('claude:default\n  signed out, routing on')
    expect(text.stdout).toMatch(/claude:work {2}work@example\.com\n[^\n]*1 session[^\n]*\n(?: {2}[^\n]*\n)*? {2}usage read just now from a forwarded answer\n {2}passed over: /)
  }, 120_000)
})
