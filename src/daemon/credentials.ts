// Where the proxy gets each Claude login's access token, and the reader for the
// `.credentials.json` file the CLI writes on Windows and Linux.
//
// The macOS Keychain reader is `KeychainCredentialsReader` in `keychain.ts`, and the Windows
// Credential Manager reader `CredentialManagerReader` in `credential-manager.ts`.
// `createTokenSource` in `tokens.ts` puts them together: on macOS the Keychain item first and
// this file when the item gives no token, on Windows Credential Manager first and this file
// when Credential Manager has no record, on Linux this file only.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseCredentials, type ClaudeCredentials } from '../core/credentials.ts'

/** The name of the file the CLI keeps a login's credentials in, inside its config folder. */
export const CREDENTIALS_FILE_NAME = '.credentials.json'

/**
 * Where the proxy reads a login's token. Both readers keep tokens in memory only.
 *
 * `read` is what every routing decision calls, so it answers from what the source already has
 * rather than going to look. `prime` does the looking, for a source that has to run a program
 * to find out (the Keychain). A source that has nothing for a login answers null for it.
 */
export interface CredentialsSource {
  /** The login's token as last read, or null when there is none. Never blocks. */
  read(id: string): ClaudeCredentials | null
  /** Reads these logins again where needed, so the next `read` is current. Never rejects. */
  prime(ids: readonly string[]): Promise<void>
  /**
   * Has the next `prime` or `read` read the login again. A source that reads in `prime` goes on
   * answering the old token from `read` until the new read has landed, and its next `prime`
   * waits for that read.
   */
  invalidate(id: string): void
  /** Forgets what was read for every login. */
  clear(): void
}

export interface CredentialsFileReaderOptions {
  /**
   * The folder holding a login's `.credentials.json`: the login's own folder for an extra
   * login, and the machine's own Claude config folder (normally `~/.claude`) for
   * `claude:default`.
   */
  credentialsDir(id: string): string
}

/**
 * Reads `<credentialsDir>/.credentials.json` whenever `read` is called. The parsed answer is kept
 * for as long as the file's modification time and size stay the same, so a token the CLI has
 * just renewed is seen on the next request, and an unchanged file costs one `stat`.
 */
export class CredentialsFileReader implements CredentialsSource {
  private readonly cache = new Map<string, { mtime: number; size: number; value: ClaudeCredentials | null }>()

  constructor(private readonly options: CredentialsFileReaderOptions) {}

  read(id: string): ClaudeCredentials | null {
    const path = this.pathOf(id)
    try {
      const stat = statSync(path)
      const cached = this.cache.get(path)
      if (cached?.mtime === stat.mtimeMs && cached.size === stat.size) return cached.value
      let value: ClaudeCredentials | null = null
      try {
        value = parseCredentials(readFileSync(path, 'utf8'))
      } catch { /* A file that cannot be read holds no token. */ }
      this.cache.set(path, { mtime: stat.mtimeMs, size: stat.size, value })
      return value
    } catch {
      this.cache.delete(path)
      return null
    }
  }

  /** Nothing to do: `read` reads the file itself. */
  prime(_ids: readonly string[]): Promise<void> { return Promise.resolve() }

  invalidate(id: string): void { this.cache.delete(this.pathOf(id)) }

  clear(): void { this.cache.clear() }

  private pathOf(id: string): string {
    return join(this.options.credentialsDir(id), CREDENTIALS_FILE_NAME)
  }
}
