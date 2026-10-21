import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { realPrepareCodexHome, type ChildRunner } from '../../../src/cli/command-deps.ts'
import { createLoginCommand, freeLoginName, loginTarget, type LoginDeps } from '../../../src/cli/commands/login.ts'
import type { ChildEnd, ChildSpec } from '../../../src/cli/wrapper.ts'
import { addLogin, defaultConfig, findLogin, loadConfig, saveConfig } from '../../../src/data/config.ts'
import { codexMergedRecordPath, configPath, kurmisHome, loginFolder, loginLockPath } from '../../../src/data/paths.ts'
import { findProgram, ProgramNotFoundError } from '../../../src/platform/programs.ts'
import { runProgram } from '../../../src/platform/run.ts'
import { FAKE_CLAUDE_SCRIPT, FAKE_CODEX_SCRIPT, writeClaudeIdentity, writeCodexAuth, writeCodexKeyringAuth } from '../../fakes/index.ts'
import { collect, fakeDaemonClient, loginStatus, statusAnswer } from '../helpers.ts'

const home = process.env.HOME!

interface FakeRunner extends ChildRunner {
  specs: ChildSpec[]
  finished: ChildEnd[]
}

/**
 * A child runner that stands in for the provider's CLI: `act` runs with the spec instead of a
 * program (e.g. writes the login's files) and answers how the "child" ended.
 */
function fakeRunner(act: (spec: ChildSpec) => ChildEnd): FakeRunner {
  const specs: ChildSpec[] = []
  const finished: ChildEnd[] = []
  return {
    specs,
    finished,
    async runInteractive(spec) {
      specs.push(spec)
      return act(spec)
    },
    finishLikeChild(end, options) {
      finished.push(end)
      if (end.kind === 'not-started') options.stderr.write(`${end.message}\n`)
      return end.kind === 'signal' ? 130 : 1
    }
  }
}

/** What a successful `claude auth login` leaves: the account in `$CLAUDE_CONFIG_DIR/.claude.json`, or `~/.claude.json`. */
function claudeSignsIn(email = 'second@example.com'): (spec: ChildSpec) => ChildEnd {
  return (spec) => {
    const dir = spec.env.CLAUDE_CONFIG_DIR
    writeClaudeIdentity(dir === undefined ? join(home, '.claude.json') : join(dir, '.claude.json'), { email })
    return { kind: 'exit', code: 0 }
  }
}

const exitWith = (code: number) => (): ChildEnd => ({ kind: 'exit', code })

/** A pid that no process has: the highest pid macOS, Linux and Windows hand out is far lower. */
const DEAD_PID = 2 ** 30

/** The lock file another `kurmis login` of `id` would hold, with `pid` as its owner (this test's parent, which runs). */
function holdLock(id: string, pid = process.ppid): void {
  mkdirSync(join(kurmisHome(), 'locks'), { recursive: true })
  writeFileSync(loginLockPath(id), JSON.stringify({ pid, createdAt: Date.now(), token: 'another-run' }))
}

const fakeProgram: LoginDeps['findProgram'] = (tool) => ({ command: `/fake/bin/${tool}`, args: ['--fake'], source: 'env' })

function command(runner: ChildRunner, patch: Partial<LoginDeps> = {}) {
  const daemon = fakeDaemonClient()
  return { daemon, login: createLoginCommand({ daemon, runner, findProgram: fakeProgram, home: () => home, ...patch }) }
}

const routedEnv = {
  PATH: '/usr/bin',
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
  ANTHROPIC_CUSTOM_HEADERS: 'x-kurmis-key: abc',
  ANTHROPIC_API_KEY: 'not-a-real-key',
  CLAUDE_CONFIG_DIR: '/elsewhere'
}

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
  rmSync(join(home, '.claude.json'), { force: true })
  rmSync(join(home, '.codex'), { recursive: true, force: true, maxRetries: 10 })
})

describe('choosing the login', () => {
  it('picks the first free number, skipping taken ids and leftover folders', () => {
    let config = defaultConfig()
    expect(freeLoginName('claude', config)).toBe('2')
    config = addLogin(config, 'claude:2')
    expect(freeLoginName('claude', config)).toBe('3')
    mkdirSync(loginFolder('claude:3'), { recursive: true })
    expect(freeLoginName('claude', config)).toBe('4')
    expect(freeLoginName('codex', config)).toBe('2')
  })

  it('reads the provider form and the id form', () => {
    const config = addLogin(defaultConfig(), 'claude:work')
    expect(loginTarget('claude', undefined, config)).toEqual({ id: 'claude:2', isNew: true })
    expect(loginTarget('codex', 'side', config)).toEqual({ id: 'codex:side', isNew: true })
    expect(loginTarget('claude:work', undefined, config)).toEqual({ id: 'claude:work', isNew: false })
    expect(loginTarget('claude:new', undefined, config)).toEqual({ id: 'claude:new', isNew: true })
    expect(loginTarget('codex:default', undefined, config)).toEqual({ id: 'codex:default', isNew: false })
    for (const [argument, name, message] of [
      ['claude', 'work', 'there is already a login claude:work'],
      ['claude', 'default', 'there is already a login claude:default'],
      ['claude', 'Bad!', 'is not a login name'],
      ['claude:work', 'x', '--name goes with'],
      ['work', undefined, 'is not claude, codex or a login id'],
      ['claude:../x', undefined, 'is not a login id']
    ] as const) {
      expect(loginTarget(argument, name, config)).toEqual({ error: expect.stringContaining(message) as unknown })
    }
  })
})

describe('kurmis login claude', () => {
  it('signs a new login in, adds it under its name and reloads the daemon', async () => {
    const runner = fakeRunner(claudeSignsIn())
    const { daemon, login } = command(runner)
    const out = collect(routedEnv)
    expect(await login.run(['claude'], out.context)).toBe(0)

    const folder = loginFolder('claude:2')
    expect(runner.specs).toHaveLength(1)
    const spec = runner.specs[0]!
    expect(spec.command).toBe('/fake/bin/claude')
    expect(spec.args).toEqual(['--fake', 'auth', 'login', '--claudeai'])
    expect(spec.env.CLAUDE_CONFIG_DIR).toBe(folder)
    expect(spec.env.PATH).toBe('/usr/bin')
    for (const name of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_API_KEY', 'CLAUDE_SECURESTORAGE_CONFIG_DIR']) {
      expect(spec.env[name]).toBeUndefined()
    }
    if (process.platform !== 'win32') expect(statSync(folder).mode & 0o777).toBe(0o700)

    expect(findLogin(loadConfig(), 'claude:2')).toMatchObject({ label: '2', routing: true, fiveHourLimit: 100, weeklyLimit: 100 })
    expect(out.stdout()).toContain('Signed in claude:2 as second@example.com.')
    expect(out.stdout()).toContain('Added claude:2 with the label "2"')
    expect(out.stdout()).toContain('The running daemon has read the change.')
    expect(readFileSync(configPath(), 'utf8')).not.toContain('example.com')
    expect(daemon.calls).toEqual(['findDaemon', 'requestReload', 'requestProbe:claude:2'])
    // The lock is released once the command is done.
    expect(existsSync(loginLockPath('claude:2'))).toBe(false)
  })

  it('signs a login whose record is in Credential Manager in with CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1', async () => {
    const asked: Array<string | null> = []
    const inCredentialManager = (folder: string | null): Promise<boolean> => {
      asked.push(folder)
      return Promise.resolve(folder === loginFolder('claude:held'))
    }
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner, { inCredentialManager })
    expect(await login.run(['claude', '--name', 'held'], collect(routedEnv).context)).toBe(0)
    expect(await login.run(['claude', '--name', 'plain'], collect(routedEnv).context)).toBe(0)
    expect(asked).toEqual([loginFolder('claude:held'), loginFolder('claude:plain')])
    expect(runner.specs[0]!.env.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBe('1')
    expect(runner.specs[1]!.env.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBeUndefined()
  })

  it('takes --name and --label, and the next login gets the next number', async () => {
    const { login } = command(fakeRunner(claudeSignsIn()))
    expect(await login.run(['claude', '--name', 'work', '--label', 'Work account'], collect().context)).toBe(0)
    expect(await login.run(['claude'], collect().context)).toBe(0)
    expect(await login.run(['claude'], collect().context)).toBe(0)
    const config = loadConfig()
    expect(findLogin(config, 'claude:work')?.label).toBe('Work account')
    expect(config.logins.map((entry) => entry.id)).toEqual(['claude:default', 'codex:default', 'claude:work', 'claude:2', 'claude:3'])
  })

  it('does not start the daemon, and says nothing about it when it is not running', async () => {
    const daemon = fakeDaemonClient({ running: false })
    const login = createLoginCommand({ daemon, runner: fakeRunner(claudeSignsIn()), findProgram: fakeProgram, home: () => home })
    const out = collect()
    expect(await login.run(['claude:new'], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['findDaemon'])
    expect(out.stdout()).not.toContain('daemon')
  })

  it('removes the folder it made and adds nothing when the CLI fails', async () => {
    const { login, daemon } = command(fakeRunner(exitWith(1)))
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(1)
    expect(existsSync(loginFolder('claude:2'))).toBe(false)
    expect(findLogin(loadConfig(), 'claude:2')).toBeUndefined()
    expect(out.stderr()).toContain('"claude auth login" failed (exit code 1). claude:2 was not added.')
    expect(daemon.calls).toEqual([])
  })

  it('cleans up and ends like the CLI when the CLI is ended by a signal', async () => {
    const runner = fakeRunner(() => ({ kind: 'signal', signal: 'SIGTERM' }))
    const { login } = command(runner)
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(130)
    expect(runner.finished).toEqual([{ kind: 'signal', signal: 'SIGTERM' }])
    expect(existsSync(loginFolder('claude:2'))).toBe(false)
    expect(findLogin(loadConfig(), 'claude:2')).toBeUndefined()
  })

  it('cleans up when the CLI cannot be started', async () => {
    const runner = fakeRunner(() => ({ kind: 'not-started', code: 'ENOENT', message: 'claude could not be started' }))
    const { login } = command(runner)
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(1)
    expect(out.stderr()).toContain('claude could not be started')
    expect(existsSync(loginFolder('claude:2'))).toBe(false)
  })

  it('adds nothing when the CLI exits 0 without signing in', async () => {
    const { login } = command(fakeRunner(exitWith(0)))
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(1)
    expect(out.stderr()).toContain('claude:2 has no credentials')
    expect(existsSync(loginFolder('claude:2'))).toBe(false)
    expect(findLogin(loadConfig(), 'claude:2')).toBeUndefined()
  })

  it('keeps the folder of an existing login whose new sign-in fails', async () => {
    saveConfig(addLogin(defaultConfig(), 'claude:work'))
    mkdirSync(loginFolder('claude:work'), { recursive: true })
    const { login } = command(fakeRunner(exitWith(1)))
    expect(await login.run(['claude:work'], collect().context)).toBe(1)
    expect(existsSync(loginFolder('claude:work'))).toBe(true)
    expect(findLogin(loadConfig(), 'claude:work')).toBeDefined()
  })

  it('signs an existing login in again and changes its label when asked', async () => {
    saveConfig(addLogin(defaultConfig(), 'claude:work'))
    const { login } = command(fakeRunner(claudeSignsIn('again@example.com')))
    const out = collect()
    expect(await login.run(['claude:work', '--label', 'Work'], out.context)).toBe(0)
    expect(out.stdout()).toContain('Signed in claude:work as again@example.com.')
    expect(out.stdout()).not.toContain('Added')
    expect(findLogin(loadConfig(), 'claude:work')?.label).toBe('Work')
  })

  it('asks the daemon to probe a login signed in again, and says when it still finds it signed out', async () => {
    saveConfig(addLogin(defaultConfig(), 'claude:work'))
    const daemon = fakeDaemonClient({ probed: statusAnswer([loginStatus('claude:work', { signedIn: false })]) })
    const { login } = command(fakeRunner(claudeSignsIn('again@example.com')), { daemon })
    const out = collect()
    expect(await login.run(['claude:work'], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['findDaemon', 'requestReload', 'requestProbe:claude:work'])
    expect(out.stdout()).toContain('The daemon still finds claude:work signed out')
  })

  it('stops waiting for the daemon\'s probe after a while, and ends the probe request', async () => {
    saveConfig(addLogin(defaultConfig(), 'codex:work'))
    const daemon = fakeDaemonClient()
    let probeSignal: AbortSignal | undefined
    daemon.requestProbe = (_connection, _logins, signal) => {
      probeSignal = signal
      return new Promise(() => undefined)
    }
    const { login } = command(fakeRunner((spec) => {
      writeCodexAuth(spec.env.CODEX_HOME!)
      return { kind: 'exit', code: 0 }
    }), { daemon, probeWaitMs: 20 })
    const out = collect()
    expect(await login.run(['codex:work'], out.context)).toBe(0)
    expect(out.stdout()).toContain("The daemon's check of codex:work did not finish within 0.02 s")
    expect(probeSignal?.aborted).toBe(true)
  })

  it('stops at once, starting nothing, while another run holds the login', async () => {
    holdLock('claude:work')
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner)
    const out = collect()
    expect(await login.run(['claude', '--name', 'work'], out.context)).toBe(1)
    expect(out.stderr()).toContain(`another "kurmis login" or "kurmis logout" of claude:work is running now (pid ${String(process.ppid)})`)
    expect(runner.specs).toEqual([])
    expect(existsSync(loginFolder('claude:work'))).toBe(false)
    expect(existsSync(loginLockPath('claude:work'))).toBe(true)
  })

  it('takes the next number when another run is signing in the first free one', async () => {
    holdLock('claude:2')
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner)
    expect(await login.run(['claude'], collect().context)).toBe(0)
    expect(runner.specs[0]?.env.CLAUDE_CONFIG_DIR).toBe(loginFolder('claude:3'))
    expect(findLogin(loadConfig(), 'claude:3')).toBeDefined()
    expect(findLogin(loadConfig(), 'claude:2')).toBeUndefined()
  })

  it('takes over the lock of a run that was killed', async () => {
    holdLock('claude:work', DEAD_PID)
    const { login } = command(fakeRunner(claudeSignsIn()))
    expect(await login.run(['claude:work'], collect().context)).toBe(0)
    expect(findLogin(loadConfig(), 'claude:work')).toBeDefined()
  })

  it('signs claude:default in on the machine\'s own folders', async () => {
    const runner = fakeRunner(claudeSignsIn('own@example.com'))
    const { login } = command(runner)
    const out = collect(routedEnv)
    expect(await login.run(['claude:default'], out.context)).toBe(0)
    expect(runner.specs[0]!.env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(runner.specs[0]!.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(out.stdout()).toContain('Signed in claude:default as own@example.com.')
    expect(existsSync(join(kurmisHome(), 'claude'))).toBe(false)
    expect(loadConfig().logins).toHaveLength(2)
  })

  it('gives a usage error for a taken or invalid name without starting anything', async () => {
    saveConfig(addLogin(defaultConfig(), 'claude:work'))
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner)
    for (const args of [['claude', '--name', 'work'], ['claude', '--name', 'No'], ['work'], [], ['claude', 'codex'], ['claude', '--label', ' ']]) {
      const out = collect()
      expect(await login.run(args, out.context)).toBe(2)
      expect(out.stderr()).toContain('kurmis login:')
    }
    expect(runner.specs).toEqual([])
  })

  it('reports a missing claude program and creates nothing', async () => {
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner, {
      findProgram: (tool) => {
        throw new ProgramNotFoundError(tool, 'claude was not found on PATH.')
      }
    })
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(1)
    expect(out.stderr()).toContain('claude was not found on PATH.')
    expect(existsSync(join(kurmisHome(), 'claude'))).toBe(false)
  })
})

describe('kurmis login codex', () => {
  it('runs codex login with the folder as CODEX_HOME and adds the login once auth.json is there', async () => {
    const runner = fakeRunner((spec) => {
      writeCodexAuth(spec.env.CODEX_HOME!)
      return { kind: 'exit', code: 0 }
    })
    const { login } = command(runner)
    const out = collect({ PATH: '/usr/bin', CODEX_HOME: '/elsewhere' })
    expect(await login.run(['codex', '--name', 'side'], out.context)).toBe(0)
    expect(runner.specs[0]!.args).toEqual(['--fake', 'login'])
    expect(runner.specs[0]!.env.CODEX_HOME).toBe(loginFolder('codex:side'))
    expect(findLogin(loadConfig(), 'codex:side')).toBeDefined()
    expect(out.stdout()).toContain('Signed in codex:side.')
  })

  it('prepares the new home from the default one before codex login runs in it', async () => {
    const defaultHome = join(home, '.codex')
    mkdirSync(defaultHome, { recursive: true })
    writeFileSync(join(defaultHome, 'config.toml'), 'model = "gpt-test"\n')
    let configSeen: string | null = null
    const runner = fakeRunner((spec) => {
      configSeen = readFileSync(join(spec.env.CODEX_HOME!, 'config.toml'), 'utf8')
      writeCodexAuth(spec.env.CODEX_HOME!)
      return { kind: 'exit', code: 0 }
    })
    const prepared: string[] = []
    const { login } = command(runner, {
      prepareCodexHome: async (id, options) => {
        prepared.push(id)
        return await realPrepareCodexHome(id, options)
      }
    })
    expect(await login.run(['codex', '--name', 'side'], collect({ PATH: '/usr/bin' }).context)).toBe(0)
    expect(prepared).toEqual(['codex:side'])
    expect(configSeen).toContain('model = "gpt-test"')
  })

  it('removes a new home and adds nothing when it cannot be prepared', async () => {
    const runner = fakeRunner(exitWith(0))
    const { login } = command(runner, { prepareCodexHome: async () => { throw new Error('disk full') } })
    const out = collect({ PATH: '/usr/bin' })
    expect(await login.run(['codex', '--name', 'side'], out.context)).toBe(1)
    expect(out.stderr()).toContain('could not prepare the Codex home of codex:side: disk full')
    expect(runner.specs).toEqual([])
    expect(existsSync(loginFolder('codex:side'))).toBe(false)
    expect(findLogin(loadConfig(), 'codex:side')).toBeUndefined()
  })

  it('adds nothing when codex login leaves no auth.json', async () => {
    const { login } = command(fakeRunner(exitWith(0)))
    const out = collect()
    expect(await login.run(['codex'], out.context)).toBe(1)
    expect(existsSync(loginFolder('codex:2'))).toBe(false)
    expect(findLogin(loadConfig(), 'codex:2')).toBeUndefined()
  })

  it('removes the merged record of a new home when codex login fails', async () => {
    const defaultHome = join(home, '.codex')
    mkdirSync(defaultHome, { recursive: true })
    writeFileSync(join(defaultHome, 'config.toml'), 'model = "gpt-test"\n')
    const { login } = command(fakeRunner(exitWith(1)))
    expect(await login.run(['codex', '--name', 'side'], collect().context)).toBe(1)
    expect(existsSync(loginFolder('codex:side'))).toBe(false)
    expect(existsSync(codexMergedRecordPath('codex:side'))).toBe(false)
  })

  it('adds a login whose config.toml keeps the sign-in in the keyring once codex login status says it is signed in', async () => {
    const defaultHome = join(home, '.codex')
    mkdirSync(defaultHome, { recursive: true })
    writeFileSync(join(defaultHome, 'config.toml'), 'cli_auth_credentials_store = "keyring"\n')
    const keyring = join(home, 'keyring')
    const env = { PATH: '/usr/bin', HOME: home, KURMIS_CODEX_BIN: FAKE_CODEX_SCRIPT, FAKE_CODEX_KEYRING_DIR: keyring }
    // codex login keeps the sign-in in the keyring and writes no auth.json.
    const signsIn = fakeRunner((spec) => {
      writeCodexKeyringAuth(keyring, spec.env.CODEX_HOME!)
      return { kind: 'exit', code: 0 }
    })
    const { login } = command(signsIn, { findProgram })
    const out = collect(env)
    expect(await login.run(['codex', '--name', 'side'], out.context)).toBe(0)
    expect(existsSync(join(loginFolder('codex:side'), 'auth.json'))).toBe(false)
    expect(findLogin(loadConfig(), 'codex:side')).toBeDefined()

    // Without the keyring item it is not signed in, and nothing is added.
    const { login: second } = command(fakeRunner(exitWith(0)), { findProgram })
    const failed = collect(env)
    expect(await second.run(['codex', '--name', 'other'], failed.context)).toBe(1)
    expect(failed.stderr()).toContain('codex:other has no credentials')
    expect(existsSync(loginFolder('codex:other'))).toBe(false)
  })

  it('signs codex:default in with CODEX_HOME as inherited', async () => {
    const codexHome = join(home, 'codex-own')
    const runner = fakeRunner((spec) => {
      writeCodexAuth(spec.env.CODEX_HOME!)
      return { kind: 'exit', code: 0 }
    })
    const { login } = command(runner)
    expect(await login.run(['codex:default'], collect({ CODEX_HOME: codexHome }).context)).toBe(0)
    expect(runner.specs[0]!.env.CODEX_HOME).toBe(codexHome)
    rmSync(codexHome, { recursive: true, force: true, maxRetries: 10 })
  })
})

describe('kurmis login with the fake claude', () => {
  /** Runs the child without a terminal, which the fake's `auth login` does not need. */
  const pipedRunner: ChildRunner = {
    async runInteractive(spec) {
      const [program, ...args] = [spec.command, ...spec.args]
      const result = await runProgram(program!, args, { timeoutMs: 20_000, env: spec.env })
      return result.code === null ? { kind: 'signal', signal: 'SIGKILL' } : { kind: 'exit', code: result.code }
    },
    finishLikeChild: () => 1
  }
  const env = (extra: Record<string, string> = {}) => ({ ...process.env, KURMIS_CLAUDE_BIN: FAKE_CLAUDE_SCRIPT, FAKE_CLAUDE_EMAIL: 'fake@example.com', ...extra })

  it('signs in through the real program lookup', async () => {
    const login = createLoginCommand({ daemon: fakeDaemonClient({ running: false }), runner: pipedRunner, findProgram, home: () => home })
    const out = collect(env())
    expect(await login.run(['claude', '--name', 'piped'], out.context)).toBe(0)
    expect(out.stdout()).toContain('Signed in claude:piped as fake@example.com.')
    expect(existsSync(join(loginFolder('claude:piped'), '.credentials.json'))).toBe(true)
  })

  it('removes the folder when the fake fails', async () => {
    const login = createLoginCommand({ daemon: fakeDaemonClient({ running: false }), runner: pipedRunner, findProgram, home: () => home })
    const out = collect(env({ FAKE_CLAUDE_LOGIN: 'fail' }))
    expect(await login.run(['claude', '--name', 'piped'], out.context)).toBe(1)
    expect(existsSync(loginFolder('claude:piped'))).toBe(false)
    expect(findLogin(loadConfig(), 'claude:piped')).toBeUndefined()
  })
})
