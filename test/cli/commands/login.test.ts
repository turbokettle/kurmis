import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChildRunner } from '../../../src/cli/command-deps.ts'
import { createLoginCommand, freshLoginId, loginTarget, type LoginDeps } from '../../../src/cli/commands/login.ts'
import type { ChildEnd, ChildSpec } from '../../../src/cli/wrapper.ts'
import { changeConfig, extraLogins, findLogin, followEmail, loadConfig, type KurmisConfig, type LoginSettings } from '../../../src/data/config.ts'
import { configPath, extraLoginsFolder, kurmisHome, loginFolder, loginLockPath, ownClaudeProbeFolder } from '../../../src/data/paths.ts'
import { findProgram, ProgramNotFoundError } from '../../../src/platform/programs.ts'
import { runProgram, type RunResult } from '../../../src/platform/run.ts'
import { FAKE_CLAUDE_SCRIPT, writeClaudeCredentials, writeClaudeIdentity } from '../../fakes/index.ts'
import { claudeRef, OWN_CLAUDE, testConfig, writeTestConfig } from '../../logins.ts'
import { collect, fakeDaemonClient, loginStatus, statusAnswer } from '../helpers.ts'

const home = process.env.HOME!

interface FakeRunner extends ChildRunner {
  specs: ChildSpec[]
  finished: ChildEnd[]
}

/**
 * A child runner that stands in for `claude auth login`: `act` runs with the spec instead of a
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

function command(runner: ChildRunner, patch: Partial<LoginDeps> = {}) {
  const daemon = fakeDaemonClient()
  return {
    daemon,
    login: createLoginCommand({ daemon, runner, findProgram: fakeProgram, home: () => home, ...patch })
  }
}

/** The one extra login a run added. */
function added(config: KurmisConfig = loadConfig()): LoginSettings {
  const logins = extraLogins(config)
  expect(logins).toHaveLength(1)
  return logins[0]!
}

/** The folders in `claude/` of the data folder. */
function folders(): string[] {
  try {
    return readdirSync(extraLoginsFolder())
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
  writeTestConfig()
})

describe('choosing the login', () => {
  it('asks for a new login without an argument, and reads an existing login by alias or id', () => {
    const config = testConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
    expect(loginTarget(undefined, config)).toEqual({ kind: 'new' })
    expect(loginTarget('workclaude', config)).toMatchObject({ kind: 'existing', login: { id: 'workclaude' } })
    expect(loginTarget('Work-Example', config)).toMatchObject({ kind: 'existing', login: { id: 'workclaude' } })
    expect(loginTarget(OWN_CLAUDE, config)).toMatchObject({ kind: 'existing', login: { id: OWN_CLAUDE, usedByPlainClaude: true } })
    expect(loginTarget('none-example', config)).toEqual({ error: 'there is no login called "none-example". "kurmis login" without a ' +
      'login adds a new one, and "kurmis status" shows the logins there are' })
  })

  it('reads claude as the name of a login, not as a word that adds one', () => {
    expect(loginTarget('claude', testConfig())).toEqual({ error: expect.stringContaining('there is no login called "claude"') as unknown })
    const config = testConfig({ extras: [{ id: 'workclaude', alias: 'claude' }] })
    expect(loginTarget('claude', config)).toMatchObject({ kind: 'existing', login: { id: 'workclaude' } })
  })

  it('makes a new id of 10 letters and digits that no folder has', () => {
    const config = testConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
    for (let index = 0; index < 20; index++) {
      const id = freshLoginId(config)
      expect(id).toMatch(/^[a-z0-9]{10}$/)
      expect([OWN_CLAUDE, 'workclaude', 'work-example']).not.toContain(id)
      expect(existsSync(loginFolder(claudeRef(id)))).toBe(false)
    }
  })

  it('does not take an id that a folder in claude/ already has', () => {
    const config = testConfig()
    const taken: string[] = []
    for (let index = 0; index < 5; index++) {
      const id = freshLoginId(config)
      mkdirSync(loginFolder(claudeRef(id)), { recursive: true })
      taken.push(id)
    }
    for (let index = 0; index < 20; index++) expect(taken).not.toContain(freshLoginId(config))
  })
})

describe('kurmis login without a login', () => {
  it('signs a new login in under a new id, names it after the email and reloads the daemon', async () => {
    const runner = fakeRunner(claudeSignsIn('second.user@example.com'))
    const { daemon, login } = command(runner)
    const out = collect(routedEnv)
    expect(await login.run([], out.context)).toBe(0)

    const entry = added()
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

    expect(out.stdout()).toContain(`Signing in a new login (id ${entry.id}) with "claude auth login".`)
    expect(out.stdout()).toContain('Signed in as second.user@example.com.')
    expect(out.stdout()).toContain(`Added second-user-example (id ${entry.id}), a login with Auto routing on and both limits at 100%. ` +
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
    expect(await login.run([], collect(routedEnv).context)).toBe(0)
    expect(await login.run([], collect(routedEnv).context)).toBe(0)
    expect(asked).toEqual(extraLogins(loadConfig()).map((entry) => loginFolder(entry)))
    expect(runner.specs[0]!.env.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBe('1')
    expect(runner.specs[1]!.env.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBeUndefined()
  })

  it('takes --alias, which an email does not replace later', async () => {
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com')))
    const out = collect()
    expect(await login.run(['--alias', 'job'], out.context)).toBe(0)
    const entry = added()
    expect(entry).toMatchObject({ alias: 'job', aliasSetByUser: true })
    expect(out.stdout()).toContain(`Added job (id ${entry.id})`)
    changeConfig((config) => followEmail(config, entry.id, 'other@example.com'))
    expect(findLogin(loadConfig(), entry.id)?.alias).toBe('job')
  })

  it.each([
    [['--alias', 'Work'], '"Work" is not an alias; an alias is 1 to 32 lowercase letters'],
    [['--alias', '_work'], '"_work" is not an alias'],
    [['--alias', 'taken-example'], 'another login is already called "taken-example"'],
    [['--alias', OWN_CLAUDE], `"${OWN_CLAUDE}" is the id of another login`],
    [['workclaude', '--alias', 'taken-example'], 'another login is already called "taken-example"']
  ])('refuses the alias in %j before anything signs in', async (args, message) => {
    writeTestConfig({ extras: [{ id: 'takenclaud', alias: 'taken-example' }, { id: 'workclaude' }] })
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner)
    const out = collect()
    expect(await login.run(args, out.context)).toBe(2)
    expect(out.stderr()).toContain(message)
    expect(runner.specs).toEqual([])
    expect(folders()).toEqual([])
  })

  it.each(['claude'])('takes %s as an alias', async (alias) => {
    const { login } = command(fakeRunner(claudeSignsIn()))
    expect(await login.run(['--alias', alias], collect().context)).toBe(0)
    expect(added()).toMatchObject({ alias, aliasSetByUser: true })
  })

  it('does not start the daemon, and says nothing about it when it is not running', async () => {
    const daemon = fakeDaemonClient({ running: false })
    const login = createLoginCommand({ daemon, runner: fakeRunner(claudeSignsIn()), findProgram: fakeProgram, home: () => home })
    const out = collect()
    expect(await login.run([], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['findDaemon'])
    expect(out.stdout()).not.toContain('daemon')
  })

  it('removes the folder it made and adds nothing when the CLI fails', async () => {
    const { login, daemon } = command(fakeRunner(exitWith(1)))
    const out = collect()
    expect(await login.run([], out.context)).toBe(1)
    expect(folders()).toEqual([])
    expect(extraLogins(loadConfig())).toEqual([])
    expect(out.stderr()).toContain('"claude auth login" failed (exit code 1). No login was added.')
    expect(daemon.calls).toEqual([])
  })

  it('cleans up and ends like the CLI when the CLI is ended by a signal', async () => {
    const runner = fakeRunner(() => ({ kind: 'signal', signal: 'SIGTERM' }))
    const { login } = command(runner)
    const out = collect()
    expect(await login.run([], out.context)).toBe(130)
    expect(runner.finished).toEqual([{ kind: 'signal', signal: 'SIGTERM' }])
    expect(folders()).toEqual([])
    expect(extraLogins(loadConfig())).toEqual([])
  })

  it('cleans up when the CLI cannot be started', async () => {
    const runner = fakeRunner(() => ({ kind: 'not-started', code: 'ENOENT', message: 'claude could not be started' }))
    const { login } = command(runner)
    const out = collect()
    expect(await login.run([], out.context)).toBe(1)
    expect(out.stderr()).toContain('claude could not be started')
    expect(folders()).toEqual([])
  })

  it('adds a login whose sign-in left a token but no email, and keeps the id as its alias', async () => {
    const { login } = command(fakeRunner((spec) => {
      writeClaudeCredentials(spec.env.CLAUDE_CONFIG_DIR!)
      return { kind: 'exit', code: 0 }
    }))
    const out = collect()
    expect(await login.run([], out.context)).toBe(0)
    const entry = added()
    expect(entry.alias).toBe(entry.id)
    expect(out.stdout()).toContain('Signed in.\n')
    expect(out.stdout()).toContain(`Added ${entry.id} (id ${entry.id}), a login with Auto routing on`)
  })

  it('adds nothing when the CLI exits 0 without signing in', async () => {
    const { login } = command(fakeRunner(exitWith(0)))
    const out = collect()
    expect(await login.run([], out.context)).toBe(1)
    expect(out.stderr()).toMatch(/[a-z0-9]{10} has no credentials\. No login was added\./)
    expect(folders()).toEqual([])
    expect(extraLogins(loadConfig())).toEqual([])
  })

  it('keeps the folder of an existing login whose new sign-in fails', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
    mkdirSync(loginFolder(claudeRef('workclaude')), { recursive: true })
    const { login } = command(fakeRunner(exitWith(1)))
    expect(await login.run(['work-example'], collect().context)).toBe(1)
    expect(existsSync(loginFolder(claudeRef('workclaude')))).toBe(true)
    expect(findLogin(loadConfig(), 'workclaude')).toBeDefined()
  })

  it('signs an existing login in again, and its automatic alias follows the new email', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude' }] })
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
    writeTestConfig({ extras: [{ id: 'workclaude' }] })
    const { login } = command(fakeRunner(claudeSignsIn('again@example.com')))
    expect(await login.run(['workclaude', '--alias', 'job'], collect().context)).toBe(0)
    expect(findLogin(loadConfig(), 'workclaude')).toMatchObject({ alias: 'job', aliasSetByUser: true })
  })

  it('asks the daemon to probe a login signed in again, and says when it still finds it signed out', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
    const daemon = fakeDaemonClient({ probed: statusAnswer([loginStatus(claudeRef('workclaude'), { signedIn: false })]) })
    const { login } = command(fakeRunner(claudeSignsIn('again@example.com')), { daemon })
    const out = collect()
    expect(await login.run(['work-example'], out.context)).toBe(0)
    expect(daemon.calls).toEqual(['findDaemon', 'requestReload', 'requestProbe:workclaude'])
    expect(out.stdout()).toContain('The daemon still finds work-example signed out')
  })

  it('stops waiting for the daemon\'s probe after a while, and ends the probe request', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
    const daemon = fakeDaemonClient()
    let probeSignal: AbortSignal | undefined
    daemon.requestProbe = (_connection, _logins, signal) => {
      probeSignal = signal
      return new Promise(() => undefined)
    }
    const { login } = command(fakeRunner(claudeSignsIn()), { daemon, probeWaitMs: 20 })
    const out = collect()
    expect(await login.run(['work-example'], out.context)).toBe(0)
    expect(out.stdout()).toContain("The daemon's check of work-example did not finish within 0.02 s")
    expect(probeSignal?.aborted).toBe(true)
  })

  it('stops at once, starting nothing, while another run holds the login', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
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
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
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
    expect(folders()).toEqual([])
    expect(loadConfig().logins.map((entry) => [entry.id, entry.alias])).toEqual([[OWN_CLAUDE, 'own-example']])
  })

  it('gives a usage error for a wrong command line without starting anything', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner)
    for (const args of [['none-example'], ['work-example', 'none-example'], ['--label', 'x'], ['--name', 'x'], ['work-example', '--name', 'x']]) {
      const out = collect()
      expect(await login.run(args, out.context)).toBe(2)
      expect(out.stderr()).toContain('kurmis login:')
    }
    expect(runner.specs).toEqual([])
  })

  it('reads "kurmis login claude" as the login called claude, which adds nothing when there is none', async () => {
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner)
    const out = collect()
    expect(await login.run(['claude'], out.context)).toBe(2)
    expect(out.stderr()).toContain('kurmis login: there is no login called "claude". "kurmis login" without a login adds a new one')
    expect(runner.specs).toEqual([])
    expect(folders()).toEqual([])

    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'claude' }] })
    const again = collect()
    expect(await login.run(['claude'], again.context)).toBe(0)
    expect(runner.specs[0]!.env.CLAUDE_CONFIG_DIR).toBe(loginFolder(claudeRef('workclaude')))
    expect(again.stdout()).toContain('Signing in claude with "claude auth login".')
    expect(extraLogins(loadConfig()).map((entry) => entry.id)).toEqual(['workclaude'])
  })

  it('reports a missing claude program and creates nothing', async () => {
    const runner = fakeRunner(claudeSignsIn())
    const { login } = command(runner, {
      findProgram: (tool) => {
        throw new ProgramNotFoundError(tool, 'claude was not found on PATH.')
      }
    })
    const out = collect()
    expect(await login.run([], out.context)).toBe(1)
    expect(out.stderr()).toContain('claude was not found on PATH.')
    expect(existsSync(extraLoginsFolder())).toBe(false)
  })
})

describe('kurmis login of an account that is already a kurmis login', () => {
  it('signs the new folder out again, deletes it and names the login that account is', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'), { email: 'work@example.com' })
    const signOut = fakeRun()
    const { login, daemon } = command(fakeRunner(claudeSignsIn('Work@Example.com')), { runProgram: signOut.runProgram, platform: 'darwin' })
    const out = collect()
    expect(await login.run([], out.context)).toBe(0)

    expect(extraLogins(loadConfig()).map((entry) => entry.id)).toEqual(['workclaude'])
    expect(folders()).toEqual(['workclaude'])
    expect(signOut.runs).toHaveLength(1)
    const [run] = signOut.runs
    expect(run!.program).toBe('/fake/bin/claude')
    expect(run!.args).toEqual(['--fake', 'auth', 'logout'])
    expect(run!.env?.CLAUDE_CONFIG_DIR).toMatch(new RegExp(`${extraLoginsFolder().replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}.[a-z0-9]{10}$`))
    expect(run!.env?.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBeUndefined()
    expect(out.stdout()).toContain('Work@Example.com is already a kurmis login: work-example (id workclaude). ' +
      'No login was added, and the new sign-in was signed out again.')
    expect(out.stdout()).toContain('"kurmis login work-example" signs work-example in again.')
    expect(daemon.calls).toEqual([])
  })

  it('says that --alias was not used', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'), { email: 'work@example.com' })
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com')), { runProgram: fakeRun().runProgram })
    const out = collect()
    expect(await login.run(['--alias', 'job'], out.context)).toBe(0)
    expect(out.stderr()).toBe('kurmis login: --alias job was not used, because no login was added. ' +
      '"kurmis set work-example --alias job" gives work-example that alias.\n')
    expect(findLogin(loadConfig(), 'workclaude')?.alias).toBe('work-example')
  })

  it('adds an account once when another run added it after the first check', async () => {
    writeTestConfig()
    const signOut = fakeRun()
    // The second look at the home folder is the check before the config is changed. Another
    // `kurmis login` of the same account saves its login just then.
    let calls = 0
    const homeWithRace = (): string => {
      calls++
      if (calls === 2) {
        writeTestConfig({ extras: [{ id: 'raceclaude', alias: 'same-example' }] })
        writeClaudeIdentity(join(loginFolder(claudeRef('raceclaude')), '.claude.json'), { email: 'same@example.com' })
      }
      return home
    }
    const { login } = command(fakeRunner(claudeSignsIn('same@example.com')), { runProgram: signOut.runProgram, home: homeWithRace })
    const out = collect()
    expect(await login.run([], out.context)).toBe(0)
    expect(extraLogins(loadConfig()).map((entry) => entry.id)).toEqual(['raceclaude'])
    expect(folders()).toEqual(['raceclaude'])
    expect(signOut.runs).toHaveLength(1)
    expect(out.stdout()).toContain('same@example.com is already a kurmis login: same-example (id raceclaude).')
  })

  it('warns, and signs nothing out, when an existing login is signed in to the account of another login', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }, { id: 'homeclaude', alias: 'home-example' }] })
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
    expect(folders().sort()).toEqual(['homeclaude', 'workclaude'])
  })

  it('finds the login plain claude uses, and signs out with CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1 on Windows', async () => {
    writeClaudeIdentity(join(home, '.claude.json'), { email: 'own@example.com' })
    writeTestConfig({ ownClaude: { alias: 'own-example' } })
    const signOut = fakeRun({ code: 1 })
    const { login } = command(fakeRunner(claudeSignsIn('own@example.com')), { runProgram: signOut.runProgram, platform: 'win32' })
    const out = collect()
    expect(await login.run([], out.context)).toBe(0)
    expect(signOut.runs[0]!.env?.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBe('1')
    expect(out.stderr()).toContain('"claude auth logout" did not finish (exit code 1); the new sign-in is deleted anyway.')
    expect(out.stderr()).toContain('may be left; Credential Manager can delete them.')
    expect(out.stdout()).toContain(`own@example.com is already a kurmis login: own-example, the login plain claude uses (id ${OWN_CLAUDE}).`)
    expect(out.stdout()).toContain('"kurmis login own-example" signs own-example in again.')
    expect(folders()).toEqual([])
  })

  it('adds a second login for the same email in another organization, with the alias ending in -2', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'),
      { email: 'work@example.com', organizationUuid: '00000000-0000-4000-8000-00000000c001' })
    const signOut = fakeRun()
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com', '00000000-0000-4000-8000-00000000c002')),
      { runProgram: signOut.runProgram })
    const out = collect()
    expect(await login.run([], out.context)).toBe(0)
    expect(signOut.runs).toEqual([])
    const second = extraLogins(loadConfig()).find((entry) => entry.id !== 'workclaude')
    expect(second?.alias).toBe('work-example-2')
    expect(out.stdout()).toContain('work-example has the same email in another organization. That is another subscription, ' +
      'so the two are separate logins.')
  })

  it('takes the same email as the same account when one side has no organization recorded', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'), { email: 'work@example.com', organizationUuid: null })
    const signOut = fakeRun()
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com', '00000000-0000-4000-8000-00000000c002')),
      { runProgram: signOut.runProgram })
    const out = collect()
    expect(await login.run([], out.context)).toBe(0)
    expect(signOut.runs).toHaveLength(1)
    expect(extraLogins(loadConfig()).map((entry) => entry.id)).toEqual(['workclaude'])
    expect(out.stdout()).toContain('work@example.com is already a kurmis login: work-example (id workclaude).')
  })

  it('does not warn when an existing login is signed in to the email of another login in another organization', async () => {
    writeTestConfig({ extras: [{ id: 'workclaude', alias: 'work-example' }, { id: 'homeclaude', alias: 'home-example' }] })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'),
      { email: 'work@example.com', organizationUuid: '00000000-0000-4000-8000-00000000c001' })
    const { login } = command(fakeRunner(claudeSignsIn('work@example.com', '00000000-0000-4000-8000-00000000c002')),
      { runProgram: fakeRun().runProgram })
    const out = collect()
    expect(await login.run(['home-example'], out.context)).toBe(0)
    expect(out.stderr()).toBe('')
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
    expect(await login.run([], out.context)).toBe(0)
    expect(out.stdout()).toContain('Signed in as fake@example.com.')
    const entry = added()
    expect(entry.alias).toBe('fake-example')
    expect(existsSync(join(loginFolder(entry), '.credentials.json'))).toBe(true)
  })

  it('signs a duplicate out with the fake and removes its folder', async () => {
    const login = createLoginCommand({ daemon: fakeDaemonClient({ running: false }), runner: pipedRunner, findProgram, runProgram, home: () => home })
    expect(await login.run([], collect(env()).context)).toBe(0)
    const out = collect(env())
    expect(await login.run([], out.context)).toBe(0)
    expect(out.stdout()).toContain('fake@example.com is already a kurmis login: fake-example')
    expect(folders()).toEqual([added().id])
  })

  it('removes the folder when the fake fails', async () => {
    const login = createLoginCommand({ daemon: fakeDaemonClient({ running: false }), runner: pipedRunner, findProgram, home: () => home })
    const out = collect(env({ FAKE_CLAUDE_LOGIN: 'fail' }))
    expect(await login.run([], out.context)).toBe(1)
    expect(folders()).toEqual([])
    expect(extraLogins(loadConfig())).toEqual([])
  })
})
