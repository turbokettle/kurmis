import { EXIT_OK, notImplemented, usageError, writeLine, type Command } from '../command.ts'
import { parseWrapperArgs } from '../wrapper-args.ts'

export const claudeCommand: Command = {
  name: 'claude',
  summary: 'Start Claude Code routed through the kurmis daemon',
  usage: `Usage: kurmis claude [--login <id>] [--] [claude arguments...]

Starts Claude Code with the terminal attached. Its requests go through the kurmis daemon,
which signs each one with a login that has room, and the command exits with claude's exit code.
The daemon is started first when it is not running.

Options (only before the first argument kurmis does not know):
  --login <id>   Keep the session on one login, whatever its limits say. <id> is claude:<name>
                 or just <name>. Without it the session is on Auto.
  -h, --help     Show this help.
  --             Pass everything after it to claude, even arguments kurmis knows.

Everything from the first argument kurmis does not know is passed to claude unchanged.
"kurmis claude -- --help" shows claude's own help.`,
  passesArguments: true,
  run(args, context) {
    const parsed = parseWrapperArgs('claude', args)
    if ('error' in parsed) return usageError('claude', parsed.error, context)
    if (parsed.help) {
      writeLine(context.stdout, claudeCommand.usage)
      return EXIT_OK
    }
    return notImplemented('claude', context)
  }
}
