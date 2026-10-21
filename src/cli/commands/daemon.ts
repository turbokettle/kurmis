// `kurmis daemon start|stop|restart|status|run`.
import { runDaemon } from '../../daemon/main.ts'
import { kurmisVersion } from '../../version.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import {
  DaemonError,
  findDaemon,
  readStatus,
  restartDaemon,
  silentDaemon,
  startDaemon,
  stopDaemon,
  type DaemonClientOptions,
  type StartResult
} from '../daemon-client.ts'
import { compareVersions } from '../../daemon/lifecycle.ts'

type Handler = (args: string[], context: CliContext) => Promise<number> | number

/** After `daemon run` has finished, the process exits within this even if something still holds it open. */
const RUN_EXIT_FALLBACK_MS = 2_000

function clientOptions(context: CliContext, noLaunchd = false): DaemonClientOptions {
  return { env: context.env, noLaunchd, onWarning: (text) => writeLine(context.stderr, `kurmis daemon: ${text}`) }
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
    const newer = compareVersions(connection.version, kurmisVersion) === 1
    return newer
      ? `A newer kurmis daemon (${connection.version}) already runs ${where}; this kurmis is ${kurmisVersion}.`
      : `The kurmis daemon ${connection.version} already runs ${where}.`
  }
  const replaced = result.replaced === null ? '' : `, replacing version ${result.replaced}, which stops once its open requests finish`
  const through = result.method === 'launchd' ? ' through launchd' : result.method === 'wmi' ? ' through WMI' : ''
  return `Started the kurmis daemon ${connection.version}${through} ${where}${replaced}.`
}

const start: Handler = async (args, context) => {
  const parsed = parseCommandArgs('daemon start', args, { 'no-launchd': { type: 'boolean' } }, context)
  if (typeof parsed === 'number') return parsed
  try {
    writeLine(context.stdout, describeStart(await startDaemon(clientOptions(context, parsed.values['no-launchd'] === true))))
    return EXIT_OK
  } catch (error) {
    return failed(error, context)
  }
}

const restart: Handler = async (args, context) => {
  const parsed = parseCommandArgs('daemon restart', args, { 'no-launchd': { type: 'boolean' } }, context)
  if (typeof parsed === 'number') return parsed
  try {
    writeLine(context.stdout, describeStart(await restartDaemon(clientOptions(context, parsed.values['no-launchd'] === true))))
    return EXIT_OK
  } catch (error) {
    return failed(error, context)
  }
}

const stop: Handler = async (args, context) => {
  const parsed = parseCommandArgs('daemon stop', args, {}, context)
  if (typeof parsed === 'number') return parsed
  try {
    const found = await findDaemon(clientOptions(context))
    if (found === null || !(await stopDaemon(clientOptions(context)))) {
      writeLine(context.stdout, 'The kurmis daemon is not running.')
    } else {
      writeLine(context.stdout, `Stopped the kurmis daemon (pid ${String(found.pid)}).`)
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
      if (json) {
        writeLine(context.stdout, JSON.stringify({ running: false, cliVersion: kurmisVersion, ...(silent === null ? {} : { notAnswering: silent }) }, null, 2))
      } else {
        writeLine(context.stdout, 'The kurmis daemon is not running.')
        if (silent !== null) {
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
      `since ${new Date(answer.startedAt).toISOString()}, with ${String(answer.logins.length)} logins.`)
    const order = compareVersions(answer.version, kurmisVersion)
    if (order === -1) writeLine(context.stdout, `This kurmis is ${kurmisVersion}; the next kurmis command replaces the daemon.`)
    if (order === 1) writeLine(context.stdout, `This kurmis is ${kurmisVersion}, older than the daemon.`)
    return EXIT_OK
  } catch (error) {
    return failed(error, context)
  }
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

The daemon is the background process that routes Claude requests. "kurmis claude" starts it
when it is not running, so it seldom needs starting by hand.

  start [--no-launchd]    Start it in the background, replacing one of an older version.
  stop                    Stop it after it finishes the requests it has open. After 30 seconds
                          it is told to stop without waiting for them.
  restart [--no-launchd]  Start a new one now; the old one finishes its open requests first.
  status [--json]         Show whether it runs, its pid, port and version. Exits 1 when it
                          does not run.
  run                     Run it in this terminal instead of the background (what "start"
                          launches).

On macOS, a daemon started from an ssh login could not read the login Keychain, so "start"
asks launchd to start it in your desktop session; --no-launchd starts it directly instead.

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
