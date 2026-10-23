// Picks the command from the first argument and runs it. `--version`, `--help` and
// `help <command>` are handled here, since they are about kurmis itself. `--login` is the only
// option that goes before a command, and only before `claude`: everything after the word
// `claude` belongs to claude, so it needs no `--`, which PowerShell drops when it runs npm's
// `kurmis.ps1`.
import { kurmisVersion } from '../version.ts'
import { EXIT_OK, EXIT_USAGE, isHelpFlag, writeLine, type CliContext } from './command.ts'
import { COMMANDS, findCommand } from './commands/index.ts'

function mainHelp(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length))
  const lines = COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`)
  return `kurmis ${kurmisVersion}: use several Claude Code logins on one machine.

Usage: kurmis <command> [options]
       kurmis [--login <login>] claude [<claude arguments...>]

Commands:
${lines.join('\n')}
  ${'help'.padEnd(width)}  Show the help of a command

Options:
  -h, --help     Show this help, or a command's help after its name (after claude, claude's own help).
  --version      Print the version.

Run "kurmis help <command>" for the options of a command.`
}

/** Runs kurmis with the arguments after the program name. Returns the exit code. */
export async function runCli(argv: readonly string[], context: CliContext): Promise<number> {
  const leading = parseLogin(argv)
  if ('error' in leading) {
    writeLine(context.stderr, `kurmis: ${leading.error}`)
    return EXIT_USAGE
  }
  const [first, ...rest] = leading.rest
  if (leading.login !== null && first !== 'claude') {
    writeLine(context.stderr, 'kurmis: --login goes right before claude, for example "kurmis --login work-example claude"')
    return EXIT_USAGE
  }
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
  return await command.run(rest, context, leading.login)
}

/** Takes `--login <login>` or `--login=<login>` off the front of the arguments. */
function parseLogin(argv: readonly string[]): { login: string | null; rest: readonly string[] } | { error: string } {
  const [first, second] = argv
  let login: string | undefined
  let rest: readonly string[]
  if (first === '--login') {
    login = second
    rest = argv.slice(2)
  } else if (first?.startsWith('--login=') === true) {
    login = first.slice('--login='.length)
    rest = argv.slice(1)
  } else {
    return { login: null, rest: argv }
  }
  if (login === undefined || login === '') {
    return { error: '--login needs the alias or id of a login, for example "kurmis --login work-example claude"' }
  }
  if (rest[0] === '--login' || rest[0]?.startsWith('--login=') === true) return { error: '--login was given twice' }
  return { login, rest }
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
