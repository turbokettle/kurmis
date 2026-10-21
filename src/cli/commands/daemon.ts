import { notImplemented, parseCommandArgs, usageError, type CliContext, type Command } from '../command.ts'

/** The daemon's subcommands. Each is filled in on its own. */
const SUBCOMMANDS: Record<string, (args: string[], context: CliContext) => Promise<number> | number> = {
  start: (args, context) => noOptions('daemon start', args, context),
  stop: (args, context) => noOptions('daemon stop', args, context),
  status: (args, context) => {
    const parsed = parseCommandArgs('daemon status', args, { json: { type: 'boolean' } }, context)
    return typeof parsed === 'number' ? parsed : notImplemented('daemon status', context)
  },
  run: (args, context) => noOptions('daemon run', args, context)
}

function noOptions(name: string, args: string[], context: CliContext): number {
  const parsed = parseCommandArgs(name, args, {}, context)
  return typeof parsed === 'number' ? parsed : notImplemented(name, context)
}

export const daemonCommand: Command = {
  name: 'daemon',
  summary: 'Start, stop or show the background process',
  usage: `Usage: kurmis daemon <start|stop|status|run>

The daemon is the background process that routes Claude requests. "kurmis claude" starts it
when it is not running, so it seldom needs starting by hand.

  start            Start it in the background, replacing one of an older version.
  stop             Stop it after it finishes the requests it has open.
  status [--json]  Show whether it runs, its pid, port and version.
  run              Run it in this terminal instead of the background (what "start" launches).

Options:
  -h, --help       Show this help.`,
  run(args, context) {
    const [subcommand, ...rest] = args
    if (subcommand === undefined) return usageError('daemon', 'needs one of start, stop, status, run', context)
    const handler = Object.hasOwn(SUBCOMMANDS, subcommand) ? SUBCOMMANDS[subcommand] : undefined
    if (handler === undefined) return usageError('daemon', `unknown subcommand "${subcommand}"`, context)
    return handler(rest, context)
  }
}
