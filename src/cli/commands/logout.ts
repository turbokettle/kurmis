import { notImplemented, parseCommandArgs, type Command } from '../command.ts'

export const logoutCommand: Command = {
  name: 'logout',
  summary: 'Remove a login and its credentials',
  usage: `Usage: kurmis logout <id>

Removes the login <id> and its credentials from kurmis. The machine's own logins,
claude:default and codex:default, cannot be removed.

Options:
  -h, --help   Show this help.`,
  run(args, context) {
    const parsed = parseCommandArgs('logout', args, {}, context, true)
    if (typeof parsed === 'number') return parsed
    return notImplemented('logout', context)
  }
}
