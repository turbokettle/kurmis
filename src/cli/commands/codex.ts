// `kurmis codex …`: starts Codex on one login. Codex has no proxy, so the login is picked once,
// when Codex starts: the one named with `--login`, or the one the daemon's usage ranks first
// (`chooseCodexLogin` in `src/core/codex-choice.ts`). The login's `CODEX_HOME` is prepared and
// Codex runs with the terminal attached.
import { CODEX_DEFAULT_ACCOUNT_ID } from '../../core/accounts.ts'
import { chooseCodexLogin, codexLoginsToProbe, isKurmisCodexHome } from '../../core/codex-choice.ts'
import type { StatusAnswer } from '../../core/control-api.ts'
import { ConfigError, findLogin, loadConfig, type KurmisConfig } from '../../data/config.ts'
import { applyEnvPatch, type EnvPatch } from '../../data/login-env.ts'
import { providerFolder } from '../../data/paths.ts'
import { EXIT_FAILURE, EXIT_OK, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import {
  realChildRunner,
  realDaemonClient,
  realFindProgram,
  realPrepareCodexHome,
  settleWithin,
  type ChildRunner,
  type DaemonClient
} from '../command-deps.ts'
import type { PreparedCodexHome } from '../codex-home-files.ts'
import { ProgramNotFoundError, type ResolvedProgram } from '../../platform/programs.ts'
import { notStartedExitCode } from '../wrapper.ts'
import { parseWrapperArgs } from '../wrapper-args.ts'

/**
 * How long `kurmis codex` waits for a usage probe of logins whose usage is missing or old
 * before it chooses with what it has. A Codex probe starts a `codex app-server` per login,
 * which takes a few seconds; a person waiting for Codex to open should not wait much longer.
 */
export const CODEX_PROBE_WAIT_MS = 5_000

export interface CodexDeps {
  daemon: DaemonClient
  child: ChildRunner
  findProgram: typeof realFindProgram
  prepareCodexHome: typeof realPrepareCodexHome
  loadConfig: () => KurmisConfig
  now: () => number
  platform: NodeJS.Platform
  probeWaitMs: number
}

const USAGE = `Usage: kurmis codex [--login <id>] [--] [codex arguments...]

Starts Codex with the terminal attached, on the login that ranks first (the same order Claude's
Auto uses) or on the one named, and exits with codex's exit code. Without --login the daemon is
asked for each login's usage, and started first when it is not running.

Options (only before the first argument kurmis does not know):
  --login <id>   Start on this login. <id> is codex:<name> or just <name>.
  -h, --help     Show this help.
  --             Pass everything after it to codex, even arguments kurmis knows.

Everything from the first argument kurmis does not know is passed to codex unchanged.
"kurmis codex -- --help" shows codex's own help.`

export function createCodexCommand(overrides: Partial<CodexDeps> = {}): Command {
  const deps: CodexDeps = {
    daemon: realDaemonClient,
    child: realChildRunner,
    findProgram: realFindProgram,
    prepareCodexHome: realPrepareCodexHome,
    loadConfig: () => loadConfig(),
    now: Date.now,
    platform: process.platform,
    probeWaitMs: CODEX_PROBE_WAIT_MS,
    ...overrides
  }
  return {
    name: 'codex',
    summary: 'Start Codex on a login that has room',
    usage: USAGE,
    passesArguments: true,
    run: (args, context) => runCodex(args, context, deps)
  }
}

export const codexCommand: Command = createCodexCommand()

async function runCodex(args: string[], context: CliContext, deps: CodexDeps): Promise<number> {
  const parsed = parseWrapperArgs('codex', args)
  if ('error' in parsed) return usageError('codex', parsed.error, context)
  if (parsed.help) {
    writeLine(context.stdout, USAGE)
    return EXIT_OK
  }

  let program: ResolvedProgram
  try {
    program = deps.findProgram('codex', { env: context.env, platform: deps.platform })
  } catch (error) {
    writeLine(context.stderr, `kurmis codex: ${messageOf(error)}`)
    // The code a shell gives for a program it cannot find, as `kurmis claude` does.
    return error instanceof ProgramNotFoundError ? notStartedExitCode('ENOENT') : EXIT_FAILURE
  }

  let login: string
  if (parsed.login === CODEX_DEFAULT_ACCOUNT_ID) {
    // Always there, so it needs no config.json, even a damaged one.
    login = parsed.login
  } else if (parsed.login !== null) {
    let config: KurmisConfig
    try {
      config = deps.loadConfig()
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error
      writeLine(context.stderr, `kurmis codex: ${error.message}`)
      return EXIT_FAILURE
    }
    if (findLogin(config, parsed.login) === undefined) {
      writeLine(context.stderr, `kurmis codex: there is no login ${parsed.login}. "kurmis list" shows the logins.`)
      return EXIT_FAILURE
    }
    login = parsed.login
  } else {
    login = await chooseLogin(context, deps)
  }

  let prepared: PreparedCodexHome
  try {
    prepared = await deps.prepareCodexHome(login, { env: context.env, platform: deps.platform })
  } catch (error) {
    writeLine(context.stderr, `kurmis codex: could not prepare the Codex home of ${login}: ${messageOf(error)}`)
    return EXIT_FAILURE
  }
  for (const warning of prepared.warnings) writeLine(context.stderr, `kurmis codex: ${warning}`)

  const env = applyEnvPatch(context.env, codexHomePatch(prepared, context.env, deps.platform), deps.platform === 'win32')
  const end = await deps.child.runInteractive(
    { command: program.command, args: [...program.args, ...parsed.passThrough], env },
    { platform: deps.platform }
  )
  return deps.child.finishLikeChild(end, { stderr: context.stderr, name: 'codex', platform: deps.platform })
}

/**
 * The `CODEX_HOME` change for the child. An extra login gets its prepared home. `codex:default`
 * keeps the inherited `CODEX_HOME`, unless that is an extra login's home kurmis set for an
 * outer `kurmis codex` session (this one was started from a shell inside it), which would put
 * this session on the outer one's login.
 */
export function codexHomePatch(prepared: PreparedCodexHome, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): EnvPatch {
  if (prepared.codexHome !== null) return { CODEX_HOME: prepared.codexHome }
  const windows = platform === 'win32'
  const inherited = windows
    ? Object.entries(env).find(([name]) => name.toUpperCase() === 'CODEX_HOME')?.[1]
    : env.CODEX_HOME
  return isKurmisCodexHome(inherited, providerFolder('codex'), windows) ? { CODEX_HOME: undefined } : {}
}

/**
 * The login the daemon's usage ranks first. Asks for a probe of logins whose usage is missing
 * or old and waits for it at most `probeWaitMs`. When the daemon cannot be reached, the
 * machine's own login. Prints a note on stderr when the choice is not the plain ranked one.
 */
async function chooseLogin(context: CliContext, deps: CodexDeps): Promise<string> {
  let status: StatusAnswer
  try {
    const connection = await deps.daemon.ensureDaemon({ env: context.env })
    status = await deps.daemon.readStatus(connection)
    const stale = codexLoginsToProbe(status, deps.now())
    if (stale.length > 0) {
      const probed = await settleWithin((signal) => deps.daemon.requestProbe(connection, stale, signal), deps.probeWaitMs)
      if (probed.kind === 'done') {
        status = probed.value
      } else {
        const why = probed.kind === 'timeout'
          ? `did not finish within ${String(deps.probeWaitMs / 1000)} s`
          : `failed (${messageOf(probed.error)})`
        writeLine(context.stderr, `kurmis codex: the usage probe ${why}; choosing with the usage read before.`)
      }
    }
  } catch (error) {
    writeLine(context.stderr,
      `kurmis codex: the kurmis daemon could not be reached (${messageOf(error)}); starting on ${CODEX_DEFAULT_ACCOUNT_ID}.`)
    return CODEX_DEFAULT_ACCOUNT_ID
  }
  const choice = chooseCodexLogin(status, deps.now())
  if (choice.note !== null) {
    writeLine(context.stderr, `kurmis codex: ${choice.note}`)
  } else if (status.logins.filter((row) => row.provider === 'codex').length > 1) {
    writeLine(context.stderr, `kurmis codex: starting on ${choice.login}.`)
  }
  return choice.login
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
