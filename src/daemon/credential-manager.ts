// The Windows Credential Manager `CredentialsSource`: a Claude login's record as newer Claude
// Code versions keep it on Windows (`src/platform/windows-credentials.ts` says how).
//
// Claude Code reads Credential Manager first and `.credentials.json` only when Credential
// Manager has nothing, so `read` answers a record found there whatever file the login has, and
// the token source falls back to the file otherwise. One PowerShell run reads every login, at
// most once per `KEYCHAIN_CACHE_MS`. Starting PowerShell and compiling its declaration takes a
// second or two, so `prime` waits only for a login without a file that was not read yet (or
// since `invalidate`); a login with a file is answered from the file until that run has ended,
// and an answer that is merely old (or marked so with `markStale`) is read again in the
// background while `read` goes on answering it. A failed read of a login without a file is
// reported once through `onFailure` until a read of it works; the record itself is kept in
// memory only.
import { parseCredentials, type ClaudeCredentials } from '../core/credentials.ts'
import { readStoredRecords, type CredentialRead } from '../platform/windows-credentials.ts'
import type { CredentialsSource } from './credentials.ts'
import { KEYCHAIN_CACHE_MS } from './keychain.ts'

/** Why a Credential Manager read gave no token: PowerShell could not read at all, the record is not one, or another failure. */
export type CredentialManagerFailureKind = 'not_run' | 'not_credentials' | 'failed'

export interface CredentialManagerReaderOptions {
  /** The `CLAUDE_SECURESTORAGE_CONFIG_DIR` the login's CLI is started with, or null for `claude:default`. */
  secureStorageDir(id: string): string | null
  /** Whether the login's `.credentials.json` exists; `prime` does not wait for such a login. */
  fileExists(id: string): boolean
  read: CredentialRead
  /** The account names to look for (`preferredAccounts`); tests pass their own. */
  accounts?: readonly string[]
  now?: () => number
  onFailure?: (failure: { id: string; kind: CredentialManagerFailureKind }) => void
}

export class CredentialManagerReader implements CredentialsSource {
  private readonly cache = new Map<string, { readAt: number; value: ClaudeCredentials | null }>()
  private readonly failureLogged = new Set<string>()
  private running: Promise<void> | null = null

  constructor(private readonly options: CredentialManagerReaderOptions) {}

  read(id: string): ClaudeCredentials | null {
    return this.cache.get(id)?.value ?? null
  }

  /** Whether the last read found the login's record in Credential Manager. */
  holds(id: string): boolean {
    return this.read(id) !== null
  }

  async prime(ids: readonly string[]): Promise<void> {
    const wanted = [...new Set(ids)]
    const waitFor = wanted.filter((id) => !this.options.fileExists(id))
    const unread = (): boolean => waitFor.some((id) => !this.cache.has(id))
    // Each pass either waits for a run that is going on, which may not cover every login asked
    // for here, or starts one for the logins that are due. A run settles every login it reads,
    // so the loop ends.
    for (;;) {
      if (this.running !== null) {
        if (!unread()) return
        await this.running
        continue
      }
      const due = wanted.filter((id) => {
        const cached = this.cache.get(id)
        return cached === undefined || this.now() - cached.readAt >= KEYCHAIN_CACHE_MS
      })
      if (due.length === 0) return
      const run = this.load(due).finally(() => { if (this.running === run) this.running = null })
      this.running = run
      if (!unread()) return
      await run
    }
  }

  /** Forgets the login's answer, so the next `prime` waits for a new read. */
  invalidate(id: string): void { this.cache.delete(id) }

  /** Keeps the login's answer but has the next `prime` read it again in the background. */
  markStale(id: string): void {
    const cached = this.cache.get(id)
    if (cached !== undefined) this.cache.set(id, { ...cached, readAt: Number.NEGATIVE_INFINITY })
  }

  clear(): void { this.cache.clear() }

  private async load(ids: readonly string[]): Promise<void> {
    let records
    try {
      records = await readStoredRecords(ids.map((id) => this.options.secureStorageDir(id)), this.options.read, this.options.accounts)
    } catch {
      for (const id of ids) this.settle(id, null, 'not_run')
      return
    }
    ids.forEach((id, index) => {
      const record = records[index]
      if (record === undefined || record.kind === 'missing') this.settle(id, null, null)
      else if (record.kind === 'failed') this.settle(id, null, 'failed')
      else {
        const value = parseCredentials(record.text)
        this.settle(id, value, value === null ? 'not_credentials' : null)
      }
    })
  }

  private settle(id: string, value: ClaudeCredentials | null, failure: CredentialManagerFailureKind | null): void {
    this.cache.set(id, { readAt: this.now(), value })
    if (failure === null) {
      this.failureLogged.delete(id)
    } else if (!this.failureLogged.has(id) && !this.options.fileExists(id)) {
      // A login with a file has its token there, so a failure to read it here is not reported.
      this.failureLogged.add(id)
      this.options.onFailure?.({ id, kind: failure })
    }
  }

  private now(): number { return this.options.now?.() ?? Date.now() }
}
