import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { codexHomePatch, createCodexCommand, settleWithin, type CodexDeps } from '../../../src/cli/commands/codex.ts'
import type { ChildRunner } from '../../../src/cli/command-deps.ts'
import type { PrepareCodexHomeOptions, PreparedCodexHome } from '../../../src/cli/codex-home-files.ts'
import type { ChildEnd, ChildSpec, FinishOptions } from '../../../src/cli/wrapper.ts'
import { addLogin, ConfigError, defaultConfig } from '../../../src/data/config.ts'
import { providerFolder } from '../../../src/data/paths.ts'
import { ProgramNotFoundError } from '../../../src/platform/programs.ts'
import { codexUsage } from '../../core/codex-usage-fixture.ts'
import { collect, fakeDaemonClient, loginStatus, statusAnswer, type FakeDaemonOptions } from '../helpers.ts'

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
      async prepareCodexHome(id: string, options: PrepareCodexHomeOptions): Promise<PreparedCodexHome> {
        void options
        prepared.push(id)
        return id === 'codex:default'
          ? { codexHome: null, warnings: [] }
          : { codexHome: `${FAKE_HOMES}/${id.slice('codex:'.length)}`, warnings: ['the hooks file could not be linked'] }
      },
      loadConfig: () => addLogin(defaultConfig(), 'codex:work'),
      now: () => NOW,
      platform: 'darwin',
      probeWaitMs: 50,
      ...overrides
    }
  }
}

const TWO_LOGINS = statusAnswer([
  loginStatus('claude:default'),
  loginStatus('codex:default', { usage: codexUsage('codex:default', { weeklyResetsAt: at(90 * HOUR), fetchedAt: NOW }) }),
  loginStatus('codex:work', { usage: codexUsage('codex:work', { weeklyResetsAt: at(10 * HOUR), fetchedAt: NOW }) })
])

describe('kurmis codex with --login', () => {
  test('starts codex on the named login with its prepared CODEX_HOME and the arguments passed on', async () => {
    const h = harness()
    const out = collect({ PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'http://127.0.0.1:40123' })
    const code = await createCodexCommand(h.deps).run(['--login', 'work', 'exec', '--login', 'x'], out.context)
    expect(code).toBe(3)
    expect(h.daemon.calls).toEqual([])
    expect(h.prepared).toEqual(['codex:work'])
    expect(h.specs).toEqual([{
      command: '/fake/node',
      args: ['/fake/codex.js', 'exec', '--login', 'x'],
      env: { PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'http://127.0.0.1:40123', CODEX_HOME: `${FAKE_HOMES}/work` }
    }])
    expect(h.finished[0]?.options.name).toBe('codex')
    expect(out.stderr()).toBe('kurmis codex: the hooks file could not be linked\n')
  })

  test('refuses a login that is not in config.json', async () => {
    const h = harness()
    const out = collect()
    expect(await createCodexCommand(h.deps).run(['--login', 'codex:other'], out.context)).toBe(1)
    expect(out.stderr()).toContain('there is no login codex:other')
    expect(h.specs).toEqual([])
  })

  test('a config.json that does not read stops a named extra login but not codex:default', async () => {
    const h = harness({}, {
      loadConfig: () => {
        throw new ConfigError('config.json is not valid JSON')
      }
    })
    const out = collect()
    expect(await createCodexCommand(h.deps).run(['--login', 'work'], out.context)).toBe(1)
    expect(out.stderr()).toBe('kurmis codex: config.json is not valid JSON\n')
    expect(await createCodexCommand(h.deps).run(['--login', 'default'], out.context)).toBe(3)
    expect(h.prepared).toEqual(['codex:default'])
  })

  test('refuses a Claude login', async () => {
    const h = harness()
    const out = collect()
    expect(await createCodexCommand(h.deps).run(['--login', 'claude:work'], out.context)).toBe(2)
    expect(out.stderr()).toContain('is a claude login, not a codex one')
  })
})

describe('kurmis codex without --login', () => {
  test('asks the daemon and starts on the login that ranks first', async () => {
    const h = harness({ status: TWO_LOGINS })
    const out = collect({ PATH: '/usr/bin' })
    expect(await createCodexCommand(h.deps).run([], out.context)).toBe(3)
    expect(h.daemon.calls).toEqual(['ensureDaemon', 'readStatus'])
    expect(h.prepared).toEqual(['codex:work'])
    expect(h.specs[0]?.env.CODEX_HOME).toBe(`${FAKE_HOMES}/work`)
    expect(out.stderr()).toContain('kurmis codex: starting on codex:work.')
  })

  test('says nothing about the choice when codex:default is the only Codex login', async () => {
    const h = harness({ status: statusAnswer([loginStatus('claude:default'), loginStatus('codex:default')]) })
    const out = collect()
    await createCodexCommand(h.deps).run([], out.context)
    expect(h.prepared).toEqual(['codex:default'])
    expect(out.stderr()).toBe('')
  })

  test('probes logins with old usage first and chooses with the answer', async () => {
    const stale = statusAnswer([
      loginStatus('codex:default', { usage: codexUsage('codex:default', { fetchedAt: NOW - 2 * HOUR }) }),
      loginStatus('codex:work')
    ])
    const h = harness({ status: stale, probed: TWO_LOGINS })
    const out = collect()
    await createCodexCommand(h.deps).run([], out.context)
    expect(h.daemon.calls).toEqual(['ensureDaemon', 'readStatus', 'requestProbe:codex:default,codex:work'])
    expect(h.prepared).toEqual(['codex:work'])
  })

  test('chooses with the usage it had when the probe does not answer in time', async () => {
    const stale = statusAnswer([
      loginStatus('codex:default', { usage: codexUsage('codex:default', { weeklyResetsAt: at(HOUR), fetchedAt: NOW - 2 * HOUR }) }),
      loginStatus('codex:work')
    ])
    const h = harness({ status: stale })
    h.daemon.requestProbe = () => new Promise(() => undefined)
    const out = collect()
    await createCodexCommand(h.deps).run([], out.context)
    expect(h.prepared).toEqual(['codex:default'])
    expect(out.stderr()).toContain('the usage probe did not finish within 0.05 s; choosing with the usage read before.')
  })

  test('chooses with the usage it had when the probe fails', async () => {
    const stale = statusAnswer([loginStatus('codex:default'), loginStatus('codex:work')])
    const h = harness({ status: stale })
    h.daemon.requestProbe = () => Promise.reject(new Error('probe broke'))
    const out = collect()
    await createCodexCommand(h.deps).run([], out.context)
    expect(h.prepared).toEqual(['codex:default'])
    expect(out.stderr()).toContain('the usage probe failed (probe broke)')
  })

  test('prints the note when every login is out', async () => {
    const out = statusAnswer([
      loginStatus('codex:default', { usage: codexUsage('codex:default', { weekly: 100, weeklyResetsAt: at(5 * HOUR), fetchedAt: NOW }) }),
      loginStatus('codex:work', { usage: codexUsage('codex:work', { weekly: 100, weeklyResetsAt: at(2 * HOUR), fetchedAt: NOW }) })
    ])
    const h = harness({ status: out })
    const collected = collect()
    await createCodexCommand(h.deps).run([], collected.context)
    expect(h.prepared).toEqual(['codex:work'])
    expect(collected.stderr()).toBe(
      'kurmis codex: Every Codex login is at its limit; starting on codex:work, whose usage comes back first (in 2h).\n' +
      'kurmis codex: the hooks file could not be linked\n')
  })

  test('starts on codex:default with a note when the daemon cannot be reached', async () => {
    const h = harness({ ensureFails: 'port 40123 is taken by another program' })
    const out = collect()
    expect(await createCodexCommand(h.deps).run(['resume'], out.context)).toBe(3)
    expect(h.prepared).toEqual(['codex:default'])
    expect(h.specs[0]?.args).toEqual(['/fake/codex.js', 'resume'])
    expect(out.stderr()).toBe('kurmis codex: the kurmis daemon could not be reached (port 40123 is taken by another program); starting on codex:default.\n')
  })
})

describe('kurmis codex and CODEX_HOME', () => {
  test('codex:default keeps the user\'s own CODEX_HOME', async () => {
    const h = harness()
    const out = collect({ CODEX_HOME: '/srv/my-codex' })
    await createCodexCommand(h.deps).run(['--login', 'default'], out.context)
    expect(h.specs[0]?.env).toEqual({ CODEX_HOME: '/srv/my-codex' })
  })

  test('codex:default drops a CODEX_HOME an outer kurmis codex session set for an extra login', async () => {
    const h = harness()
    const out = collect({ CODEX_HOME: join(providerFolder('codex'), 'work'), PATH: '/usr/bin' })
    await createCodexCommand(h.deps).run(['--login', 'default'], out.context)
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
  test('codex not found: a message and exit 1, before the daemon is asked', async () => {
    const h = harness({}, {
      findProgram: () => {
        throw new ProgramNotFoundError('codex', 'codex was not found on PATH')
      }
    })
    const out = collect()
    expect(await createCodexCommand(h.deps).run([], out.context)).toBe(1)
    expect(out.stderr()).toBe('kurmis codex: codex was not found on PATH\n')
    expect(h.daemon.calls).toEqual([])
  })

  test('a home that cannot be prepared: a message and exit 1', async () => {
    const h = harness({}, {
      prepareCodexHome: () => Promise.reject(new Error('the folder is not writable'))
    })
    const out = collect()
    expect(await createCodexCommand(h.deps).run(['--login', 'work'], out.context)).toBe(1)
    expect(out.stderr()).toContain('could not prepare the Codex home of codex:work: the folder is not writable')
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
    expect(await settleWithin(Promise.resolve(5), 1000)).toEqual({ kind: 'done', value: 5 })
    expect(await settleWithin(Promise.reject(new Error('no')), 1000)).toMatchObject({ kind: 'failed' })
    expect(await settleWithin(new Promise(() => undefined), 10)).toEqual({ kind: 'timeout' })
  })
})
