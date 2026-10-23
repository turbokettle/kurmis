// Whether a login's credentials are on this machine, without the daemon and without reading a
// secret out of the system's store. `kurmis login` checks a sign-in with it, and `kurmis status`
// shows it when no daemon runs (`checkCredentials`).
//
// A login counts when its token is there: its `.credentials.json` holds a `claudeAiOauth` record
// with an access token, or the system's store has its record. On macOS that is a Keychain item,
// looked up with `security find-generic-password -s <service>` without `-w`, which prints the
// item's attributes and not its secret. On Windows it is a Credential Manager record, found by
// listing the credentials' names (`storedRecordsExist`). A `.claude.json` that names an account
// does not count: the CLI keeps it after the token is gone.
//
// A check that could not run (`security` or PowerShell missing, failing or too slow, a
// credentials file that could not be read) answers `unknown`, never yes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCredentials } from '../core/credentials.ts'
import { keychainService } from '../core/keychain-service.ts'
import { CREDENTIALS_FILE_NAME } from '../daemon/credentials.ts'
import { NO_SUCH_ITEM_EXIT_CODE } from '../daemon/keychain.ts'
import { claudeCredentialsDir, claudeSecureStorageDir } from '../daemon/tokens.ts'
import type { LoginRef } from '../data/login-id.ts'
import type { runProgram } from '../platform/run.ts'
import { systemProgram } from '../platform/system-programs.ts'
import { powerShellCredentialRead, preferredAccounts, storedRecordsExist, type CredentialRead } from '../platform/windows-credentials.ts'

/** Whether a login's credentials are on this machine, or `unknown` when a check could not run. */
export type CredentialCheck = boolean | 'unknown'

/** What the checks start programs with; the fakes in tests. */
export interface CredentialCheckDeps {
  /** Runs `security` (macOS) and PowerShell (Windows). */
  runProgram: typeof runProgram
  /** Which system store a login's record may be in. `process.platform` by default. */
  platform?: NodeJS.Platform
  /**
   * Windows: lists Credential Manager's credentials by name, without their blobs.
   * `powerShellCredentialRead` with `blobs` false by default.
   */
  readCredentialNames?: CredentialRead
}

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
 * Whether each login's token is on this machine, by login id: in its `.credentials.json` (the
 * login's folder, or `~/.claude` for plain claude's login), else on macOS in its Keychain item
 * and on Windows in Credential Manager, both named after the login's
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR` (`keychainService`). Only the logins without the file reach
 * the store: one `security` run each on macOS, side by side, and one PowerShell run for all of
 * them on Windows.
 */
export async function checkCredentials(logins: readonly LoginRef[], env: NodeJS.ProcessEnv, home: string,
  deps: CredentialCheckDeps): Promise<Map<string, CredentialCheck>> {
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
  const answers = new Map<string, CredentialCheck>()
  logins.forEach((login, index) => {
    const file = files[index] ?? false
    answers.set(login.id, file === true ? true : either(file, stores[left.indexOf(login)] ?? false))
  })
  return answers
}

/** Whether one login's credentials are on this machine (`checkCredentials`). */
export async function hasCredentials(login: LoginRef, env: NodeJS.ProcessEnv, home: string, deps: CredentialCheckDeps): Promise<CredentialCheck> {
  return (await checkCredentials([login], env, home, deps)).get(login.id) ?? 'unknown'
}
