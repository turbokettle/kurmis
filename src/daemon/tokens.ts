// The daemon's token source: where the proxy reads each Claude login's access token.
//
// Where the Claude CLI keeps a login's credentials record:
//
// - macOS: in a Keychain item, named after the `CLAUDE_SECURESTORAGE_CONFIG_DIR` the login's
//   CLI runs with (`keychainService` in `src/core/keychain-service.ts`). The CLI reads the item
//   first, and the login's `.credentials.json` when there is no item, so the daemon does the
//   same: the item first, and the file whenever the item gives no token.
// - Windows: in `.credentials.json`, or, in newer CLI versions, in Windows Credential Manager,
//   which the CLI reads first, and the file only when Credential Manager has nothing. The
//   daemon does the same (`CredentialManagerReader` in `credential-manager.ts`). A probe of a
//   login whose record is in Credential Manager runs with `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`
//   (`probeEnvironment`), because the CLI's feature flag for it is read from the config folder
//   the CLI runs with, and a probe's folder is not the one a routed CLI uses: with the flag off
//   there, the probe would not see the record, and would report the login signed out.
// - Linux: in `.credentials.json` only.
//
// The two kinds of login:
//
// - an extra login `claude:<name>`: its folder in the kurmis data folder (`loginFolder`) is both
//   the string its Keychain item name is made from and the folder that holds its file;
// - `claude:default`, the machine's own login: the Keychain item with the plain name (its CLI
//   runs without `CLAUDE_SECURESTORAGE_CONFIG_DIR`), and `<home>/.claude/.credentials.json`.
//
// `read` never waits. Keychain and Credential Manager answers are fetched by `prime` and kept
// for a minute (`KEYCHAIN_CACHE_MS`; `credential-manager.ts` says when it keeps them longer);
// the file is checked with one `stat` per `read`.
//
// A failed Keychain read goes to the daemon log as `token_read_failed` with the login and a fixed
// reason word, once per login until a read of it works. A missing item is not logged, because on
// macOS a login that keeps its record in the file, or is signed out, has none.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeCredentials } from '../core/credentials.ts'
import type { DaemonLog, LogReason } from '../data/log.ts'
import { isDefaultLoginId, parseLoginId } from '../data/login-id.ts'
import { loginFolder } from '../data/paths.ts'
import { CREDENTIALS_FILE_NAME, CredentialsFileReader, type CredentialsSource } from './credentials.ts'
import { CredentialManagerReader, type CredentialManagerFailureKind } from './credential-manager.ts'
import { powerShellCredentialRead, type CredentialRead } from '../platform/windows-credentials.ts'
import { systemProgram } from '../platform/system-programs.ts'
import { KeychainCredentialsReader, keychainHoldsSecret, type KeychainFailureKind } from './keychain.ts'

export interface TokenSourceOptions {
  /** `KURMIS_SECURITY_PROGRAM` (a test hook) names the `security` program; else `SECURITY_PROGRAM`. */
  env: NodeJS.ProcessEnv
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** The user's home folder. Defaults to `os.homedir()`. The default login's file is `<home>/.claude/.credentials.json`. */
  home?: () => string
  now?: () => number
  log?: DaemonLog
  /** How long one `security` call may take. Defaults to `KEYCHAIN_READ_TIMEOUT_MS`; tests pass less. */
  keychainReadTimeoutMs?: number
  /** Windows: reads Credential Manager. Runs PowerShell (`powerShellCredentialRead`) by default; tests pass their own. */
  credentialRead?: CredentialRead
}

export interface TokenSource extends CredentialsSource {
  /** True when tokens come from the macOS Keychain (with the file as fallback). For whyPassedOver's `keychain`. */
  readonly keychain: boolean
  /**
   * Has the next `prime` read the login again, as `invalidate` does, except that `prime` does
   * not wait for the Credential Manager read: it goes on in the background. A Credential Manager
   * login that is not read again every minute (its file exists and it had no record there, or
   * its last read failed) keeps its longer wait.
   */
  markStale(id: string): void
  /** Whether the last Credential Manager read of the login that worked found its record there. */
  inCredentialManager(id: string): boolean
}

/** The variable that makes Claude Code on Windows keep its record in Credential Manager. */
export const FORCE_CREDENTIAL_MANAGER_VARIABLE = 'CLAUDE_CODE_FORCE_WINDOWS_CREDMAN'

/**
 * The environment a usage probe of `id` gets: `env`, with `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`
 * when the login's record was found in Credential Manager, so the probe's CLI reads it there
 * and writes a renewed token back there.
 */
export function probeEnvironment(tokens: Pick<TokenSource, 'inCredentialManager'>, id: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return tokens.inCredentialManager(id) ? { ...env, [FORCE_CREDENTIAL_MANAGER_VARIABLE]: '1' } : env
}

/**
 * The `security` program the daemon runs: `KURMIS_SECURITY_PROGRAM` from `env`, else from this
 * process's environment, else `/usr/bin/security` (`systemProgram`).
 */
export function securityProgramOf(env: NodeJS.ProcessEnv, processEnv: NodeJS.ProcessEnv = process.env): string {
  return systemProgram('security', env, processEnv)
}

/**
 * The string a Claude login's Keychain item name is made from: the login's folder for an extra
 * login, null for `claude:default`, whose item has the plain name. Throws for an id that is not a
 * Claude login id.
 */
export function claudeSecureStorageDir(id: string): string | null {
  return isDefaultLoginId(checkedClaudeId(id)) ? null : loginFolder(id)
}

/**
 * The folder holding a Claude login's `.credentials.json`: the login's folder for an extra login,
 * `<home>/.claude` for `claude:default`. Throws for an id that is not a Claude login id.
 */
export function claudeCredentialsDir(id: string, home: string): string {
  return isDefaultLoginId(checkedClaudeId(id)) ? join(home, '.claude') : loginFolder(id)
}

/**
 * The daemon's `TokenSource`. Ids that are not Claude login ids have no token: `read` answers
 * null for them and `prime` skips them, so no such id can reach the Keychain.
 */
export function createTokenSource(options: TokenSourceOptions): TokenSource {
  const home = options.home ?? homedir
  const file = new CredentialsFileReader({ credentialsDir: (id) => claudeCredentialsDir(id, home()) })
  const credentialManager = (options.platform ?? process.platform) === 'win32'
    ? new CredentialManagerReader({
        secureStorageDir: claudeSecureStorageDir,
        fileExists: (id) => existsSync(join(claudeCredentialsDir(id, home()), CREDENTIALS_FILE_NAME)),
        read: options.credentialRead ?? powerShellCredentialRead(options.env),
        now: options.now,
        onFailure: (failure) => {
          const login = parseLoginId(failure.id)
          if (login !== null) options.log?.write('token_read_failed', { login: login.id, reason: credentialManagerReasonOf(failure.kind) })
        }
      })
    : null
  const keychain = keychainHoldsSecret(options.platform ?? process.platform)
    ? new KeychainCredentialsReader({
        accounts: { secureStorageDir: claudeSecureStorageDir },
        securityProgram: securityProgramOf(options.env),
        readTimeoutMs: options.keychainReadTimeoutMs,
        now: options.now,
        onFailure: (failure) => {
          const login = parseLoginId(failure.id)
          if (login !== null) options.log?.write('token_read_failed', { login: login.id, reason: logReasonOf(failure.kind) })
        }
      })
    : null

  return {
    keychain: keychain !== null,
    read(id: string): ClaudeCredentials | null {
      if (!isClaudeLoginId(id)) return null
      return credentialManager?.read(id) ?? keychain?.read(id) ?? file.read(id)
    },
    async prime(ids: readonly string[]): Promise<void> {
      const claude = ids.filter(isClaudeLoginId)
      await Promise.all([keychain?.prime(claude), credentialManager?.prime(claude)])
    },
    invalidate(id: string): void {
      if (!isClaudeLoginId(id)) return
      keychain?.invalidate(id)
      credentialManager?.invalidate(id)
      file.invalidate(id)
    },
    markStale(id: string): void {
      if (!isClaudeLoginId(id)) return
      // A Keychain read takes a moment, so the Keychain answer is simply read again.
      keychain?.invalidate(id)
      credentialManager?.markStale(id)
      file.invalidate(id)
    },
    inCredentialManager(id: string): boolean {
      return isClaudeLoginId(id) && credentialManager !== null && credentialManager.holds(id)
    },
    clear(): void {
      keychain?.clear()
      credentialManager?.clear()
      file.clear()
    }
  }
}

/** The daemon log's reason word for a failed Keychain read. */
export function logReasonOf(kind: KeychainFailureKind): LogReason {
  switch (kind) {
    case 'timeout': return 'timeout'
    case 'not_allowed': return 'not_allowed'
    case 'empty':
    case 'not_credentials':
    case 'too_large': return 'invalid'
    case 'not_run':
    case 'failed': return 'other'
  }
}

/** The daemon log's reason word for a failed Credential Manager read. */
function credentialManagerReasonOf(kind: CredentialManagerFailureKind): LogReason {
  return kind === 'not_credentials' ? 'invalid' : 'other'
}

function isClaudeLoginId(id: string): boolean {
  return parseLoginId(id)?.provider === 'claude'
}

function checkedClaudeId(id: string): string {
  if (!isClaudeLoginId(id)) throw new Error(`${id} is not a Claude login id.`)
  return id
}
