// `kurmis claude …`: starts Claude Code with its requests going through the daemon
// (docs/architecture.md, "How a Claude CLI reaches the daemon").
//
// The CLI is started on one login's credentials: the pinned one with `--login`, otherwise the
// one `autoStartLogin` picks from the daemon's status (normally plain claude's login). When
// config.json cannot be read, a CLI without `--login` starts on plain claude's login, with the id
// the daemon's status gives it, and a warning. The proxy signs each request with the login it
// picks, so on Auto this only has to be a login the CLI can send with at all. The routing
// variables go into the process environment and, because a `settings.json` in global mode would
// beat that, into a `--settings` argument too (`settings-arg.ts`).
// `CLAUDE_SECURESTORAGE_CONFIG_DIR` stays in the process environment only: the settings layers
// are about the requests, while that variable says where the CLI's own credentials are.
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { autoStartLogin, type StartableLogin } from '../../core/account-router.ts'
import type { StatusAnswer } from '../../core/control-api.ts'
import {
  applyRoutedEnv,
  inheritedOAuthTokenVariables,
  OAUTH_TOKEN_VARIABLES,
  routedClaudeEnv,
  withoutRoutedVariables
} from '../../core/routed-env.ts'
import { ConfigError, loadConfig, machineOwnLogin, resolveLogin, type KurmisConfig } from '../../data/config.ts'
import { configDirHasOwnCredentials, namesDefaultClaudeFolder } from '../../data/login-env.ts'
import type { LoginId } from '../../data/login-id.ts'
import { loginFolder, logPath } from '../../data/paths.ts'
import { ProgramNotFoundError, type ResolvedProgram } from '../../platform/programs.ts'
import { EXIT_FAILURE, EXIT_OK, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realChildRunner, realDaemonClient, realFindProgram, type ChildRunner, type DaemonClient } from '../command-deps.ts'
import type { DaemonConnection } from '../daemon-client.ts'
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
import { loginArgument, machineOwnText } from '../login-names.ts'
import { notStartedExitCode } from '../wrapper.ts'
import { parseWrapperArgs } from '../wrapper-args.ts'

export interface ClaudeDeps {
  daemon: DaemonClient
  child: ChildRunner
  findProgram: typeof realFindProgram
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
}

const USAGE = `Usage: kurmis claude [--login <login>] [--] [claude arguments...]

Starts Claude Code with the terminal attached. Its requests go through the kurmis daemon,
which signs each one with a login that has room, and the command exits with claude's exit code.
The daemon is started first when it is not running.

Options (only before the first argument kurmis does not know):
  --login <login>   Keep the session on one Claude login, whatever its limits say. <login> is
                    the login's alias or its id, as "kurmis status" shows them, for example
                    --login work-example. Only Claude logins are looked at, so a Codex login
                    with the same alias does not count. Without --login the session is on Auto.
                    When config.json cannot be read, --login is an error. Without --login
                    claude then starts on the login plain claude uses, with a warning.
  -h, --help        Show this help.
  --                Pass everything after it to claude, even arguments kurmis knows.

Everything from the first argument kurmis does not know is passed to claude unchanged, except
claude's --settings: kurmis passes its own settings that way, and adds them to yours when you
give one (your file is not changed).
"kurmis claude -- --help" shows claude's own help.`

export function createClaudeCommand(overrides: Partial<ClaudeDeps> = {}): Command {
  const deps: ClaudeDeps = {
    daemon: realDaemonClient,
    child: realChildRunner,
    findProgram: realFindProgram,
    loadConfig: () => loadConfig(),
    platform: process.platform,
    cwd: () => process.cwd(),
    homeDir: () => homedir(),
    folderExists: (path) => existsSync(path) && statSync(path).isDirectory(),
    storeSettings: (text, holdsUserSettings) => storeSettings(text, holdsUserSettings),
    ...overrides
  }
  return {
    name: 'claude',
    summary: 'Start Claude Code routed through the kurmis daemon',
    usage: USAGE,
    passesArguments: true,
    run: (args, context) => runClaude(args, context, deps)
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
  machineOwn: boolean
}

async function runClaude(args: string[], context: CliContext, deps: ClaudeDeps): Promise<number> {
  const parsed = parseWrapperArgs(args)
  if ('error' in parsed) return usageError('claude', parsed.error, context)
  if (parsed.help) {
    writeLine(context.stdout, USAGE)
    return EXIT_OK
  }
  const fail = (message: string, code = EXIT_FAILURE): number => {
    writeLine(context.stderr, `kurmis claude: ${message}`)
    return code
  }

  const userSettings = readUserSettingsArg(parsed.passThrough, { cwd: deps.cwd(), readFile: deps.readFile })
  if ('error' in userSettings) return fail(userSettings.error)

  let program: ResolvedProgram
  try {
    program = deps.findProgram('claude', { env: context.env, platform: deps.platform })
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
    if (parsed.login !== null) return fail(error.message)
    writeLine(context.stderr, `kurmis claude: ${error.message} Starting claude on ${machineOwnText('claude')}.`)
    config = null
  }
  let pinned: StartedOn | null = null
  if (parsed.login !== null && config !== null) {
    const resolved = resolveLogin(config, parsed.login, 'claude')
    if ('error' in resolved) {
      return fail(`${resolved.error}. "kurmis status" shows the logins, and "kurmis login claude" adds one.`)
    }
    pinned = resolved.login
  }

  let connection: DaemonConnection
  try {
    // Without the config `ensureDaemon` cannot tell which port the daemon belongs on, so a daemon
    // that runs is used as it is. When none runs, `ensureDaemon` reads the config again, which
    // works when the config only had its lock taken a moment ago.
    connection = (config === null ? await deps.daemon.findDaemon({ env: context.env }) : null) ??
      await deps.daemon.ensureDaemon({ env: context.env })
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
    const ownRow = status.logins.find((login) => login.provider === 'claude' && login.machineOwn)
    if (config === null) {
      // The daemon's id for the login plain claude uses. Without one, no started-on header is
      // sent, which the daemon reads as that login too.
      startedOn = ownRow ?? { id: null, alias: machineOwnText('claude'), machineOwn: true }
    } else {
      const startId = autoStartLogin(startableLogins(status))
      startedOn = status.logins.find((login) => login.id === startId) ?? machineOwnLogin(config, 'claude')
      if (!startedOn.machineOwn) {
        const own = ownRow ?? machineOwnLogin(config, 'claude')
        writeLine(context.stderr, `kurmis claude: ${own.alias}, ${machineOwnText('claude')}, is not signed in, so claude starts on ` +
          `${startedOn.alias}'s credentials; requests are still routed on Auto.`)
      }
    }
  }

  let secureStorageDir: string | null = null
  if (!startedOn.machineOwn && startedOn.id !== null) {
    secureStorageDir = loginFolder({ id: startedOn.id as LoginId, provider: 'claude', machineOwn: false })
    if (!deps.folderExists(secureStorageDir)) {
      const argument = config === null ? startedOn.alias
        : loginArgument(config, { id: startedOn.id, provider: 'claude', alias: startedOn.alias })
      return fail(`the folder of ${startedOn.alias} is missing (${secureStorageDir}). Sign it in again with ` +
        `"kurmis login ${argument}".`)
    }
  }

  if (startedOn.machineOwn && configDirHasOwnCredentials(context.env, deps.platform)) {
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
  const env = applyRoutedEnv(context.env, routed, deps.platform === 'win32')
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
 * The Claude logins of a status as `autoStartLogin` reads them. A login the daemon has not looked
 * at yet (`signedIn: null`) counts as signed in only for plain claude's login, which is
 * normally signed in; an extra login that is known to be signed in is better to start on than
 * one that is not known.
 */
export function startableLogins(status: StatusAnswer): StartableLogin[] {
  return status.logins
    .filter((login) => login.provider === 'claude')
    .map((login) => ({
      id: login.id,
      machineOwn: login.machineOwn,
      loggedIn: login.signedIn ?? login.machineOwn,
      autoRoute: login.routing
    }))
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
  return `the kurmis daemon could not be reached (${messageOf(error)}). Start it with "kurmis daemon start"; ` +
    `its log is ${logPath()}. Claude is not started unrouted.`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
