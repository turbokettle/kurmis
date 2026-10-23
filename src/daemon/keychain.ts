// Reading a Claude login's access token out of the macOS Keychain.
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
import { runProgram } from '../platform/run.ts'
import type { CredentialsSource } from './credentials.ts'

/** How long a Keychain answer is used before `security` is asked again. */
export const KEYCHAIN_CACHE_MS = 60_000

/** A `security` call still running after this is killed, and counts as no token. */
export const KEYCHAIN_READ_TIMEOUT_MS = 3_000

/** The item is a small JSON document; an answer larger than this is not one. */
const MAX_OUTPUT_BYTES = 256 * 1024

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
 * killed for printing more than a credentials record can be. It holds nothing `security` printed.
 */
export class KeychainReadError extends Error {
  constructor(
    readonly code: number | null,
    readonly timedOut = false,
    readonly outputTooLarge = false
  ) {
    super(`security failed (${timedOut ? 'timed out' : outputTooLarge ? 'printed too much' : `exit code ${String(code)}`})`)
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
  if (result.timedOut || result.outputTooLarge || result.error !== null || result.code !== 0) {
    throw new KeychainReadError(result.code, result.timedOut, result.outputTooLarge)
  }
  return result.stdout.trim().length === 0 ? null : result.stdout
}

/**
 * Why this process cannot use the login Keychain, or null when it can:
 * `security show-keychain-info login.keychain`, which prints the Keychain's settings and shows
 * no dialog. A process started from an ssh login cannot use it, and neither can anything it
 * starts. Its Keychain search list then holds only the System keychain, so every item read
 * answers exit 44, the same as an item that is not there, and nothing else would tell a login
 * whose record is in the Keychain from one that keeps it in its `.credentials.json`. `code` is
 * `security`'s exit code, or null when it was killed or never ran. Holds nothing `security`
 * printed.
 */
export async function loginKeychainProblem(securityProgram: string, timeoutMs: number = KEYCHAIN_READ_TIMEOUT_MS):
  Promise<{ code: number | null; timedOut: boolean } | null> {
  const result = await runProgram(securityProgram, ['show-keychain-info', 'login.keychain'], { timeoutMs, maxOutputBytes: MAX_OUTPUT_BYTES })
  if (!result.timedOut && !result.outputTooLarge && result.error === null && result.code === 0) return null
  return { code: result.timedOut ? null : result.code, timedOut: result.timedOut }
}

/** What `kurmis status` says about a `loginKeychainProblem`. */
export function loginKeychainProblemText(problem: { code: number | null; timedOut: boolean }): string {
  const how = problem.timedOut ? 'did not answer in time' : problem.code === null ? 'could not be run' : `exited with code ${String(problem.code)}`
  return `The daemon cannot read the login Keychain ("security show-keychain-info login.keychain" ${how}), so it has no ` +
    'token for a login whose credentials are kept there. It was probably started from an ssh session. Start it again ' +
    'from a terminal at the screen with "kurmis daemon restart".'
}

/** Reads one Keychain item, as `readKeychainItem` does. Tests pass their own to inject answers. */
export type KeychainRun = (service: string) => Promise<string | null>

export interface KeychainReaderOptions {
  accounts: {
    /**
     * The `CLAUDE_SECURESTORAGE_CONFIG_DIR` the login's CLI is started with, exactly as passed,
     * or null for plain claude's login, which is started without it.
     */
    secureStorageDir(id: string): string | null
  }
  /** The `security` program to run: `/usr/bin/security` in the daemon, a stand-in in tests. */
  securityProgram: string
  /** Defaults to `KEYCHAIN_READ_TIMEOUT_MS`. */
  readTimeoutMs?: number
  now?: () => number
  /** Replaces the `security` call, for tests that inject an answer rather than run a stand-in. */
  run?: KeychainRun
  /** Told once per login when its read fails, and again only after a read of it has worked. */
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
 * than `KEYCHAIN_CACHE_MS`, or that was invalidated since, one read per login at a time, and
 * `read` answers from what the last read found. After `invalidate`, `read` goes on answering the
 * old token until the new read lands, and a read that started before `invalidate` is not used.
 */
export class KeychainCredentialsReader implements CredentialsSource {
  private readonly cache = new Map<string, { readAt: number; value: ClaudeCredentials | null }>()
  /** The read of each login going on now, with the `invalidations` count it started under. */
  private readonly reading = new Map<string, { promise: Promise<void>; invalidated: number }>()
  /** How often each login was invalidated. */
  private readonly invalidations = new Map<string, number>()
  /** The logins whose failed read has been reported to `onFailure`, until a read of one works. */
  private readonly failureReported = new Set<string>()
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

  invalidate(id: string): void {
    this.invalidations.set(id, this.invalidatedCount(id) + 1)
    const cached = this.cache.get(id)
    if (cached !== undefined) this.cache.set(id, { ...cached, readAt: Number.NEGATIVE_INFINITY })
  }

  clear(): void {
    this.cache.clear()
    for (const id of this.reading.keys()) this.invalidations.set(id, this.invalidatedCount(id) + 1)
  }

  /**
   * One read per login at a time; a second caller waits for the one already running. A read
   * that started before the latest `invalidate` is waited for and then followed by a new one.
   */
  private refresh(id: string): Promise<void> {
    const cached = this.cache.get(id)
    if (cached && this.now() - cached.readAt < KEYCHAIN_CACHE_MS) return Promise.resolve()
    const invalidated = this.invalidatedCount(id)
    const running = this.reading.get(id)
    if (running !== undefined) {
      return running.invalidated === invalidated ? running.promise : running.promise.then(() => this.refresh(id))
    }
    const promise = this.load(id, invalidated).finally(() => { this.reading.delete(id) })
    this.reading.set(id, { promise, invalidated })
    return promise
  }

  private invalidatedCount(id: string): number { return this.invalidations.get(id) ?? 0 }

  private async load(id: string, invalidated: number): Promise<void> {
    const timeoutMs = this.options.readTimeoutMs ?? KEYCHAIN_READ_TIMEOUT_MS
    const run = this.options.run ?? ((service: string) => readKeychainItem(this.options.securityProgram, service, timeoutMs))
    const service = keychainService(this.options.accounts.secureStorageDir(id))
    // The answer of a read that started before the latest `invalidate` or `clear` is not kept.
    const keep = (value: ClaudeCredentials | null): boolean => {
      if (this.invalidatedCount(id) !== invalidated) return false
      this.cache.set(id, { readAt: this.now(), value })
      return true
    }
    if (this.unanswered.has(service)) {
      keep(null)
      return
    }
    let value: ClaudeCredentials | null = null
    let failure: { kind: KeychainFailureKind; code: number | null } | null = null
    try {
      const secret = await run(service)
      value = secret === null ? null : parseCredentials(secret)
      if (secret === null) failure = { kind: 'empty', code: null }
      else if (value === null) failure = { kind: 'not_credentials', code: null }
    } catch (error) {
      if (error instanceof KeychainReadError && error.timedOut) {
        this.unanswered.add(service)
        keep(null)
        this.options.onFailure?.({ id, kind: 'timeout', code: null })
        return
      }
      // No item is an answer, not a failure: the login keeps its record in `.credentials.json`
      // or is signed out. It counts as a read that worked.
      if (!(error instanceof KeychainReadError && error.code === NO_SUCH_ITEM_EXIT_CODE)) {
        failure = error instanceof KeychainReadError
          ? { kind: failureKindOf(error), code: error.code }
          : { kind: 'failed', code: null }
      }
    }
    if (!keep(value)) return
    if (failure === null) {
      this.failureReported.delete(id)
    } else if (!this.failureReported.has(id)) {
      // Once per login, or the log would get a line a minute for as long as the failure lasts.
      this.failureReported.add(id)
      this.options.onFailure?.({ id, ...failure })
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
