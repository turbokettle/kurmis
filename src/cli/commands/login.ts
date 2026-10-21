import { notImplemented, parseCommandArgs, type Command } from '../command.ts'

export const loginCommand: Command = {
  name: 'login',
  summary: 'Sign in a new login, or sign an existing one in again',
  usage: `Usage: kurmis login <id>

Signs in the login <id>, which is claude:<name> or codex:<name>. A new login is added with
routing on and both limits at 100%. The name is 1 to 32 lowercase letters, digits, "-" or "_".

Options:
  -h, --help   Show this help.`,
  run(args, context) {
    const parsed = parseCommandArgs('login', args, {}, context, true)
    if (typeof parsed === 'number') return parsed
    return notImplemented('login', context)
  }
}
