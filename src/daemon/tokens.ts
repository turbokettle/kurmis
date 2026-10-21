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
// The two kinds of login, told apart by `machineOwn` in the login's settings:
//
// - an extra login: its folder in the kurmis data folder (`loginFolder`) is both the string its
//   Keychain item name is made from and the folder that holds its file;
// - the machine's own login: the Keychain item with the plain name (its CLI runs without
//   `CLAUDE_SECURESTORAGE_CONFIG_DIR`), and `<home>/.claude/.credentials.json`.
//
// The source is asked by login id. It looks each id up in the config once (`login` in the
// options) and keeps what it found, since a login's provider and kind never change.
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
import { FORCE_CREDENTIAL_MANAGER_VARIABLE } from '../data/login-env.ts'
import { isLoginId, type LoginId, type LoginRef } from '../data/login-id.ts'
import { loginFolder } from '../data/paths.ts'
import { CREDENTIALS_FILE_NAME, CredentialsFileReader, type CredentialsSource } from './credentials.ts'
import { CredentialManagerReader, type CredentialManagerFailureKind } from './credential-manager.ts'
import { powerShellCredentialRead, type CredentialRead } from '../platform/windows-credentials.ts'
import { systemProgram } from '../platform/system-programs.ts'
import { KeychainCredentialsReader, keychainHoldsSecret, type KeychainFailureKind } from './keychain.ts'

export interface TokenSourceOptions {
  /**
   * The login with this id in the config, or undefined when there is none. Only a Claude login
   * has a token; any other id is answered null and never reaches the Keychain.
   */
  login: (id: string) => LoginRef | undefined
  /** `KURMIS_SECURITY_PROGRAM` (a test hook) names the `security` program; else `SECURITY_PROGRAM`. */
  env: NodeJS.ProcessEnv
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /**
   * The user's home folder. Defaults to `os.homedir()`. The machine's own login's file is
   * `<home>/.claude/.credentials.json`.
   */
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
 * login, null for the machine's own login, whose item has the plain name. Throws for a login
 * that is not a Claude login.
 */
export function claudeSecureStorageDir(login: LoginRef): string | null {
  return checkedClaude(login).machineOwn ? null : loginFolder(login)
}

/**
 * The folder holding a Claude login's `.credentials.json`: the login's folder for an extra login,
 * `<home>/.claude` for the machine's own login. Throws for a login that is not a Claude login.
 */
export function claudeCredentialsDir(login: LoginRef, home: string): string {
  return checkedClaude(login).machineOwn ? join(home, '.claude') : loginFolder(login)
}

/**
 * The daemon's `TokenSource`. An id that is not the id of a Claude login in the config has no
 * token: `read` answers null for it and `prime` skips it, so no such id can reach the Keychain.
 */
export function createTokenSource(options: TokenSourceOptions): TokenSource {
  const home = options.home ?? homedir
  /** The Claude logins looked up so far, by id. A login's provider and kind never change. */
  const known = new Map<string, LoginRef>()
  const claudeLogin = (id: string): LoginRef | null => {
    const seen = known.get(id)
    if (seen !== undefined) return seen
    const found = isLoginId(id) ? options.login(id) : undefined
    if (found?.provider !== 'claude' || found.id !== id) return null
    const login: LoginRef = { id: found.id, provider: 'claude', machineOwn: found.machineOwn }
    known.set(id, login)
    return login
  }
  const isClaude = (id: string): id is LoginId => claudeLogin(id) !== null
  /** The login of an id the readers were handed, which `read` and `prime` have checked. */
  const checked = (id: string): LoginRef => {
    const login = claudeLogin(id)
    if (login === null) throw new Error(`${id} is not the id of a Claude login.`)
    return login
  }
  const file = new CredentialsFileReader({ credentialsDir: (id) => claudeCredentialsDir(checked(id), home()) })
  const credentialManager = (options.platform ?? process.platform) === 'win32'
    ? new CredentialManagerReader({
        secureStorageDir: (id) => claudeSecureStorageDir(checked(id)),
        fileExists: (id) => existsSync(join(claudeCredentialsDir(checked(id), home()), CREDENTIALS_FILE_NAME)),
        read: options.credentialRead ?? powerShellCredentialRead(options.env),
        now: options.now,
        onFailure: (failure) => {
          const login = claudeLogin(failure.id)
          if (login !== null) options.log?.write('token_read_failed', { login: login.id, reason: credentialManagerReasonOf(failure.kind) })
        }
      })
    : null
  const keychain = keychainHoldsSecret(options.platform ?? process.platform)
    ? new KeychainCredentialsReader({
        accounts: { secureStorageDir: (id) => claudeSecureStorageDir(checked(id)) },
        securityProgram: securityProgramOf(options.env),
        readTimeoutMs: options.keychainReadTimeoutMs,
        now: options.now,
        onFailure: (failure) => {
          const login = claudeLogin(failure.id)
          if (login !== null) options.log?.write('token_read_failed', { login: login.id, reason: logReasonOf(failure.kind) })
        }
      })
    : null

  return {
    keychain: keychain !== null,
    read(id: string): ClaudeCredentials | null {
      if (!isClaude(id)) return null
      return credentialManager?.read(id) ?? keychain?.read(id) ?? file.read(id)
    },
    async prime(ids: readonly string[]): Promise<void> {
      const claude = ids.filter(isClaude)
      await Promise.all([keychain?.prime(claude), credentialManager?.prime(claude)])
    },
    invalidate(id: string): void {
      if (!isClaude(id)) return
      keychain?.invalidate(id)
      credentialManager?.invalidate(id)
      file.invalidate(id)
    },
    markStale(id: string): void {
      if (!isClaude(id)) return
      // A Keychain read takes a moment, so the Keychain answer is simply read again.
      keychain?.invalidate(id)
      credentialManager?.markStale(id)
      file.invalidate(id)
    },
    inCredentialManager(id: string): boolean {
      return isClaude(id) && credentialManager !== null && credentialManager.holds(id)
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

function checkedClaude(login: LoginRef): LoginRef {
  if (login.provider !== 'claude') throw new Error(`${login.id} is not a Claude login.`)
  return login
}
