// How `kurmis claude …` and `kurmis codex …` split their arguments into kurmis' own options
// and the arguments passed on to the CLI.
//
// Kurmis reads its options from the front of the list and stops at the first argument it
// does not know; that argument and everything after it go to the CLI unchanged. `--` also
// stops it and is itself dropped, so `kurmis claude -- --help` passes `--help` to claude.
//
//   kurmis claude --login work-example -p "hi"   -> the login work-example, claude gets: -p hi
//   kurmis claude -p --login work-example        -> Auto, claude gets: -p --login work-example
//   kurmis claude --help                         -> kurmis' help for `kurmis claude`
//   kurmis claude -- --help                      -> claude gets: --help
//
// The text given to `--login` is returned as it was typed. The command looks it up in
// config.json (`resolveLogin`), among its own provider's logins only.
import { isHelpFlag } from './command.ts'

export interface WrapperArgs {
  /** `--help` or `-h` came before the first passed-on argument. */
  help: boolean
  /**
   * What `--login` was given: an alias, an id, or either with `claude:` or `codex:` in front.
   * Null for Auto (Claude) or the ranked pick (Codex).
   */
  login: string | null
  /** The arguments for the CLI, unchanged. */
  passThrough: string[]
}

/**
 * Parses the arguments of `kurmis claude` or `kurmis codex`. Returns the parsed arguments, or
 * an error message for a missing, empty or repeated `--login`.
 */
export function parseWrapperArgs(args: readonly string[]): WrapperArgs | { error: string } {
  const result: WrapperArgs = { help: false, login: null, passThrough: [] }
  let index = 0
  while (index < args.length) {
    const arg = args[index] as string
    if (arg === '--') {
      index++
      break
    }
    if (isHelpFlag(arg)) {
      result.help = true
      index++
      continue
    }
    let value: string | undefined
    if (arg === '--login') {
      value = args[index + 1]
      index += 2
    } else if (arg.startsWith('--login=')) {
      value = arg.slice('--login='.length)
      index++
    } else {
      break
    }
    if (value === undefined || value === '') return { error: '--login needs the alias or id of a login, for example --login work-example' }
    if (result.login !== null) return { error: '--login was given twice' }
    result.login = value
  }
  result.passThrough = args.slice(index)
  return result
}
