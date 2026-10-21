// `kurmis status [--json]`: each login's usage, limits and whether routing can use it, as the
// daemon sees it. The daemon is started first when it is not running.
import type { StatusAnswer } from '../../core/control-api.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, settleWithin, type DaemonClient } from '../command-deps.ts'
import { formatStatus, statusJson } from '../status-format.ts'

/**
 * How long `kurmis status` waits for the first usage probe of a daemon that has read no usage
 * yet. Claude probes start one short-lived `claude` per login, and they run side by side.
 */
export const STATUS_PROBE_WAIT_MS = 15_000

export interface StatusDeps {
  daemon: DaemonClient
  now: () => number
  platform: NodeJS.Platform
  probeWaitMs: number
}

const USAGE = `Usage: kurmis status [--json]

Shows each login's five-hour and weekly usage, its limits, and whether routing can use it now.
The daemon is started first when it is not running.

Each login is shown by its alias, with its provider, its id and the account's email when the
daemon knows it. The login plain claude uses and the login plain codex uses are marked: they
are the accounts a plain "claude" and a plain "codex" are signed in to. When an extra Claude
login is the same account as the login plain claude uses, a warning says so, because both then
use one subscription. The same goes for Codex.

Options:
  --json       Print the same as JSON. Each login has "alias", "id", "provider" and
               "machineOwn"; "warnings" holds the warnings.
  -h, --help   Show this help.`

export function createStatusCommand(overrides: Partial<StatusDeps> = {}): Command {
  const deps: StatusDeps = {
    daemon: realDaemonClient,
    now: Date.now,
    platform: process.platform,
    probeWaitMs: STATUS_PROBE_WAIT_MS,
    ...overrides
  }
  return {
    name: 'status',
    summary: "Show each login's usage",
    usage: USAGE,
    run: (args, context) => runStatus(args, context, deps)
  }
}

export const statusCommand: Command = createStatusCommand()

/** Whether no login that may be signed in has any usage yet, so a first probe is worth waiting for. */
export function nothingProbedYet(status: StatusAnswer): boolean {
  const signedIn = status.logins.filter((login) => login.signedIn !== false)
  return signedIn.length > 0 && signedIn.every((login) => login.usage === null)
}

async function runStatus(args: string[], context: CliContext, deps: StatusDeps): Promise<number> {
  const parsed = parseCommandArgs('status', args, { json: { type: 'boolean' } }, context)
  if (typeof parsed === 'number') return parsed
  let status: StatusAnswer
  try {
    const connection = await deps.daemon.ensureDaemon({ env: context.env })
    status = await deps.daemon.readStatus(connection)
    if (nothingProbedYet(status)) {
      const probed = await settleWithin((signal) => deps.daemon.requestProbe(connection, undefined, signal), deps.probeWaitMs)
      if (probed.kind === 'done') {
        status = probed.value
      } else {
        writeLine(context.stderr, probed.kind === 'timeout'
          ? `kurmis status: the first usage probe did not finish within ${String(deps.probeWaitMs / 1000)} s; showing what the daemon has.`
          : `kurmis status: the usage probe failed (${messageOf(probed.error)}); showing what the daemon has.`)
      }
    }
  } catch (error) {
    writeLine(context.stderr, `kurmis status: the kurmis daemon could not be reached: ${messageOf(error)}`)
    writeLine(context.stderr, 'Its log is daemon.log in the kurmis data folder; "kurmis daemon start" starts it.')
    return EXIT_FAILURE
  }
  const now = deps.now()
  const options = { keychain: deps.platform === 'darwin' }
  if (parsed.values.json === true) {
    writeLine(context.stdout, JSON.stringify(statusJson(status, now, options), null, 2))
  } else {
    context.stdout.write(formatStatus(status, now, options))
  }
  return EXIT_OK
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
