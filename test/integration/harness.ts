// The harness of the integration tests: the real bundled kurmis, run as `node <bundle> …` child
// processes, against the fakes. Each test makes a `World`: a temporary folder with its own HOME
// (= USERPROFILE), KURMIS_HOME, fake Keychain, fake launchctl and fake registry folders, a free
// port in `config.json`, and its own fake Anthropic API. The world's `config.json` holds the
// logins of plain claude and plain codex with the fixed ids `OWN_CLAUDE` and `OWN_CODEX` of `test/logins.ts`,
// unless the test asks for a file without logins (`WorldOptions.ownLogins`).
//
// What a child process gets is built here from nothing, not from `process.env`: only PATH (a
// folder with `node` in it, then the system folders), TMPDIR, TZ, the folders above, and the
// stand-in programs `test/setup.ts` names (`KURMIS_SECURITY_PROGRAM`, `KURMIS_LAUNCHCTL_PROGRAM`,
// `KURMIS_REG_PROGRAM`, `KURMIS_POWERSHELL_PROGRAM`, `KURMIS_TASKKILL_PROGRAM`,
// `KURMIS_WSCRIPT_PROGRAM`), and the file the guard records refusals in
// (`KURMIS_REFUSED_PROGRAMS_LOG`). `KURMIS_CLAUDE_BIN` and `KURMIS_CODEX_BIN` name the fake
// claude and codex, so neither kurmis nor the daemon it starts ever looks for the real ones on PATH. No
// `SSH_*`, `ANTHROPIC_*`, `CLAUDE_*` or `CODEX_HOME` variable reaches a child unless a test
// passes one.
//
// When the test ends, the world's kurmis commands that still run are killed, and every daemon
// they started is stopped (`kurmis daemon stop`). After that, a daemon that still runs is killed
// when it is shown to be the world's (`OwnDaemons` in `test/daemon/own-daemons.ts`): it answers
// the world's key on the world's port, or, off Windows, its command line names a bundle the
// world's commands ran (its own, or one passed in `RunOptions.bundle`).
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach } from 'vitest'
import { CONFIG_VERSION } from '../../src/data/config.ts'
import { buildTestBundle } from '../daemon/bundle.ts'
import { freePort, waitUntil } from '../daemon/helpers.ts'
import { OwnDaemons } from '../daemon/own-daemons.ts'
import {
  FAKE_CLAUDE_SCRIPT,
  FAKE_CODEX_SCRIPT,
  fakeToken,
  readClaudeCredentials,
  readCodexRecord,
  readFakeClaudeRecord,
  startFakeAnthropic,
  writeClaudeCredentials,
  writeCodexAuth,
  type ClaudeCredentials,
  type FakeAnthropic,
  type FakeClaudeRecord,
  type FakeCodexLogin,
  type FakeCodexRecord
} from '../fakes/index.ts'
import { OWN_CLAUDE, OWN_CODEX, testConfig, type TestConfigOptions } from '../logins.ts'

export { OWN_CLAUDE, OWN_CODEX, waitUntil }

/** A login as `config.json` holds it. */
export interface ConfigLogin {
  id: string
  provider: 'claude' | 'codex'
  usedByPlainCli: boolean
  alias: string
  aliasSetByUser: boolean
  routing: boolean
  fiveHourLimit: number
  weeklyLimit: number
  useFirst: boolean
}

/** A login that `addClaudeLogin` or `addCodexLogin` added. */
export interface AddedLogin {
  id: string
  alias: string
  /** The login's folder in the data folder: `claude/<id>` or `codex/<id>`. */
  folder: string
  /** The access token the fake claude wrote; empty for a Codex login. */
  token: string
  stdout: string
}

/** What one `kurmis` run ended with. */
export interface KurmisResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

export interface RunOptions {
  /** Variables set over the world's environment; `undefined` removes one. */
  env?: Record<string, string | undefined>
  /** Written to stdin, which is then closed. Default: stdin is closed at once. */
  input?: string
  /** The folder kurmis starts in. Default: the world's `work` folder. */
  cwd?: string
  /** Default 60 s: generous, because the machine may be loaded. */
  timeoutMs?: number
  /** The bundle to run. Default: the world's. */
  bundle?: string
}

export interface DaemonInfo {
  pid: number
  port: number
  version: string
  startedAt: number
}

export interface WorldOptions {
  /** The version the bundle reports. Default: the version in package.json. */
  version?: string
  /**
   * The logins `config.json` starts with: those of plain claude and plain codex at `OWN_CLAUDE` and `OWN_CODEX`
   * and these extras and settings (`testConfig`). The port is always the world's.
   */
  config?: TestConfigOptions
  /**
   * False: `config.json` holds only its version and the port, so the first kurmis command gives
   * the logins of plain claude and plain codex new random ids. Default true.
   */
  ownLogins?: boolean
}

export interface World {
  /** The world's folder; everything below lives in it. */
  root: string
  home: string
  /** KURMIS_HOME. */
  data: string
  /** The folder kurmis starts in by default. */
  work: string
  port: number
  api: FakeAnthropic
  bundle: string
  /** The environment every child gets, before `RunOptions.env`. */
  env: Record<string, string>
  /** `FAKE_CLAUDE_RECORD` and `FAKE_CODEX_RECORD`. */
  claudeRecordFile: string
  codexRecordFile: string
  fakeKeychainDir: string
  fakeLaunchctlDir: string
  fakeRegDir: string
  /** Runs `node <bundle> …args` and waits for it. */
  kurmis(args: string[], options?: RunOptions): Promise<KurmisResult>
  /**
   * Writes `~/.claude/.credentials.json` for the login plain claude uses, with the token
   * `fakeToken('default')`, and answers what it wrote.
   */
  signInDefaultClaude(options?: Partial<ClaudeCredentials>): ClaudeCredentials
  /**
   * Adds an extra Claude login through `kurmis login claude`, the fake claude signing in to
   * `email`, and fails the test when it does not add one.
   */
  addClaudeLogin(email: string, options?: { alias?: string }): Promise<AddedLogin>
  /**
   * Adds an extra Codex login through `kurmis login codex`. The fake codex's `login` writes no
   * sign-in, so this runs it through `codexSignInScript`, which writes an `auth.json` for
   * `login` into the new login's home first.
   */
  addCodexLogin(login: FakeCodexLogin & { email: string }, options?: { alias?: string }): Promise<AddedLogin>
  /**
   * A script for `KURMIS_CODEX_BIN` that runs the fake codex, and on `codex login` first copies
   * the file `TEST_CODEX_SIGN_IN` names to `$CODEX_HOME/auth.json`.
   */
  codexSignInScript: string
  /** The folder of an extra login in the data folder: `claude/<id>` or `codex/<id>`. */
  loginFolder(provider: 'claude' | 'codex', id: string): string
  readConfig(): { version: number; port: number; logins: ConfigLogin[] } & Record<string, unknown>
  /** The login of config.json with this id; fails the test when there is none. */
  configLogin(id: string): ConfigLogin
  /** `daemon.json`, or null when there is none. */
  daemonInfo(): DaemonInfo | null
  claudeRecord(): FakeClaudeRecord[]
  codexRecord(): FakeCodexRecord[]
  /** `kurmis status --json`, parsed; fails the test when it does not exit 0. */
  status(): Promise<StatusJson>
  /** Stops every daemon of this world and removes its folder. Called after each test. */
  dispose(): Promise<void>
}

/** The parts of `kurmis status --json` the tests read. */
export interface StatusJson {
  format: number
  daemon: null | { version: string; pid: number; port: number; startedAt: string; older: boolean }
  source: 'daemon' | 'files'
  globalRouting: 'on' | 'paused' | 'off'
  logins: Array<{
    id: string
    alias: string
    provider: string
    usedByPlainCli: boolean
    email: string | null
    signedIn: boolean | null
    credentials: boolean | null
    probing: boolean
    routing: boolean
    fiveHourLimit: number
    weeklyLimit: number
    useFirst: boolean
    usage: null | {
      fetchedAt: string
      source: string
      plan: string | null
      error: string | null
      windows: Array<{ key: string; label: string; durationMinutes: number | null; utilization: number; resetsAt: string | null; plan: boolean; limitPercent: number | null }>
    }
    blocked: null | { kind: string; text: string; until: string | null }
    sessions: number | null
  }>
  codexStart: null | { login: string; alias: string; note: string | null }
  warnings: string[]
}

/** The version in package.json, which `pnpm bundle` builds into the real bundle. */
export const PACKAGE_VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version

const worlds = new Set<World>()

afterEach(async () => {
  const open = [...worlds]
  worlds.clear()
  await Promise.all(open.map((world) => world.dispose()))
})

/** The stand-in program `test/setup.ts` put in `name`; fails when it is not set. */
function standIn(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '' || !value.includes(`${join('test', '')}`)) {
    throw new Error(`${name} is not a test stand-in (${String(value)}); test/setup.ts should have set it`)
  }
  return value
}

/** PATH for the children: a folder holding only `node`, then the system folders. */
function childPath(root: string): string {
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  if (process.platform === 'win32') return [dirname(process.execPath), process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : ''].join(delimiter)
  symlinkSync(process.execPath, join(bin, 'node'))
  return [bin, '/usr/bin', '/bin'].join(delimiter)
}

/** Makes a world for the current test. It is disposed of after the test, whatever its outcome. */
export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kurmis-int-')))
  const home = join(root, 'home')
  const data = join(home, '.kurmis')
  const work = join(root, 'work')
  const fakeKeychainDir = join(root, 'fake-keychain')
  const fakeLaunchctlDir = join(root, 'fake-launchctl')
  const fakeRegDir = join(root, 'fake-reg')
  for (const dir of [home, data, work, fakeKeychainDir, fakeLaunchctlDir, fakeRegDir]) mkdirSync(dir, { recursive: true })
  const port = await freePort()
  const config = options.ownLogins === false
    ? { version: CONFIG_VERSION, port }
    : testConfig({ ...options.config, port })
  writeFileSync(join(data, 'config.json'), JSON.stringify(config))
  const codexSignInScript = join(root, 'codex-with-sign-in.mjs')
  writeFileSync(codexSignInScript, [
    "import { spawnSync } from 'node:child_process'",
    "import { copyFileSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "import process from 'node:process'",
    'const args = process.argv.slice(2)',
    'const signIn = process.env.TEST_CODEX_SIGN_IN',
    "if (signIn && process.env.CODEX_HOME && args[0] === 'login' && args[1] !== 'status') {",
    "  copyFileSync(signIn, join(process.env.CODEX_HOME, 'auth.json'))",
    '}',
    `const run = spawnSync(process.execPath, [${JSON.stringify(FAKE_CODEX_SCRIPT)}, ...args], { stdio: 'inherit' })`,
    'process.exit(run.status ?? 1)',
    ''
  ].join('\n'))
  const [api, bundle] = await Promise.all([
    startFakeAnthropic(),
    buildTestBundle({ version: options.version ?? PACKAGE_VERSION, entry: 'real' })
  ])
  const claudeRecordFile = join(root, 'fake-claude.jsonl')
  const codexRecordFile = join(root, 'fake-codex.jsonl')
  const env: Record<string, string> = {
    PATH: childPath(root),
    HOME: home,
    USERPROFILE: home,
    KURMIS_HOME: data,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    // The fake claude prints a reset in the local zone; a fixed one makes it predictable.
    TZ: 'UTC',
    KURMIS_CLAUDE_BIN: FAKE_CLAUDE_SCRIPT,
    KURMIS_CODEX_BIN: FAKE_CODEX_SCRIPT,
    KURMIS_UPSTREAM_URL: api.url,
    KURMIS_SECURITY_PROGRAM: standIn('KURMIS_SECURITY_PROGRAM'),
    FAKE_SECURITY_DIR: fakeKeychainDir,
    KURMIS_LAUNCHCTL_PROGRAM: standIn('KURMIS_LAUNCHCTL_PROGRAM'),
    FAKE_LAUNCHCTL_DIR: fakeLaunchctlDir,
    KURMIS_REG_PROGRAM: standIn('KURMIS_REG_PROGRAM'),
    FAKE_REG_DIR: fakeRegDir,
    KURMIS_POWERSHELL_PROGRAM: standIn('KURMIS_POWERSHELL_PROGRAM'),
    FAKE_POWERSHELL_DIR: join(root, 'fake-powershell'),
    KURMIS_TASKKILL_PROGRAM: standIn('KURMIS_TASKKILL_PROGRAM'),
    FAKE_TASKKILL_DIR: join(root, 'fake-taskkill'),
    KURMIS_WSCRIPT_PROGRAM: standIn('KURMIS_WSCRIPT_PROGRAM'),
    KURMIS_REFUSED_PROGRAMS_LOG: process.env.KURMIS_REFUSED_PROGRAMS_LOG ?? '',
    FAKE_CLAUDE_RECORD: claudeRecordFile,
    FAKE_CODEX_RECORD: codexRecordFile,
    KURMIS_REFUSE_SYSTEM_PROGRAMS: '1'
  }
  if (process.platform === 'win32' && process.env.SystemRoot !== undefined) env.SystemRoot = process.env.SystemRoot

  /**
   * The daemons of this world: every pid its `daemon.json` and `daemon.log` named, and every
   * bundle its commands ran, so a daemon of an older bundle is stopped too.
   */
  const daemons = new OwnDaemons(data, [bundle])
  /** The kurmis processes that have not ended yet. */
  const running = new Set<ChildProcess>()
  const noteDaemon = (): void => { daemons.note() }
  const readDaemonInfo = (): DaemonInfo | null => {
    try {
      return JSON.parse(readFileSync(join(data, 'daemon.json'), 'utf8')) as DaemonInfo
    } catch {
      return null
    }
  }

  const run = (args: string[], runOptions: RunOptions = {}): Promise<KurmisResult> => {
    const childEnv: Record<string, string> = { ...env }
    for (const [name, value] of Object.entries(runOptions.env ?? {})) {
      if (value === undefined) delete childEnv[name]
      else childEnv[name] = value
    }
    return new Promise((resolve, reject) => {
      daemons.addBundle(runOptions.bundle ?? bundle)
      const child = spawn(process.execPath, [runOptions.bundle ?? bundle, ...args], {
        env: childEnv,
        cwd: runOptions.cwd ?? work,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      running.add(child)
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`kurmis ${args.join(' ')} did not finish within ${String(runOptions.timeoutMs ?? 60_000)} ms\n` +
          `stdout: ${stdout}\nstderr: ${stderr}`))
      }, runOptions.timeoutMs ?? 60_000)
      child.on('error', (error) => { clearTimeout(timer); reject(error) })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        running.delete(child)
        noteDaemon()
        resolve({ code, signal, stdout, stderr })
      })
      child.stdin.end(runOptions.input ?? '')
    })
  }

  const loginFolderOf = (provider: 'claude' | 'codex', id: string): string => join(data, provider, id)
  const readConfig = (): ReturnType<World['readConfig']> =>
    JSON.parse(readFileSync(join(data, 'config.json'), 'utf8')) as ReturnType<World['readConfig']>

  /** Runs `kurmis login <provider>` and answers the login it added, which is the one config.json did not have before. */
  const addLogin = async (provider: 'claude' | 'codex', alias: string | undefined, runEnv: Record<string, string>): Promise<AddedLogin> => {
    const before = new Set(readConfig().logins.map((login) => login.id))
    const args = ['login', provider, ...(alias === undefined ? [] : ['--alias', alias])]
    const result = await run(args, { env: runEnv })
    const added = readConfig().logins.filter((login) => !before.has(login.id))
    if (result.code !== 0 || added.length !== 1) throw new Error(`kurmis ${args.join(' ')} added no login: ${JSON.stringify(result)}`)
    const login = added[0]!
    const folder = loginFolderOf(provider, login.id)
    const token = provider === 'claude' ? readClaudeCredentials(folder)?.accessToken : ''
    if (token === undefined) throw new Error(`the new Claude login ${login.id} has no token after kurmis login`)
    return { id: login.id, alias: login.alias, folder, token, stdout: result.stdout }
  }

  let disposed = false
  const world: World = {
    root,
    home,
    data,
    work,
    port,
    api,
    bundle,
    env,
    claudeRecordFile,
    codexRecordFile,
    fakeKeychainDir,
    fakeLaunchctlDir,
    fakeRegDir,
    kurmis: run,
    signInDefaultClaude(credentials = {}) {
      return writeClaudeCredentials(join(home, '.claude'), { accessToken: fakeToken('default'), ...credentials })
    },
    addClaudeLogin: (email, loginOptions = {}) => addLogin('claude', loginOptions.alias, { FAKE_CLAUDE_EMAIL: email }),
    async addCodexLogin(login, loginOptions = {}) {
      const signIn = mkdtempSync(join(root, 'codex-sign-in-'))
      const file = writeCodexAuth(signIn, login)
      return await addLogin('codex', loginOptions.alias, { KURMIS_CODEX_BIN: codexSignInScript, TEST_CODEX_SIGN_IN: file })
    },
    codexSignInScript,
    loginFolder: loginFolderOf,
    readConfig,
    configLogin(id) {
      const login = readConfig().logins.find((candidate) => candidate.id === id)
      if (login === undefined) throw new Error(`config.json has no login ${id}`)
      return login
    },
    daemonInfo: readDaemonInfo,
    claudeRecord: () => readFakeClaudeRecord(claudeRecordFile),
    codexRecord: () => readCodexRecord(codexRecordFile),
    async status() {
      const result = await run(['status', '--json'])
      if (result.code !== 0) throw new Error(`kurmis status --json failed: ${JSON.stringify(result)}`)
      return JSON.parse(result.stdout) as StatusJson
    },
    async dispose() {
      if (disposed) return
      disposed = true
      worlds.delete(world)
      // A command a failed test left running could still start a daemon.
      for (const child of running) child.kill('SIGKILL')
      noteDaemon()
      if (daemons.seen) {
        await run(['daemon', 'stop'], { timeoutMs: 45_000 }).catch(() => undefined)
      }
      // A daemon that lost the port to another one started at the same moment exits once it finds
      // the port taken; one that was still starting when the stop freed the port would bind it
      // and outlive the test. On Windows such a daemon also holds the world's home as its working
      // folder, so the folder could not be removed.
      await daemons.stop()
      await api.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 10 })
    }
  }
  worlds.add(world)
  return world
}
