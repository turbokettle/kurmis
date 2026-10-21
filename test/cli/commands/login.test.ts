import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { realPrepareCodexHome, type ChildRunner } from '../../../src/cli/command-deps.ts'
import { createLoginCommand, freshLoginId, loginTarget, type LoginDeps } from '../../../src/cli/commands/login.ts'
import type { ChildEnd, ChildSpec } from '../../../src/cli/wrapper.ts'
import { changeConfig, extraLogins, findLogin, followEmail, loadConfig, type KurmisConfig, type LoginSettings } from '../../../src/data/config.ts'
import type { LoginRef } from '../../../src/data/login-id.ts'
import { codexMergedRecordPath, configPath, kurmisHome, loginFolder, loginLockPath, ownClaudeProbeFolder, providerFolder } from '../../../src/data/paths.ts'
import { findProgram, ProgramNotFoundError } from '../../../src/platform/programs.ts'
import { runProgram, type RunResult } from '../../../src/platform/run.ts'
import { FAKE_CLAUDE_SCRIPT, FAKE_CODEX_SCRIPT, writeClaudeIdentity, writeCodexAuth, writeCodexKeyringAuth } from '../../fakes/index.ts'
import { claudeRef, codexRef, OWN_CLAUDE, OWN_CLAUDE_REF, OWN_CODEX, testConfig, writeTestConfig } from '../../logins.ts'
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
function claudeSignsIn(email = 'second@example.com', organizationUuid?: string | null): (spec: ChildSpec) => ChildEnd {
  return (spec) => {
    const dir = spec.env.CLAUDE_CONFIG_DIR
    writeClaudeIdentity(dir === undefined ? join(home, '.claude.json') : join(dir, '.claude.json'),
      organizationUuid === undefined ? { email } : { email, organizationUuid })
    return { kind: 'exit', code: 0 }
  }
}

/** What a successful `codex login` leaves: `auth.json` in `CODEX_HOME`. */
function codexSignsIn(email = 'codex-user@example.com'): (spec: ChildSpec) => ChildEnd {
  return (spec) => {
    writeCodexAuth(spec.env.CODEX_HOME ?? join(home, '.codex'), { email })
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

interface Run {
  program: string
  args: readonly string[]
  env: NodeJS.ProcessEnv | undefined
}

/** A `runProgram` that records each run (the sign-out of a duplicate) and answers `result`. */
function fakeRun(result: Partial<RunResult> = {}): { runs: Run[]; runProgram: LoginDeps['runProgram'] } {
  const runs: Run[] = []
  return {
    runs,
    async runProgram(program, args, options) {
      runs.push({ program, args, env: options.env })
      return { stdout: '', stderr: '', code: 0, timedOut: false, outputTooLarge: false, error: null, ...result }
    }
  }
}

/** A `readCodexEmail` that reads the email the fake's `auth.json` holds, as `codex app-server` would answer it. */
const codexEmailFromAuth: LoginDeps['readCodexEmail'] = async (login, env) => {
  const codexHome = login.usedByPlainCli ? env.CODEX_HOME ?? join(home, '.codex') : loginFolder(login)
  try {
    const auth = JSON.parse(readFileSync(join(codexHome, 'auth.json'), 'utf8')) as { tokens: { id_token: string } }
    const claims = JSON.parse(Buffer.from(auth.tokens.id_token.split('.')[1]!, 'base64url').toString('utf8')) as { email?: string }
    return claims.email ?? null
  } catch {
    return null
  }
}

function command(runner: ChildRunner, patch: Partial<LoginDeps> = {}) {
  const daemon = fakeDaemonClient()
  return {
    daemon,
    login: createLoginCommand({ daemon, runner, findProgram: fakeProgram, home: () => home, readCodexEmail: codexEmailFromAuth, ...patch })
  }
}

/** The one extra login of `provider` a run added. */
function added(provider: 'claude' | 'codex', config: KurmisConfig = loadConfig()): LoginSettings {
  const logins = extraLogins(config, provider)
  expect(logins).toHaveLength(1)
  return logins[0]!
}

/** The folders in `claude/` or `codex/` of the data folder. */
function folders(provider: 'claude' | 'codex'): string[] {
  try {
    return readdirSync(providerFolder(provider))
  } catch {
    return []
  }
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
  writeTestConfig()
})

describe('choosing the login', () => {
  it('reads the provider form and a login by alias or id', () => {
    const config = testConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }, { id: 'workcodex1', provider: 'codex', alias: 'work-example' }] })
    expect(loginTarget('claude', config)).toEqual({ kind: 'new', provider: 'claude' })
    expect(loginTarget('codex', config)).toEqual({ kind: 'new', provider: 'codex' })
    expect(loginTarget('workclaude', config)).toMatchObject({ kind: 'existing', login: { id: 'workclaude' } })
    expect(loginTarget('codex:work-example', config)).toMatchObject({ kind: 'existing', login: { id: 'workcodex1' } })
    expect(loginTarget(OWN_CLAUDE, config)).toMatchObject({ kind: 'existing', login: { id: OWN_CLAUDE, usedByPlainCli: true } })
    expect(loginTarget('work-example', config)).toEqual({ error: expect.stringContaining('give claude:work-example or codex:work-example') as unknown })
    expect(loginTarget('none-example', config)).toEqual({ error: expect.stringContaining('there is no login called "none-example"') as unknown })
  })

  it('reads the provider in any case', () => {
    const config = testConfig()
    expect(loginTarget('Claude', config)).toEqual({ kind: 'new', provider: 'claude' })
    expect(loginTarget(' CODEX ', config)).toEqual({ kind: 'new', provider: 'codex' })
  })

  it('says what is missing when a provider prefix names no login', () => {
    const config = testConfig()
    expect(loginTarget('claude:', config)).toEqual({ error: '"claude:" names no login. Put the alias or id of a Claude login ' +
      'after "claude:", for example claude:work-example, or run "kurmis login claude" to add a new Claude login' })
    expect(loginTarget('Codex:', config)).toEqual({ error: expect.stringContaining('"kurmis login codex" to add a new Codex login') as unknown })
  })

  it('makes a new id of 10 letters and digits that no folder has', () => {
    const config = testConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    for (let index = 0; index < 20; index++) {
      const id = freshLoginId(config)
      expect(id).toMatch(/^[a-z0-9]{10}$/)
      expect([OWN_CLAUDE, OWN_CODEX, 'workclaude', 'work-example']).not.toContain(id)
      expect(existsSync(loginFolder(claudeRef(id))) || existsSync(loginFolder(codexRef(id)))).toBe(false)
    }
  })
})

describe('kurmis login claude', () => {
  it('signs a new login in under a new id, names it after the email and reloads the daemon', async () => {
    const runner = fakeRunner(claudeSignsIn('second.user@example.com'))
    const { daemon, login } = command(runner)
    const out = collect(routedEnv)
    expect(await login.run(['claude'], out.context)).toBe(0)

    const entry = added('claude')
    expect(entry.id).toMatch(/^[a-z0-9]{10}$/)
    expect(entry).toMatchObject({ alias: 'second-user-example', aliasSetByUser: false, routing: true, fiveHourLimit: 100, weeklyLimit: 100 })
    const folder = loginFolder(entry)
    expect(runner.specs).toHaveLength(1)
    const spec = runner.specs[0]!
    expect(spec.command).toBe('/fake/bin/claude')
    expect(spec.args).toEqual(['--fake', 'auth', 'login', '--claudeai'])
    // The sign-in runs in the login's final folder, which is never renamed.
    expect(spec.env.CLAUDE_CONFIG_DIR).toBe(folder)
    expect(spec.env.PATH).toBe('/usr/bin')
    for (const name of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_API_KEY', 'CLAUDE_SECURESTORAGE_CONFIG_DIR']) {
      expect(spec.env[name]).toBeUndefined()
    }
    if (process.platform !== 'win32') expect(statSync(folder).mode & 0o777).toBe(0o700)

    expect(out.stdout()).toContain(`Signing in a new Claude login (id ${entry.id}) with "claude auth login".`)
    expect(out.stdout()).toContain('Signed in as second.user@example.com.')
    expect(out.stdout()).toContain(`Added second-user-example (id ${entry.id}), a Claude login with Auto routing on and both limits at 100%. ` +
      '"kurmis set second-user-example" changes that.')
    expect(out.stdout()).toContain('The running daemon has read the change.')
    // No email is kept in any file kurmis writes.
    expect(readFileSync(configPath(), 'utf8')).not.toContain('example.com')
    expect(daemon.calls).toEqual(['findDaemon', 'requestReload', `requestProbe:${entry.id}`])
    // The lock is released once the command is done.
    expect(existsSync(loginLockPath(entry.id))).toBe(false)
  })

  it('signs a login whose record is in Credential Manager in with CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1', async () => {
    const asked: Array<string | null> = []
    const inCredentialManager = (folder: string | null): Promise<boolean> => {
      asked.push(folder)
      return Promise.resolve(asked.length === 1)
    }
    let email = 0
    const runner = fakeRunner((spec) => claudeSignsIn(`user${String(++email)}@example.com`)(spec))
    const { login } = command(runner, { inCredentialManager })
    expect(await login.run(['claude'], collect(routedEnv).context)).toBe(0)
    expect(await login.run(['claude'], collect(routedEnv).context)).toBe(0)
    expect(asked).toEqual(extraLogins(loadConfig(), 'claude').map((entry) => loginFolder(entry)))
    expect(runner.specs[0]!.env.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBe('1')
    expect(runner.specs[1]!.env.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBeUndefined()
  })

  it('takes --alias, which an email does not replace later', async () => {
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com')))
    const out = collect()
    expect(await login.run(['claude', '--alias', 'job'], out.context)).toBe(0)
    const entry = added('claude')
    expect(entry).toMatchObject({ alias: 'job', aliasSetByUser: true })
    expect(out.stdout()).toContain(`Added job (id ${entry.id})`)
    changeConfig((config) => followEmail(config, entry.id, 'other@example.com'))
    expect(findLogin(loadConfig(), entry.id)?.alias).toBe('job')
  })

  it('gives two logins of one email domain their own aliases, and the same alias in Claude and Codex', async () => {
    const { login } = command(fakeRunner((spec) =>
      spec.args.includes('auth') ? claudeSignsIn('me@example.com')(spec) : codexSignsIn('me@example.com')(spec)))
    expect(await login.run(['claude'], collect().context)).toBe(0)
    expect(await login.run(['codex'], collect().context)).toBe(0)
    expect(added('claude').alias).toBe('me-example')
    expect(added('codex').alias).toBe('me-example')
  })

  it.each([
    [['claude', '--alias', 'Work'], '"Work" is not an alias; an alias is 1 to 32 lowercase letters'],
    [['claude', '--alias', 'claude'], '"claude" is not an alias'],
    [['claude', '--alias', 'taken-example'], 'another Claude login is already called "taken-example"'],
    [['claude', '--alias', OWN_CODEX], `"${OWN_CODEX}" is the id of another login`],
    [['workclaude', '--alias', 'taken-example'], 'another Claude login is already called "taken-example"']
  ])('refuses the alias in %j before anything signs in', async (args, message) => {
    writeTestConfig({ extras: [{ id: 'takenclaud', provider: 'claude', alias: 'taken-example' }, { id: 'workclaude', provider: 'claude' }] })
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner)
    const out = collect()
    expect(await login.run(args, out.context)).toBe(2)
    expect(out.stderr()).toContain(message)
    expect(runner.specs).toEqual([])
    expect(folders('claude')).toEqual([])
  })

  it('takes an alias a login of the other provider has', async () => {
    writeTestConfig({ extras: [{ id: 'workcodex1', provider: 'codex', alias: 'work-example' }] })
    const { login } = command(fakeRunner(claudeSignsIn()))
    expect(await login.run(['claude', '--alias', 'work-example'], collect().context)).toBe(0)
    expect(added('claude').alias).toBe('work-example')
  })

  it('does not start the daemon, and says nothing about it when it is not running', async () => {
    const daemon = fakeDaemonClient({ running: false })
    const login = createLoginCommand({ daemon, runner: fakeRunner(claudeSignsIn()), findProgram: fakeProgram, home: () => home })
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['findDaemon'])
    expect(out.stdout()).not.toContain('daemon')
  })

  it('removes the folder it made and adds nothing when the CLI fails', async () => {
    const { login, daemon } = command(fakeRunner(exitWith(1)))
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(1)
    expect(folders('claude')).toEqual([])
    expect(extraLogins(loadConfig())).toEqual([])
    expect(out.stderr()).toContain('"claude auth login" failed (exit code 1). No login was added.')
    expect(daemon.calls).toEqual([])
  })

  it('cleans up and ends like the CLI when the CLI is ended by a signal', async () => {
    const runner = fakeRunner(() => ({ kind: 'signal', signal: 'SIGTERM' }))
    const { login } = command(runner)
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(130)
    expect(runner.finished).toEqual([{ kind: 'signal', signal: 'SIGTERM' }])
    expect(folders('claude')).toEqual([])
    expect(extraLogins(loadConfig())).toEqual([])
  })

  it('cleans up when the CLI cannot be started', async () => {
    const runner = fakeRunner(() => ({ kind: 'not-started', code: 'ENOENT', message: 'claude could not be started' }))
    const { login } = command(runner)
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(1)
    expect(out.stderr()).toContain('claude could not be started')
    expect(folders('claude')).toEqual([])
  })

  it('adds nothing when the CLI exits 0 without signing in', async () => {
    const { login } = command(fakeRunner(exitWith(0)))
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(1)
    expect(out.stderr()).toMatch(/[a-z0-9]{10} has no credentials\. No login was added\./)
    expect(folders('claude')).toEqual([])
    expect(extraLogins(loadConfig())).toEqual([])
  })

  it('keeps the folder of an existing login whose new sign-in fails', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    mkdirSync(loginFolder(claudeRef('workclaude')), { recursive: true })
    const { login } = command(fakeRunner(exitWith(1)))
    expect(await login.run(['work-example'], collect().context)).toBe(1)
    expect(existsSync(loginFolder(claudeRef('workclaude')))).toBe(true)
    expect(findLogin(loadConfig(), 'workclaude')).toBeDefined()
  })

  it('signs an existing login in again, and its automatic alias follows the new email', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude' }] })
    changeConfig((config) => followEmail(config, 'workclaude', 'old@example.com'))
    const runner = fakeRunner(claudeSignsIn('new@example.com'))
    const { login } = command(runner)
    const out = collect()
    expect(await login.run(['old-example'], out.context)).toBe(0)
    expect(runner.specs[0]!.env.CLAUDE_CONFIG_DIR).toBe(loginFolder(claudeRef('workclaude')))
    expect(out.stdout()).toContain('Signing in old-example with "claude auth login".')
    expect(out.stdout()).toContain('Signed in as new@example.com.')
    expect(out.stdout()).toContain('old-example is now called new-example.')
    expect(out.stdout()).not.toContain('Added')
    expect(findLogin(loadConfig(), 'workclaude')).toMatchObject({ alias: 'new-example', aliasSetByUser: false })
  })

  it('signs an existing login in again with --alias, which it keeps', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude' }] })
    const { login } = command(fakeRunner(claudeSignsIn('again@example.com')))
    expect(await login.run(['workclaude', '--alias', 'job'], collect().context)).toBe(0)
    expect(findLogin(loadConfig(), 'workclaude')).toMatchObject({ alias: 'job', aliasSetByUser: true })
  })

  it('asks the daemon to probe a login signed in again, and says when it still finds it signed out', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    const daemon = fakeDaemonClient({ probed: statusAnswer([loginStatus(claudeRef('workclaude'), { signedIn: false })]) })
    const { login } = command(fakeRunner(claudeSignsIn('again@example.com')), { daemon })
    const out = collect()
    expect(await login.run(['work-example'], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['findDaemon', 'requestReload', 'requestProbe:workclaude'])
    expect(out.stdout()).toContain('The daemon still finds work-example signed out')
  })

  it('stops waiting for the daemon\'s probe after a while, and ends the probe request', async () => {
    writeTestConfig({ extras: [{ id: 'workcodex1', provider: 'codex', alias: 'work-example' }] })
    const daemon = fakeDaemonClient()
    let probeSignal: AbortSignal | undefined
    daemon.requestProbe = (_connection, _logins, signal) => {
      probeSignal = signal
      return new Promise(() => undefined)
    }
    const { login } = command(fakeRunner(codexSignsIn()), { daemon, probeWaitMs: 20 })
    const out = collect()
    expect(await login.run(['work-example'], out.context)).toBe(0)
    expect(out.stdout()).toContain("The daemon's check of work-example did not finish within 0.02 s")
    expect(probeSignal?.aborted).toBe(true)
  })

  it('stops at once, starting nothing, while another run holds the login', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    holdLock('workclaude')
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner)
    const out = collect()
    expect(await login.run(['work-example'], out.context)).toBe(1)
    expect(out.stderr()).toContain(`another "kurmis login" or "kurmis logout" of work-example is running now (pid ${String(process.ppid)})`)
    expect(runner.specs).toEqual([])
    expect(existsSync(loginFolder(claudeRef('workclaude')))).toBe(false)
    expect(existsSync(loginLockPath('workclaude'))).toBe(true)
  })

  it('takes over the lock of a run that was killed', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    holdLock('workclaude', DEAD_PID)
    const { login } = command(fakeRunner(claudeSignsIn()))
    expect(await login.run(['work-example'], collect().context)).toBe(0)
    expect(findLogin(loadConfig(), 'workclaude')).toBeDefined()
  })

  it('signs the login plain claude uses in on ~/.claude, and its alias follows the email', async () => {
    mkdirSync(ownClaudeProbeFolder(), { recursive: true })
    writeClaudeIdentity(join(ownClaudeProbeFolder(), '.claude.json'), { email: 'before@example.com' })
    const runner = fakeRunner(claudeSignsIn('own@example.com'))
    const { login } = command(runner)
    const out = collect(routedEnv)
    expect(await login.run([OWN_CLAUDE], out.context)).toBe(0)
    expect(runner.specs[0]!.env.CLAUDE_CONFIG_DIR).toBeUndefined()
    expect(runner.specs[0]!.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(out.stdout()).toContain('Signed in as own@example.com.')
    expect(out.stdout()).toContain(`${OWN_CLAUDE} is now called own-example.`)
    // The probe folder's profile named the account from before.
    expect(existsSync(join(ownClaudeProbeFolder(), '.claude.json'))).toBe(false)
    expect(folders('claude')).toEqual([])
    expect(loadConfig().logins.map((entry) => [entry.id, entry.alias])).toEqual([[OWN_CLAUDE, 'own-example'], [OWN_CODEX, OWN_CODEX]])
  })

  it('gives a usage error for a wrong command line without starting anything', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }, { id: 'workcodex1', provider: 'codex', alias: 'work-example' }] })
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner)
    for (const args of [['work-example'], ['none-example'], [], ['claude', 'codex'], ['claude', '--label', 'x'], ['claude', '--name', 'x']]) {
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
    expect(existsSync(providerFolder('claude'))).toBe(false)
  })
})

describe('kurmis login of an account that is already a kurmis login', () => {
  it('signs the new Claude folder out again, deletes it and names the login that account is', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'), { email: 'work@example.com' })
    const signOut = fakeRun()
    const { login, daemon } = command(fakeRunner(claudeSignsIn('Work@Example.com')), { runProgram: signOut.runProgram, platform: 'darwin' })
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(0)

    expect(extraLogins(loadConfig()).map((entry) => entry.id)).toEqual(['workclaude'])
    expect(folders('claude')).toEqual(['workclaude'])
    expect(signOut.runs).toHaveLength(1)
    const [run] = signOut.runs
    expect(run!.program).toBe('/fake/bin/claude')
    expect(run!.args).toEqual(['--fake', 'auth', 'logout'])
    expect(run!.env?.CLAUDE_CONFIG_DIR).toMatch(new RegExp(`${providerFolder('claude').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}.[a-z0-9]{10}$`))
    expect(run!.env?.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBeUndefined()
    expect(out.stdout()).toContain('Work@Example.com is already a kurmis Claude login: work-example (id workclaude). ' +
      'No login was added, and the new sign-in was signed out again.')
    expect(out.stdout()).toContain('"kurmis login work-example" signs work-example in again.')
    expect(daemon.calls).toEqual([])
  })

  it('says that --alias was not used', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'), { email: 'work@example.com' })
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com')), { runProgram: fakeRun().runProgram })
    const out = collect()
    expect(await login.run(['claude', '--alias', 'job'], out.context)).toBe(0)
    expect(out.stderr()).toBe('kurmis login: --alias job was not used, because no login was added. ' +
      '"kurmis set work-example --alias job" gives work-example that alias.\n')
    expect(findLogin(loadConfig(), 'workclaude')?.alias).toBe('work-example')
  })

  it('adds a Claude account once when another run added it after the first check', async () => {
    writeTestConfig()
    const signOut = fakeRun()
    // The second look at the home folder is the check before the config is changed. Another
    // `kurmis login claude` of the same account saves its login just then.
    let calls = 0
    const homeWithRace = (): string => {
      calls++
      if (calls === 2) {
        writeTestConfig({ extras: [{ id: 'raceclaude', provider: 'claude', alias: 'same-example' }] })
        writeClaudeIdentity(join(loginFolder(claudeRef('raceclaude')), '.claude.json'), { email: 'same@example.com' })
      }
      return home
    }
    const { login } = command(fakeRunner(claudeSignsIn('same@example.com')), { runProgram: signOut.runProgram, home: homeWithRace })
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(0)
    expect(extraLogins(loadConfig()).map((entry) => entry.id)).toEqual(['raceclaude'])
    expect(folders('claude')).toEqual(['raceclaude'])
    expect(signOut.runs).toHaveLength(1)
    expect(out.stdout()).toContain('same@example.com is already a kurmis Claude login: same-example (id raceclaude).')
  })

  it('warns, and signs nothing out, when an existing login is signed in to the account of another login', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }, { id: 'homeclaude', provider: 'claude', alias: 'home-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'), { email: 'work@example.com' })
    const signOut = fakeRun()
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com')), { runProgram: signOut.runProgram })
    const out = collect()
    expect(await login.run(['home-example'], out.context)).toBe(0)
    expect(out.stderr()).toBe('kurmis login: warning: work@example.com is also the account of work-example (id workclaude). ' +
      'home-example and work-example are now the same account and share its limits. Neither was signed out. ' +
      '"kurmis login home-example" signs home-example in to another account.\n')
    expect(signOut.runs).toEqual([])
    expect(extraLogins(loadConfig()).map((entry) => entry.id)).toEqual(['workclaude', 'homeclaude'])
    expect(folders('claude').sort()).toEqual(['homeclaude', 'workclaude'])
  })

  it('warns when the login plain codex uses is signed in to the account of an extra Codex login', async () => {
    writeTestConfig({ extras: [{ id: 'workcodex1', provider: 'codex', alias: 'work-example' }] })
    writeCodexAuth(loginFolder(codexRef('workcodex1')), { email: 'work@example.com' })
    const { login } = command(fakeRunner(codexSignsIn('work@example.com')),
      { runProgram: fakeRun().runProgram, daemon: fakeDaemonClient({ running: false }) })
    const out = collect()
    expect(await login.run([OWN_CODEX], out.context)).toBe(0)
    expect(out.stderr()).toContain('kurmis login: warning: work@example.com is also the account of work-example (id workcodex1).')
  })

  it('finds the login plain claude uses, and signs out with CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1 on Windows', async () => {
    writeClaudeIdentity(join(home, '.claude.json'), { email: 'own@example.com' })
    writeTestConfig({ ownClaude: { alias: 'own-example' }, extras: [{ id: 'othercodex', provider: 'codex', alias: 'own-example' }] })
    const signOut = fakeRun({ code: 1 })
    const { login } = command(fakeRunner(claudeSignsIn('own@example.com')), { runProgram: signOut.runProgram, platform: 'win32' })
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(0)
    expect(signOut.runs[0]!.env?.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBe('1')
    expect(out.stderr()).toContain('"claude auth logout" did not finish (exit code 1); the new sign-in is deleted anyway.')
    expect(out.stderr()).toContain('may be left; Credential Manager can delete them.')
    expect(out.stdout()).toContain(`own@example.com is already a kurmis Claude login: own-example, the login plain claude uses (id ${OWN_CLAUDE}).`)
    // A Codex login has the same alias, so the command names the provider.
    expect(out.stdout()).toContain('"kurmis login claude:own-example" signs own-example in again.')
    expect(folders('claude')).toEqual([])
  })

  it('signs the new Codex home out again and deletes it with its merged record', async () => {
    writeTestConfig({ extras: [{ id: 'workcodex1', provider: 'codex', alias: 'work-example' }] })
    writeCodexAuth(loginFolder(codexRef('workcodex1')), { email: 'work@example.com' })
    const signOut = fakeRun()
    const asked: string[] = []
    const readCodexEmail: LoginDeps['readCodexEmail'] = async (ref, env) => {
      asked.push(ref.id)
      return await codexEmailFromAuth(ref, env)
    }
    const { login } = command(fakeRunner(codexSignsIn('work@example.com')),
      { runProgram: signOut.runProgram, readCodexEmail, daemon: fakeDaemonClient({ running: false }) })
    const out = collect()
    expect(await login.run(['codex'], out.context)).toBe(0)
    expect(signOut.runs.map((run) => run.args)).toEqual([['--fake', 'logout']])
    const newId = signOut.runs[0]!.env?.CODEX_HOME?.slice(providerFolder('codex').length + 1)
    expect(newId).toMatch(/^[a-z0-9]{10}$/)
    expect(folders('codex')).toEqual(['workcodex1'])
    expect(existsSync(codexMergedRecordPath(codexRef(newId!)))).toBe(false)
    expect(extraLogins(loadConfig()).map((entry) => entry.id)).toEqual(['workcodex1'])
    expect(out.stdout()).toContain('work@example.com is already a kurmis Codex login: work-example (id workcodex1).')
    // The new login's email, then the others', the login plain claude uses included.
    expect(asked.sort()).toEqual([newId, OWN_CODEX, 'workcodex1'].sort())
  })

  it('takes Codex emails a running daemon knows from its status instead of asking Codex', async () => {
    writeTestConfig({ extras: [{ id: 'workcodex1', provider: 'codex', alias: 'work-example' }] })
    const asked: string[] = []
    const readCodexEmail: LoginDeps['readCodexEmail'] = async (ref, env) => {
      asked.push(ref.id)
      return await codexEmailFromAuth(ref, env)
    }
    const daemon = fakeDaemonClient({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF), loginStatus(codexRef('workcodex1'), { email: 'work@example.com' })]) })
    const { login } = command(fakeRunner(codexSignsIn('work@example.com')), { runProgram: fakeRun().runProgram, readCodexEmail, daemon })
    const out = collect()
    expect(await login.run(['codex'], out.context)).toBe(0)
    expect(out.stdout()).toContain('work@example.com is already a kurmis Codex login: work-example (id workcodex1).')
    expect(asked).not.toContain('workcodex1')
    expect(daemon.calls).toEqual(['findDaemon', 'readStatus'])
  })

  it('adds a second login for the same email in another organization, with the alias ending in -2', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'),
      { email: 'work@example.com', organizationUuid: '00000000-0000-4000-8000-00000000c001' })
    const signOut = fakeRun()
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com', '00000000-0000-4000-8000-00000000c002')),
      { runProgram: signOut.runProgram })
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(0)
    expect(signOut.runs).toEqual([])
    const second = extraLogins(loadConfig(), 'claude').find((entry) => entry.id !== 'workclaude')
    expect(second?.alias).toBe('work-example-2')
    expect(out.stdout()).toContain('work-example has the same email in another organization. That is another subscription, ' +
      'so the two are separate logins.')
  })

  it('takes the same email as the same account when one side has no organization recorded', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'), { email: 'work@example.com', organizationUuid: null })
    const signOut = fakeRun()
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com', '00000000-0000-4000-8000-00000000c002')),
      { runProgram: signOut.runProgram })
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(0)
    expect(signOut.runs).toHaveLength(1)
    expect(extraLogins(loadConfig()).map((entry) => entry.id)).toEqual(['workclaude'])
    expect(out.stdout()).toContain('work@example.com is already a kurmis Claude login: work-example (id workclaude).')
  })

  it('does not warn when an existing login is signed in to the email of another login in another organization', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }, { id: 'homeclaude', provider: 'claude', alias: 'home-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'),
      { email: 'work@example.com', organizationUuid: '00000000-0000-4000-8000-00000000c001' })
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com', '00000000-0000-4000-8000-00000000c002')),
      { runProgram: fakeRun().runProgram })
    const out = collect()
    expect(await login.run(['home-example'], out.context)).toBe(0)
    expect(out.stderr()).toBe('')
  })

  it('adds the login when no other login of its provider has the email', async () => {
    writeTestConfig({ extras: [{ id: 'workcodex1', provider: 'codex', alias: 'work-example' }] })
    // The same email on the other provider is another subscription.
    writeCodexAuth(loginFolder(codexRef('workcodex1')), { email: 'work@example.com' })
    const signOut = fakeRun()
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com')), { runProgram: signOut.runProgram })
    expect(await login.run(['claude'], collect().context)).toBe(0)
    expect(added('claude').alias).toBe('work-example')
    expect(signOut.runs).toEqual([])
  })
})

describe('kurmis login codex', () => {
  it('runs codex login with the new folder as CODEX_HOME and adds the login once auth.json is there', async () => {
    const runner = fakeRunner(codexSignsIn('side@example.com'))
    const { login } = command(runner)
    const out = collect({ PATH: '/usr/bin', CODEX_HOME: '/elsewhere' })
    expect(await login.run(['codex'], out.context)).toBe(0)
    const entry = added('codex')
    expect(runner.specs[0]!.args).toEqual(['--fake', 'login'])
    expect(runner.specs[0]!.env.CODEX_HOME).toBe(loginFolder(entry))
    expect(entry.alias).toBe('side-example')
    expect(out.stdout()).toContain('Signed in as side@example.com.')
  })

  it('keeps the id as the alias while Codex names no email', async () => {
    const { login } = command(fakeRunner(codexSignsIn()), { readCodexEmail: async () => null })
    const out = collect()
    expect(await login.run(['codex'], out.context)).toBe(0)
    const entry = added('codex')
    expect(entry.alias).toBe(entry.id)
    expect(out.stdout()).toContain('Signed in.')
  })

  it('prepares the new home from the default one before codex login runs in it', async () => {
    const defaultHome = join(home, '.codex')
    mkdirSync(defaultHome, { recursive: true })
    writeFileSync(join(defaultHome, 'config.toml'), 'model = "gpt-test"\n')
    let configSeen: string | null = null
    const runner = fakeRunner((spec) => {
      configSeen = readFileSync(join(spec.env.CODEX_HOME!, 'config.toml'), 'utf8')
      return codexSignsIn()(spec)
    })
    const prepared: LoginRef[] = []
    const { login } = command(runner, {
      prepareCodexHome: async (ref, options) => {
        prepared.push(ref)
        return await realPrepareCodexHome(ref, options)
      }
    })
    expect(await login.run(['codex'], collect({ PATH: '/usr/bin' }).context)).toBe(0)
    expect(prepared.map((ref) => ref.id)).toEqual([added('codex').id])
    expect(configSeen).toContain('model = "gpt-test"')
  })

  it('removes a new home and adds nothing when it cannot be prepared', async () => {
    const runner = fakeRunner(exitWith(0))
    const { login } = command(runner, { prepareCodexHome: async () => { throw new Error('disk full') } })
    const out = collect({ PATH: '/usr/bin' })
    expect(await login.run(['codex'], out.context)).toBe(1)
    expect(out.stderr()).toMatch(/could not prepare the Codex home of [a-z0-9]{10}: disk full\. No login was added\./)
    expect(runner.specs).toEqual([])
    expect(folders('codex')).toEqual([])
    expect(extraLogins(loadConfig())).toEqual([])
  })

  it('adds nothing when codex login leaves no auth.json', async () => {
    const { login } = command(fakeRunner(exitWith(0)))
    expect(await login.run(['codex'], collect().context)).toBe(1)
    expect(folders('codex')).toEqual([])
    expect(extraLogins(loadConfig())).toEqual([])
  })

  it('removes the merged record of a new home when codex login fails', async () => {
    const defaultHome = join(home, '.codex')
    mkdirSync(defaultHome, { recursive: true })
    writeFileSync(join(defaultHome, 'config.toml'), 'model = "gpt-test"\n')
    const runner = fakeRunner(exitWith(1))
    const { login } = command(runner)
    expect(await login.run(['codex'], collect().context)).toBe(1)
    expect(folders('codex')).toEqual([])
    expect(existsSync(join(kurmisHome(), 'codex-merged')) ? readdirSync(join(kurmisHome(), 'codex-merged')) : []).toEqual([])
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
    const { login } = command(signsIn, { findProgram, readCodexEmail: async () => null })
    const out = collect(env)
    expect(await login.run(['codex'], out.context)).toBe(0)
    const entry = added('codex')
    expect(existsSync(join(loginFolder(entry), 'auth.json'))).toBe(false)

    // Without the keyring item it is not signed in, and nothing is added.
    const { login: second } = command(fakeRunner(exitWith(0)), { findProgram })
    const failed = collect(env)
    expect(await second.run(['codex'], failed.context)).toBe(1)
    expect(failed.stderr()).toMatch(/[a-z0-9]{10} has no credentials/)
    expect(folders('codex')).toEqual([entry.id])
  })

  it('signs the login plain codex uses in with CODEX_HOME as inherited', async () => {
    const codexHome = join(home, 'codex-own')
    const runner = fakeRunner(codexSignsIn())
    const { login } = command(runner)
    expect(await login.run([OWN_CODEX], collect({ CODEX_HOME: codexHome }).context)).toBe(0)
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
    expect(await login.run(['claude'], out.context)).toBe(0)
    expect(out.stdout()).toContain('Signed in as fake@example.com.')
    const entry = added('claude')
    expect(entry.alias).toBe('fake-example')
    expect(existsSync(join(loginFolder(entry), '.credentials.json'))).toBe(true)
  })

  it('signs a duplicate out with the fake and removes its folder', async () => {
    const login = createLoginCommand({ daemon: fakeDaemonClient({ running: false }), runner: pipedRunner, findProgram, runProgram, home: () => home })
    expect(await login.run(['claude'], collect(env()).context)).toBe(0)
    const out = collect(env())
    expect(await login.run(['claude'], out.context)).toBe(0)
    expect(out.stdout()).toContain('fake@example.com is already a kurmis Claude login: fake-example')
    expect(folders('claude')).toEqual([added('claude').id])
  })

  it('removes the folder when the fake fails', async () => {
    const login = createLoginCommand({ daemon: fakeDaemonClient({ running: false }), runner: pipedRunner, findProgram, home: () => home })
    const out = collect(env({ FAKE_CLAUDE_LOGIN: 'fail' }))
    expect(await login.run(['claude'], out.context)).toBe(1)
    expect(folders('claude')).toEqual([])
    expect(extraLogins(loadConfig())).toEqual([])
  })
})
