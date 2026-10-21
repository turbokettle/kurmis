// The Windows Credential Manager `CredentialsSource`: a Claude login's record as newer Claude
// Code versions keep it on Windows (`src/platform/windows-credentials.ts` says how).
//
// Claude Code reads Credential Manager first and `.credentials.json` only when Credential
// Manager has nothing, so `read` answers a record found there whatever file the login has, and
// the token source falls back to the file otherwise. One PowerShell run reads every login that
// is due. Starting PowerShell and compiling its declaration takes a second or two, so `prime`
// waits only for a login that was not read yet, or not since `invalidate`, and that has no file
// or had its record found here; any other login is answered from the file until the run ends.
//
// When a login is read again:
//
// - after `invalidate` (a refused token, a renewal), at the next `prime`;
// - after a read that failed, after `retryDelayMs` (one minute, doubling up to 15 minutes);
// - when its file exists and the last read found no record here, after
//   `FILE_LOGIN_RECHECK_MS` (15 minutes), so a machine whose logins all use the file runs
//   PowerShell every 15 minutes, not every minute. A record can still appear while the file
//   is there: when the CLI fails to delete the file after moving the record, or when a CLI
//   with the feature off writes the file after a record was made;
// - otherwise after `KEYCHAIN_CACHE_MS` (a minute), or at the next `prime` after `markStale`.
//
// Apart from `invalidate`, a read again happens in the background while `read` goes on
// answering what it has. After `invalidate`, `read` also goes on answering the old token until
// the new read lands, so a request that reads it meanwhile still finds one; the next `prime`
// waits for the new read. A read that started before `invalidate` is not used.
//
// A failed read keeps the token and the found state from before. Whether the login's record is
// here (`holds`) changes only with a read that worked: a probe of such a login gets
// `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` (`probeEnvironment` in `tokens.ts`), also right after
// `invalidate`. A failed read of a login without a file, or with its record here, is reported
// once through `onFailure` until a read of it works. Records are kept in memory only.
import { parseCredentials, type ClaudeCredentials } from '../core/credentials.ts'
import { readStoredRecords, type CredentialRead } from '../platform/windows-credentials.ts'
import type { CredentialsSource } from './credentials.ts'
import { KEYCHAIN_CACHE_MS } from './keychain.ts'

/** Why a Credential Manager read gave no token: PowerShell could not read at all, the record is not one, or another failure. */
export type CredentialManagerFailureKind = 'not_run' | 'not_credentials' | 'failed'

/**
 * How long a login whose file exists, and whose last read found no record here, is not read
 * here again.
 */
export const FILE_LOGIN_RECHECK_MS = 15 * 60_000

/**
 * How long after its `failures`-th failed read in a row a login is read again: 1, 2, 4, 8,
 * then 15 minutes.
 */
export function retryDelayMs(failures: number): number {
  return Math.min(KEYCHAIN_CACHE_MS * 2 ** Math.max(0, failures - 1), FILE_LOGIN_RECHECK_MS)
}

export interface CredentialManagerReaderOptions {
  /** The `CLAUDE_SECURESTORAGE_CONFIG_DIR` the login's CLI is started with, or null for plain claude's login. */
  secureStorageDir(id: string): string | null
  /** Whether the login's `.credentials.json` exists. */
  fileExists(id: string): boolean
  read: CredentialRead
  /** The account names to look for (`preferredAccounts`); tests pass their own. */
  accounts?: readonly string[]
  now?: () => number
  onFailure?: (failure: { id: string; kind: CredentialManagerFailureKind }) => void
}

/** What the reads of one login have found so far. */
interface Entry {
  /**
   * The token of the last read that found a record, kept through failed reads; null after a
   * read that found none.
   */
  value: ClaudeCredentials | null
  /** When the last read of the login settled. */
  readAt: number
  /** Failed reads since the last one that worked. */
  failures: number
  /** Set by `markStale`: the next `prime` reads the login again in the background. */
  stale: boolean
}

/** What one read of one login gave. */
type Outcome =
  | { kind: 'found'; value: ClaudeCredentials }
  | { kind: 'missing' }
  | { kind: 'failed'; failure: CredentialManagerFailureKind }

export class CredentialManagerReader implements CredentialsSource {
  private readonly entries = new Map<string, Entry>()
  /** The logins whose last read that worked found their record here. */
  private readonly found = new Set<string>()
  /** The logins invalidated since their last read settled. */
  private readonly pending = new Set<string>()
  /** How often each login was invalidated; a read started before the latest one is not used. */
  private readonly invalidations = new Map<string, number>()
  /** How often `clear` ran; a read started before it is not used either. */
  private clears = 0
  private readonly failureLogged = new Set<string>()
  private running: Promise<void> | null = null

  constructor(private readonly options: CredentialManagerReaderOptions) {}

  read(id: string): ClaudeCredentials | null {
    return this.entries.get(id)?.value ?? null
  }

  /** Whether the last read of the login that worked found its record in Credential Manager. */
  holds(id: string): boolean {
    return this.found.has(id)
  }

  async prime(ids: readonly string[]): Promise<void> {
    const wanted = [...new Set(ids)]
    const waitFor = wanted.filter((id) => this.found.has(id) || !this.options.fileExists(id))
    const unread = (): boolean => waitFor.some((id) => !this.entries.has(id) || this.pending.has(id))
    // Each pass either waits for a run that is going on, which may not cover every login asked
    // for here, or starts one for the logins that are due. A run settles every login it reads
    // unless it was invalidated meanwhile, which makes it due for the next run, so the loop ends
    // once `invalidate` stops being called.
    for (;;) {
      if (this.running !== null) {
        if (!unread()) return
        await this.running
        continue
      }
      const due = wanted.filter((id) => this.isDue(id))
      if (due.length === 0) return
      const run = this.load(due).finally(() => { if (this.running === run) this.running = null })
      this.running = run
      if (!unread()) return
      await run
    }
  }

  /**
   * Has the next `prime` read the login again and wait for it where it waits for the login at
   * all. `read` goes on answering the old token until then.
   */
  invalidate(id: string): void {
    this.invalidations.set(id, (this.invalidations.get(id) ?? 0) + 1)
    this.pending.add(id)
  }

  /**
   * Has the next `prime` read the login again in the background. A login whose last read
   * failed, or whose file exists and whose last read found no record here, keeps its longer wait.
   */
  markStale(id: string): void {
    const entry = this.entries.get(id)
    if (entry !== undefined) entry.stale = true
  }

  clear(): void {
    this.clears++
    this.entries.clear()
    this.found.clear()
    this.pending.clear()
  }

  private isDue(id: string): boolean {
    const entry = this.entries.get(id)
    if (entry === undefined || this.pending.has(id)) return true
    const age = this.now() - entry.readAt
    if (entry.failures > 0) return age >= retryDelayMs(entry.failures)
    if (!this.found.has(id) && this.options.fileExists(id)) return age >= FILE_LOGIN_RECHECK_MS
    return entry.stale || age >= KEYCHAIN_CACHE_MS
  }

  private async load(ids: readonly string[]): Promise<void> {
    const clears = this.clears
    const started = new Map(ids.map((id) => [id, this.invalidations.get(id) ?? 0]))
    const settle = (id: string, outcome: Outcome): void => {
      if (this.clears === clears && (this.invalidations.get(id) ?? 0) === started.get(id)) this.settle(id, outcome)
    }
    let records
    try {
      records = await readStoredRecords(ids.map((id) => this.options.secureStorageDir(id)), this.options.read, this.options.accounts)
    } catch {
      for (const id of ids) settle(id, { kind: 'failed', failure: 'not_run' })
      return
    }
    ids.forEach((id, index) => {
      const record = records[index]
      if (record === undefined || record.kind === 'missing') settle(id, { kind: 'missing' })
      else if (record.kind === 'failed') settle(id, { kind: 'failed', failure: 'failed' })
      else {
        const value = parseCredentials(record.text)
        settle(id, value === null ? { kind: 'failed', failure: 'not_credentials' } : { kind: 'found', value })
      }
    })
  }

  private settle(id: string, outcome: Outcome): void {
    this.pending.delete(id)
    const before = this.entries.get(id)
    const readAt = this.now()
    if (outcome.kind !== 'failed') {
      this.entries.set(id, { value: outcome.kind === 'found' ? outcome.value : null, readAt, failures: 0, stale: false })
      if (outcome.kind === 'found') this.found.add(id)
      else this.found.delete(id)
      this.failureLogged.delete(id)
      return
    }
    this.entries.set(id, { value: before?.value ?? null, readAt, failures: (before?.failures ?? 0) + 1, stale: false })
    // A login whose token is in its file, as far as is known, is not reported.
    if (!this.failureLogged.has(id) && (this.found.has(id) || !this.options.fileExists(id))) {
      this.failureLogged.add(id)
      this.options.onFailure?.({ id, kind: outcome.failure })
    }
  }

  private now(): number { return this.options.now?.() ?? Date.now() }
}
