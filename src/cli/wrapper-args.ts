// How `kurmis claude …` and `kurmis codex …` split their arguments into kurmis' own options
// and the arguments passed on to the CLI.
//
// Kurmis reads its options from the front of the list and stops at the first argument it
// does not know; that argument and everything after it go to the CLI unchanged. `--` also
// stops it and is itself dropped, so `kurmis claude -- --help` passes `--help` to claude.
//
//   kurmis claude --login work -p "hi"   -> login claude:work, claude gets: -p hi
//   kurmis claude -p --login work        -> Auto, claude gets: -p --login work
//   kurmis claude --help                 -> kurmis' help for `kurmis claude`
//   kurmis claude -- --help              -> claude gets: --help
import { isHelpFlag } from './command.ts'
import { loginId, parseLoginId, type LoginId, type LoginProvider } from '../data/login-id.ts'

export interface WrapperArgs {
  /** `--help` or `-h` came before the first passed-on argument. */
  help: boolean
  /** The login named with `--login`, or null for Auto (Claude) or the ranked pick (Codex). */
  login: LoginId | null
  /** The arguments for the CLI, unchanged. */
  passThrough: string[]
}

/**
 * Parses the arguments of `kurmis claude` or `kurmis codex`. `--login` takes a full id
 * (`claude:work`) or only the name (`work`), which gets the command's provider. Returns the
 * parsed arguments, or an error message for a missing, invalid or repeated `--login`, or one
 * that names the other provider's login.
 */
export function parseWrapperArgs(provider: LoginProvider, args: readonly string[]): WrapperArgs | { error: string } {
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
      if (value === undefined) return { error: '--login needs a login id, for example --login work' }
      index += 2
    } else if (arg.startsWith('--login=')) {
      value = arg.slice('--login='.length)
      index++
    } else {
      break
    }
    if (result.login !== null) return { error: '--login was given twice' }
    const login = resolveLogin(provider, value)
    if (typeof login === 'object') return login
    result.login = login
  }
  result.passThrough = args.slice(index)
  return result
}

function resolveLogin(provider: LoginProvider, value: string): LoginId | { error: string } {
  const parsed = parseLoginId(value)
  if (parsed !== null) {
    if (parsed.provider !== provider) return { error: `${value} is a ${parsed.provider} login, not a ${provider} one` }
    return parsed.id
  }
  if (value.includes(':')) return { error: `"${value}" is not a login id` }
  try {
    return loginId(provider, value)
  } catch {
    return { error: `"${value}" is not a login name` }
  }
}
