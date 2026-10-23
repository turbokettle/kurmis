// The shape every `kurmis <command>` module has, and the helpers they share.
import { parseArgs, type ParseArgsConfig } from 'node:util'

/** Where a command writes. `process.stdout` and `process.stderr` fit; tests pass collectors. */
export interface Output {
  write(text: string): unknown
}

export interface CliContext {
  stdout: Output
  stderr: Output
  env: NodeJS.ProcessEnv
}

export interface Command {
  name: string
  /** One line for the command list in `kurmis --help`. */
  summary: string
  /** The full help text, printed by `kurmis <name> --help` and `kurmis help <name>`. */
  usage: string
  /**
   * True for `claude`, which passes all its arguments on to claude, `--help` included. For every
   * other command, `--help` or `-h` anywhere prints `usage`.
   */
  passesArguments?: boolean
  /**
   * Runs the command. The arguments are the ones after the command name. `login` is what
   * `--login` before the command gave, which only `claude` takes. Returns the exit code.
   */
  run(args: string[], context: CliContext, login?: string | null): Promise<number> | number
}

/** Exit codes. */
export const EXIT_OK = 0
export const EXIT_FAILURE = 1
/** The command line was wrong: an unknown command, option or argument. */
export const EXIT_USAGE = 2

/** The words that mark the login plain claude uses, in what the commands print. */
export const PLAIN_CLAUDE_LOGIN = 'the login plain claude uses'

export function writeLine(output: Output, text = ''): void {
  output.write(`${text}\n`)
}

/** Prints `kurmis <command>: <message>` and a pointer to the help; returns `EXIT_USAGE`. */
export function usageError(command: string, message: string, context: CliContext): number {
  writeLine(context.stderr, `kurmis ${command}: ${message}`)
  writeLine(context.stderr, `Run "kurmis help ${command}" for its options.`)
  return EXIT_USAGE
}

export function isHelpFlag(arg: string): boolean {
  return arg === '--help' || arg === '-h'
}

type Options = NonNullable<ParseArgsConfig['options']>

/**
 * `node:util` `parseArgs` in strict mode, with its error turned into a usage error. Returns
 * the parsed values, or an exit code when the arguments were wrong.
 */
export function parseCommandArgs<T extends Options>(
  command: string,
  args: string[],
  options: T,
  context: CliContext,
  allowPositionals = false
): { values: ReturnType<typeof parseArgs<{ options: T; allowPositionals: boolean }>>['values']; positionals: string[] } | number {
  try {
    const parsed = parseArgs({ args, options, allowPositionals, strict: true })
    return { values: parsed.values, positionals: parsed.positionals }
  } catch (error) {
    return usageError(command, error instanceof Error ? error.message : String(error), context)
  }
}
