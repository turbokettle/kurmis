// `kurmis claude …`: starts Claude Code with its requests going through the daemon
// (docs/architecture.md, "How a Claude CLI reaches the daemon").
//
// The CLI is started on one login's credentials: the pinned one with `--login`, otherwise the
// one `autoStartLogin` picks from the daemon's status (normally plain claude's login). While the
// daemon has neither a token nor a probe answer for plain claude's login, as right after it
// starts, the wrapper first waits up to `START_PROBE_WAIT_MS` for the probes of the logins the
// daemon knows nothing about (`withFirstProbe`), so the first start after a daemon start
// picks the same login as the later ones. When
// config.json cannot be read, a CLI without `--login` starts on plain claude's login, with the id
// the daemon's status gives it, and a warning. The proxy signs each request with the login it
// picks, so on Auto this only has to be a login the CLI can send with at all. The routing
// variables go into the process environment and, because a `settings.json` in global mode would
// beat that, into a `--settings` argument too (`settings-arg.ts`).
// `CLAUDE_SECURESTORAGE_CONFIG_DIR` stays in the process environment only: the settings layers
// are about the requests, while that variable says where the CLI's own credentials are.
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { LoginStatus, StatusAnswer } from '../../core/control-api.ts'
import {
  applyEnvPatch,
  inheritedOAuthTokenVariables,
  OAUTH_TOKEN_VARIABLES,
  routedClaudeEnv,
  withoutRoutedVariables
} from '../../core/routed-env.ts'
import { canUseDaemon } from '../../daemon/lifecycle.ts'
import { ConfigError, loadConfig, plainClaudeLogin, resolveLogin, type KurmisConfig } from '../../data/config.ts'
import { configDirHasOwnCredentials, namesDefaultClaudeFolder } from '../../data/login-env.ts'
import type { LoginId } from '../../data/login-id.ts'
import { loginFolder, logPath } from '../../data/paths.ts'
import { findProgram, ProgramNotFoundError, type ResolvedProgram } from '../../platform/programs.ts'
import { EXIT_FAILURE, PLAIN_CLAUDE_LOGIN, writeLine, type CliContext, type Command } from '../command.ts'
import {
  realChildRunner, realDaemonClient, settleWithin, type ChildRunner, type DaemonClient
} from '../command-deps.ts'
import { DaemonNotUsableError, type DaemonConnection } from '../daemon-client.ts'
import {
  claudeArgsWithSettings,
  claudeUserSettingsPath,
  inheritedCustomHeaders,
  readUserSettingsArg,
  readUserSettingsEnv,
  settingsEnv,
  storeSettings,
  userOwnedRoutingVariables,
  type CustomHeaderLayers,
  type SettingsStore,
  type UserSettingsArg
} from '../settings-arg.ts'
import { notStartedExitCode } from '../wrapper.ts'

export interface ClaudeDeps {
  daemon: DaemonClient
  child: ChildRunner
  findProgram: typeof findProgram
  loadConfig: () => KurmisConfig
  platform: NodeJS.Platform
  /** The folder claude starts in, for a relative `--settings` path. */
  cwd: () => string
  /** The home folder, for `~/.claude/settings.json`. */
  homeDir: () => string
  /** Reads a settings file as UTF-8. */
  readFile?: (path: string) => string
  /** Whether a login's folder is there. */
  folderExists: (path: string) => boolean
  /** Writes the merged `--settings` (`storeSettings` in `settings-arg.ts`). */
  storeSettings: SettingsStore
  /** How long to wait for the daemon's first probes before picking the login to start on. */
  probeWaitMs: number
}

/**
 * How long `kurmis claude` on Auto waits for the daemon to probe the logins it knows nothing
 * about yet, when one of them is plain claude's login. A probe starts one short-lived `claude`,
 * and the probes run side by side.
 */
const START_PROBE_WAIT_MS = 15_000

const USAGE = `Usage: kurmis [--login <login>] claude [<claude arguments...>]

Starts Claude Code with the terminal attached. Its requests go through the kurmis daemon,
which signs each one with a login that has room, and the command exits with claude's exit code.
The daemon is started first when it is not running.

kurmis' options go before "claude", and claude's arguments after it, for example
"kurmis --login work-example claude --resume".

Options:
  --login <login>   Send every request of the session with one login, even when it is out
                    of usage. <login> is the login's alias or its id, as "kurmis status"
                    shows them. Without --login, each request goes to a login that has room
                    (Auto).

claude needs a signed-in login of its own to start, even though the daemon re-signs every
request. On Auto, kurmis starts it on the login plain claude uses, or on another signed-in login
when that one is signed out. This does not change where the requests go. Right after the daemon
starts, kurmis waits up to 15 seconds for its first usage probe to tell which.

kurmis passes its own settings to claude with --settings. When you give a --settings of your
own, kurmis adds its settings to yours and does not change your file.

To use kurmis every time you run claude: alias claude='kurmis claude'`

export function createClaudeCommand(overrides: Partial<ClaudeDeps> = {}): Command {
  const deps: ClaudeDeps = {
    daemon: realDaemonClient,
    child: realChildRunner,
    findProgram,
    loadConfig: () => loadConfig(),
    platform: process.platform,
    cwd: () => process.cwd(),
    homeDir: () => homedir(),
    folderExists: (path) => existsSync(path) && statSync(path).isDirectory(),
    storeSettings: (text, holdsUserSettings) => storeSettings(text, holdsUserSettings),
    probeWaitMs: START_PROBE_WAIT_MS,
    ...overrides
  }
  return {
    name: 'claude',
    summary: 'Start Claude Code routed through the kurmis daemon',
    usage: USAGE,
    passesArguments: true,
    run: (args, context, login) => runClaude(args, login ?? null, context, deps)
  }
}

export const claudeCommand: Command = createClaudeCommand()

/**
 * The login a CLI is started on, as the config or the daemon's status has it. `id` is null only
 * for the login plain claude uses when neither the config nor the daemon names its id.
 */
interface StartedOn {
  id: string | null
  alias: string
  usedByPlainClaude: boolean
}

async function runClaude(args: string[], login: string | null, context: CliContext, deps: ClaudeDeps): Promise<number> {
  const fail = (message: string, code = EXIT_FAILURE): number => {
    writeLine(context.stderr, `kurmis claude: ${message}`)
    return code
  }

  const userSettings = readUserSettingsArg(args, { cwd: deps.cwd(), readFile: deps.readFile })
  if ('error' in userSettings) return fail(userSettings.error)

  let program: ResolvedProgram
  try {
    program = deps.findProgram({ env: context.env, platform: deps.platform })
  } catch (error) {
    // 127, as a shell answers for a program it cannot find (see `notStartedExitCode`).
    if (error instanceof ProgramNotFoundError) return fail(error.message, notStartedExitCode('ENOENT'))
    return fail(messageOf(error))
  }

  // Null when config.json cannot be read: then claude starts on the login plain claude uses.
  let config: KurmisConfig | null
  try {
    config = deps.loadConfig()
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    // A pinned login cannot be looked up without the config.
    if (login !== null) return fail(error.message)
    writeLine(context.stderr, `kurmis claude: ${error.message} Starting claude on ${PLAIN_CLAUDE_LOGIN}.`)
    config = null
  }
  let pinned: StartedOn | null = null
  if (login !== null && config !== null) {
    const resolved = resolveLogin(config, login)
    if ('error' in resolved) {
      return fail(`${resolved.error}. "kurmis status" shows the logins, and "kurmis login" adds one.`)
    }
    pinned = resolved.login
  }

  let connection: DaemonConnection
  try {
    // Without the config `ensureDaemon` cannot tell which port the daemon belongs on, so a daemon
    // that runs is used as it is, when this kurmis can read its answers. Otherwise
    // `ensureDaemon` reads the config again, which works when the config only had its lock taken
    // a moment ago, and says why it cannot use a daemon that runs.
    const running = config === null ? await deps.daemon.findDaemon({ env: context.env }) : null
    connection = running !== null && canUseDaemon(running) ? running : await deps.daemon.ensureDaemon({ env: context.env })
  } catch (error) {
    return fail(daemonUnreachable(error))
  }

  let startedOn: StartedOn
  if (pinned !== null) {
    startedOn = pinned
  } else {
    let status: StatusAnswer
    try {
      status = await deps.daemon.readStatus(connection)
    } catch (error) {
      return fail(daemonUnreachable(error))
    }
    const ownRow = status.logins.find((login) => login.usedByPlainClaude)
    if (config === null) {
      // The daemon's id for the login plain claude uses. Without one, no started-on header is
      // sent, which the daemon reads as that login too.
      startedOn = ownRow ?? { id: null, alias: PLAIN_CLAUDE_LOGIN, usedByPlainClaude: true }
    } else {
      status = await withFirstProbe(connection, status, context, deps)
      startedOn = autoStartLogin(status.logins) ?? plainClaudeLogin(config)
      if (!startedOn.usedByPlainClaude) {
        const own = ownRow ?? plainClaudeLogin(config)
        writeLine(context.stderr, `kurmis claude: ${own.alias}, ${PLAIN_CLAUDE_LOGIN}, is not signed in, so claude starts on ` +
          `${startedOn.alias}'s credentials; requests are still routed on Auto.`)
      }
    }
  }

  let secureStorageDir: string | null = null
  if (!startedOn.usedByPlainClaude && startedOn.id !== null) {
    secureStorageDir = loginFolder({ id: startedOn.id as LoginId, usedByPlainClaude: false })
    if (!deps.folderExists(secureStorageDir)) {
      return fail(`the folder of ${startedOn.alias} is missing (${secureStorageDir}). Sign it in again with ` +
        `"kurmis login ${startedOn.alias}".`)
    }
  }

  if (startedOn.usedByPlainClaude && configDirHasOwnCredentials(context.env, deps.platform)) {
    writeLine(context.stderr, `kurmis claude: ${configDirNote(context.env['CLAUDE_CONFIG_DIR'] ?? '', deps)}`)
  }

  const layers = settingsLayers(userSettings, context.env, deps)
  if (layers.warning !== null) writeLine(context.stderr, `kurmis claude: ${layers.warning}`)
  // A value of the person's own for ENABLE_TOOL_SEARCH or CLAUDE_CODE_MAX_RETRIES is left as it is.
  const routed = withoutRoutedVariables(routedClaudeEnv({
    port: connection.port,
    key: connection.key,
    login: pinned?.id ?? null,
    startedOn: startedOn.id,
    secureStorageDir,
    inheritedCustomHeaders: inheritedCustomHeaders(layers.layers)
  }), userOwnedRoutingVariables(layers.layers))
  for (const note of oauthTokenNotes(context.env, layers.layers, userSettings, claudeUserSettingsPath(context.env, deps.homeDir()))) {
    writeLine(context.stderr, `kurmis claude: ${note}`)
  }
  const env = applyEnvPatch(context.env, routed, deps.platform === 'win32')
  let claudeArgs: { args: string[]; remove: () => void }
  try {
    claudeArgs = claudeArgsWithSettings(userSettings, settingsEnv(routed), deps.storeSettings)
  } catch (error) {
    return fail(`could not write the settings file for claude: ${error instanceof Error ? error.message : String(error)}`)
  }

  let end
  try {
    end = await deps.child.runInteractive(
      { command: program.command, args: [...program.args, ...claudeArgs.args], env },
      { platform: deps.platform }
    )
  } finally {
    // Before `finishLikeChild`, which may raise the child's signal on this process.
    claudeArgs.remove()
  }
  return deps.child.finishLikeChild(end, { stderr: context.stderr, name: 'claude', platform: deps.platform })
}

/**
 * `status`, or, when the daemon knows nothing yet about whether plain claude's login is signed in
 * (no token read and no probe answer, as right after the daemon starts), the status after the
 * daemon has probed every login it knows nothing about. The wait is at most
 * `probeWaitMs`; when it is over or the probe request fails, `status` is used as it is, with a
 * note.
 */
async function withFirstProbe(connection: DaemonConnection, status: StatusAnswer, context: CliContext,
  deps: ClaudeDeps): Promise<StatusAnswer> {
  const unknown = status.logins.filter((login) => login.signedIn === null)
  if (!unknown.some((login) => login.usedByPlainClaude)) return status
  const ids = unknown.map((login) => login.id)
  const probed = await settleWithin((signal) => deps.daemon.requestProbe(connection, ids, signal), deps.probeWaitMs)
  if (probed.kind === 'done') return probed.value
  writeLine(context.stderr, probed.kind === 'timeout'
    ? `kurmis claude: the daemon did not finish its first usage probe within ${String(deps.probeWaitMs / 1000)} s, so it is not ` +
      `known yet whether ${PLAIN_CLAUDE_LOGIN} is signed in; claude starts on it.`
    : `kurmis claude: the usage probe failed (${messageOf(probed.error)}), so it is not known whether ` +
      `${PLAIN_CLAUDE_LOGIN} is signed in; claude starts on it.`)
  return status
}

/**
 * The login of `logins` whose credentials an Auto claude is started on. The proxy signs each
 * Auto request with the login it picks, so this login only has to let claude send at all: a
 * claude that finds no credentials answers "Not logged in" before it sends anything.
 *
 * Plain claude's login is taken unless the daemon found it signed out (a login it has not
 * looked at yet is normally signed in). Otherwise the first signed-in login of the pool (the
 * logins with routing on); an extra login whose sign-in is not known yet does not count as
 * signed in. When no pool login is signed in, the pool's first login is taken: claude then fails
 * to sign in on a pool login, which is the problem to fix. With no pool at all, plain claude's
 * login stays, because the router holds such a session to it (`effectivePin`). Undefined only
 * when `logins` has no login plain claude uses.
 */
function autoStartLogin(logins: readonly LoginStatus[]): LoginStatus | undefined {
  const own = logins.find((login) => login.usedByPlainClaude)
  if (own === undefined || own.signedIn !== false) return own
  const pool = logins.filter((login) => login.routing)
  return pool.find((login) => login.signedIn === true) ?? pool[0] ?? own
}

/**
 * The layers claude reads its environment from, highest last in effect: the person's
 * `--settings`, the user settings file and the process environment. They give the person's own
 * `ANTHROPIC_CUSTOM_HEADERS` and their own values for `USER_OWNED_ROUTING_VARIABLES`. A user
 * settings file that cannot be read is skipped with a warning.
 */
function settingsLayers(userSettings: UserSettingsArg, env: NodeJS.ProcessEnv,
  deps: ClaudeDeps): { layers: CustomHeaderLayers; warning: string | null } {
  const flagEnv = userSettings.settings?.env
  const fromFile = readUserSettingsEnv(claudeUserSettingsPath(env, deps.homeDir()), deps.readFile)
  return {
    layers: {
      flagEnv: typeof flagEnv === 'object' && flagEnv !== null && !Array.isArray(flagEnv) ? flagEnv as Record<string, unknown> : null,
      userSettingsEnv: fromFile.env,
      processEnv: env,
      windows: deps.platform === 'win32'
    },
    warning: fromFile.warning
  }
}

/**
 * The note for a CLI started on plain claude's login while `CLAUDE_CONFIG_DIR` is set, on a platform
 * where that gives the CLI credentials of its own (`configDirHasOwnCredentials`).
 */
function configDirNote(value: string, deps: ClaudeDeps): string {
  if (namesDefaultClaudeFolder(value, deps.platform, deps.homeDir())) {
    const keeps = deps.platform === 'win32' ? 'may keep its credentials in a Credential Manager entry'
      : 'keeps its credentials in a Keychain item'
    return 'CLAUDE_CONFIG_DIR names ~/.claude, the folder of the login plain claude uses, but a claude started with it set ' +
      `${keeps} of its own, which may hold another account. Kurmis starts claude with the credentials of the login ` +
      'plain claude uses, the ones a claude without CLAUDE_CONFIG_DIR reads.'
  }
  return 'CLAUDE_CONFIG_DIR is set, but kurmis starts claude on the login plain claude uses, the one in ~/.claude, so claude ' +
    'signs in with that login\'s credentials, not with those in CLAUDE_CONFIG_DIR. Settings and transcripts still come from ' +
    'CLAUDE_CONFIG_DIR.'
}

/**
 * One note for each place that sets one of `OAUTH_TOKEN_VARIABLES` to a value that is not
 * empty: the process environment, and the `env` of the user settings file and of the person's
 * `--settings`. The routed environment leaves them out and the wrapper's
 * `--settings` sets them to the empty string (`settingsEnv`), so claude does not use them; the
 * note says so and where to remove them. Never shows a value.
 */
function oauthTokenNotes(env: NodeJS.ProcessEnv, layers: CustomHeaderLayers, userSettings: UserSettingsArg,
  userSettingsPath: string): string[] {
  const windows = layers.windows === true
  const listed = (names: string[]): { names: string; verb: string; pronoun: string } => ({
    names: names.join(' and '),
    verb: names.length === 1 ? 'is' : 'are',
    pronoun: names.length === 1 ? 'it' : 'them'
  })
  const notes: string[] = []
  const inherited = inheritedOAuthTokenVariables(env, windows)
  if (inherited.length > 0) {
    const said = listed(inherited)
    notes.push(`${said.names} ${said.verb} set, so claude would sign its requests with that token instead of a kurmis login. ` +
      `Kurmis starts claude without ${said.pronoun}; unset ${said.pronoun} to stop this note.`)
  }
  const flagWhere = userSettings.source === 'inline' || userSettings.source === null ? 'your --settings' : userSettings.source
  for (const [where, layer] of [[userSettingsPath, layers.userSettingsEnv], [flagWhere, layers.flagEnv]] as const) {
    if (layer === null) continue
    const names = Object.entries(layer)
      .filter(([name, value]) => typeof value === 'string' && value !== '' &&
        OAUTH_TOKEN_VARIABLES.some((other) => (windows ? other.toUpperCase() === name.toUpperCase() : other === name)))
      .map(([name]) => name)
    if (names.length === 0) continue
    const said = listed(names)
    notes.push(`${said.names} ${said.verb} set in the "env" of ${where}, so claude would sign its requests with that token ` +
      `instead of a kurmis login. Kurmis sets ${said.pronoun} to an empty value for this claude, which Claude Code reads as ` +
      `unset; remove ${said.pronoun} there to stop this note.`)
  }
  return notes
}

function daemonUnreachable(error: unknown): string {
  if (error instanceof DaemonNotUsableError) return `${error.message} Claude is not started unrouted.`
  return `the kurmis daemon could not be reached (${messageOf(error)}). Start it with "kurmis daemon start"; ` +
    `its log is ${logPath()}. Claude is not started unrouted.`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
