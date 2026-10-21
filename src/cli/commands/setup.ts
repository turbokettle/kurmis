import { notImplemented, parseCommandArgs, type Command } from '../command.ts'

export const setupCommand: Command = {
  name: 'setup',
  summary: 'Route every Claude Code on this machine through kurmis',
  usage: `Usage: kurmis setup [--undo]

Puts kurmis' routing settings in the env block of ~/.claude/settings.json, so a plain "claude"
and the IDE extensions are routed too, and makes the daemon start when you log in.

Options:
  --undo       Remove both again.
  -h, --help   Show this help.`,
  run(args, context) {
    const parsed = parseCommandArgs('setup', args, { undo: { type: 'boolean' } }, context)
    if (typeof parsed === 'number') return parsed
    return notImplemented('setup', context)
  }
}
