// Picks the command from the first argument and runs it. `--version`, `--help` and
// `help <command>` are handled here, since they are about kurmis itself.
import { kurmisVersion } from '../version.ts'
import { EXIT_OK, EXIT_USAGE, isHelpFlag, writeLine, type CliContext } from './command.ts'
import { COMMANDS, findCommand } from './commands/index.ts'

export function mainHelp(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length))
  const lines = COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`)
  return `kurmis ${kurmisVersion}: use several Claude Code and Codex logins on one machine.

Usage: kurmis <command> [options]

Commands:
${lines.join('\n')}
  ${'help'.padEnd(width)}  Show the help of a command

Options:
  -h, --help     Show this help, or a command's help after its name.
  --version      Print the version.

Run "kurmis help <command>" for the options of a command.`
}

/** Runs kurmis with the arguments after the program name. Returns the exit code. */
export async function runCli(argv: readonly string[], context: CliContext): Promise<number> {
  const [first, ...rest] = argv
  if (first === undefined || isHelpFlag(first)) {
    writeLine(context.stdout, mainHelp())
    return EXIT_OK
  }
  if (first === '--version') {
    writeLine(context.stdout, kurmisVersion)
    return EXIT_OK
  }
  if (first === 'help') return help(rest, context)

  const command = findCommand(first)
  if (command === undefined) {
    writeLine(context.stderr, first.startsWith('-') ? `kurmis: unknown option "${first}"` : `kurmis: unknown command "${first}"`)
    writeLine(context.stderr)
    writeLine(context.stderr, mainHelp())
    return EXIT_USAGE
  }
  if (command.passesArguments !== true) {
    const beforeDashes = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest
    if (beforeDashes.some(isHelpFlag)) {
      writeLine(context.stdout, command.usage)
      return EXIT_OK
    }
  }
  return await command.run(rest, context)
}

function help(args: readonly string[], context: CliContext): number {
  const [name, ...extra] = args
  if (name === undefined) {
    writeLine(context.stdout, mainHelp())
    return EXIT_OK
  }
  const command = findCommand(name)
  if (command === undefined || extra.length > 0) {
    writeLine(context.stderr, command === undefined ? `kurmis help: unknown command "${name}"` : 'kurmis help: takes one command name')
    writeLine(context.stderr)
    writeLine(context.stderr, mainHelp())
    return EXIT_USAGE
  }
  writeLine(context.stdout, command.usage)
  return EXIT_OK
}
