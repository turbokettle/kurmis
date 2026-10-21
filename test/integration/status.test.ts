// `kurmis status --json` (and the text form) end to end: the real bundle starts the real daemon,
// whose usage probes run the fake claude and the fake codex app-server against each login's own
// folder. Each login's `get_usage` and rate-limit answers come from the scenario file in that
// folder (`~/.claude` and `~/.codex` of the world's HOME for the logins of plain claude and plain codex).
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
import { createWorld, OWN_CLAUDE, OWN_CODEX, PACKAGE_VERSION, waitUntil, type StatusJson, type World } from './harness.ts'

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

/** The line `kurmis status` prints under the title of the login plain claude or plain codex uses. */
function ownLine(provider: 'claude' | 'codex'): string {
  return `  the login plain ${provider} uses\n`
}

describe('kurmis status, end to end', () => {
  it("shows every Claude and Codex login's probed usage, limits and blocks, and gives the logins of plain claude and plain codex aliases from their emails", async () => {
    const world = await createWorld()
    const nowSeconds = Math.floor(Date.now() / 1000)

    // The login plain claude uses, its usage read through ~/.claude.
    world.signInDefaultClaude()
    writeClaudeIdentity(join(world.home, '.claude.json'), { email: 'default@example.com' })
    const defaultFiveHourReset = isoIn(2 * HOUR_MS)
    const defaultWeekReset = isoIn(DAY_MS)
    writeClaudeScenario(join(world.home, '.claude'), {
      fiveHour: { utilization: 61, resetsAt: defaultFiveHourReset },
      sevenDay: { utilization: 20, resetsAt: defaultWeekReset }
    })

    // An extra Claude login, over the weekly limit it is given below.
    const work = await world.addClaudeLogin('work@example.com')
    const workWeekReset = isoIn(3 * DAY_MS)
    writeClaudeScenario(work.folder, {
      fiveHour: 7,
      sevenDay: { utilization: 95, resetsAt: workWeekReset },
      usage: { subscription_type: 'team' }
    })
    expect((await world.kurmis(['set', 'work-example', '--five-hour', '80', '--weekly', '90'])).code).toBe(0)

    // The login plain codex uses: ~/.codex.
    writeCodexAuth(join(world.home, '.codex'), { email: 'codex-default@example.com', planType: 'plus' })
    writeCodexScenario(join(world.home, '.codex'), {
      primary: { usedPercent: 30, resetsAt: nowSeconds + 3600 },
      secondary: { usedPercent: 50, resetsAt: nowSeconds + 5 * 86_400 }
    })

    // An extra Codex login, over the five-hour limit it is given below.
    const spare = await world.addCodexLogin({ email: 'codex-spare@example.com', planType: 'pro' })
    expect(spare.alias).toBe('codex-spare-example')
    writeCodexScenario(spare.folder, { primary: { usedPercent: 99, resetsAt: nowSeconds + 1800 } })
    expect((await world.kurmis(['set', 'codex-spare-example', '--five-hour', '90'])).code).toBe(0)

    // Nothing has told kurmis the emails of the logins of plain claude and plain codex yet.
    expect([world.configLogin(OWN_CLAUDE).alias, world.configLogin(OWN_CODEX).alias]).toEqual([OWN_CLAUDE, OWN_CODEX])

    // Nothing has started a daemon yet, and `status` starts none: it shows the files.
    const offline = await statusJson(world)
    expect(world.daemonInfo()).toBeNull()
    expect(offline).toMatchObject({ format: 3, daemon: null, source: 'files', globalRouting: 'off', codexStart: null, warnings: [] })
    expect(offline.logins.map((login) => [login.id, login.signedIn, login.credentials, login.usage, login.blocked])).toEqual([
      [OWN_CLAUDE, null, true, null, null], [OWN_CODEX, null, true, null, null], [work.id, null, true, null, null], [spare.id, null, true, null, null]
    ])
    // Claude emails come from the profile files; a Codex login's only a running daemon knows.
    expect(offline.logins.map((login) => login.email)).toEqual(['default@example.com', null, 'work@example.com', null])
    const offlineText = await world.kurmis(['status'])
    expect(offlineText.stdout).toMatch(/^The kurmis daemon is not running\. /)
    expect(offlineText.stdout).toContain(`work-example (Claude, id ${work.id})  work@example.com\n  credentials on this machine, routing on`)

    const startedAround = Date.now()
    expect((await world.kurmis(['daemon', 'start'])).code).toBe(0)
    const status = await probedStatus(world)
    const daemon = world.daemonInfo()
    expect(daemon).not.toBeNull()

    expect(status).toMatchObject({ format: 3, source: 'daemon', globalRouting: 'off' })
    expect(status.daemon).toEqual({
      version: PACKAGE_VERSION, pid: daemon?.pid, port: world.port, startedAt: new Date(daemon?.startedAt ?? 0).toISOString(), older: false
    })
    expect(Math.abs(Date.parse(status.daemon?.startedAt ?? '') - startedAround)).toBeLessThan(MINUTE_MS)
    expect(status.logins.map((login) => [login.id, login.machineOwn])).toEqual([[OWN_CLAUDE, true], [OWN_CODEX, true], [work.id, false], [spare.id, false]])
    expect(status.warnings).toEqual([])
    for (const login of status.logins) {
      expect(login, login.id).toMatchObject({ signedIn: true, probing: false, routing: true, useFirst: false })
      expect(login.usage, login.id).toMatchObject({ source: 'probe', error: null })
      expect(Math.abs(Date.parse(login.usage?.fetchedAt ?? '') - Date.now()), login.id).toBeLessThan(5 * MINUTE_MS)
    }

    // The probes told the daemon the emails of the logins of plain claude and plain codex, and it gave them their
    // automatic aliases in config.json.
    expect(world.configLogin(OWN_CLAUDE)).toMatchObject({ machineOwn: true, alias: 'default-example', aliasSetByUser: false })
    expect(world.configLogin(OWN_CODEX)).toMatchObject({ machineOwn: true, alias: 'codex-default-example', aliasSetByUser: false })

    const claudeDefault = loginOf(status, OWN_CLAUDE)
    expect(claudeDefault).toMatchObject({
      provider: 'claude', alias: 'default-example', email: 'default@example.com', fiveHourLimit: 100, weeklyLimit: 100, blocked: null, sessions: 0
    })
    expect(windowOf(claudeDefault, 'five_hour')).toEqual({
      key: 'five_hour', label: '5 hour', durationMinutes: 300, utilization: 61, resetsAt: defaultFiveHourReset, plan: true, limitPercent: 100
    })
    expect(windowOf(claudeDefault, 'seven_day')).toEqual({
      key: 'seven_day', label: '7 day', durationMinutes: 10080, utilization: 20, resetsAt: defaultWeekReset, plan: true, limitPercent: 100
    })
    // The fake's Opus window meters one model, so no routing limit applies to it.
    expect(windowOf(claudeDefault, 'seven_day_opus')).toMatchObject({ utilization: 4, plan: false, limitPercent: null })
    // The fake also lists the same Opus window in model_scoped, as get_usage can; it is shown once.
    expect(claudeDefault.usage?.windows.map((window) => window.key)).toEqual(['five_hour', 'seven_day', 'seven_day_opus'])

    const workRow = loginOf(status, work.id)
    expect(workRow).toMatchObject({ provider: 'claude', alias: 'work-example', email: 'work@example.com', fiveHourLimit: 80, weeklyLimit: 90, sessions: 0 })
    expect(workRow.usage?.plan).toBe('team')
    expect(windowOf(workRow, 'five_hour')).toMatchObject({ utilization: 7, limitPercent: 80 })
    expect(windowOf(workRow, 'seven_day')).toMatchObject({ utilization: 95, resetsAt: workWeekReset, limitPercent: 90 })
    expect(workRow.blocked).toMatchObject({ kind: 'over-limit', until: workWeekReset })

    const codexDefault = loginOf(status, OWN_CODEX)
    expect(codexDefault).toMatchObject({
      provider: 'codex', alias: 'codex-default-example', email: 'codex-default@example.com', fiveHourLimit: 100, weeklyLimit: 100, blocked: null, sessions: null
    })
    expect(codexDefault.usage?.plan).toBe('plus')
    expect(codexDefault.usage?.windows).toEqual([
      { key: 'codex:primary', label: 'Codex 5h', durationMinutes: 300, utilization: 30, resetsAt: isoSeconds(nowSeconds + 3600), plan: true, limitPercent: 100 },
      { key: 'codex:secondary', label: 'Codex 7d', durationMinutes: 10080, utilization: 50, resetsAt: isoSeconds(nowSeconds + 5 * 86_400), plan: true, limitPercent: 100 }
    ])

    const spareRow = loginOf(status, spare.id)
    expect(spareRow).toMatchObject({ provider: 'codex', alias: 'codex-spare-example', fiveHourLimit: 90, weeklyLimit: 100, sessions: null })
    expect(spareRow.usage?.plan).toBe('pro')
    expect(windowOf(spareRow, 'codex:primary')).toMatchObject({ utilization: 99, resetsAt: isoSeconds(nowSeconds + 1800), limitPercent: 90 })
    expect(spareRow.blocked).toMatchObject({ kind: 'over-limit', until: isoSeconds(nowSeconds + 1800) })
    expect(status.codexStart).toEqual({ login: OWN_CODEX, alias: 'codex-default-example', note: null })

    // Each Codex login was probed in its own home: the one plain codex uses with CODEX_HOME left unset.
    const probedHomes = world.codexRecord()
      .filter((line) => line.event === 'start' && line.mode === 'app-server')
      .map((line) => line.event === 'start' ? line.codexHome : undefined)
    expect(new Set(probedHomes)).toEqual(new Set([null, spare.folder]))

    // The text form says the same, and marks the logins of plain claude and plain codex.
    const text = await world.kurmis(['status'])
    expect(text.code).toBe(0)
    expect(text.stdout).toContain(`kurmis daemon ${PACKAGE_VERSION}, pid ${String(daemon?.pid)}, port ${String(world.port)}`)
    expect(text.stdout).toContain(`default-example (Claude, id ${OWN_CLAUDE})  default@example.com\n${ownLine('claude')}  signed in, routing on`)
    expect(text.stdout).toContain(`codex-default-example (Codex, id ${OWN_CODEX})  codex-default@example.com\n${ownLine('codex')}  signed in, routing on`)
    expect(text.stdout).toContain(`work-example (Claude, id ${work.id})  work@example.com\n` +
      '  signed in, routing on, limits 80% 5 hour, 90% weekly, 0 sessions, plan team\n')
    expect(text.stdout).toMatch(/\n {2}7 day +95% {2}resets in [^\n]+limit 90%\n/)
    expect(text.stdout).toContain(`codex-spare-example (Codex, id ${spare.id})  codex-spare@example.com\n  signed in`)
    expect(text.stdout).toMatch(/\n {2}Codex 5h +99% {2}resets in [^\n]+limit 90%\n/)
    expect(text.stdout).toContain('kurmis codex would start on codex-default-example.')
    expect(text.stdout.match(/^ {2}the login plain (claude|codex) uses$/gm)).toHaveLength(2)
    expect((text.stdout.match(/\n {2}passed over: /g) ?? []).length).toBe(2)

    // Emails are shown, never kept by the daemon.
    for (const file of ['daemon.log', 'state.json', 'config.json']) {
      expect(readFileSync(join(world.data, file), 'utf8'), file).not.toContain('@example.com')
    }
  }, 120_000)

  it('shows signed-out logins, a failed probe, and what forwarded answers and a usage-limit 429 told the daemon', async () => {
    const world = await createWorld()
    // The logins of plain claude and plain codex have no credentials at all.
    const work = await world.addClaudeLogin('work@example.com')
    const spare = await world.addClaudeLogin('spare@example.com')
    writeClaudeScenario(spare.folder, { getUsage: 'error' })

    expect((await world.kurmis(['daemon', 'start'])).code).toBe(0)
    const first = await probedStatus(world)
    expect(loginOf(first, OWN_CLAUDE)).toMatchObject({
      alias: OWN_CLAUDE, machineOwn: true, signedIn: false, email: null, blocked: { kind: 'signed-out', until: null }, usage: { windows: [], error: null }
    })
    expect(loginOf(first, OWN_CODEX)).toMatchObject({ alias: OWN_CODEX, machineOwn: true, signedIn: false, blocked: { kind: 'signed-out' } })
    expect(loginOf(first, spare.id)).toMatchObject({ alias: 'spare-example', signedIn: true, blocked: null, usage: { source: 'probe', windows: [] } })
    expect(loginOf(first, spare.id).usage?.error).toEqual(expect.any(String))
    expect(loginOf(first, work.id)).toMatchObject({ alias: 'work-example', signedIn: true, blocked: null, sessions: 0, usage: { source: 'probe', error: null } })
    expect(first.codexStart).toEqual({ login: OWN_CODEX, alias: OWN_CODEX, note: expect.stringContaining('No Codex login') as string })

    // A forwarded answer's rate-limit headers update the usage of the login that served it.
    const fiveHourReset = Math.floor((Date.now() + HOUR_MS) / 1000)
    const weekReset = Math.floor((Date.now() + DAY_MS) / 1000)
    world.api.scriptFor(work.token, reply.ok({
      text: 'From work',
      unified: { fiveHour: { utilization: 0.5, resetsAt: fiveHourReset * 1000 }, sevenDay: { utilization: 0.25, resetsAt: weekReset * 1000 } }
    }))
    expect(await world.kurmis(['claude', '-p', 'hi', '--session-id', SESSION_A])).toMatchObject({ code: 0, stdout: 'From work\n' })
    const afterAnswer = loginOf(await statusJson(world), work.id)
    expect(afterAnswer).toMatchObject({ sessions: 1, blocked: null, usage: { source: 'session' } })
    expect(windowOf(afterAnswer, 'five_hour')).toMatchObject({ utilization: 50, resetsAt: isoSeconds(fiveHourReset) })
    expect(windowOf(afterAnswer, 'seven_day')).toMatchObject({ utilization: 25, resetsAt: isoSeconds(weekReset) })

    // A usage-limit 429 starts a cooldown until the reset it names; the request goes on to spare.
    const quotaReset = Math.floor((Date.now() + 2 * HOUR_MS) / 1000)
    world.api.scriptFor(work.token, reply.quota({ claim: 'five_hour', resetsAt: quotaReset * 1000 }))
    world.api.scriptFor(spare.token, reply.ok({ text: 'From spare' }))
    expect(await world.kurmis(['claude', '-p', 'hi'])).toMatchObject({ code: 0, stdout: 'From spare\n' })
    const afterQuota = await statusJson(world)
    const cooled = loginOf(afterQuota, work.id)
    expect(cooled.blocked).toMatchObject({ kind: 'cooldown', until: isoSeconds(quotaReset) })
    expect(windowOf(cooled, 'five_hour')).toMatchObject({ utilization: 100, resetsAt: isoSeconds(quotaReset) })
    expect(loginOf(afterQuota, spare.id)).toMatchObject({ sessions: 1, blocked: null, usage: { source: 'session', error: null } })

    const text = await world.kurmis(['status'])
    expect(text.stdout).toContain(`${OWN_CLAUDE} (Claude, id ${OWN_CLAUDE})\n${ownLine('claude')}  signed out, routing on`)
    expect(text.stdout).toMatch(new RegExp(`work-example \\(Claude, id ${work.id}\\) {2}work@example\\.com\\n[^\\n]*1 session[^\\n]*\\n` +
      '(?: {2}[^\\n]*\\n)*? {2}usage read just now from a forwarded answer\\n {2}passed over: '))
    // The text gives the cooldown's end in local time; the JSON above keeps it as ISO.
    expect(text.stdout).toMatch(/passed over: cooling down until (?:\d{4}-\d{2}-\d{2} )?\d{2}:\d{2} \(in [^)]+\)\n/)
  }, 120_000)
})
