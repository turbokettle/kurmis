import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { codexHomePatch, createCodexCommand, type CodexDeps } from '../../../src/cli/commands/codex.ts'
import { settleWithin } from '../../../src/cli/command-deps.ts'
import type { ChildRunner } from '../../../src/cli/command-deps.ts'
import type { PrepareCodexHomeOptions, PreparedCodexHome } from '../../../src/cli/codex-home-files.ts'
import type { ChildEnd, ChildSpec, FinishOptions } from '../../../src/cli/wrapper.ts'
import { ConfigError } from '../../../src/data/config.ts'
import type { LoginRef } from '../../../src/data/login-id.ts'
import { providerFolder } from '../../../src/data/paths.ts'
import { ProgramNotFoundError } from '../../../src/platform/programs.ts'
import { codexUsage } from '../../core/codex-usage-fixture.ts'
import { claudeRef, codexRef, OWN_CLAUDE_REF, OWN_CODEX, OWN_CODEX_REF, testConfig } from '../../logins.ts'
import { collect, fakeDaemonClient, loginStatus, statusAnswer, type FakeDaemonOptions } from '../helpers.ts'

const WORK = { ...codexRef('workcodex1'), alias: 'work-example' }

const NOW = Date.parse('2026-09-13T01:10:00.000Z')
const HOUR = 3_600_000
const at = (ms: number): string => new Date(NOW + ms).toISOString()
const FAKE_HOMES = '/tmp/kurmis-fake/codex'

interface Harness {
  deps: Partial<CodexDeps>
  specs: ChildSpec[]
  prepared: string[]
  finished: { end: ChildEnd; options: FinishOptions }[]
  daemon: ReturnType<typeof fakeDaemonClient>
}

function harness(daemonOptions: FakeDaemonOptions = {}, overrides: Partial<CodexDeps> = {}): Harness {
  const specs: ChildSpec[] = []
  const prepared: string[] = []
  const finished: Harness['finished'] = []
  const child: ChildRunner = {
    async runInteractive(spec) {
      specs.push(spec)
      return { kind: 'exit', code: 3 }
    },
    finishLikeChild(end, options) {
      finished.push({ end, options })
      return end.kind === 'exit' ? end.code : 1
    }
  }
  const daemon = fakeDaemonClient(daemonOptions)
  return {
    specs,
    prepared,
    finished,
    daemon,
    deps: {
      daemon,
      child,
      findProgram: () => ({ command: '/fake/node', args: ['/fake/codex.js'], source: 'env' }),
      async prepareCodexHome(login: LoginRef, options: PrepareCodexHomeOptions): Promise<PreparedCodexHome> {
        void options
        prepared.push(login.id)
        return login.usedByPlainCli
          ? { codexHome: null, warnings: [] }
          : { codexHome: `${FAKE_HOMES}/${login.id}`, warnings: ['the hooks file could not be linked'] }
      },
      // A Claude login with the same alias as the Codex one, which kurmis codex never looks at.
      loadConfig: () => testConfig({ extras: [{ ...WORK }, { id: 'workclaude', provider: 'claude', alias: 'work-example' }] }),
      now: () => NOW,
      platform: 'darwin',
      probeWaitMs: 50,
      ...overrides
    }
  }
}

const TWO_LOGINS = statusAnswer([
  loginStatus(OWN_CLAUDE_REF),
  loginStatus({ ...claudeRef('workclaude'), alias: 'work-example' }),
  loginStatus(OWN_CODEX_REF, { usage: codexUsage(OWN_CODEX, { weeklyResetsAt: at(90 * HOUR), fetchedAt: NOW }) }),
  loginStatus(WORK, { usage: codexUsage(WORK.id, { weeklyResetsAt: at(10 * HOUR), fetchedAt: NOW }) })
])

describe('kurmis codex with --login', () => {
  test('starts codex on the named login with its prepared CODEX_HOME and the arguments passed on', async () => {
    const h = harness()
    const out = collect({ PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'http://127.0.0.1:40123' })
    const code = await createCodexCommand(h.deps).run(['--login', 'work-example', 'exec', '--login', 'x'], out.context)
    expect(code).toBe(3)
    expect(h.daemon.calls).toEqual([])
    expect(h.prepared).toEqual([WORK.id])
    expect(h.specs).toEqual([{
      command: '/fake/node',
      args: ['/fake/codex.js', 'exec', '--login', 'x'],
      env: { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'http://127.0.0.1:40123', CODEX_HOME: `${FAKE_HOMES}/${WORK.id}` }
    }])
    expect(h.finished[0]?.options.name).toBe('codex')
    expect(out.stderr()).toBe('kurmis codex: the hooks file could not be linked\n')
  })

  test('finds the login by id, by alias and with codex: in front, among the Codex logins only', async () => {
    for (const text of [WORK.id, 'codex:work-example', 'work-example', `codex:${WORK.id}`]) {
      const h = harness()
      expect(await createCodexCommand(h.deps).run(['--login', text], collect().context)).toBe(3)
      expect(h.prepared).toEqual([WORK.id])
    }
    const h = harness()
    expect(await createCodexCommand(h.deps).run(['--login', OWN_CODEX], collect().context)).toBe(3)
    expect(h.prepared).toEqual([OWN_CODEX])
  })

  test('refuses a login that is not in config.json', async () => {
    const h = harness()
    const out = collect()
    expect(await createCodexCommand(h.deps).run(['--login', 'other-example'], out.context)).toBe(1)
    expect(out.stderr()).toContain('there is no Codex login called "other-example"')
    expect(h.specs).toEqual([])
  })

  test('a config.json that does not read stops a named login, and Auto starts on the login plain codex uses', async () => {
    const h = harness({ status: TWO_LOGINS }, {
      loadConfig: () => {
        throw new ConfigError('config.json is not valid JSON.')
      }
    })
    const named = collect()
    expect(await createCodexCommand(h.deps).run(['--login', 'work-example'], named.context)).toBe(1)
    expect(named.stderr()).toBe('kurmis codex: config.json is not valid JSON.\n')
    const auto = collect({ CODEX_HOME: '/srv/my-codex' })
    expect(await createCodexCommand(h.deps).run([], auto.context)).toBe(3)
    expect(auto.stderr()).toBe('kurmis codex: config.json is not valid JSON. Starting on the login plain codex uses.\n')
    expect(h.specs[0]?.env).toEqual({ CODEX_HOME: '/srv/my-codex' })
    expect(h.daemon.calls).toEqual([])
  })

  test('refuses a Claude login', async () => {
    const h = harness()
    for (const text of ['claude:work-example', 'workclaude']) {
      const out = collect()
      expect(await createCodexCommand(h.deps).run(['--login', text], out.context)).toBe(1)
      expect(out.stderr()).toContain('is a Claude login; this takes a Codex login')
    }
    expect(h.specs).toEqual([])
  })
})

describe('kurmis codex without --login', () => {
  test('asks the daemon and starts on the login that ranks first', async () => {
    const h = harness({ status: TWO_LOGINS })
    const out = collect({ PATH: '/usr/bin' })
    expect(await createCodexCommand(h.deps).run([], out.context)).toBe(3)
    expect(h.daemon.calls).toEqual(['ensureDaemon', 'readStatus'])
    expect(h.prepared).toEqual([WORK.id])
    expect(h.specs[0]?.env.CODEX_HOME).toBe(`${FAKE_HOMES}/${WORK.id}`)
    expect(out.stderr()).toContain('kurmis codex: starting on work-example.')
  })

  test('says nothing about the choice when the login plain codex uses is the only Codex login', async () => {
    const h = harness({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF), loginStatus(OWN_CODEX_REF)]) })
    const out = collect()
    await createCodexCommand(h.deps).run([], out.context)
    expect(h.prepared).toEqual([OWN_CODEX])
    expect(out.stderr()).toBe('')
  })

  test('probes logins with old usage first and chooses with the answer', async () => {
    const stale = statusAnswer([
      loginStatus(OWN_CODEX_REF, { usage: codexUsage(OWN_CODEX, { fetchedAt: NOW - 2 * HOUR }) }),
      loginStatus(WORK)
    ])
    const h = harness({ status: stale, probed: TWO_LOGINS })
    const out = collect()
    await createCodexCommand(h.deps).run([], out.context)
    expect(h.daemon.calls).toEqual(['ensureDaemon', 'readStatus', `requestProbe:${OWN_CODEX},${WORK.id}`])
    expect(h.prepared).toEqual([WORK.id])
  })

  test('chooses with the usage it had when the probe does not answer in time', async () => {
    const stale = statusAnswer([
      loginStatus(OWN_CODEX_REF, { usage: codexUsage(OWN_CODEX, { weeklyResetsAt: at(HOUR), fetchedAt: NOW - 2 * HOUR }) }),
      loginStatus(WORK)
    ])
    const h = harness({ status: stale })
    h.daemon.requestProbe = () => new Promise(() => undefined)
    const out = collect()
    await createCodexCommand(h.deps).run([], out.context)
    expect(h.prepared).toEqual([OWN_CODEX])
    expect(out.stderr()).toContain('the usage probe did not finish within 0.05 s; choosing with the usage read before.')
  })

  test('chooses with the usage it had when the probe fails', async () => {
    const stale = statusAnswer([loginStatus(OWN_CODEX_REF), loginStatus(WORK)])
    const h = harness({ status: stale })
    h.daemon.requestProbe = () => Promise.reject(new Error('probe broke'))
    const out = collect()
    await createCodexCommand(h.deps).run([], out.context)
    expect(h.prepared).toEqual([OWN_CODEX])
    expect(out.stderr()).toContain('the usage probe failed (probe broke)')
  })

  test('prints the note when every login is out', async () => {
    const out = statusAnswer([
      loginStatus(OWN_CODEX_REF, { usage: codexUsage(OWN_CODEX, { weekly: 100, weeklyResetsAt: at(5 * HOUR), fetchedAt: NOW }) }),
      loginStatus(WORK, { usage: codexUsage(WORK.id, { weekly: 100, weeklyResetsAt: at(2 * HOUR), fetchedAt: NOW }) })
    ])
    const h = harness({ status: out })
    const collected = collect()
    await createCodexCommand(h.deps).run([], collected.context)
    expect(h.prepared).toEqual([WORK.id])
    expect(collected.stderr()).toBe(
      'kurmis codex: Every Codex login is at its limit; starting on work-example, whose usage comes back first (in 2h).\n' +
      'kurmis codex: the hooks file could not be linked\n')
  })

  test('starts on the login plain codex uses with a note when the daemon cannot be reached', async () => {
    const h = harness({ ensureFails: 'port 40123 is taken by another program' })
    const out = collect()
    expect(await createCodexCommand(h.deps).run(['resume'], out.context)).toBe(3)
    expect(h.prepared).toEqual([OWN_CODEX])
    expect(h.specs[0]?.args).toEqual(['/fake/codex.js', 'resume'])
    expect(out.stderr()).toBe(`kurmis codex: the kurmis daemon could not be reached (port 40123 is taken by another program); starting on ${OWN_CODEX}, the login plain codex uses.\n`)
  })
})

describe('kurmis codex and CODEX_HOME', () => {
  test('the login plain codex uses keeps the user\'s own CODEX_HOME', async () => {
    const h = harness()
    const out = collect({ CODEX_HOME: '/srv/my-codex' })
    await createCodexCommand(h.deps).run(['--login', OWN_CODEX], out.context)
    expect(h.specs[0]?.env).toEqual({ CODEX_HOME: '/srv/my-codex' })
  })

  test('the login plain codex uses drops a CODEX_HOME an outer kurmis codex session set for an extra login', async () => {
    // The home is a path of this machine, so the command has to compare it by this OS's rules.
    const h = harness({}, { platform: process.platform })
    const out = collect({ CODEX_HOME: join(providerFolder('codex'), 'work'), PATH: '/usr/bin' })
    await createCodexCommand(h.deps).run(['--login', OWN_CODEX], out.context)
    expect(h.specs[0]?.env).toEqual({ PATH: '/usr/bin' })
  })

  test('an extra login replaces any inherited CODEX_HOME, matched without case on Windows', () => {
    expect(codexHomePatch({ codexHome: 'C:\\k\\codex\\work', warnings: [] }, { Codex_Home: 'x' }, 'win32'))
      .toEqual({ CODEX_HOME: 'C:\\k\\codex\\work' })
    const kurmisHome = join(providerFolder('codex'), 'work').toUpperCase()
    expect(codexHomePatch({ codexHome: null, warnings: [] }, { Codex_Home: kurmisHome }, 'win32'))
      .toEqual({ CODEX_HOME: undefined })
    expect(codexHomePatch({ codexHome: null, warnings: [] }, { CODEX_HOME: '/srv/my-codex' }, 'darwin')).toEqual({})
  })
})

describe('kurmis codex failures', () => {
  test('codex not found: a message and exit 127, before the daemon is asked', async () => {
    const h = harness({}, {
      findProgram: () => {
        throw new ProgramNotFoundError('codex', 'codex was not found on PATH')
      }
    })
    const out = collect()
    expect(await createCodexCommand(h.deps).run([], out.context)).toBe(127)
    expect(out.stderr()).toBe('kurmis codex: codex was not found on PATH\n')
    expect(h.daemon.calls).toEqual([])
  })

  test('a home that cannot be prepared: a message and exit 1', async () => {
    const h = harness({}, {
      prepareCodexHome: () => Promise.reject(new Error('the folder is not writable'))
    })
    const out = collect()
    expect(await createCodexCommand(h.deps).run(['--login', 'work-example'], out.context)).toBe(1)
    expect(out.stderr()).toContain('could not prepare the Codex home of work-example: the folder is not writable')
    expect(h.specs).toEqual([])
  })

  test('--help prints kurmis\' help and starts nothing', async () => {
    const h = harness()
    const out = collect()
    expect(await createCodexCommand(h.deps).run(['--help'], out.context)).toBe(0)
    expect(out.stdout()).toContain('Usage: kurmis codex')
    expect(h.specs).toEqual([])
  })
})

describe('waiting for a promise at most so long', () => {
  test('answers the value, the error, or a timeout', async () => {
    expect(await settleWithin(() => Promise.resolve(5), 1000)).toEqual({ kind: 'done', value: 5 })
    expect(await settleWithin(() => Promise.reject(new Error('no')), 1000)).toMatchObject({ kind: 'failed' })
    expect(await settleWithin(() => { throw new Error('at once') }, 1000)).toMatchObject({ kind: 'failed' })
    expect(await settleWithin(() => new Promise(() => undefined), 10)).toEqual({ kind: 'timeout' })
  })

  test('aborts the signal it gave the work when the time is up, and only then', async () => {
    let given: AbortSignal | null = null
    expect(await settleWithin((signal) => {
      given = signal
      return new Promise(() => undefined)
    }, 10)).toEqual({ kind: 'timeout' })
    expect(given!.aborted).toBe(true)
    let kept: AbortSignal | null = null
    await settleWithin((signal) => {
      kept = signal
      return Promise.resolve(1)
    }, 1000)
    expect(kept!.aborted).toBe(false)
  })
})
