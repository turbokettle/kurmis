// `kurmis list [--json]`: the logins in config.json with their settings, and whether each has
// credentials on this machine. It never needs the daemon. It reads files, and starts
// `codex login status` only for a Codex login whose `config.toml` keeps the sign-in in the
// system's keyring and that has no `auth.json` (`hasCredentials`).
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { tomlValue } from '../../core/codex-account-config.ts'
import { ConfigError, loadConfig, type LoginSettings } from '../../data/config.ts'
import { CLAUDE_PROFILE_FILE, parseClaudeIdentity } from '../../data/identity.ts'
import { applyEnvPatch, codexLoginEnv } from '../../data/login-env.ts'
import type { LoginRef } from '../../data/login-id.ts'
import { loginFolder } from '../../data/paths.ts'
import { ProgramNotFoundError, windowsEnv, type findProgram } from '../../platform/programs.ts'
import { runProgram } from '../../platform/run.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, writeLine, type Command } from '../command.ts'
import { realFindProgram } from '../command-deps.ts'
import { machineOwnText } from '../login-names.ts'

/** How `codex login status` is found and run (`codexSignedIn`); the fakes in tests. */
export interface CodexStatusDeps {
  findProgram: typeof findProgram
  runProgram: typeof runProgram
}

export interface ListDeps extends CodexStatusDeps {
  /** The user's home folder, where `~/.claude`, `~/.claude.json` and `~/.codex` are. */
  home: () => string
}

/** How long `codex login status` may take. It reads one file or keyring item and contacts no server. */
export const CODEX_LOGIN_STATUS_TIMEOUT_MS = 10_000

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
 * - plain claude's login: `~/.claude/.credentials.json`, or an account in
 *   `~/.claude.json`.
 * - Codex: `auth.json` exists in the login's Codex home (`codexHomeOf`). Only its existence is
 *   checked. A login that keeps its sign-in in the system's keyring has none; `hasCredentials`
 *   asks Codex about that one.
 */
export function hasLocalCredentials(login: LoginRef, env: NodeJS.ProcessEnv, home: string): boolean {
  if (login.provider === 'codex') return existsSync(join(codexHomeOf(login, env, home), 'auth.json'))
  if (login.machineOwn) {
    return existsSync(join(home, '.claude', '.credentials.json')) || namesAccount(join(home, CLAUDE_PROFILE_FILE))
  }
  const folder = loginFolder(login)
  return existsSync(join(folder, '.credentials.json')) || namesAccount(join(folder, CLAUDE_PROFILE_FILE))
}

/**
 * The Codex home of a Codex login, the one `codex login` and `codex logout` run in
 * (`codexLoginEnv`): the login's folder, or for plain codex's login the inherited
 * `CODEX_HOME` (unless it is an extra login's home), else `~/.codex`.
 */
export function codexHomeOf(login: LoginRef, env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform = process.platform): string {
  const patched = applyEnvPatch(env, codexLoginEnv(login, env, platform), platform === 'win32')
  const named = platform === 'win32' ? windowsEnv(patched, 'CODEX_HOME') : patched['CODEX_HOME']
  return named !== undefined && named !== '' ? named : join(home, '.codex')
}

/**
 * Whether the `config.toml` of `codexHome` makes Codex keep the sign-in somewhere other than
 * `auth.json`: `cli_auth_credentials_store` set to anything but `"file"`, Codex's default
 * (`"keyring"` or `"auto"`: the macOS Keychain or Windows Credential Manager). A file that
 * cannot be read as TOML counts as yes, so that Codex is asked. No file counts as no.
 */
export function codexKeepsSignInElsewhere(codexHome: string): boolean {
  let text: string
  try {
    text = readFileSync(join(codexHome, 'config.toml'), 'utf8')
  } catch {
    return false
  }
  try {
    const store = tomlValue(text)['cli_auth_credentials_store']
    return store !== undefined && store !== 'file'
  } catch {
    return true
  }
}

/**
 * Whether `codex login status`, run on the Codex login `login` the way `codex login` is, says it
 * is signed in (exit code 0). What it prints is not read. False when Codex is not found, fails
 * or takes longer than `CODEX_LOGIN_STATUS_TIMEOUT_MS`.
 */
export async function codexSignedIn(login: LoginRef, env: NodeJS.ProcessEnv, deps: CodexStatusDeps): Promise<boolean> {
  let program
  try {
    program = deps.findProgram('codex', { env })
  } catch (error) {
    if (error instanceof ProgramNotFoundError) return false
    throw error
  }
  const result = await deps.runProgram(program.command, [...program.args, 'login', 'status'],
    { timeoutMs: CODEX_LOGIN_STATUS_TIMEOUT_MS, env: applyEnvPatch(env, codexLoginEnv(login, env)), maxOutputBytes: 64 * 1024 })
  return result.code === 0
}

/**
 * Whether a login has credentials on this machine: `hasLocalCredentials`, and for a Codex
 * login without `auth.json` whose `config.toml` keeps the sign-in in the system's keyring
 * (`codexKeepsSignInElsewhere`), what `codex login status` says. So Codex is started only for
 * such a login, which `codex login` gave no `auth.json`.
 */
export async function hasCredentials(login: LoginRef, env: NodeJS.ProcessEnv, home: string, deps: CodexStatusDeps): Promise<boolean> {
  if (hasLocalCredentials(login, env, home)) return true
  if (login.provider !== 'codex' || !codexKeepsSignInElsewhere(codexHomeOf(login, env, home))) return false
  return await codexSignedIn(login, env, deps)
}

/** A login as `kurmis list --json` prints it: its settings and `credentials`. */
export type ListedLogin = LoginSettings & { credentials: boolean }

/** The headers of the setting columns are the names of `kurmis set`'s options. */
const HEADER = ['PROVIDER', 'ALIAS', 'ID', 'AUTO', 'FIVE-HOUR', 'WEEKLY', 'USE-FIRST', 'CREDENTIALS']

/**
 * The logins as a table with a header row, columns padded to their widest cell, followed by a
 * line for each of the logins of plain claude and plain codex that says which one it is.
 */
export function formatLoginTable(logins: readonly ListedLogin[]): string {
  const rows = [
    HEADER,
    ...logins.map((login) => [
      login.provider,
      login.alias,
      login.id,
      login.routing ? 'on' : 'off',
      `${String(login.fiveHourLimit)}%`,
      `${String(login.weeklyLimit)}%`,
      login.useFirst ? 'on' : 'off',
      login.credentials ? 'yes' : 'no'
    ])
  ]
  const widths = HEADER.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)))
  const table = rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd())
  const own = logins.filter((login) => login.machineOwn).map((login) =>
    `${login.alias} is ${machineOwnText(login.provider)}.`)
  return [...table, ...(own.length > 0 ? ['', ...own] : [])].join('\n')
}

export function createListCommand(deps: Partial<ListDeps> = {}): Command {
  const home = deps.home ?? homedir
  const codex: CodexStatusDeps = { findProgram: deps.findProgram ?? realFindProgram, runProgram: deps.runProgram ?? runProgram }
  return {
    name: 'list',
    summary: 'List the logins and their routing settings',
    usage: `Usage: kurmis list [--json]

Lists every login kurmis knows, with its settings and whether it has credentials on this
machine. The logins of plain claude and plain codex come first. They are the accounts a plain
"claude" and a plain "codex" are signed in to, and the lines under the table name them.
Change the settings with "kurmis set". The columns:

  PROVIDER      claude or codex.
  ALIAS         The name you type for the login, for example in "kurmis claude --login".
                Kurmis makes it from the account's email until you set one with
                "kurmis set <alias> --alias <new alias>". While kurmis knows no email for
                the login, the alias is its id.
  ID            The login's id, which never changes. Commands take it in place of the alias.
  AUTO          Whether Auto routing may use the login (set --auto).
  FIVE-HOUR     Auto routing stops using the login once its five-hour window reaches this
                (set --five-hour).
  WEEKLY        The same for the weekly window (set --weekly).
  USE-FIRST     Whether Auto routing takes this login before the others that have room
                (set --use-first).
  CREDENTIALS   Whether the login's credentials are on this machine. This looks at files, and
                asks "codex login status" for a Codex login that keeps its sign-in in the
                system's keyring (cli_auth_credentials_store); "kurmis status" asks the daemon
                whether they still work.

Options:
  --json       Print the logins as JSON. Each has "alias", "id", "provider", "machineOwn"
               (true for the logins of plain claude and plain codex) and "credentials" for the last column.
  -h, --help   Show this help.`,
    async run(args, context) {
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
      // The `codex login status` runs, if any, run at the same time.
      const listed = await Promise.all(logins.map(async (login) =>
        ({ ...login, credentials: await hasCredentials(login, context.env, home(), codex) })))
      writeLine(context.stdout, parsed.values.json === true ? JSON.stringify(listed, null, 2) : formatLoginTable(listed))
      return EXIT_OK
    }
  }
}

export const listCommand = createListCommand()
