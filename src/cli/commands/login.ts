// `kurmis login`: signs a login in with the provider's own CLI and adds it to config.json.
//
//   kurmis login claude|codex [--name <name>] [--label <text>]   a new login
//   kurmis login <id> [--label <text>]                           a new login with that id, or an
//                                                                existing one signed in again
//
// Claude runs `claude auth login --claudeai` with the login's folder as `CLAUDE_CONFIG_DIR`
// (`claudeLoginEnv`), Codex runs `codex login` with the folder as `CODEX_HOME` (`codexLoginEnv`).
// The CLI gets the terminal, as in `kurmis claude`. A new login is added to config.json only after
// its CLI has exited 0 and its credentials are there; otherwise a folder this command created is
// removed again. The email the CLI reports is shown on the terminal and written nowhere: the
// label defaults to the login's name.
//
// The run holds the login's lock (`login-lock.ts`) from before it creates the folder until it is
// done, so a second `kurmis login` or a `kurmis logout` of the same login stops at once instead
// of sharing or deleting the folder. Without `--name` the first free number whose lock is free
// is taken, so two `kurmis login claude` at the same moment get `claude:2` and `claude:3`.
//
// After a sign-in a running daemon is told to read config.json again and asked to probe the
// login, because it may still hold the login as signed out from before (G4 in the review): Auto
// would pass the login over until its next usage check.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { addLogin, changeConfig, ConfigError, findLogin, loadConfig, updateLogin, type KurmisConfig, type LoginSettingsPatch } from '../../data/config.ts'
import { CLAUDE_PROFILE_FILE, parseClaudeIdentity, readClaudeIdentity, type ClaudeIdentity } from '../../data/identity.ts'
import { applyEnvPatch, claudeLoginEnv, codexLoginEnv } from '../../data/login-env.ts'
import { isDefaultLoginId, isLoginProvider, isValidLoginName, parseLoginId, type LoginId, type LoginProvider } from '../../data/login-id.ts'
import { claudeDefaultProbeFolder, codexMergedRecordPath, loginFolder } from '../../data/paths.ts'
import { makePrivateDirSync } from '../../platform/files.ts'
import { ProgramNotFoundError, type findProgram, type ResolvedProgram } from '../../platform/programs.ts'
import { removeTreeSync } from '../../platform/remove-tree.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realChildRunner, realDaemonClient, realFindProgram, realPrepareCodexHome, reloadText, settleWithin, type ChildRunner, type DaemonClient } from '../command-deps.ts'
import type { FileLock } from '../../data/lock.ts'
import { LoginBusyError, lockLogin } from '../login-lock.ts'
import { hasLocalCredentials } from './list.ts'

export interface LoginDeps {
  daemon: DaemonClient
  runner: ChildRunner
  findProgram: typeof findProgram
  /** The user's home folder, where `~/.claude.json` and `~/.codex` are. */
  home: () => string
  /**
   * Prepares an extra Codex login's home before `codex login` runs in it, so the sign-in reads
   * the same merged `config.toml` (for example where to keep the credentials) as the sessions
   * started on it later.
   */
  prepareCodexHome: typeof realPrepareCodexHome
  /** How long to wait for the daemon's probe after a sign-in. `LOGIN_PROBE_WAIT_MS` by default. */
  probeWaitMs: number
}

/** How long a login waits for the daemon's probe of the login it signed in. */
export const LOGIN_PROBE_WAIT_MS = 15_000

/**
 * The first of `<provider>:2`, `<provider>:3`, ... that no login uses, that has no folder, and
 * whose name is not in `skip` (names another run is signing in now).
 */
export function freeLoginName(provider: LoginProvider, config: KurmisConfig, skip: ReadonlySet<string> = new Set()): string {
  for (let number = 2; ; number++) {
    const id = `${provider}:${String(number)}`
    if (!skip.has(String(number)) && findLogin(config, id) === undefined && !existsSync(loginFolder(id))) return String(number)
  }
}

/** What the command line asks for: the login, and whether it is to be added. */
export type LoginTarget = { id: LoginId; isNew: boolean } | { error: string }

/** Reads `kurmis login <provider|id> [--name <name>]` against the current config. `skip` goes to `freeLoginName`. */
export function loginTarget(argument: string, name: string | undefined, config: KurmisConfig,
  skip: ReadonlySet<string> = new Set()): LoginTarget {
  if (isLoginProvider(argument)) {
    const chosen = name ?? freeLoginName(argument, config, skip)
    if (!isValidLoginName(chosen)) {
      return { error: `"${chosen}" is not a login name; a name is 1 to 32 lowercase letters, digits, "-" or "_"` }
    }
    const id = `${argument}:${chosen}`
    if (findLogin(config, id) !== undefined) {
      return { error: `there is already a login ${id}; "kurmis login ${id}" signs it in again` }
    }
    return { id: id as LoginId, isNew: true }
  }
  if (name !== undefined) return { error: '--name goes with "kurmis login claude" or "kurmis login codex", not with a login id' }
  if (!argument.includes(':')) {
    return { error: `"${argument}" is not claude, codex or a login id such as claude:${argument}` }
  }
  const parsed = parseLoginId(argument)
  if (parsed === null) {
    return { error: `"${argument}" is not a login id; a login id is claude:<name> or codex:<name>, where the name is 1 to 32 lowercase letters, digits, "-" or "_"` }
  }
  return { id: parsed.id, isNew: findLogin(config, parsed.id) === undefined }
}

/** The account in `~/.claude.json`, which `claude auth login` writes for the machine's own login. */
function homeIdentity(home: string): ClaudeIdentity | null {
  try {
    return parseClaudeIdentity(readFileSync(join(home, CLAUDE_PROFILE_FILE), 'utf8'))
  } catch {
    return null
  }
}

function fail(context: CliContext, message: string): number {
  writeLine(context.stderr, `kurmis login: ${message}`)
  return EXIT_FAILURE
}

/** A login to sign in, with its lock held. */
type Reserved = { id: LoginId; isNew: boolean; lock: FileLock } | { error: string; usage: boolean }

/**
 * Picks the login the command line asks for and takes its lock. The config is read again once
 * the lock is held, since another run may have added the login in the meantime. Without
 * `--name`, a number another run holds, or adds meanwhile, is passed over for the next one.
 */
function reserveLogin(argument: string, name: string | undefined): Reserved {
  const skip = new Set<string>()
  for (;;) {
    const target = loginTarget(argument, name, loadConfig(), skip)
    if ('error' in target) return { error: target.error, usage: true }
    const numbered = isLoginProvider(argument) && name === undefined
    let lock: FileLock
    try {
      lock = lockLogin(target.id)
    } catch (error) {
      if (!(error instanceof LoginBusyError)) throw error
      if (!numbered) return { error: error.message, usage: false }
      skip.add(target.id.slice(target.id.indexOf(':') + 1))
      continue
    }
    try {
      const config = loadConfig()
      const listed = findLogin(config, target.id) !== undefined
      if (numbered && (listed || existsSync(loginFolder(target.id)))) {
        lock.release()
        skip.add(target.id.slice(target.id.indexOf(':') + 1))
        continue
      }
      if (target.isNew && listed && isLoginProvider(argument)) {
        lock.release()
        return { error: `there is already a login ${target.id}; "kurmis login ${target.id}" signs it in again`, usage: true }
      }
      return { id: target.id, isNew: !listed, lock }
    } catch (error) {
      lock.release()
      throw error
    }
  }
}

/**
 * Tells a running daemon about the login: it reads config.json again, and probes the login,
 * so a signed-out state it held from before ends now. Answers lines for the person.
 */
async function tellDaemon(daemon: DaemonClient, id: string, env: NodeJS.ProcessEnv, probeWaitMs: number): Promise<string[]> {
  let connection
  try {
    connection = await daemon.findDaemon({ env })
    if (connection === null) return []
    await daemon.requestReload(connection)
  } catch (error) {
    const said = reloadText({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    return said === null ? [] : [said]
  }
  const lines = [reloadText({ kind: 'reloaded' }) ?? '']
  const found = connection
  const probed = await settleWithin((signal) => daemon.requestProbe(found, [id], signal), probeWaitMs)
  if (probed.kind === 'done') {
    const row = probed.value.logins.find((login) => login.id === id)
    if (row?.signedIn === false) lines.push(`The daemon still finds ${id} signed out; "kurmis status" shows what it knows.`)
  } else {
    const why = probed.kind === 'timeout'
      ? `did not finish within ${String(probeWaitMs / 1000)} s`
      : `failed (${probed.error instanceof Error ? probed.error.message : String(probed.error)})`
    lines.push(`The daemon's check of ${id} ${why}; it checks the login again within 15 minutes.`)
  }
  return lines
}

/** What `signIn` needs: the reserved login, the program and the command's dependencies. */
interface SignInRun {
  id: LoginId
  isNew: boolean
  lock: FileLock
  provider: LoginProvider
  program: ResolvedProgram
  label: string | undefined
  context: CliContext
  deps: LoginDeps
}

/** Signs the reserved login in and adds it. The caller releases the lock afterwards too. */
async function signIn(run: SignInRun): Promise<number> {
  const { id, isNew, lock, provider, program, label, context } = run
  const isDefault = isDefaultLoginId(id)

  const folder = isDefault ? null : loginFolder(id)
  let created = false
  if (folder !== null && !existsSync(folder)) {
    makePrivateDirSync(folder)
    created = true
  }
  const cleanUp = (): void => {
    if (!created || folder === null) return
    removeTreeSync(folder)
    // Preparing the Codex home wrote what it merged in; a later login of this name must not find it.
    if (provider === 'codex') rmSync(codexMergedRecordPath(id), { force: true })
  }
  const notAdded = isNew ? ` ${id} was not added.` : ''

  if (provider === 'codex' && !isDefault) {
    try {
      const prepared = await run.deps.prepareCodexHome(id, { env: context.env })
      for (const warning of prepared.warnings) writeLine(context.stderr, `kurmis login: ${warning}`)
    } catch (error) {
      cleanUp()
      return fail(context, `could not prepare the Codex home of ${id}: ${error instanceof Error ? error.message : String(error)}.${notAdded}`)
    }
  }

  const cliName = provider === 'claude' ? 'claude auth login' : 'codex login'
  writeLine(context.stdout, `Signing in ${id}${isNew ? ' (a new login)' : ''} with "${cliName}". Follow its steps.`)
  const env = applyEnvPatch(context.env, provider === 'claude' ? claudeLoginEnv(id) : codexLoginEnv(id, context.env))
  const cliArgs = provider === 'claude' ? ['auth', 'login', '--claudeai'] : ['login']
  const end = await run.deps.runner.runInteractive({ command: program.command, args: [...program.args, ...cliArgs], env })

  if (end.kind !== 'exit') {
    cleanUp()
    // Before `finishLikeChild`, which raises the child's signal on this process.
    lock.release()
    if (isNew) writeLine(context.stderr, `kurmis login:${notAdded}`)
    return run.deps.runner.finishLikeChild(end, { stderr: context.stderr, name: provider })
  }
  if (end.code !== 0) {
    cleanUp()
    return fail(context, `"${cliName}" failed (exit code ${String(end.code)}).${notAdded}`)
  }

  if (provider === 'claude' && isDefault) {
    // The probe folder's profile names the account the default login had before; without it
    // the daemon reads ~/.claude.json, which this sign-in just wrote, until the next probe
    // writes the probe folder's file again.
    rmSync(join(claudeDefaultProbeFolder(), CLAUDE_PROFILE_FILE), { force: true })
  }
  const identity = provider === 'claude' ? (isDefault ? homeIdentity(run.deps.home()) : readClaudeIdentity(id, run.deps.home())) : null
  if (identity === null && !hasLocalCredentials(id, context.env, run.deps.home())) {
    cleanUp()
    return fail(context, `"${cliName}" ended, but ${id} has no credentials.${notAdded}`)
  }

  try {
    const patch: LoginSettingsPatch = label === undefined ? {} : { label }
    if (isNew) changeConfig((config) => addLogin(config, id, patch))
    else if (label !== undefined) changeConfig((config) => updateLogin(config, id, patch))
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    // The login is signed in, so its credentials are kept; logout removes them.
    return fail(context, `${id} is signed in but could not be saved: ${error.message} ` +
      `Run "kurmis login ${id}" again, or "kurmis logout ${id}" to remove its credentials.`)
  }

  const who = identity?.email ?? null
  writeLine(context.stdout, who === null ? `Signed in ${id}.` : `Signed in ${id} as ${who}.`)
  if (isNew) {
    writeLine(context.stdout, `Added ${id} with the label "${label ?? id.slice(id.indexOf(':') + 1)}", Auto routing on and both limits at 100%. ` +
      `"kurmis set ${id}" changes that.`)
  }
  for (const line of await tellDaemon(run.deps.daemon, id, context.env, run.deps.probeWaitMs)) writeLine(context.stdout, line)
  return EXIT_OK
}

export function createLoginCommand(deps: Partial<LoginDeps> = {}): Command {
  const full: LoginDeps = {
    daemon: deps.daemon ?? realDaemonClient,
    runner: deps.runner ?? realChildRunner,
    findProgram: deps.findProgram ?? realFindProgram,
    home: deps.home ?? homedir,
    prepareCodexHome: deps.prepareCodexHome ?? realPrepareCodexHome,
    probeWaitMs: deps.probeWaitMs ?? LOGIN_PROBE_WAIT_MS
  }
  return {
    name: 'login',
    summary: 'Sign in a new login, or sign an existing one in again',
    usage: `Usage: kurmis login claude|codex [--name <name>] [--label <text>]
       kurmis login <id> [--label <text>]

Signs a login in with Claude Code's "claude auth login" or Codex's "codex login", which open
the sign-in page in the browser, and adds it to kurmis with Auto routing on and both limits at
100% ("kurmis set" changes that).

  kurmis login claude          Adds a new Claude login, named 2, 3, ... (claude:2) unless
                               --name gives the name.
  kurmis login codex           The same for Codex.
  kurmis login claude:work     Adds claude:work, or signs it in again when it exists. This also
                               signs in the machine's own claude:default or codex:default again.

A name is 1 to 32 lowercase letters, digits, "-" or "_". Each extra login keeps its own
credentials in its folder in the kurmis data folder (on macOS in the Keychain).

Options:
  --name <name>    The name of the new login, for "kurmis login claude|codex".
  --label <text>   The name "kurmis list" and "kurmis status" show. Defaults to the login's name.
  -h, --help       Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs('login', args, { name: { type: 'string' }, label: { type: 'string' } }, context, true)
      if (typeof parsed === 'number') return parsed
      if (parsed.positionals.length !== 1) return usageError('login', 'takes claude, codex or one login id', context)
      const label = parsed.values.label?.trim()
      if (label !== undefined && (label === '' || label.length > 64)) return usageError('login', '--label takes 1 to 64 characters', context)

      const argument = parsed.positionals[0]!
      let target: LoginTarget
      try {
        target = loginTarget(argument, parsed.values.name, loadConfig())
      } catch (error) {
        if (error instanceof ConfigError) return fail(context, error.message)
        throw error
      }
      if ('error' in target) return usageError('login', target.error, context)
      const provider: LoginProvider = target.id.startsWith('codex:') ? 'codex' : 'claude'

      let program: ResolvedProgram
      try {
        program = full.findProgram(provider, { env: context.env })
      } catch (error) {
        if (error instanceof ProgramNotFoundError) return fail(context, error.message)
        throw error
      }

      let reserved: Reserved
      try {
        reserved = reserveLogin(argument, parsed.values.name)
      } catch (error) {
        if (error instanceof ConfigError) return fail(context, error.message)
        throw error
      }
      if ('error' in reserved) return reserved.usage ? usageError('login', reserved.error, context) : fail(context, reserved.error)
      const { id, isNew, lock } = reserved
      try {
        return await signIn({ id, isNew, lock, provider, program, label, context, deps: full })
      } finally {
        lock.release()
      }
    }
  }
}


export const loginCommand = createLoginCommand()
