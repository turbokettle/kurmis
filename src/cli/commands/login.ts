// `kurmis login`: signs a login in with the provider's own CLI and adds it to config.json.
//
//   kurmis login claude|codex [--alias <alias>]   a new login
//   kurmis login <login> [--alias <alias>]        an existing login, by alias or id, signed in again
//
// A new login gets a random id (`freshLoginId`) before anything else, and its folder is
// `claude/<id>/` or `codex/<id>/` from the start: on macOS the Keychain item's name depends on the
// folder's path, so the folder is never renamed after the sign-in.
//
// Claude runs `claude auth login --claudeai` with the login's folder as `CLAUDE_CONFIG_DIR`
// (`claudeLoginEnv`), Codex runs `codex login` with the folder as `CODEX_HOME` (`codexLoginEnv`).
// The CLI gets the terminal, as in `kurmis claude`. A new login is added to config.json only after
// its CLI has exited 0 and its credentials are there (`hasCredentials`: for a Codex login whose
// `config.toml` keeps the sign-in in the system's keyring, `codex login status` says so);
// otherwise the folder this command created is removed again. On Windows a Claude login whose
// record is in Credential Manager signs in with `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`, so the new
// token replaces it.
//
// After the sign-in the command reads the account's email: for Claude from the `.claude.json`
// the CLI wrote (`readClaudeIdentity`; `~/.claude.json` for plain claude's login), for Codex
// from `codex app-server` (`readCodexEmail`). The email is shown on the terminal and written
// nowhere. It gives the login's automatic alias (`followEmail`) unless `--alias` sets one. A
// Claude account is its email and its organization (`isSameClaudeAccount`): a personal plan and
// a Team or Enterprise seat of one email are two logins, and the second gets the alias with
// `-2`. A Codex account is its email. When a new sign-in is an account that is already a kurmis
// login of the same provider, the login plain claude or plain codex uses included, the new folder
// is signed out again and deleted, and the command says which login that account already is.
// For Claude this is checked again under the config lock, before the login is added. When an
// existing login is signed in to an account that another login of its provider already has, the
// command warns and signs nothing out.
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
import { readCodexEmail } from '../../daemon/codex-probe.ts'
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
import { applyEnvPatch, claudeLoginEnv, codexLoginEnv } from '../../data/login-env.ts'
import { isLoginProvider, LOGIN_PROVIDERS, type LoginId, type LoginProvider, type LoginRef } from '../../data/login-id.ts'
import { codexMergedRecordPath, loginFolder, ownClaudeProbeFolder } from '../../data/paths.ts'
import { makePrivateDirSync } from '../../platform/files.ts'
import { holdsStoredRecord } from '../../platform/windows-credentials.ts'
import { ProgramNotFoundError, type findProgram, type ResolvedProgram } from '../../platform/programs.ts'
import { removeTreeSync } from '../../platform/remove-tree.ts'
import { runProgram } from '../../platform/run.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realChildRunner, realDaemonClient, realFindProgram, realPrepareCodexHome, reloadText, settleWithin, type ChildRunner, type DaemonClient } from '../command-deps.ts'
import type { FileLock } from '../../data/lock.ts'
import { LoginBusyError, lockLogin } from '../login-lock.ts'
import { loginArgument, plainCliLoginText, PROVIDER_NAMES } from '../login-names.ts'
import { leftBehindText, signOutLogin } from '../sign-out.ts'
import { hasCredentials } from '../local-credentials.ts'

export interface LoginDeps {
  daemon: DaemonClient
  runner: ChildRunner
  findProgram: typeof findProgram
  /**
   * Runs the credential check (`hasCredentials`: `codex login status` for a Codex login that
   * keeps its sign-in in the keyring, `security` or PowerShell for a Claude login without
   * `.credentials.json`), and `claude auth logout` or `codex logout` on a new sign-in of an account
   * that is already a kurmis login.
   */
  runProgram: typeof runProgram
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
  /**
   * Whether Windows Credential Manager holds a record of the Claude login whose folder this is
   * (null for plain claude's login); such a login signs in with
   * `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` (`claudeLoginEnv`), so the new token replaces the
   * record. `holdsStoredRecord` by default.
   */
  inCredentialManager: (folder: string | null, env: NodeJS.ProcessEnv) => Promise<boolean>
  /** The email a Codex login is signed in with, or null. `readCodexEmail` by default. */
  readCodexEmail: (login: LoginRef, env: NodeJS.ProcessEnv) => Promise<string | null>
  /** Where the sign-out of a duplicate sign-in runs; it sets `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN` on Windows. */
  platform: NodeJS.Platform
}

/** How long a login waits for the daemon's probe of the login it signed in. */
export const LOGIN_PROBE_WAIT_MS = 15_000

/** What the command line asks for: a new login of a provider, or an existing login. */
export type LoginTarget = { kind: 'new'; provider: LoginProvider } | { kind: 'existing'; login: LoginSettings } | { error: string }

/**
 * Reads `kurmis login <claude|codex|login>` against the current config. The provider's name may
 * be in any case, as aliases and ids may (`resolveLogin`).
 */
export function loginTarget(argument: string, config: KurmisConfig): LoginTarget {
  const typed = argument.trim().toLowerCase()
  if (isLoginProvider(typed)) return { kind: 'new', provider: typed }
  const prefix = typed.endsWith(':') ? typed.slice(0, -1).trim() : null
  if (prefix !== null && isLoginProvider(prefix)) {
    return { error: `"${argument}" names no login. Put the alias or id of a ${PROVIDER_NAMES[prefix]} login after ` +
      `"${prefix}:", for example ${prefix}:work-example, or run "kurmis login ${prefix}" to add a new ${PROVIDER_NAMES[prefix]} login` }
  }
  const resolved = resolveLogin(config, argument)
  if ('error' in resolved) {
    return { error: `${resolved.error}. "kurmis login claude" or "kurmis login codex" adds a new login, and "kurmis status" shows the logins there are` }
  }
  return { kind: 'existing', login: resolved.login }
}

/**
 * A new login's id: none of the config's ids and aliases (`newLoginIdFor`), and not the name of a
 * folder in `claude/` or `codex/`, which a login that is gone may have left.
 */
export function freshLoginId(config: KurmisConfig): LoginId {
  for (;;) {
    const id = newLoginIdFor(config)
    if (LOGIN_PROVIDERS.every((provider) => !existsSync(loginFolder({ id, provider, usedByPlainCli: false })))) return id
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
 * The other login of `login`'s provider that is signed in to `account`, or null. A Claude account
 * is its email and its organization (`isSameClaudeAccount`), read from each login's
 * `.claude.json`. A Codex account is its email, from a running daemon's status where it knows
 * it, and from `codex app-server` for the rest, all at the same time.
 */
async function sameAccount(config: KurmisConfig, login: LoginRef, account: ClaudeAccountKey & { email: string },
  env: NodeJS.ProcessEnv, deps: LoginDeps): Promise<LoginSettings | null> {
  if (login.provider === 'claude') return sameClaudeAccount(config, login, account, deps.home())
  const others = config.logins.filter((other) => other.provider === login.provider && other.id !== login.id)
  const known = new Map<string, string>()
  try {
    const connection = await deps.daemon.findDaemon({ env })
    if (connection !== null) {
      for (const row of (await deps.daemon.readStatus(connection)).logins) if (row.email !== null) known.set(row.id, row.email)
    }
  } catch { /* Without the daemon every email is read from Codex. */ }
  const emails = await Promise.all(others.map(async (other) => known.get(other.id) ?? await deps.readCodexEmail(other, env)))
  // Codex's `account/read` names no workspace, so for Codex the email alone decides.
  return others.find((_, index) => isSameEmail(emails[index] ?? null, account.email)) ?? null
}

/**
 * The other Claude login signed in to `account`, by each login's `.claude.json`, or null. It
 * reads files only, so it can run while the config lock is held.
 */
function sameClaudeAccount(config: KurmisConfig, login: LoginRef, account: ClaudeAccountKey, home: string): LoginSettings | null {
  return config.logins.find((other) => other.provider === 'claude' && other.id !== login.id &&
    isSameClaudeAccount(readClaudeIdentity(other, home) ?? { email: null, organizationUuid: null }, account)) ?? null
}

/**
 * Another Claude login with the email of `account` but in another organization, or null: the
 * same person's other subscription, which is a login of its own.
 */
function otherOrganization(config: KurmisConfig, login: LoginRef, account: ClaudeAccountKey, home: string): LoginSettings | null {
  if (login.provider !== 'claude') return null
  return config.logins.find((other) => {
    if (other.provider !== 'claude' || other.id === login.id) return false
    const identity = readClaudeIdentity(other, home)
    return identity !== null && isSameEmail(identity.email, account.email) && !isSameClaudeAccount(identity, account)
  }) ?? null
}

/**
 * Thrown inside `changeConfig` when the config read under the lock has a login of the new
 * sign-in's account: another `kurmis login` of the same account added it meanwhile.
 */
class AddedMeanwhile extends Error {
  constructor(readonly existing: LoginSettings, readonly config: KurmisConfig) {
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
  const provider = ref.provider

  const folder = ref.usedByPlainCli ? null : loginFolder(ref)
  let created = false
  if (folder !== null && !existsSync(folder)) {
    makePrivateDirSync(folder)
    created = true
  }
  const cleanUp = (): void => {
    if (!created || folder === null) return
    removeTreeSync(folder)
    // Preparing the Codex home wrote what it merged in; nothing may be left of this id.
    if (provider === 'codex') rmSync(codexMergedRecordPath(ref), { force: true })
  }
  const notAdded = isNew ? ' No login was added.' : ''

  if (provider === 'codex' && !ref.usedByPlainCli) {
    try {
      const prepared = await deps.prepareCodexHome({ ...ref, alias: name }, { env: context.env })
      for (const warning of prepared.warnings) writeLine(context.stderr, `kurmis login: ${warning}`)
    } catch (error) {
      cleanUp()
      return fail(context, `could not prepare the Codex home of ${name}: ${error instanceof Error ? error.message : String(error)}.${notAdded}`)
    }
  }

  const cliName = provider === 'claude' ? 'claude auth login' : 'codex login'
  const what = isNew ? `a new ${PROVIDER_NAMES[provider]} login (id ${ref.id})` : name
  writeLine(context.stdout, `Signing in ${what} with "${cliName}". Follow its steps.`)
  const credentialManager = provider === 'claude' && await deps.inCredentialManager(folder, context.env)
  const env = applyEnvPatch(context.env, provider === 'claude' ? claudeLoginEnv(ref, credentialManager) : codexLoginEnv(ref, context.env))
  const cliArgs = provider === 'claude' ? ['auth', 'login', '--claudeai'] : ['login']
  const end = await deps.runner.runInteractive({ command: program.command, args: [...program.args, ...cliArgs], env })

  if (end.kind !== 'exit') {
    cleanUp()
    // Before `finishLikeChild`, which raises the child's signal on this process.
    lock.release()
    if (isNew) writeLine(context.stderr, `kurmis login:${notAdded}`)
    return deps.runner.finishLikeChild(end, { stderr: context.stderr, name: provider })
  }
  if (end.code !== 0) {
    cleanUp()
    return fail(context, `"${cliName}" failed (exit code ${String(end.code)}).${notAdded}`)
  }

  if (provider === 'claude' && ref.usedByPlainCli) {
    // The probe folder's profile names the account plain claude's login had before; without
    // it the daemon reads ~/.claude.json, which this sign-in just wrote, until the next probe
    // writes the probe folder's file again.
    rmSync(join(ownClaudeProbeFolder(), CLAUDE_PROFILE_FILE), { force: true })
  }
  const identity = provider === 'claude' ? (ref.usedByPlainCli ? homeIdentity(deps.home()) : readClaudeIdentity(ref, deps.home())) : null
  // A check that could not run (`unknown`) does not undo a sign-in the CLI reported as done.
  if (identity === null && (await hasCredentials(ref, context.env, deps.home(), deps)) === false) {
    cleanUp()
    return fail(context, `"${cliName}" ended, but ${name} has no credentials.${notAdded}`)
  }
  const email = provider === 'claude' ? identity?.email ?? null : await deps.readCodexEmail(ref, context.env)
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
    const existing = await sameAccount(config, ref, account, context.env, deps)
    if (existing !== null) return await dropDuplicate(run, config, existing, account.email)
  }

  let saved: KurmisConfig
  try {
    saved = changeConfig((config) => {
      // A Claude account is checked again from the config read under the lock, so two runs of
      // `kurmis login claude` that sign in to one account at the same moment add it once.
      // A Codex email is read from `codex app-server`, which is too slow to run under the lock.
      const meanwhile = isNew && provider === 'claude' && account !== null ? sameClaudeAccount(config, ref, account, deps.home()) : null
      if (meanwhile !== null) throw new AddedMeanwhile(meanwhile, config)
      let next = isNew ? addLogin(config, ref, alias === undefined ? {} : { alias }) : config
      if (!isNew && alias !== undefined) next = updateLogin(next, ref.id, { alias })
      // Without an email the alias stays as it is.
      return followEmail(next, ref.id, email)
    })
  } catch (error) {
    if (error instanceof AddedMeanwhile && email !== null) return await dropDuplicate(run, error.config, error.existing, email)
    if (!(error instanceof ConfigError)) throw error
    // The login is signed in, so its credentials are kept; logout removes them.
    return fail(context, isNew
      ? `${name} is signed in but could not be added: ${error.message} "kurmis logout ${ref.id}" removes its credentials and folder.`
      : `${name} is signed in again but its settings could not be saved: ${error.message}`)
  }
  const login = findLogin(saved, ref.id)!
  const argument = loginArgument(saved, login)

  writeLine(context.stdout, email === null ? 'Signed in.' : `Signed in as ${email}.`)
  if (isNew) {
    writeLine(context.stdout, `Added ${login.alias} (id ${login.id}), a ${PROVIDER_NAMES[provider]} login with Auto routing on and ` +
      `both limits at 100%. "kurmis set ${argument}" changes that.`)
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
    const other = await sameAccount(saved, ref, account, context.env, deps)
    if (other !== null) {
      const which = other.usedByPlainCli ? `${other.alias}, ${plainCliLoginText(other.provider)},` : other.alias
      writeLine(context.stderr, `kurmis login: warning: ${email} is also the account of ${which} (id ${other.id}). ` +
        `${login.alias} and ${other.alias} are now the same account and share its limits. Neither was signed out. ` +
        `"kurmis login ${argument}" signs ${login.alias} in to another account.`)
    }
  }
  for (const line of await tellDaemon(deps.daemon, login, context.env, deps.probeWaitMs)) writeLine(context.stdout, line)
  return EXIT_OK
}

/**
 * A new sign-in of an account that `existing` already is: signs the new folder out again,
 * deletes it, and says which login the account is. Exit code 0, since the account is there.
 */
async function dropDuplicate(run: SignInRun, config: KurmisConfig, existing: LoginSettings, email: string): Promise<number> {
  const { ref, context, deps } = run
  const problem = await signOutLogin(ref, context.env, deps)
  if (problem !== null) {
    writeLine(context.stderr, `kurmis login: ${problem}; the new sign-in is deleted anyway.${leftBehindText(ref, deps.platform)}`)
  }
  try {
    removeTreeSync(loginFolder(ref))
    if (ref.provider === 'codex') rmSync(codexMergedRecordPath(ref), { force: true })
  } catch (error) {
    return fail(context, `${email} is already ${existing.alias}, but the folder of the new sign-in could not be deleted ` +
      `(${error instanceof Error ? error.message : String(error)}). "kurmis logout ${ref.id}" deletes it.`)
  }
  const which = existing.usedByPlainCli ? `${existing.alias}, ${plainCliLoginText(existing.provider)}` : existing.alias
  writeLine(context.stdout, `${email} is already a kurmis ${PROVIDER_NAMES[ref.provider]} login: ${which} (id ${existing.id}). ` +
    'No login was added, and the new sign-in was signed out again.')
  writeLine(context.stdout, `"kurmis login ${loginArgument(config, existing)}" signs ${existing.alias} in again.`)
  if (run.alias !== undefined) {
    writeLine(context.stderr, `kurmis login: --alias ${run.alias} was not used, because no login was added. ` +
      `"kurmis set ${loginArgument(config, existing)} --alias ${run.alias}" gives ${existing.alias} that alias.`)
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
    prepareCodexHome: deps.prepareCodexHome ?? realPrepareCodexHome,
    probeWaitMs: deps.probeWaitMs ?? LOGIN_PROBE_WAIT_MS,
    inCredentialManager: deps.inCredentialManager ?? ((folder, env) => holdsStoredRecord(folder, env)),
    readCodexEmail: deps.readCodexEmail ?? ((login, env) => readCodexEmail(login, { env })),
    platform: deps.platform ?? process.platform
  }
  return {
    name: 'login',
    summary: 'Sign in a new login, or sign an existing one in again',
    usage: `Usage: kurmis login claude|codex [--alias <alias>]
       kurmis login <login> [--alias <alias>]

Signs a login in with Claude Code's "claude auth login" or Codex's "codex login", which open
the sign-in page in the browser.

  kurmis login claude         Adds a new Claude login. It gets Auto routing on and both limits
                              at 100%; "kurmis set" changes that.
  kurmis login codex          Adds a new Codex login.
  kurmis login work-example   Signs the login work-example in again, for example after it was
                              signed out. This works for the logins of plain claude and plain
                              codex too.

<login> is the login's alias or its id, as "kurmis status" shows them. When a Claude login and a
Codex login have the same alias, put claude: or codex: in front, for example
claude:work-example.

Each login gets an id of random letters and digits, which never changes. Its alias is the name
you see and type. Kurmis makes the alias from the account's email: work@example.com gives
work-example. Without --alias, the alias follows the email when the account changes.

When the account you sign in to with "kurmis login claude" or "kurmis login codex" is already
a kurmis login, kurmis signs the new sign-in out again, adds nothing and says which login the
account is. --alias is then not used. When "kurmis login <login>" signs a login in to an
account that another login of the same provider already has, kurmis warns that the two logins
are now the same account and signs neither out.

A Claude account is its email and its organization: a personal plan and a Team or Enterprise
seat of the same email are two subscriptions, so they become two logins, and the second one's
alias ends in -2. When the organization of either login is not known, the email alone decides.
A Codex account is its email.

Each extra login keeps its own credentials in its folder in the kurmis data folder (on macOS in
the Keychain). Kurmis prints the account's email and does not store it.

Options:
  --alias <alias>   The alias of the login, in place of the one made from the email. It is 1
                    to 32 lowercase letters, digits, "-" or "_", starts with a letter or digit,
                    and is not "claude" or "codex". No other login of the same provider may
                    have it. Kurmis keeps it when the email changes.
  -h, --help        Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs('login', args, { alias: { type: 'string' } }, context, true)
      if (typeof parsed === 'number') return parsed
      if (parsed.positionals.length !== 1) return usageError('login', 'takes claude, codex, or one login by its alias or id', context)
      const alias = parsed.values.alias

      let config: KurmisConfig
      try {
        config = loadConfig()
      } catch (error) {
        if (error instanceof ConfigError) return fail(context, error.message)
        throw error
      }
      const target = loginTarget(parsed.positionals[0]!, config)
      if ('error' in target) return usageError('login', target.error, context)
      const isNew = target.kind === 'new'
      const ref: LoginRef = isNew
        ? { id: freshLoginId(config), provider: target.provider, usedByPlainCli: false }
        : { id: target.login.id, provider: target.login.provider, usedByPlainCli: target.login.usedByPlainCli }
      const name = isNew ? ref.id : target.login.alias
      if (alias !== undefined) {
        const problem = aliasProblem(config, ref, alias)
        if (problem !== null) return usageError('login', problem, context)
      }

      let program: ResolvedProgram
      try {
        program = full.findProgram(ref.provider, { env: context.env })
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

