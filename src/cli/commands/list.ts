// `kurmis list [--json]`: the logins in config.json with their settings, and whether each has
// credentials on this machine. It reads files only and never needs the daemon.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_DEFAULT_ACCOUNT_ID, CODEX_DEFAULT_ACCOUNT_ID } from '../../core/accounts.ts'
import { ConfigError, loadConfig, type LoginSettings } from '../../data/config.ts'
import { CLAUDE_PROFILE_FILE, parseClaudeIdentity } from '../../data/identity.ts'
import { loginFolder } from '../../data/paths.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, writeLine, type Command } from '../command.ts'

export interface ListDeps {
  /** The user's home folder, where `~/.claude`, `~/.claude.json` and `~/.codex` are. */
  home: () => string
}

/** Whether the `.claude.json` at `file` names an account. A missing or unreadable file names none. */
function namesAccount(file: string): boolean {
  try {
    return parseClaudeIdentity(readFileSync(file, 'utf8')) !== null
  } catch {
    return false
  }
}

/**
 * Whether a login has credentials on this machine, from files only, without reading a secret:
 *
 * - an extra Claude login: its folder holds `.credentials.json`, or a `.claude.json` that names
 *   an account. On macOS the secret is in the Keychain, which is not read here, so the account
 *   in `.claude.json` (written by `claude auth login`) is the sign there.
 * - `claude:default`: `~/.claude/.credentials.json`, or an account in `~/.claude.json`.
 * - Codex: `auth.json` exists in the login's folder, or in `$CODEX_HOME` (else `~/.codex`) for
 *   `codex:default`. Only its existence is checked.
 */
export function hasLocalCredentials(id: string, env: NodeJS.ProcessEnv, home: string): boolean {
  if (id === CLAUDE_DEFAULT_ACCOUNT_ID) {
    return existsSync(join(home, '.claude', '.credentials.json')) || namesAccount(join(home, CLAUDE_PROFILE_FILE))
  }
  if (id === CODEX_DEFAULT_ACCOUNT_ID) {
    const codexHome = env.CODEX_HOME !== undefined && env.CODEX_HOME !== '' ? env.CODEX_HOME : join(home, '.codex')
    return existsSync(join(codexHome, 'auth.json'))
  }
  const folder = loginFolder(id)
  if (id.startsWith('codex:')) return existsSync(join(folder, 'auth.json'))
  return existsSync(join(folder, '.credentials.json')) || namesAccount(join(folder, CLAUDE_PROFILE_FILE))
}

/** A login as `kurmis list --json` prints it: its settings and `credentials`. */
export type ListedLogin = LoginSettings & { credentials: boolean }

/** The headers of the setting columns are the names of `kurmis set`'s options. */
const HEADER = ['ID', 'LABEL', 'AUTO', 'FIVE-HOUR', 'WEEKLY', 'USE-FIRST', 'CREDENTIALS']

/** The logins as a table with a header row, columns padded to their widest cell. */
export function formatLoginTable(logins: readonly ListedLogin[]): string {
  const rows = [
    HEADER,
    ...logins.map((login) => [
      login.id,
      login.label,
      login.routing ? 'on' : 'off',
      `${String(login.fiveHourLimit)}%`,
      `${String(login.weeklyLimit)}%`,
      login.useFirst ? 'on' : 'off',
      login.credentials ? 'yes' : 'no'
    ])
  ]
  const widths = HEADER.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)))
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd()).join('\n')
}

export function createListCommand(deps: Partial<ListDeps> = {}): Command {
  const home = deps.home ?? homedir
  return {
    name: 'list',
    summary: 'List the logins and their routing settings',
    usage: `Usage: kurmis list [--json]

Lists every login kurmis knows, the machine's own claude:default and codex:default first, with
its settings and whether it has credentials on this machine. Change the settings with
"kurmis set". The columns:

  AUTO          Whether Auto routing may use the login (set --auto).
  FIVE-HOUR     Auto routing stops using the login once its five-hour window reaches this
                (set --five-hour).
  WEEKLY        The same for the weekly window (set --weekly).
  USE-FIRST     Whether Auto routing takes this login before the others that have room
                (set --use-first).
  CREDENTIALS   Whether the login's credentials are on this machine. This only looks at files;
                "kurmis status" asks the daemon whether they still work.

Options:
  --json       Print the logins as JSON, with a "credentials" field for the last column.
  -h, --help   Show this help.`,
    run(args, context) {
      const parsed = parseCommandArgs('list', args, { json: { type: 'boolean' } }, context)
      if (typeof parsed === 'number') return parsed
      let logins: LoginSettings[]
      try {
        logins = loadConfig().logins
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error
        writeLine(context.stderr, `kurmis list: ${error.message}`)
        return EXIT_FAILURE
      }
      const listed = logins.map((login) => ({ ...login, credentials: hasLocalCredentials(login.id, context.env, home()) }))
      writeLine(context.stdout, parsed.values.json === true ? JSON.stringify(listed, null, 2) : formatLoginTable(listed))
      return EXIT_OK
    }
  }
}

export const listCommand = createListCommand()
