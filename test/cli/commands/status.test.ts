import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { createStatusCommand, nothingProbedYet, type StatusDeps } from '../../../src/cli/commands/status.ts'
import type { StatusJson } from '../../../src/cli/status-format.ts'
import { configPath, kurmisHome, loginFolder } from '../../../src/data/paths.ts'
import { emptyState, saveStateSync } from '../../../src/data/state.ts'
import type { LoginId } from '../../../src/data/login-id.ts'
import { findProgram } from '../../../src/platform/programs.ts'
import { runProgram } from '../../../src/platform/run.ts'
import { codexUsage } from '../../core/codex-usage-fixture.ts'
import { accountUsage, usageWindow } from '../../core/usage-fixtures.ts'
import { FAKE_CODEX_SCRIPT, readCodexRecord, writeClaudeCredentials, writeClaudeIdentity, writeCodexKeyringAuth } from '../../fakes/index.ts'
import { collect, fakeDaemonClient, loginStatus, statusAnswer } from '../helpers.ts'
import { claudeRef, codexRef, OWN_CLAUDE, OWN_CLAUDE_REF, OWN_CODEX, OWN_CODEX_REF, writeTestConfig } from '../../logins.ts'

const NOW = Date.parse('2026-09-13T01:10:00.000Z')
const HOUR = 60 * 60_000

const PROBED = statusAnswer([
  loginStatus(OWN_CLAUDE_REF),
  loginStatus(OWN_CODEX_REF, { usage: codexUsage('owncodex01', { fiveHour: 7, fetchedAt: NOW }) })
])

const home = join(process.env.HOME!, 'status-home')

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
  rmSync(home, { recursive: true, force: true, maxRetries: 10 })
  mkdirSync(home, { recursive: true })
})

/** The status command with fakes; global routing is off unless `overrides` says otherwise. */
function command(overrides: Partial<StatusDeps> = {}) {
  return createStatusCommand({ now: () => NOW, platform: 'linux', home: () => home, globalRouting: () => 'off', version: '0.1.0', ...overrides })
}

describe('kurmis status with the daemon running', () => {
  test('prints the status as text, without starting a daemon', async () => {
    const daemon = fakeDaemonClient({ status: PROBED })
    const out = collect()
    expect(await command({ daemon }).run([], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['findDaemon', 'readStatus'])
    expect(out.stdout()).toContain('kurmis daemon 0.1.0, pid 4242, port 40123')
    expect(out.stdout()).toContain('Global routing is off: only Claude Code started with "kurmis claude" goes\nthrough kurmis. "kurmis setup" turns it on.\n')
    expect(out.stdout()).toContain('  Codex 5h    7%')
    // The alias is the id, so the id is not repeated.
    expect(out.stdout()).toContain('ownclaude1 (Claude)\n  the login plain claude uses\n  signed in')
    expect(out.stderr()).toBe('')
  })

  test('--json prints the status JSON', async () => {
    const daemon = fakeDaemonClient({ status: PROBED })
    const out = collect()
    expect(await command({ daemon, globalRouting: () => 'paused' }).run(['--json'], out.context)).toBe(0)
    const json = JSON.parse(out.stdout()) as StatusJson
    expect(json).toMatchObject({ format: 4, source: 'daemon', globalRouting: 'paused', daemon: { version: '0.1.0', pid: 4242, older: false } })
    expect(json.logins.map((login) => [login.id, login.alias, login.usedByPlainCli, login.signedIn, login.credentials])).toEqual([
      ['ownclaude1', 'ownclaude1', true, true, null], ['owncodex01', 'owncodex01', true, true, null]
    ])
    expect(json.warnings).toEqual([])
  })

  test('warns when an extra login is the same account as the login plain claude uses', async () => {
    const status = statusAnswer([
      loginStatus(OWN_CLAUDE_REF, { email: 'own@example.com', usage: PROBED.logins[1]!.usage }),
      loginStatus({ ...claudeRef('workclaude'), alias: 'own-example' }, { email: 'own@example.com' })
    ])
    const daemon = fakeDaemonClient({ status })
    const text = collect()
    expect(await command({ daemon }).run([], text.context)).toBe(0)
    expect(text.stdout()).toContain('Warning: own-example and ownclaude1, the login plain claude uses, are the')
    const json = collect()
    expect(await command({ daemon }).run(['--json'], json.context)).toBe(0)
    expect((JSON.parse(json.stdout()) as StatusJson).warnings).toEqual([expect.stringContaining('"kurmis logout own-example"')])
  })

  test('asks for a probe once when no login has been probed yet', async () => {
    const daemon = fakeDaemonClient({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF), loginStatus(OWN_CODEX_REF)]), probed: PROBED })
    const out = collect()
    await command({ daemon }).run(['--json'], out.context)
    expect(daemon.calls).toEqual(['findDaemon', 'readStatus', 'requestProbe'])
    expect(out.stdout()).toContain('"codex:primary"')
  })

  test('shows what the daemon has when the first probe takes too long', async () => {
    const daemon = fakeDaemonClient({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF)]) })
    let probeSignal: AbortSignal | undefined
    daemon.requestProbe = (_connection, _logins, signal) => {
      probeSignal = signal
      return new Promise(() => undefined)
    }
    const out = collect()
    expect(await command({ daemon, probeWaitMs: 20 }).run([], out.context)).toBe(0)
    // The probe request is ended, so its connection does not keep the CLI running.
    expect(probeSignal?.aborted).toBe(true)
    expect(out.stderr()).toContain('the first usage probe did not finish within 0.02 s')
    expect(out.stdout()).toContain('usage not read yet')
  })

  test('shows the status of an older daemon and says the next start replaces it, without replacing it', async () => {
    const daemon = fakeDaemonClient({ status: PROBED })
    const out = collect()
    expect(await command({ daemon, version: '0.2.0' }).run([], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['findDaemon', 'readStatus'])
    expect(out.stdout()).toContain('kurmis daemon 0.1.0, pid 4242, port 40123, running for')
    expect(out.stdout()).toContain('It runs an older kurmis than this one (0.2.0).')
    expect(out.stdout()).toContain('  signed in, routing on')
  })

  test('shows the files when the daemon answers in a control API version this kurmis cannot read', async () => {
    writeTestConfig()
    const daemon = fakeDaemonClient({ status: { ...PROBED, version: '0.0.9', apiVersion: 1 } })
    const out = collect()
    expect(await command({ daemon }).run(['--json'], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['findDaemon', 'readStatus'])
    const json = JSON.parse(out.stdout()) as StatusJson
    expect(json).toMatchObject({ source: 'files', daemon: { version: '0.0.9', older: true } })
    expect(json.logins.map((login) => [login.id, login.signedIn, login.credentials])).toEqual([[OWN_CLAUDE, null, false], [OWN_CODEX, null, false]])
  })

  test('shows the files, with a note on stderr, when the daemon does not answer the status request', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    const daemon = fakeDaemonClient({ readFails: 'the request timed out' })
    const out = collect()
    expect(await command({ daemon }).run([], out.context)).toBe(0)
    expect(out.stderr()).toContain('kurmis status: the kurmis daemon (pid 4242) did not answer the status request: the request timed out')
    expect(out.stderr()).toContain('Showing the logins from config.json instead.')
    expect(out.stdout()).toContain('The kurmis daemon is not running.')
    expect(out.stdout()).toContain('work-example (Claude, id workclaude)')
    const json = collect()
    expect(await command({ daemon }).run(['--json'], json.context)).toBe(0)
    expect(JSON.parse(json.stdout())).toMatchObject({ source: 'files', daemon: null })
  })

  test('warns about two extra logins of one provider with the same email, and says how to remove the second', async () => {
    const status = statusAnswer([
      loginStatus(OWN_CLAUDE_REF, { email: 'own@example.com', usage: PROBED.logins[1]!.usage }),
      loginStatus(OWN_CODEX_REF),
      loginStatus({ ...claudeRef('workclaude'), alias: 'work-example' }, { email: 'work@example.com' }),
      loginStatus({ ...claudeRef('workagain'), alias: 'work-example-2' }, { email: 'Work@Example.com' }),
      // The same email on another provider is another account.
      loginStatus({ ...codexRef('workcodex1'), alias: 'work-example' }, { email: 'work@example.com' })
    ])
    const out = collect()
    expect(await command({ daemon: fakeDaemonClient({ status }) }).run(['--json'], out.context)).toBe(0)
    expect((JSON.parse(out.stdout()) as StatusJson).warnings).toEqual([
      'work-example-2 and work-example are the same Claude account (work@example.com), so they use one subscription. ' +
        '"kurmis logout work-example-2" removes work-example-2.'
    ])
  })

  test('an unknown option is a usage error', async () => {
    const out = collect()
    expect(await command({ daemon: fakeDaemonClient() }).run(['--yaml'], out.context)).toBe(2)
  })
})

describe('kurmis status with the daemon not running', () => {
  test('shows the logins of config.json, the usage of state.json with its age, and the credentials on this machine', async () => {
    writeTestConfig({
      extras: [
        { id: 'workclaude', provider: 'claude', alias: 'work-example', fiveHourLimit: 90, useFirst: true },
        { id: 'sidecodex1', provider: 'codex', routing: false }
      ]
    })
    const state = emptyState()
    state.usage.set('workclaude' as LoginId, accountUsage({ accountId: 'workclaude', fetchedAt: NOW - 3 * HOUR, fiveHour: usageWindow(42, new Date(NOW + HOUR).toISOString()) }))
    state.sessions.set('0b7c0a52-1111-4222-8333-944445555666', { login: 'workclaude' as LoginId, lastUsed: NOW - HOUR })
    saveStateSync(state)
    writeClaudeCredentials(loginFolder(claudeRef('workclaude')))
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'), { email: 'work@example.com' })

    const daemon = fakeDaemonClient({ running: false })
    const out = collect({})
    expect(await command({ daemon }).run([], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['findDaemon'])
    expect(out.stderr()).toBe('')
    const text = out.stdout()
    expect(text).toMatch(/^The kurmis daemon is not running\. "kurmis claude", "kurmis codex" without\n--login, "kurmis setup" and "kurmis daemon start" each start it\./)
    expect(text).toContain(`${OWN_CLAUDE} (Claude)\n  the login plain claude uses\n  no credentials on this machine, routing on`)
    expect(text).toContain('work-example (Claude, id workclaude)  work@example.com\n' +
      '  credentials on this machine, routing on, limits 90% 5 hour, 100% weekly,\n  use first, 1 session, plan max\n')
    expect(text).toContain('  usage read 3h ago\n')
    expect(text).toContain('sidecodex1 (Codex)\n  no credentials on this machine, routing off')
    expect(text).not.toContain('kurmis codex would start on')
    expect(text).not.toContain('passed over')

    const json = collect({})
    expect(await command({ daemon }).run(['--json'], json.context)).toBe(0)
    const parsed = JSON.parse(json.stdout()) as StatusJson
    expect(parsed).toMatchObject({ format: 4, daemon: null, source: 'files', globalRouting: 'off', codexStart: null, warnings: [] })
    expect(parsed.logins.map((login) => [login.id, login.alias, login.usedByPlainCli, login.signedIn, login.credentials, login.sessions])).toEqual([
      [OWN_CLAUDE, OWN_CLAUDE, true, null, false, 0], [OWN_CODEX, OWN_CODEX, true, null, false, null],
      ['workclaude', 'work-example', false, null, true, 1], ['sidecodex1', 'sidecodex1', false, null, false, null]
    ])
    expect(parsed.logins[2]?.usage).toMatchObject({ fetchedAt: new Date(NOW - 3 * HOUR).toISOString(), windows: [{ key: 'five_hour', utilization: 42 }] })
  })

  test('warns about an extra Claude login that is the account of the login plain claude uses, from the profile files', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'own-example' }] })
    writeClaudeIdentity(join(home, '.claude.json'), { email: 'own@example.com' })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'), { email: 'Own@Example.com' })
    const out = collect({})
    expect(await command({ daemon: fakeDaemonClient({ running: false }) }).run(['--json'], out.context)).toBe(0)
    expect((JSON.parse(out.stdout()) as StatusJson).warnings).toEqual([expect.stringContaining('"kurmis logout own-example"')])
  })

  test('warns when global routing is on', async () => {
    writeTestConfig()
    const out = collect({})
    expect(await command({ daemon: fakeDaemonClient({ running: false }), globalRouting: () => 'on' }).run([], out.context)).toBe(0)
    expect(out.stdout()).toContain('Warning: Global routing is on, but the daemon is not running')
  })

  test('reads global routing from the settings file and paused.json', async () => {
    writeTestConfig()
    const out = collect({ HOME: home })
    // The real globalRoutingState: no settings file and no paused.json.
    expect(await createStatusCommand({ daemon: fakeDaemonClient({ running: false }), home: () => home }).run(['--json'], out.context)).toBe(0)
    expect((JSON.parse(out.stdout()) as StatusJson).globalRouting).toBe('off')
  })

  test('says so when it cannot look for the daemon, and shows the files', async () => {
    writeTestConfig()
    const out = collect({})
    expect(await command({ daemon: fakeDaemonClient({ findFails: 'the key file cannot be read' }) }).run([], out.context)).toBe(0)
    expect(out.stderr()).toBe('kurmis status: could not look for the kurmis daemon: the key file cannot be read\n')
    expect(out.stdout()).toContain('The kurmis daemon is not running.')
  })

  test('writes nothing in a data folder that is gone, and shows the logins of plain claude and plain codex without an id', async () => {
    writeClaudeIdentity(join(home, '.claude.json'), { email: 'own@example.com' })
    const out = collect({ HOME: home })
    // The real globalRoutingState, which reads config.json for the port.
    expect(await createStatusCommand({ daemon: fakeDaemonClient({ running: false }), home: () => home, now: () => NOW })
      .run([], out.context)).toBe(0)
    expect(existsSync(kurmisHome())).toBe(false)
    expect(out.stdout()).toContain('the login plain claude uses (Claude, no id yet)  own@example.com\n' +
      '  config.json has no entry for it yet. The first kurmis command other than\n  "kurmis status" that reads config.json adds one, with an id.\n')
    expect(out.stdout()).toContain('the login plain codex uses (Codex, no id yet)')
    const json = collect({ HOME: home })
    expect(await command({ daemon: fakeDaemonClient({ running: false }) }).run(['--json'], json.context)).toBe(0)
    expect((JSON.parse(json.stdout()) as StatusJson).logins.map((login) => [login.id, login.alias, login.provider, login.usedByPlainCli]))
      .toEqual([[null, null, 'claude', true], [null, null, 'codex', true]])
    expect(existsSync(kurmisHome())).toBe(false)
  })

  test('leaves a config.json without the logins of plain claude and plain codex as it is', async () => {
    mkdirSync(kurmisHome(), { recursive: true })
    const text = JSON.stringify({ version: 2, port: 30001, logins: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    writeFileSync(configPath(), text)
    const out = collect({})
    expect(await createStatusCommand({ daemon: fakeDaemonClient({ running: false }), home: () => home, now: () => NOW })
      .run(['--json'], out.context)).toBe(0)
    expect(readFileSync(configPath(), 'utf8')).toBe(text)
    expect(readdirSync(kurmisHome())).toEqual(['config.json'])
    expect((JSON.parse(out.stdout()) as StatusJson).logins.map((login) => login.id)).toEqual([null, null, 'workclaude'])
  })

  test('a broken config.json is an error', async () => {
    mkdirSync(kurmisHome(), { recursive: true })
    writeFileSync(configPath(), '{"version": 7}')
    const out = collect({})
    expect(await command({ daemon: fakeDaemonClient({ running: false }) }).run([], out.context)).toBe(1)
    expect(out.stderr()).toContain('newer kurmis')
  })

  test('asks codex login status about a Codex login that keeps its sign-in in the keyring', async () => {
    writeTestConfig({ extras: [{ id: 'sidecodex1', provider: 'codex' }] })
    const side = loginFolder(codexRef('sidecodex1'))
    mkdirSync(side, { recursive: true })
    writeFileSync(join(side, 'config.toml'), 'cli_auth_credentials_store = "keyring"\n')
    const keyring = join(home, 'keyring')
    const record = join(home, 'codex-record.jsonl')
    writeCodexKeyringAuth(keyring, side)
    const out = collect({ HOME: home, USERPROFILE: home, KURMIS_CODEX_BIN: FAKE_CODEX_SCRIPT, FAKE_CODEX_KEYRING_DIR: keyring, FAKE_CODEX_RECORD: record })
    expect(await command({ daemon: fakeDaemonClient({ running: false }), findProgram, runProgram }).run(['--json'], out.context)).toBe(0)
    const json = JSON.parse(out.stdout()) as StatusJson
    expect(json.logins.find((login) => login.id === 'sidecodex1')?.credentials).toBe(true)
    expect(json.logins.find((login) => login.id === OWN_CODEX)?.credentials).toBe(false)
    // Only the login whose config.toml keeps the sign-in in the keyring was asked.
    expect(readCodexRecord(record).filter((line) => line.event === 'start').map((line) => line.event === 'start' && line.codexHome)).toEqual([side])
  })
})

describe('whether nothing has been probed yet', () => {
  test('every login that may be signed in has no usage', () => {
    expect(nothingProbedYet(statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn: null }), loginStatus(codexRef('workcodex1'), { signedIn: false, usage: codexUsage('workcodex1', { fetchedAt: NOW }) })]))).toBe(true)
    expect(nothingProbedYet(PROBED)).toBe(false)
    expect(nothingProbedYet(statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn: false })]))).toBe(false)
  })
})
