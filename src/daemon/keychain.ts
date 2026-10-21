// Reading a Claude login's access token out of the macOS Keychain. Copied from the original router's
// `src/tools/claude/main/accounts/router/keychain.ts`.
//
// On macOS the CLI keeps a login's credentials record in a generic-password item instead of in
// `.credentials.json`. The item is named after the `CLAUDE_SECURESTORAGE_CONFIG_DIR` the login's
// CLI is started with (`keychainService` in `src/core/keychain-service.ts`), and holds the same
// JSON as the file, so the parsing is shared (`parseCredentials` in `src/core/credentials.ts`).
//
// **Nothing here may put a dialog on the person's screen.** `security` cannot be told to fail
// instead of asking: `find-generic-password` has no such option. A native reader that turned
// user interaction off would be a program of its own, and the Keychain decides per program
// whether a read needs the person's approval, so it would not get the answers `security` gets.
// The CLI writes its item with `/usr/bin/security add-generic-password` and reads it back with
// `/usr/bin/security find-generic-password`, and `security`'s man page says the program that
// created an item may read it without asking. This reader runs that same program, so for an
// item the CLI created it gets the answer the CLI gets each time it starts, with no dialog.
//
// Two things can still make a read wait for the person: an item that another program created
// or whose access list was changed, and a locked login Keychain. Neither can be told apart from
// a working read without making the read, so the damage is bounded: `security` runs with
// standard input closed and is killed at its deadline, and an item whose read was killed is
// never read again by this process. Each such item can then put up one dialog per daemon run,
// not one a minute. A locked Keychain, an item that waits, a missing item and a missing
// `security` all end the same way: no token from the Keychain for that login. The daemon then
// reads the login's `.credentials.json` instead (`createTokenSource` in `tokens.ts`).
import { keychainService } from '../core/keychain-service.ts'
import { parseCredentials, type ClaudeCredentials } from '../core/credentials.ts'
import { runProgram, type RunResult } from '../platform/run.ts'
import type { CredentialsSource } from './credentials.ts'

/** The real `security` program, for the daemon to pass. Tests pass a stand-in instead. */
export const SECURITY_PROGRAM = '/usr/bin/security'

/** How long a Keychain answer is used before `security` is asked again. */
export const KEYCHAIN_CACHE_MS = 60_000

/** A `security` call still running after this is killed, and counts as no token. */
export const KEYCHAIN_READ_TIMEOUT_MS = 3_000

/** The item is a small JSON document; an answer larger than this is not one. */
const MAX_OUTPUT_BYTES = 256 * 1024

/** How much of `security`'s stderr goes into an error message. */
const MAX_REASON_CHARS = 500

/**
 * Whether the Claude CLI keeps its credentials in the macOS Keychain on this platform. Where it
 * does, the daemon reads the Keychain item first and the login's `.credentials.json` when the
 * item gives no token; elsewhere it reads only the file (`createTokenSource` in `tokens.ts`).
 */
export function keychainHoldsSecret(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin'
}

/**
 * A `security` call that failed. `code` is its exit code, or null when it was killed or never
 * ran. `timedOut` is true when it was killed at its deadline, and `outputTooLarge` when it was
 * killed for printing more than a credentials record can be. `reason` never holds the item's
 * contents.
 */
export class KeychainReadError extends Error {
  constructor(
    readonly reason: string,
    readonly code: number | null,
    readonly timedOut = false,
    readonly outputTooLarge = false
  ) {
    super(reason)
  }
}

/** `security`'s exit code for an item that is not in the Keychain. */
export const NO_SUCH_ITEM_EXIT_CODE = 44

/** `security`'s exit code for a Keychain this process may not use: locked, or an ssh session. */
export const KEYCHAIN_NOT_ALLOWED_EXIT_CODE = 36

/**
 * Runs `security find-generic-password -w -s <service>`: the item's contents, or null when the
 * item is empty. Throws a `KeychainReadError` when `security` failed. Exit 44
 * (`NO_SUCH_ITEM_EXIT_CODE`) is an item that is not there, and 36
 * (`KEYCHAIN_NOT_ALLOWED_EXIT_CODE`) a Keychain this process may not use.
 */
export async function readKeychainItem(
  securityProgram: string,
  service: string,
  timeoutMs: number = KEYCHAIN_READ_TIMEOUT_MS
): Promise<string | null> {
  const result = await runProgram(securityProgram, ['find-generic-password', '-w', '-s', service],
    { timeoutMs, maxOutputBytes: MAX_OUTPUT_BYTES })
  const failure = failureOf(result, timeoutMs)
  if (failure !== null) throw new KeychainReadError(failure, result.code, result.timedOut, result.outputTooLarge)
  return result.stdout.trim().length === 0 ? null : result.stdout
}

/** Why a `security` call failed, or null when it exited 0. Never quotes stdout. */
function failureOf(result: RunResult, timeoutMs: number): string | null {
  if (result.timedOut) return `it did not answer within ${seconds(timeoutMs)} seconds`
  if (result.outputTooLarge) return `it printed more than ${String(MAX_OUTPUT_BYTES)} bytes, which is not a credentials record`
  if (result.error !== null) return result.error
  if (result.code === 0) return null
  const said = result.stderr.trim()
  return said.length > 0 ? said.slice(0, MAX_REASON_CHARS) : 'it printed nothing on stderr'
}

function seconds(ms: number): string {
  return String(ms / 1000)
}

/** Reads one Keychain item, as `readKeychainItem` does. Tests pass their own to inject answers. */
export type KeychainRun = (service: string) => Promise<string | null>

export interface KeychainReaderOptions {
  accounts: {
    /**
     * The `CLAUDE_SECURESTORAGE_CONFIG_DIR` the login's CLI is started with, exactly as passed,
     * or null for the machine's own login (`claude:default`), which is started without it.
     */
    secureStorageDir(id: string): string | null
  }
  /** The `security` program to run: `SECURITY_PROGRAM` in the daemon, a stand-in in tests. */
  securityProgram: string
  /** Defaults to `KEYCHAIN_READ_TIMEOUT_MS`. */
  readTimeoutMs?: number
  now?: () => number
  /** Replaces the `security` call, for tests that inject an answer rather than run a stand-in. */
  run?: KeychainRun
  /**
   * Told once per login when its read fails, and again only after a read of it has worked. A
   * line names the login, the item and why, and never the item's contents. It is free text, so
   * it is for a person reading a terminal, never for the daemon log; the daemon uses `onFailure`.
   */
  log?: (line: string) => void
  /** Called at the same times as `log`, with the failure as fixed values instead of text. */
  onFailure?: (failure: KeychainReadFailure) => void
}

/**
 * Why a Keychain read gave no token:
 *
 * - `timeout`: `security` did not answer by its deadline and was killed (most likely a dialog);
 * - `not_allowed`: exit 36, the Keychain is locked or this process may not use it (an ssh session);
 * - `empty`: the item exists and is empty;
 * - `not_credentials`: the item holds something that is not a credentials record with a token;
 * - `too_large`: `security` printed more than a credentials record can be and was killed;
 * - `not_run`: `security` could not be started, or was ended by a signal;
 * - `failed`: any other non-zero exit, or the read threw.
 *
 * An item that is not there (exit 44) is not a failure: on macOS a login whose CLI keeps its
 * record in `.credentials.json`, or that is signed out, has no item.
 */
export type KeychainFailureKind = 'timeout' | 'not_allowed' | 'empty' | 'not_credentials' | 'too_large' | 'not_run' | 'failed'

/** A failed Keychain read, as fixed values only. Holds no text from `security` and nothing of the item. */
export interface KeychainReadFailure {
  /** The login id the read was for. */
  id: string
  kind: KeychainFailureKind
  /** `security`'s exit code, or null when it exited 0, was killed, never ran, or the read threw. */
  code: number | null
}

/**
 * The Keychain `CredentialsSource`. `prime` runs `security` for each login whose answer is older
 * than `KEYCHAIN_CACHE_MS`, one read per login at a time, and `read` answers from what the last
 * read found.
 */
export class KeychainCredentialsReader implements CredentialsSource {
  private readonly cache = new Map<string, { readAt: number; value: ClaudeCredentials | null }>()
  private readonly reading = new Map<string, Promise<void>>()
  /** The logins whose failed read has been logged, until a read of one works. */
  private readonly failureLogged = new Set<string>()
  /**
   * The items whose read was killed at its deadline. A `security` that does not answer is most
   * likely showing a Keychain dialog that nobody is there to answer, and reading the item again
   * would show another one, so none of these is read again by this reader. Neither `invalidate`
   * nor `clear` empties it.
   */
  private readonly unanswered = new Set<string>()

  constructor(private readonly options: KeychainReaderOptions) {}

  read(id: string): ClaudeCredentials | null {
    return this.cache.get(id)?.value ?? null
  }

  async prime(ids: readonly string[]): Promise<void> {
    await Promise.all([...new Set(ids)].map((id) => this.refresh(id)))
  }

  invalidate(id: string): void { this.cache.delete(id) }

  clear(): void { this.cache.clear() }

  /** One read per login at a time; a second caller waits for the one already running. */
  private refresh(id: string): Promise<void> {
    const cached = this.cache.get(id)
    if (cached && this.now() - cached.readAt < KEYCHAIN_CACHE_MS) return Promise.resolve()
    let running = this.reading.get(id)
    if (!running) {
      running = this.load(id).finally(() => { this.reading.delete(id) })
      this.reading.set(id, running)
    }
    return running
  }

  private async load(id: string): Promise<void> {
    const timeoutMs = this.options.readTimeoutMs ?? KEYCHAIN_READ_TIMEOUT_MS
    const run = this.options.run ?? ((service: string) => readKeychainItem(this.options.securityProgram, service, timeoutMs))
    const service = keychainService(this.options.accounts.secureStorageDir(id))
    if (this.unanswered.has(service)) {
      this.cache.set(id, { readAt: this.now(), value: null })
      return
    }
    let value: ClaudeCredentials | null = null
    let failure: { text: string; kind: KeychainFailureKind; code: number | null } | null = null
    try {
      const secret = await run(service)
      value = secret === null ? null : parseCredentials(secret)
      if (secret === null) failure = { text: 'the item is empty', kind: 'empty', code: null }
      else if (value === null) failure = { text: 'the item holds no OAuth token', kind: 'not_credentials', code: null }
    } catch (error) {
      if (error instanceof KeychainReadError && error.timedOut) {
        this.unanswered.add(service)
        this.cache.set(id, { readAt: this.now(), value: null })
        this.options.log?.(`reading login ${id} from the Keychain item "${service}" did not answer within ` +
          `${seconds(timeoutMs)} seconds, so the proxy holds no token for it, and this daemon will not read that item ` +
          'again until it restarts. A read that waits is usually a Keychain dialog: either a program other than the ' +
          'Claude CLI created the item or changed its access list, so /usr/bin/security may read it only after somebody ' +
          'allows it, or the login Keychain is locked. Reading again would put up another dialog.')
        this.options.onFailure?.({ id, kind: 'timeout', code: null })
        return
      }
      // No item is an answer, not a failure: the login keeps its record in `.credentials.json`
      // or is signed out. It counts as a read that worked.
      if (!(error instanceof KeychainReadError && error.code === NO_SUCH_ITEM_EXIT_CODE)) {
        failure = error instanceof KeychainReadError
          ? {
              text: `${error.code === null ? 'no exit code' : `exit ${String(error.code)}`}: ${error.reason}`,
              kind: failureKindOf(error),
              code: error.code
            }
          : { text: `it threw: ${error instanceof Error ? error.message : String(error)}`, kind: 'failed', code: null }
      }
    }
    this.cache.set(id, { readAt: this.now(), value })
    if (failure === null) {
      this.failureLogged.delete(id)
    } else if (!this.failureLogged.has(id)) {
      // Once per login, or the log would get a line a minute for as long as the failure lasts.
      this.failureLogged.add(id)
      this.options.log?.(`reading login ${id} from the Keychain item "${service}" failed, so the proxy holds no token ` +
        `for it (${failure.text})`)
      this.options.onFailure?.({ id, kind: failure.kind, code: failure.code })
    }
  }

  private now(): number { return this.options.now?.() ?? Date.now() }
}

/** The kind of a failed `security` call that was not a timeout and not a missing item. */
function failureKindOf(error: KeychainReadError): KeychainFailureKind {
  if (error.outputTooLarge) return 'too_large'
  if (error.code === KEYCHAIN_NOT_ALLOWED_EXIT_CODE) return 'not_allowed'
  if (error.code === null) return 'not_run'
  return 'failed'
}

/**
 * Whether this process can read the login Keychain at all, or why not.
 *
 * A process started from an ssh login runs in the ssh session, where the login Keychain cannot
 * be read, and so does everything it starts: a Claude CLI started there finds no token and says
 * "Not logged in". `security show-keychain-info login.keychain` shows no dialog either way: it
 * prints the Keychain's settings when it can read it, and fails with "User interaction is not
 * allowed" when it cannot. The daemon calls this at start to tell whether it has to be started
 * through launchd instead.
 */
export async function probeLoginKeychain(
  securityProgram: string,
  timeoutMs: number = KEYCHAIN_READ_TIMEOUT_MS
): Promise<{ readable: true } | { readable: false; reason: string }> {
  const result = await runProgram(securityProgram, ['show-keychain-info', 'login.keychain'],
    { timeoutMs, maxOutputBytes: MAX_OUTPUT_BYTES })
  const failure = failureOf(result, timeoutMs)
  return failure === null ? { readable: true } : { readable: false, reason: failure }
}
