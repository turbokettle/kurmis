import { EXIT_OK, notImplemented, usageError, writeLine, type Command } from '../command.ts'
import { parseWrapperArgs } from '../wrapper-args.ts'

export const codexCommand: Command = {
  name: 'codex',
  summary: 'Start Codex on a login that has room',
  usage: `Usage: kurmis codex [--login <id>] [--] [codex arguments...]

Starts Codex with the terminal attached, on the login that ranks first (the same order Claude's
Auto uses) or on the one named, and exits with codex's exit code.

Options (only before the first argument kurmis does not know):
  --login <id>   Start on this login. <id> is codex:<name> or just <name>.
  -h, --help     Show this help.
  --             Pass everything after it to codex, even arguments kurmis knows.

Everything from the first argument kurmis does not know is passed to codex unchanged.
"kurmis codex -- --help" shows codex's own help.`,
  passesArguments: true,
  run(args, context) {
    const parsed = parseWrapperArgs('codex', args)
    if ('error' in parsed) return usageError('codex', parsed.error, context)
    if (parsed.help) {
      writeLine(context.stdout, codexCommand.usage)
      return EXIT_OK
    }
    return notImplemented('codex', context)
  }
}
