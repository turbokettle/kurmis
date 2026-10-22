// Whether a login's credentials are on this machine, without the daemon and without reading a
// secret out of the system's store. `kurmis login` checks a sign-in with it, and `kurmis status`
// shows it when no daemon runs (`checkCredentials`).
//
// A Claude login counts when its token is there: its `.credentials.json` holds a `claudeAiOauth`
// record with an access token, or the system's store has its record. On macOS that is a Keychain
// item, looked up with `security find-generic-password -s <service>` without `-w`, which prints
// the item's attributes and not its secret. On Windows it is a Credential Manager record, found
// by listing the credentials' names (`storedRecordsExist`). A `.claude.json` that names an
// account does not count: the CLI keeps it after the token is gone.
//
// A Codex login counts when its home has `auth.json`, and for a Codex login whose `config.toml`
// keeps the sign-in in the system's keyring, when `codex login status` says it is signed in.
//
// A check that could not run (`security`, PowerShell or Codex missing, failing or too slow, a
// credentials file that could not be read) answers `unknown`, never yes.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tomlValue } from '../core/codex-account-config.ts'
import { parseCredentials } from '../core/credentials.ts'
import { keychainService } from '../core/keychain-service.ts'
import { CREDENTIALS_FILE_NAME } from '../daemon/credentials.ts'
import { NO_SUCH_ITEM_EXIT_CODE } from '../daemon/keychain.ts'
import { claudeCredentialsDir, claudeSecureStorageDir } from '../daemon/tokens.ts'
import { applyEnvPatch, codexLoginEnv } from '../data/login-env.ts'
import type { LoginRef } from '../data/login-id.ts'
import { ProgramNotFoundError, windowsEnv, type findProgram } from '../platform/programs.ts'
import type { runProgram } from '../platform/run.ts'
import { systemProgram } from '../platform/system-programs.ts'
import { powerShellCredentialRead, preferredAccounts, storedRecordsExist, type CredentialRead } from '../platform/windows-credentials.ts'

/** Whether a login's credentials are on this machine, or `unknown` when a check could not run. */
export type CredentialCheck = boolean | 'unknown'

/** What the checks start programs with; the fakes in tests. */
export interface CredentialCheckDeps {
  /** Finds `codex` for `codex login status`. */
  findProgram: typeof findProgram
  /** Runs `codex login status`, `security` (macOS) and PowerShell (Windows). */
  runProgram: typeof runProgram
  /** Which system store a Claude login's record may be in. `process.platform` by default. */
  platform?: NodeJS.Platform
  /**
   * Windows: lists Credential Manager's credentials by name, without their blobs.
   * `powerShellCredentialRead` with `blobs` false by default.
   */
  readCredentialNames?: CredentialRead
}

/** How long `codex login status` may take. It reads one file or keyring item and contacts no server. */
export const CODEX_LOGIN_STATUS_TIMEOUT_MS = 10_000

/**
 * How long `security find-generic-password` may take. It answers in milliseconds; a locked
 * Keychain can make it wait for the person, and then the answer is `unknown`.
 */
export const KEYCHAIN_LOOKUP_TIMEOUT_MS = 3_000

/**
 * Whether `<dir>/.credentials.json` holds a `claudeAiOauth` record with an access token. The
 * token is parsed in memory and nothing of it is kept. A missing file is no; a file that cannot
 * be read for another reason is `unknown`.
 */
export function credentialsFileHasToken(dir: string): CredentialCheck {
  let text: string
  try {
    text = readFileSync(join(dir, CREDENTIALS_FILE_NAME), 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR' ? false : 'unknown'
  }
  return parseCredentials(text) !== null
}

/**
 * Whether the macOS Keychain has the generic-password item `service`:
 * `security find-generic-password -s <service>`, which prints the item's attributes but not its
 * secret, and is not read here. Exit 0 is yes, 44 (`NO_SUCH_ITEM_EXIT_CODE`) no, anything else
 * (a locked Keychain, a missing `security`, the deadline) `unknown`. `KURMIS_SECURITY_PROGRAM`
 * (a test hook) names a stand-in for `security`.
 *
 * In an ssh login the search list holds only the System keychain, so a no is asked again of the
 * user's own keychains (`security list-keychains -d user`), named one by one.
 */
export async function keychainItemExists(service: string, env: NodeJS.ProcessEnv, run: typeof runProgram): Promise<CredentialCheck> {
  // `security` runs in this process's environment, as the daemon's Keychain reader runs it.
  const security = (args: string[]): ReturnType<typeof runProgram> =>
    run(systemProgram('security', env), args, { timeoutMs: KEYCHAIN_LOOKUP_TIMEOUT_MS, maxOutputBytes: 64 * 1024 })
  const answer = async (keychains: string[]): Promise<CredentialCheck> => {
    const result = await security(['find-generic-password', '-s', service, ...keychains])
    if (result.error !== null) return 'unknown'
    if (result.code === 0) return true
    return result.code === NO_SUCH_ITEM_EXIT_CODE ? false : 'unknown'
  }
  const searched = await answer([])
  if (searched !== false) return searched
  const listed = await security(['list-keychains', '-d', 'user'])
  if (listed.error !== null || listed.code !== 0) return false
  const keychains = listed.stdout.split('\n').map((line) => line.trim().replace(/^"|"$/g, '')).filter((line) => line.length > 0)
  return keychains.length === 0 ? false : answer(keychains)
}

/** Yes when either says yes, else `unknown` when either is, else no. */
function either(a: CredentialCheck, b: CredentialCheck): CredentialCheck {
  if (a === true || b === true) return true
  return a === 'unknown' || b === 'unknown' ? 'unknown' : false
}

/**
 * Whether each Claude login has its token on this machine: in its `.credentials.json` (the
 * login's folder, or `~/.claude` for plain claude's login), else on macOS in its Keychain item
 * and on Windows in Credential Manager, both named after the login's
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR` (`keychainService`). Only the logins without the file reach
 * the store: one `security` run each on macOS, side by side, and one PowerShell run for all of
 * them on Windows.
 */
async function claudeCredentials(logins: readonly LoginRef[], env: NodeJS.ProcessEnv, home: string,
  deps: CredentialCheckDeps): Promise<CredentialCheck[]> {
  const files = logins.map((login) => credentialsFileHasToken(claudeCredentialsDir(login, home)))
  const left = logins.filter((_login, index) => files[index] !== true)
  const platform = deps.platform ?? process.platform
  let stores: CredentialCheck[] = left.map(() => false)
  if (left.length > 0 && platform === 'darwin') {
    stores = await Promise.all(left.map((login) => keychainItemExists(keychainService(claudeSecureStorageDir(login)), env, deps.runProgram)))
  } else if (left.length > 0 && platform === 'win32') {
    const read = deps.readCredentialNames ?? powerShellCredentialRead(env, deps.runProgram, false)
    stores = await storedRecordsExist(left.map(claudeSecureStorageDir), read, preferredAccounts(env))
  }
  return logins.map((login, index) => {
    const file = files[index] ?? false
    if (file === true) return true
    return either(file, stores[left.indexOf(login)] ?? false)
  })
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
 * is signed in: exit code 0 is yes, another exit code no. What it prints is not read. `unknown`
 * when Codex is not found, cannot start or takes longer than `CODEX_LOGIN_STATUS_TIMEOUT_MS`.
 */
export async function codexSignedIn(login: LoginRef, env: NodeJS.ProcessEnv, deps: CredentialCheckDeps): Promise<CredentialCheck> {
  let program
  try {
    program = deps.findProgram('codex', { env })
  } catch (error) {
    if (error instanceof ProgramNotFoundError) return 'unknown'
    throw error
  }
  const result = await deps.runProgram(program.command, [...program.args, 'login', 'status'],
    { timeoutMs: CODEX_LOGIN_STATUS_TIMEOUT_MS, env: applyEnvPatch(env, codexLoginEnv(login, env)), maxOutputBytes: 64 * 1024 })
  if (result.error !== null) return 'unknown'
  return result.code === 0
}

/**
 * Whether a Codex login has credentials on this machine: `auth.json` in its Codex home
 * (`codexHomeOf`; only its existence is checked), else, when its `config.toml` keeps the sign-in
 * in the system's keyring (`codexKeepsSignInElsewhere`), what `codex login status` says. So
 * Codex is started only for such a login.
 */
async function codexCredentials(login: LoginRef, env: NodeJS.ProcessEnv, home: string, deps: CredentialCheckDeps): Promise<CredentialCheck> {
  const codexHome = codexHomeOf(login, env, home)
  if (existsSync(join(codexHome, 'auth.json'))) return true
  if (!codexKeepsSignInElsewhere(codexHome)) return false
  return await codexSignedIn(login, env, deps)
}

/**
 * Whether each login's credentials are on this machine, by login id; see the file's header. The
 * programs it starts, if any, run at the same time.
 */
export async function checkCredentials(logins: readonly LoginRef[], env: NodeJS.ProcessEnv, home: string,
  deps: CredentialCheckDeps): Promise<Map<string, CredentialCheck>> {
  const claude = logins.filter((login) => login.provider === 'claude')
  const codex = logins.filter((login) => login.provider === 'codex')
  const [claudeAnswers, codexAnswers] = await Promise.all([
    claudeCredentials(claude, env, home, deps),
    Promise.all(codex.map((login) => codexCredentials(login, env, home, deps)))
  ])
  const answers = new Map<string, CredentialCheck>()
  claude.forEach((login, index) => answers.set(login.id, claudeAnswers[index] ?? 'unknown'))
  codex.forEach((login, index) => answers.set(login.id, codexAnswers[index] ?? 'unknown'))
  return answers
}

/** Whether one login's credentials are on this machine (`checkCredentials`). */
export async function hasCredentials(login: LoginRef, env: NodeJS.ProcessEnv, home: string, deps: CredentialCheckDeps): Promise<CredentialCheck> {
  return (await checkCredentials([login], env, home, deps)).get(login.id) ?? 'unknown'
}
