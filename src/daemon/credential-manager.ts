// The Windows Credential Manager `CredentialsSource`: a Claude login's record as newer Claude
// Code versions keep it on Windows (`src/platform/windows-credentials.ts` says how).
//
// Claude Code reads Credential Manager first and `.credentials.json` when it has nothing, and
// deletes the file once the record is in Credential Manager. So a login whose file exists keeps
// its record in the file, and this reader is asked only about logins without one: `read`
// answers null for a login whose file exists, and `prime` reads only the others. One PowerShell
// run reads every such login, at most once per `KEYCHAIN_CACHE_MS`. Starting PowerShell and
// compiling its `CredReadW` declaration takes a second or two, so `prime` waits only for a login
// read for the first time (or since `invalidate`); an answer that is merely old is read again in
// the background while `read` goes on answering it. A failed read is reported once per login
// through `onFailure` until a read of it works; the record itself is kept in memory only.
import { parseCredentials, type ClaudeCredentials } from '../core/credentials.ts'
import { readStoredRecords, type CredentialRead } from '../platform/windows-credentials.ts'
import type { CredentialsSource } from './credentials.ts'
import { KEYCHAIN_CACHE_MS } from './keychain.ts'

/** Why a Credential Manager read gave no token: PowerShell could not read at all, the record is not one, or another failure. */
export type CredentialManagerFailureKind = 'not_run' | 'not_credentials' | 'failed'

export interface CredentialManagerReaderOptions {
  /** The `CLAUDE_SECURESTORAGE_CONFIG_DIR` the login's CLI is started with, or null for `claude:default`. */
  secureStorageDir(id: string): string | null
  /** Whether the login's `.credentials.json` exists; such a login is not read from Credential Manager. */
  fileExists(id: string): boolean
  read: CredentialRead
  now?: () => number
  onFailure?: (failure: { id: string; kind: CredentialManagerFailureKind }) => void
}

export class CredentialManagerReader implements CredentialsSource {
  private readonly cache = new Map<string, { readAt: number; value: ClaudeCredentials | null }>()
  private readonly failureLogged = new Set<string>()
  private running: Promise<void> | null = null

  constructor(private readonly options: CredentialManagerReaderOptions) {}

  read(id: string): ClaudeCredentials | null {
    if (this.options.fileExists(id)) return null
    return this.cache.get(id)?.value ?? null
  }

  async prime(ids: readonly string[]): Promise<void> {
    const wanted = [...new Set(ids)].filter((id) => !this.options.fileExists(id))
    const unread = (): boolean => wanted.some((id) => !this.cache.has(id))
    // A run that is going on may cover the logins never read yet; wait for it first.
    if (this.running !== null && unread()) await this.running
    const due = wanted.filter((id) => {
      const cached = this.cache.get(id)
      return cached === undefined || this.now() - cached.readAt >= KEYCHAIN_CACHE_MS
    })
    if (due.length === 0) return
    if (this.running === null) this.running = this.load(due).finally(() => { this.running = null })
    if (unread()) await this.running
  }

  invalidate(id: string): void { this.cache.delete(id) }

  clear(): void { this.cache.clear() }

  private async load(ids: readonly string[]): Promise<void> {
    let records
    try {
      records = await readStoredRecords(ids.map((id) => this.options.secureStorageDir(id)), this.options.read)
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
    } else if (!this.failureLogged.has(id)) {
      this.failureLogged.add(id)
      this.options.onFailure?.({ id, kind: failure })
    }
  }

  private now(): number { return this.options.now?.() ?? Date.now() }
}
