// `kurmis login`: signs a login in with `claude auth login` and adds it to config.json.
//
//   kurmis login [--alias <alias>]           a new login
//   kurmis login <login> [--alias <alias>]   an existing login, by alias or id, signed in again
//
// A new login gets a random id (`freshLoginId`) before anything else, and its folder is
// `claude/<id>/` from the start: on macOS the Keychain item's name depends on the folder's path,
// so the folder is never renamed after the sign-in.
//
// The command runs `claude auth login --claudeai` with the login's folder as `CLAUDE_CONFIG_DIR`
// (`claudeLoginEnv`). The CLI gets the terminal, as in `kurmis claude`. A new login is added to
// config.json only after the CLI has exited 0 and the login's credentials are there
// (`hasCredentials`); otherwise the folder this command created is removed again. On Windows a
// login whose record is in Credential Manager signs in with `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`,
// so the new token replaces it.
//
// After the sign-in the command reads the account's email from the `.claude.json` the CLI wrote
// (`readClaudeIdentity`; `~/.claude.json` for plain claude's login). The email is shown on the
// terminal and written nowhere. It gives the login's automatic alias (`followEmail`) unless
// `--alias` sets one. An account is its email and its organization (`isSameClaudeAccount`): a
// personal plan and a Team or Enterprise seat of one email are two logins, and the second gets
// the alias with `-2`. When a new sign-in is an account that is already a kurmis login, the login
// plain claude uses included, the new folder is signed out again and deleted, and the command
// says which login that account already is. This is checked again under the config lock, before
// the login is added. When an existing login is signed in to an account that another login
// already has, the command warns and signs nothing out.
//
// The run holds the login's lock (`login-lock.ts`) from before it creates the folder until it is
// done, so a `kurmis logout` of the same login stops at once instead of deleting the folder.
//
// After a sign-in a running daemon is told to read config.json again and asked to probe the
// login, because it may still hold the login as signed out from before: Auto would pass the
// login over until its next usage check.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { applyEnvPatch } from '../../core/routed-env.ts'
import {
  addLogin,
  aliasProblem,
  changeConfig,
  ConfigError,
  findLogin,
  followEmail,
  loadConfig,
  newLoginIdFor,
  resolveLogin,
  updateLogin,
  type KurmisConfig,
  type LoginSettings
} from '../../data/config.ts'
import {
  CLAUDE_PROFILE_FILE, isSameClaudeAccount, isSameEmail, parseClaudeIdentity, readClaudeIdentity, type ClaudeAccountKey, type ClaudeIdentity
} from '../../data/identity.ts'
import { claudeLoginEnv } from '../../data/login-env.ts'
import type { LoginId, LoginRef } from '../../data/login-id.ts'
import { loginFolder, ownClaudeProbeFolder } from '../../data/paths.ts'
import { makePrivateDirSync } from '../../platform/files.ts'
import { holdsStoredRecord } from '../../platform/windows-credentials.ts'
import { ProgramNotFoundError, type findProgram, type ResolvedProgram } from '../../platform/programs.ts'
import { removeTreeSync } from '../../platform/remove-tree.ts'
import { runProgram } from '../../platform/run.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realChildRunner, realDaemonClient, realFindProgram, reloadText, settleWithin, type ChildRunner, type DaemonClient } from '../command-deps.ts'
import type { FileLock } from '../../data/lock.ts'
import { LoginBusyError, lockLogin } from '../login-lock.ts'
import { plainClaudeLoginText } from '../login-names.ts'
import { leftBehindText, signOutLogin } from '../sign-out.ts'
import { hasCredentials } from '../local-credentials.ts'

export interface LoginDeps {
  daemon: DaemonClient
  runner: ChildRunner
  findProgram: typeof findProgram
  /**
   * Runs the credential check (`hasCredentials`: `security` or PowerShell for a login without
   * `.credentials.json`), and `claude auth logout` on a new sign-in of an account that is
   * already a kurmis login.
   */
  runProgram: typeof runProgram
  /** The user's home folder, where `~/.claude.json` is. */
  home: () => string
  /** How long to wait for the daemon's probe after a sign-in. `LOGIN_PROBE_WAIT_MS` by default. */
  probeWaitMs: number
  /**
   * Whether Windows Credential Manager holds a record of the login whose folder this is
   * (null for plain claude's login); such a login signs in with
   * `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` (`claudeLoginEnv`), so the new token replaces the
   * record. `holdsStoredRecord` by default.
   */
  inCredentialManager: (folder: string | null, env: NodeJS.ProcessEnv) => Promise<boolean>
  /** Where the sign-out of a duplicate sign-in runs; it sets `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN` on Windows. */
  platform: NodeJS.Platform
}

/** How long a login waits for the daemon's probe of the login it signed in. */
export const LOGIN_PROBE_WAIT_MS = 15_000

/** What the command line asks for: a new login, or an existing one. */
export type LoginTarget = { kind: 'new' } | { kind: 'existing'; login: LoginSettings } | { error: string }

/**
 * Reads the argument of `kurmis login [<login>]` against the current config: none asks for a new
 * login, and one names an existing login by its alias or id (`resolveLogin`).
 */
export function loginTarget(argument: string | undefined, config: KurmisConfig): LoginTarget {
  if (argument === undefined) return { kind: 'new' }
  const resolved = resolveLogin(config, argument)
  if ('error' in resolved) {
    return { error: `${resolved.error}. "kurmis login" without a login adds a new one, and "kurmis status" shows the logins there are` }
  }
  return { kind: 'existing', login: resolved.login }
}

/**
 * A new login's id: none of the config's ids and aliases (`newLoginIdFor`), and not the name of a
 * folder in `claude/`, which a login that is gone may have left.
 */
export function freshLoginId(config: KurmisConfig): LoginId {
  for (;;) {
    const id = newLoginIdFor(config)
    if (!existsSync(loginFolder({ id, usedByPlainClaude: false }))) return id
  }
}

/** The account in `~/.claude.json`, which `claude auth login` writes for plain claude's login. */
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

/**
 * The other login signed in to `account`, by each login's `.claude.json`, or null. An account is
 * its email and its organization (`isSameClaudeAccount`). It reads files only, so it can run
 * while the config lock is held.
 */
function sameAccount(config: KurmisConfig, login: LoginRef, account: ClaudeAccountKey, home: string): LoginSettings | null {
  return config.logins.find((other) => other.id !== login.id &&
    isSameClaudeAccount(readClaudeIdentity(other, home) ?? { email: null, organizationUuid: null }, account)) ?? null
}

/**
 * Another login with the email of `account` but in another organization, or null: the same
 * person's other subscription, which is a login of its own.
 */
function otherOrganization(config: KurmisConfig, login: LoginRef, account: ClaudeAccountKey, home: string): LoginSettings | null {
  return config.logins.find((other) => {
    if (other.id === login.id) return false
    const identity = readClaudeIdentity(other, home)
    return identity !== null && isSameEmail(identity.email, account.email) && !isSameClaudeAccount(identity, account)
  }) ?? null
}

/**
 * Thrown inside `changeConfig` when the config read under the lock has a login of the new
 * sign-in's account: another `kurmis login` of the same account added it meanwhile.
 */
class AddedMeanwhile extends Error {
  constructor(readonly existing: LoginSettings) {
    super(`${existing.id} has the same account`)
    this.name = 'AddedMeanwhile'
  }
}

/**
 * Tells a running daemon about the login: it reads config.json again, and probes the login,
 * so a signed-out state it held from before ends now. Answers lines for the person.
 */
async function tellDaemon(daemon: DaemonClient, login: LoginSettings, env: NodeJS.ProcessEnv, probeWaitMs: number): Promise<string[]> {
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
  const probed = await settleWithin((signal) => daemon.requestProbe(found, [login.id], signal), probeWaitMs)
  if (probed.kind === 'done') {
    const row = probed.value.logins.find((other) => other.id === login.id)
    if (row?.signedIn === false) lines.push(`The daemon still finds ${login.alias} signed out; "kurmis status" shows what it knows.`)
  } else {
    const why = probed.kind === 'timeout'
      ? `did not finish within ${String(probeWaitMs / 1000)} s`
      : `failed (${probed.error instanceof Error ? probed.error.message : String(probed.error)})`
    lines.push(`The daemon's check of ${login.alias} ${why}; it checks the login again within 15 minutes.`)
  }
  return lines
}

/** What `signIn` needs: the login, its lock, the program and the command's dependencies. */
interface SignInRun {
  /** The login to sign in: a new one, not in config.json yet, or an existing one. */
  ref: LoginRef
  isNew: boolean
  /** What the messages call the login until it is saved: its alias, or the id of a new one. */
  name: string
  lock: FileLock
  program: ResolvedProgram
  /** The alias `--alias` gave, already checked with `aliasProblem`. */
  alias: string | undefined
  context: CliContext
  deps: LoginDeps
}

/** Signs the login in and adds or updates it. The caller releases the lock afterwards too. */
async function signIn(run: SignInRun): Promise<number> {
  const { ref, isNew, name, lock, program, alias, context, deps } = run

  const folder = ref.usedByPlainClaude ? null : loginFolder(ref)
  let created = false
  if (folder !== null && !existsSync(folder)) {
    makePrivateDirSync(folder)
    created = true
  }
  const cleanUp = (): void => {
    if (created && folder !== null) removeTreeSync(folder)
  }
  const notAdded = isNew ? ' No login was added.' : ''

  const cliName = 'claude auth login'
  const what = isNew ? `a new login (id ${ref.id})` : name
  writeLine(context.stdout, `Signing in ${what} with "${cliName}". Follow its steps.`)
  const credentialManager = await deps.inCredentialManager(folder, context.env)
  const env = applyEnvPatch(context.env, claudeLoginEnv(ref, credentialManager))
  const end = await deps.runner.runInteractive({ command: program.command, args: [...program.args, 'auth', 'login', '--claudeai'], env })

  if (end.kind !== 'exit') {
    cleanUp()
    // Before `finishLikeChild`, which raises the child's signal on this process.
    lock.release()
    if (isNew) writeLine(context.stderr, `kurmis login:${notAdded}`)
    return deps.runner.finishLikeChild(end, { stderr: context.stderr, name: 'claude' })
  }
  if (end.code !== 0) {
    cleanUp()
    return fail(context, `"${cliName}" failed (exit code ${String(end.code)}).${notAdded}`)
  }

  if (ref.usedByPlainClaude) {
    // The probe folder's profile names the account plain claude's login had before; without
    // it the daemon reads ~/.claude.json, which this sign-in just wrote, until the next probe
    // writes the probe folder's file again.
    rmSync(join(ownClaudeProbeFolder(), CLAUDE_PROFILE_FILE), { force: true })
  }
  const identity = ref.usedByPlainClaude ? homeIdentity(deps.home()) : readClaudeIdentity(ref, deps.home())
  // A check that could not run (`unknown`) does not undo a sign-in the CLI reported as done.
  if (identity === null && (await hasCredentials(ref, context.env, deps.home(), deps)) === false) {
    cleanUp()
    return fail(context, `"${cliName}" ended, but ${name} has no credentials.${notAdded}`)
  }
  const email = identity?.email ?? null
  const account = email === null ? null : { email, organizationUuid: identity?.organizationUuid ?? null }

  if (isNew && account !== null) {
    let config: KurmisConfig
    try {
      config = loadConfig()
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error
      return fail(context, `${name} is signed in, but config.json could not be read: ${error.message} ` +
        `"kurmis logout ${ref.id}" removes its credentials and folder.`)
    }
    const existing = sameAccount(config, ref, account, deps.home())
    if (existing !== null) return await dropDuplicate(run, existing, account.email)
  }

  let saved: KurmisConfig
  try {
    saved = changeConfig((config) => {
      // The account is checked again from the config read under the lock, so two runs of
      // `kurmis login` that sign in to one account at the same moment add it once.
      const meanwhile = isNew && account !== null ? sameAccount(config, ref, account, deps.home()) : null
      if (meanwhile !== null) throw new AddedMeanwhile(meanwhile)
      let next = isNew ? addLogin(config, ref.id, alias === undefined ? {} : { alias }) : config
      if (!isNew && alias !== undefined) next = updateLogin(next, ref.id, { alias })
      // Without an email the alias stays as it is.
      return followEmail(next, ref.id, email)
    })
  } catch (error) {
    if (error instanceof AddedMeanwhile && email !== null) return await dropDuplicate(run, error.existing, email)
    if (!(error instanceof ConfigError)) throw error
    // The login is signed in, so its credentials are kept; logout removes them.
    return fail(context, isNew
      ? `${name} is signed in but could not be added: ${error.message} "kurmis logout ${ref.id}" removes its credentials and folder.`
      : `${name} is signed in again but its settings could not be saved: ${error.message}`)
  }
  const login = findLogin(saved, ref.id)!

  writeLine(context.stdout, email === null ? 'Signed in.' : `Signed in as ${email}.`)
  if (isNew) {
    writeLine(context.stdout, `Added ${login.alias} (id ${login.id}), a login with Auto routing on and ` +
      `both limits at 100%. "kurmis set ${login.alias}" changes that.`)
    const sibling = account === null ? null : otherOrganization(saved, ref, account, deps.home())
    if (sibling !== null) {
      writeLine(context.stdout, `${sibling.alias} has the same email in another organization. That is another subscription, ` +
        'so the two are separate logins.')
    }
  } else if (login.alias !== name) {
    writeLine(context.stdout, `${name} is now called ${login.alias}.`)
  }
  if (!isNew && account !== null) {
    // Nothing is signed out: the person may have meant either login, and both still work.
    const other = sameAccount(saved, ref, account, deps.home())
    if (other !== null) {
      const which = other.usedByPlainClaude ? `${other.alias}, ${plainClaudeLoginText()},` : other.alias
      writeLine(context.stderr, `kurmis login: warning: ${email} is also the account of ${which} (id ${other.id}). ` +
        `${login.alias} and ${other.alias} are now the same account and share its limits. Neither was signed out. ` +
        `"kurmis login ${login.alias}" signs ${login.alias} in to another account.`)
    }
  }
  for (const line of await tellDaemon(deps.daemon, login, context.env, deps.probeWaitMs)) writeLine(context.stdout, line)
  return EXIT_OK
}

/**
 * A new sign-in of an account that `existing` already is: signs the new folder out again,
 * deletes it, and says which login the account is. Exit code 0, since the account is there.
 */
async function dropDuplicate(run: SignInRun, existing: LoginSettings, email: string): Promise<number> {
  const { ref, context, deps } = run
  const problem = await signOutLogin(ref, context.env, deps)
  if (problem !== null) {
    writeLine(context.stderr, `kurmis login: ${problem}; the new sign-in is deleted anyway.${leftBehindText(ref, deps.platform)}`)
  }
  try {
    removeTreeSync(loginFolder(ref))
  } catch (error) {
    return fail(context, `${email} is already ${existing.alias}, but the folder of the new sign-in could not be deleted ` +
      `(${error instanceof Error ? error.message : String(error)}). "kurmis logout ${ref.id}" deletes it.`)
  }
  const which = existing.usedByPlainClaude ? `${existing.alias}, ${plainClaudeLoginText()}` : existing.alias
  writeLine(context.stdout, `${email} is already a kurmis login: ${which} (id ${existing.id}). ` +
    (problem === null ? 'No login was added, and the new sign-in was signed out again.' : 'No login was added, and the new sign-in was deleted.'))
  writeLine(context.stdout, `"kurmis login ${existing.alias}" signs ${existing.alias} in again.`)
  if (run.alias !== undefined) {
    writeLine(context.stderr, `kurmis login: --alias ${run.alias} was not used, because no login was added. ` +
      `"kurmis set ${existing.alias} --alias ${run.alias}" gives ${existing.alias} that alias.`)
  }
  return EXIT_OK
}

export function createLoginCommand(deps: Partial<LoginDeps> = {}): Command {
  const full: LoginDeps = {
    daemon: deps.daemon ?? realDaemonClient,
    runner: deps.runner ?? realChildRunner,
    findProgram: deps.findProgram ?? realFindProgram,
    runProgram: deps.runProgram ?? runProgram,
    home: deps.home ?? homedir,
    probeWaitMs: deps.probeWaitMs ?? LOGIN_PROBE_WAIT_MS,
    inCredentialManager: deps.inCredentialManager ?? ((folder, env) => holdsStoredRecord(folder, env)),
    platform: deps.platform ?? process.platform
  }
  return {
    name: 'login',
    summary: 'Sign in a new login, or sign an existing one in again',
    usage: `Usage: kurmis login [--alias <alias>]
       kurmis login <login> [--alias <alias>]

Signs a login in through the browser.

  kurmis login                Adds a new login.
  kurmis login work-example   Signs the login work-example in again, for example after it was
                              signed out.

<login> is an alias or id that "kurmis status" shows.

A new login's alias comes from its email: work@example.com gives work-example. When you sign in
to an account kurmis already has, nothing is added and kurmis names the login it already is.
"kurmis set" changes a login's alias and routing settings.

Options:
  --alias <alias>   Use this alias instead of the one from the email: 1 to 32 lowercase
                    letters, digits, "-" or "_", starting with a letter or digit.
  -h, --help        Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs('login', args, { alias: { type: 'string' } }, context, true)
      if (typeof parsed === 'number') return parsed
      if (parsed.positionals.length > 1) return usageError('login', 'takes at most one login, by its alias or id', context)
      const alias = parsed.values.alias

      let config: KurmisConfig
      try {
        config = loadConfig()
      } catch (error) {
        if (error instanceof ConfigError) return fail(context, error.message)
        throw error
      }
      const target = loginTarget(parsed.positionals[0], config)
      if ('error' in target) return usageError('login', target.error, context)
      const isNew = target.kind === 'new'
      const ref: LoginRef = isNew
        ? { id: freshLoginId(config), usedByPlainClaude: false }
        : { id: target.login.id, usedByPlainClaude: target.login.usedByPlainClaude }
      const name = isNew ? ref.id : target.login.alias
      if (alias !== undefined) {
        const problem = aliasProblem(config, ref, alias)
        if (problem !== null) return usageError('login', problem, context)
      }

      let program: ResolvedProgram
      try {
        program = full.findProgram({ env: context.env })
      } catch (error) {
        if (error instanceof ProgramNotFoundError) return fail(context, error.message)
        throw error
      }

      let lock: FileLock
      try {
        lock = lockLogin(ref.id, name)
      } catch (error) {
        if (error instanceof LoginBusyError) return fail(context, error.message)
        throw error
      }
      try {
        if (!isNew) {
          // Read again under the lock: a `kurmis logout` may have removed the login meanwhile.
          let current: KurmisConfig
          try {
            current = loadConfig()
          } catch (error) {
            if (error instanceof ConfigError) return fail(context, error.message)
            throw error
          }
          if (findLogin(current, ref.id) === undefined) return fail(context, `${name} was removed by another kurmis command just now`)
        }
        return await signIn({ ref, isNew, name, lock, program, alias, context, deps: full })
      } finally {
        lock.release()
      }
    }
  }
}

export const loginCommand = createLoginCommand()

