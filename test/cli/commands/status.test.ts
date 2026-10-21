import { describe, expect, test } from 'vitest'
import { createStatusCommand, nothingProbedYet } from '../../../src/cli/commands/status.ts'
import { codexUsage } from '../../core/codex-usage-fixture.ts'
import { collect, fakeDaemonClient, loginStatus, statusAnswer } from '../helpers.ts'
import { claudeRef, codexRef, OWN_CLAUDE_REF, OWN_CODEX_REF } from '../../logins.ts'

const NOW = Date.parse('2026-09-13T01:10:00.000Z')

const PROBED = statusAnswer([
  loginStatus(OWN_CLAUDE_REF),
  loginStatus(OWN_CODEX_REF, { usage: codexUsage('owncodex01', { fiveHour: 7, fetchedAt: NOW }) })
])

describe('kurmis status', () => {
  test('prints the status as text', async () => {
    const daemon = fakeDaemonClient({ status: PROBED })
    const out = collect()
    expect(await createStatusCommand({ daemon, now: () => NOW, platform: 'linux' }).run([], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['ensureDaemon', 'readStatus'])
    expect(out.stdout()).toContain('kurmis daemon 0.1.0, pid 4242, port 40123')
    expect(out.stdout()).toContain('  Codex 5h    7%')
    expect(out.stdout()).toContain('ownclaude1 (Claude, id ownclaude1)\n  this machine\'s own Claude sign-in')
    expect(out.stderr()).toBe('')
  })

  test('--json prints the status JSON', async () => {
    const daemon = fakeDaemonClient({ status: PROBED })
    const out = collect()
    expect(await createStatusCommand({ daemon, now: () => NOW, platform: 'linux' }).run(['--json'], out.context)).toBe(0)
    const json = JSON.parse(out.stdout()) as { format: number; logins: { id: string; alias: string; machineOwn: boolean }[]; warnings: string[] }
    expect(json.format).toBe(2)
    expect(json.logins.map((login) => [login.id, login.alias, login.machineOwn])).toEqual([['ownclaude1', 'ownclaude1', true], ['owncodex01', 'owncodex01', true]])
    expect(json.warnings).toEqual([])
  })

  test('warns when an extra login is the same account as the machine\'s own login', async () => {
    const status = statusAnswer([
      loginStatus(OWN_CLAUDE_REF, { email: 'own@example.com', usage: PROBED.logins[1]!.usage }),
      loginStatus({ ...claudeRef('workclaude'), alias: 'own-example' }, { email: 'own@example.com' })
    ])
    const daemon = fakeDaemonClient({ status })
    const text = collect()
    expect(await createStatusCommand({ daemon, now: () => NOW, platform: 'linux' }).run([], text.context)).toBe(0)
    expect(text.stdout()).toContain('Warning: own-example and ownclaude1, this machine\'s own Claude sign-in, are the')
    const json = collect()
    expect(await createStatusCommand({ daemon, now: () => NOW, platform: 'linux' }).run(['--json'], json.context)).toBe(0)
    expect((JSON.parse(json.stdout()) as { warnings: string[] }).warnings).toEqual([expect.stringContaining('"kurmis logout own-example"')])
  })

  test('asks for a probe once when no login has been probed yet', async () => {
    const daemon = fakeDaemonClient({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF), loginStatus(OWN_CODEX_REF)]), probed: PROBED })
    const out = collect()
    await createStatusCommand({ daemon, now: () => NOW, platform: 'linux' }).run(['--json'], out.context)
    expect(daemon.calls).toEqual(['ensureDaemon', 'readStatus', 'requestProbe'])
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
    expect(await createStatusCommand({ daemon, now: () => NOW, platform: 'linux', probeWaitMs: 20 }).run([], out.context)).toBe(0)
    // The probe request is ended, so its connection does not keep the CLI running.
    expect(probeSignal?.aborted).toBe(true)
    expect(out.stderr()).toContain('the first usage probe did not finish within 0.02 s')
    expect(out.stdout()).toContain('usage not read yet')
  })

  test('a daemon that cannot be reached is an error', async () => {
    const daemon = fakeDaemonClient({ ensureFails: 'the daemon did not start within 5 s' })
    const out = collect()
    expect(await createStatusCommand({ daemon, now: () => NOW, platform: 'linux' }).run([], out.context)).toBe(1)
    expect(out.stderr()).toContain('kurmis status: the kurmis daemon could not be reached: the daemon did not start within 5 s')
    expect(out.stdout()).toBe('')
  })

  test('an unknown option is a usage error', async () => {
    const out = collect()
    expect(await createStatusCommand({ daemon: fakeDaemonClient() }).run(['--yaml'], out.context)).toBe(2)
  })
})

describe('whether nothing has been probed yet', () => {
  test('every login that may be signed in has no usage', () => {
    expect(nothingProbedYet(statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn: null }), loginStatus(codexRef('workcodex1'), { signedIn: false, usage: codexUsage('workcodex1', { fetchedAt: NOW }) })]))).toBe(true)
    expect(nothingProbedYet(PROBED)).toBe(false)
    expect(nothingProbedYet(statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn: false })]))).toBe(false)
  })
})
