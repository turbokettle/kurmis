// `kurmis claude …`: starts Claude Code with its requests going through the daemon
// (docs/architecture.md, "How a Claude CLI reaches the daemon").
//
// The CLI is started on one login's credentials: the pinned one with `--login`, otherwise the
// one `autoStartLogin` picks from the daemon's status (normally `claude:default`). The proxy
// signs each request with the login it picks, so on Auto this only has to be a login the CLI
// can send with at all. The routing variables go into the process environment and, because a
// `settings.json` in global mode would beat that, into a `--settings` argument too
// (`settings-arg.ts`). `CLAUDE_SECURESTORAGE_CONFIG_DIR` stays in the process environment only:
// the settings layers are about the requests, while that variable says where the CLI's own
// credentials are.
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { autoStartLogin, type StartableLogin } from '../../core/account-router.ts'
import { CLAUDE_DEFAULT_ACCOUNT_ID } from '../../core/accounts.ts'
import type { StatusAnswer } from '../../core/control-api.ts'
import { applyRoutedEnv, inheritedOAuthTokenVariables, routedClaudeEnv, withoutRoutedVariables } from '../../core/routed-env.ts'
import { ConfigError, findLogin, loadConfig, type KurmisConfig } from '../../data/config.ts'
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
  routingVariables,
  storeSettings,
  userOwnedRoutingVariables,
  type CustomHeaderLayers,
  type SettingsStore,
  type UserSettingsArg
} from '../settings-arg.ts'
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

const USAGE = `Usage: kurmis claude [--login <id>] [--] [claude arguments...]

Starts Claude Code with the terminal attached. Its requests go through the kurmis daemon,
which signs each one with a login that has room, and the command exits with claude's exit code.
The daemon is started first when it is not running.

Options (only before the first argument kurmis does not know):
  --login <id>   Keep the session on one login, whatever its limits say. <id> is claude:<name>
                 or just <name>. Without it the session is on Auto.
  -h, --help     Show this help.
  --             Pass everything after it to claude, even arguments kurmis knows.

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

async function runClaude(args: string[], context: CliContext, deps: ClaudeDeps): Promise<number> {
  const parsed = parseWrapperArgs('claude', args)
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

  if (parsed.login !== null && parsed.login !== CLAUDE_DEFAULT_ACCOUNT_ID) {
    let config: KurmisConfig
    try {
      config = deps.loadConfig()
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error
      return fail(error.message)
    }
    if (findLogin(config, parsed.login) === undefined) {
      return fail(`there is no login ${parsed.login}. "kurmis list" shows the logins, and "kurmis login claude" adds one.`)
    }
  }

  let connection: DaemonConnection
  try {
    connection = await deps.daemon.ensureDaemon({ env: context.env })
  } catch (error) {
    return fail(daemonUnreachable(error))
  }

  let startedOn: string
  if (parsed.login !== null) {
    startedOn = parsed.login
  } else {
    let status: StatusAnswer
    try {
      status = await deps.daemon.readStatus(connection)
    } catch (error) {
      return fail(daemonUnreachable(error))
    }
    startedOn = autoStartLogin(startableLogins(status))
    if (startedOn !== CLAUDE_DEFAULT_ACCOUNT_ID) {
      writeLine(context.stderr,
        `kurmis claude: ${CLAUDE_DEFAULT_ACCOUNT_ID} is not signed in, so claude starts on ${startedOn}'s credentials; requests are still routed on Auto.`)
    }
  }

  let secureStorageDir: string | null = null
  if (startedOn !== CLAUDE_DEFAULT_ACCOUNT_ID) {
    secureStorageDir = loginFolder(startedOn)
    if (!deps.folderExists(secureStorageDir)) {
      return fail(`the folder of ${startedOn} is missing (${secureStorageDir}). Sign it in again with "kurmis login ${startedOn}".`)
    }
  }

  const layers = settingsLayers(userSettings, context.env, deps)
  if (layers.warning !== null) writeLine(context.stderr, `kurmis claude: ${layers.warning}`)
  // A value of the person's own for ENABLE_TOOL_SEARCH or CLAUDE_CODE_MAX_RETRIES is left as it is.
  const routed = withoutRoutedVariables(routedClaudeEnv({
    port: connection.port,
    key: connection.key,
    login: parsed.login,
    startedOn,
    secureStorageDir,
    inheritedCustomHeaders: inheritedCustomHeaders(layers.layers)
  }), userOwnedRoutingVariables(layers.layers))
  const tokenVariables = inheritedOAuthTokenVariables(context.env, deps.platform === 'win32')
  if (tokenVariables.length > 0) {
    writeLine(context.stderr, `kurmis claude: ${tokenVariables.join(' and ')} ${tokenVariables.length === 1 ? 'is' : 'are'} set, ` +
      'so claude would sign its requests with that token instead of a kurmis login. Kurmis starts claude without ' +
      `${tokenVariables.length === 1 ? 'it' : 'them'}; unset ${tokenVariables.length === 1 ? 'it' : 'them'} to stop this note.`)
  }
  const env = applyRoutedEnv(context.env, routed, deps.platform === 'win32')
  let claudeArgs: { args: string[]; remove: () => void }
  try {
    claudeArgs = claudeArgsWithSettings(userSettings, routingVariables(routed), deps.storeSettings)
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
 * at yet (`signedIn: null`) counts as signed in only for the machine's own login, which is
 * normally signed in; an extra login that is known to be signed in is better to start on than
 * one that is not known.
 */
export function startableLogins(status: StatusAnswer): StartableLogin[] {
  return status.logins
    .filter((login) => login.provider === 'claude')
    .map((login) => ({
      id: login.id,
      loggedIn: login.signedIn ?? login.id === CLAUDE_DEFAULT_ACCOUNT_ID,
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

function daemonUnreachable(error: unknown): string {
  return `the kurmis daemon could not be reached (${messageOf(error)}). Start it with "kurmis daemon start"; ` +
    `its log is ${logPath()}. Claude is not started unrouted.`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
