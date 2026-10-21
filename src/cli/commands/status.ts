import { notImplemented, parseCommandArgs, type Command } from '../command.ts'

export const statusCommand: Command = {
  name: 'status',
  summary: "Show each login's usage",
  usage: `Usage: kurmis status [--json]

Shows each login's five-hour and weekly usage, its limits, and whether routing can use it now.

Options:
  --json       Print the same as JSON.
  -h, --help   Show this help.`,
  run(args, context) {
    const parsed = parseCommandArgs('status', args, { json: { type: 'boolean' } }, context)
    if (typeof parsed === 'number') return parsed
    return notImplemented('status', context)
  }
}
