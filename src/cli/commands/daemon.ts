// `kurmis daemon start|stop|restart|status|run`.
import { runDaemon } from '../../daemon/main.ts'
import { kurmisVersion } from '../../version.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { DAEMON_JOB_VARIABLES } from '../../platform/launchd.ts'
import {
  DaemonError,
  findDaemon,
  keyRefusedProblem,
  readStatus,
  restartDaemon,
  silentDaemon,
  startDaemon,
  stopDaemon,
  type DaemonClientOptions,
  type StartResult
} from '../daemon-client.ts'
import { CONTROL_API_VERSION } from '../../core/control-api.ts'
import { daemonAge, versionText } from '../../daemon/lifecycle.ts'

type Handler = (args: string[], context: CliContext) => Promise<number> | number

/** After `daemon run` has finished, the process exits within this even if something still holds it open. */
const RUN_EXIT_FALLBACK_MS = 2_000

function clientOptions(context: CliContext): DaemonClientOptions {
  return { env: context.env }
}

/** Prints a `DaemonError` as a sentence; anything else is rethrown. */
function failed(error: unknown, context: CliContext): number {
  if (!(error instanceof DaemonError)) throw error
  writeLine(context.stderr, `kurmis daemon: ${error.message}`)
  return EXIT_FAILURE
}

function address(port: number): string {
  return `127.0.0.1:${String(port)}`
}

function describeStart(result: StartResult): string {
  const { connection } = result
  const where = `on ${address(connection.port)} (pid ${String(connection.pid)})`
  if (!result.started) {
    // A newer daemon that this kurmis cannot use is an error of `startDaemon`.
    const newer = daemonAge(connection, kurmisVersion) === 'newer'
    return newer
      ? `A newer kurmis daemon (${versionText(connection.version, connection.apiVersion)}) already runs ${where}; ` +
        `this kurmis is ${versionText(kurmisVersion, CONTROL_API_VERSION)}, and can use it.`
      : `The kurmis daemon ${connection.version} already runs ${where}.`
  }
  const replaced = result.replaced === null ? '' : `, replacing version ${result.replaced}, which stops once its open requests finish`
  return `Started the kurmis daemon ${connection.version} ${where}${replaced}.`
}

const start: Handler = async (args, context) => {
  const parsed = parseCommandArgs('daemon start', args, { env: { type: 'string', multiple: true } }, context)
  if (typeof parsed === 'number') return parsed
  const assignments = daemonStartAssignments(parsed.values.env ?? [])
  if (typeof assignments === 'string') return usageError('daemon start', assignments, context)
  // The Windows logon script passes the variables this way, since a program started at logon
  // gets only the user's environment. The data folder's paths are read from `process.env`
  // (`src/data/paths.ts`), and the daemon this starts gets the variables through `context.env`.
  for (const [name, value] of Object.entries(assignments)) process.env[name] = value
  const startContext = { ...context, env: { ...context.env, ...assignments } }
  try {
    writeLine(context.stdout, describeStart(await startDaemon(clientOptions(startContext))))
    return EXIT_OK
  } catch (error) {
    return failed(error, context)
  }
}

const restart: Handler = async (args, context) => {
  const parsed = parseCommandArgs('daemon restart', args, {}, context)
  if (typeof parsed === 'number') return parsed
  try {
    writeLine(context.stdout, describeStart(await restartDaemon(clientOptions(context))))
    return EXIT_OK
  } catch (error) {
    return failed(error, context)
  }
}

const stop: Handler = async (args, context) => {
  const parsed = parseCommandArgs('daemon stop', args, { now: { type: 'boolean' } }, context)
  if (typeof parsed === 'number') return parsed
  const now = parsed.values.now === true
  try {
    const found = await findDaemon(clientOptions(context))
    if (found === null) {
      const problem = await keyRefusedProblem(clientOptions(context))
      if (problem !== null) throw new DaemonError(problem)
    }
    if (found === null || !(await stopDaemon({ ...clientOptions(context), now }))) {
      writeLine(context.stdout, 'The kurmis daemon is not running.')
      const silent = found === null ? silentDaemon() : null
      if (silent !== null) {
        writeLine(context.stdout, `Process ${String(silent.pid)}, named in daemon.json, does not answer on ${address(silent.port)}, so ` +
          'it was not asked to stop. It may be finishing its open requests before it stops.')
      }
    } else {
      writeLine(context.stdout, now
        ? `Stopped the kurmis daemon (pid ${String(found.pid)}) without waiting for its open requests.`
        : `Stopped the kurmis daemon (pid ${String(found.pid)}).`)
    }
    return EXIT_OK
  } catch (error) {
    return failed(error, context)
  }
}

const status: Handler = async (args, context) => {
  const parsed = parseCommandArgs('daemon status', args, { json: { type: 'boolean' } }, context)
  if (typeof parsed === 'number') return parsed
  const json = parsed.values.json === true
  try {
    const found = await findDaemon(clientOptions(context))
    if (found === null) {
      const silent = silentDaemon()
      const refused = silent === null ? null : await keyRefusedProblem(clientOptions(context))
      if (json) {
        writeLine(context.stdout, JSON.stringify({
          running: false,
          cliVersion: kurmisVersion,
          ...(silent === null ? {} : { notAnswering: silent }),
          ...(refused === null ? {} : { keyRefused: refused })
        }, null, 2))
      } else {
        writeLine(context.stdout, 'The kurmis daemon is not running.')
        if (refused !== null) {
          writeLine(context.stdout, refused)
        } else if (silent !== null) {
          writeLine(context.stdout, `Process ${String(silent.pid)}, named in daemon.json, does not answer on ${address(silent.port)}. ` +
            'It may be finishing its open requests before it stops.')
        }
      }
      return EXIT_FAILURE
    }
    const answer = await readStatus(found)
    if (json) {
      writeLine(context.stdout, JSON.stringify({
        running: true,
        pid: answer.pid,
        port: answer.port,
        version: answer.version,
        apiVersion: answer.apiVersion,
        startedAt: answer.startedAt,
        logins: answer.logins.length,
        cliVersion: kurmisVersion
      }, null, 2))
      return EXIT_OK
    }
    writeLine(context.stdout, `The kurmis daemon ${answer.version} runs on ${address(answer.port)}, pid ${String(answer.pid)}, ` +
      `since ${new Date(answer.startedAt).toISOString()}, with ${String(answer.logins.length)} ${answer.logins.length === 1 ? 'login' : 'logins'}.`)
    const age = daemonAge(answer, kurmisVersion)
    const versions = `The daemon is ${versionText(answer.version, answer.apiVersion)}, this kurmis is ` +
      `${versionText(kurmisVersion, CONTROL_API_VERSION)}.`
    const sameApi = answer.apiVersion === CONTROL_API_VERSION
    if (age === 'older') {
      writeLine(context.stdout, `${versions} The daemon is older, so the next "kurmis claude", "kurmis setup" or ` +
        '"kurmis daemon start" replaces it.')
    } else if (age === 'newer') {
      writeLine(context.stdout, sameApi
        ? `${versions} The daemon is newer; this kurmis can use it and does not replace it.`
        : `${versions} The daemon is newer, so this kurmis does not replace it, and it cannot use a daemon of another ` +
          'control API version. Update this kurmis, or stop the daemon with "kurmis daemon stop" and run the command again.')
    } else if (age === 'unknown' && !sameApi) {
      writeLine(context.stdout, `${versions} The versions cannot be compared, so this kurmis does not replace the daemon, ` +
        'and it cannot use a daemon of another control API version. Stop the daemon with "kurmis daemon stop" and run ' +
        'the command again.')
    }
    return EXIT_OK
  } catch (error) {
    return failed(error, context)
  }
}

/**
 * The `--env NAME=VALUE` assignments of `daemon start`, as variables, or a sentence saying what
 * is wrong. Only the kurmis variables a login item carries (`DAEMON_JOB_VARIABLES`) may be set.
 */
export function daemonStartAssignments(values: readonly string[]): Record<string, string> | string {
  const out: Record<string, string> = {}
  for (const value of values) {
    const at = value.indexOf('=')
    const name = at === -1 ? value : value.slice(0, at)
    if (at === -1 || !DAEMON_JOB_VARIABLES.includes(name)) {
      return `--env takes NAME=VALUE with NAME one of ${DAEMON_JOB_VARIABLES.join(', ')}, not "${name}"`
    }
    out[name] = value.slice(at + 1)
  }
  return out
}

const run: Handler = async (args, context) => {
  const parsed = parseCommandArgs('daemon run', args, {}, context)
  if (typeof parsed === 'number') return parsed
  const code = await runDaemon({ env: context.env, stdout: context.stdout, stderr: context.stderr })
  // A timer or socket left open by mistake must not keep a stopped daemon around.
  setTimeout(() => process.exit(code), RUN_EXIT_FALLBACK_MS).unref()
  return code
}

const SUBCOMMANDS: Record<string, Handler> = { start, stop, restart, status, run }

export const daemonCommand: Command = {
  name: 'daemon',
  summary: 'Start, stop or show the background process',
  usage: `Usage: kurmis daemon <start|stop|restart|status|run>

The daemon is the background process that routes Claude requests. "kurmis claude" and
"kurmis setup" start it when it is not running, so "kurmis daemon start" is seldom
needed.

  start                   Start it in the background. An older daemon is replaced, a newer
                          one is kept.
  stop [--now]            Stop it after it finishes its open requests, waiting at most 30
                          seconds. With --now it stops at once, and open Claude sessions
                          retry the requests it cut.
  restart                 Start a new one now; the old one finishes its open requests first.
  status [--json]         Show whether it runs, its pid, port and version. Exits 1 when it
                          does not run.
  run                     Run it in this terminal instead of the background.

On macOS, a daemon started from an ssh login cannot read the login Keychain. Run
"kurmis setup" in a terminal at the screen: the daemon then runs in your desktop session,
starts again at each login, and ssh sessions use it.

Options:
  -h, --help              Show this help.`,
  run(args, context) {
    const [subcommand, ...rest] = args
    if (subcommand === undefined) return usageError('daemon', 'needs one of start, stop, restart, status, run', context)
    const handler = Object.hasOwn(SUBCOMMANDS, subcommand) ? SUBCOMMANDS[subcommand] : undefined
    if (handler === undefined) return usageError('daemon', `unknown subcommand "${subcommand}"`, context)
    return handler(rest, context)
  }
}
