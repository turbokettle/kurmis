// Who a Claude login is: the `oauthAccount` block the CLI caches in a config folder's
// `.claude.json`. The proxy needs the account uuid for `metadata.user_id` (`rewriteUserId` in
// `src/core/proxy-rules.ts`), `kurmis list` and `status` show the email, and the login's automatic
// alias is made from it (`followEmail` in `config.ts`).
//
// The block is read only from a config folder that this login's own CLI runs write, so it can
// never name another login: the login's folder for an extra login (written by `claude auth login`
// and by its usage probes), and the probe folder for the machine's own login (written by its
// probes).
// The shared `~/.claude.json` is read for the machine's own login only before its first probe has
// written the probe folder's file, as a last resort: a routed CLI writes there too, but always
// on behalf of the machine's own login.
//
// The email is personal data. It may be shown to the person on their own terminal, and is never
// written to the log or to any file kurmis keeps.
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { LoginRef } from './login-id.ts'
import { loginFolder, ownClaudeProbeFolder } from './paths.ts'

/** The CLI's own cache of its profile, inside a config folder or at `~/.claude.json`. */
export const CLAUDE_PROFILE_FILE = '.claude.json'

export interface ClaudeIdentity {
  accountUuid: string | null
  email: string | null
  organizationUuid: string | null
  organizationName: string | null
}

/**
 * The files the identity of a login is read from, best first: for an extra login only its own
 * folder's `.claude.json`, for the machine's own login the probe folder's and then
 * `~/.claude.json`.
 */
export function claudeIdentityFiles(login: LoginRef, home: string = homedir()): string[] {
  if (login.machineOwn) {
    return [join(ownClaudeProbeFolder(), CLAUDE_PROFILE_FILE), join(home, CLAUDE_PROFILE_FILE)]
  }
  return [join(loginFolder(login), CLAUDE_PROFILE_FILE)]
}

/** The `oauthAccount` block of a `.claude.json`, or null when there is none or it names nobody. */
export function parseClaudeIdentity(text: string): ClaudeIdentity | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object') return null
    const block = (parsed as Record<string, unknown>)['oauthAccount']
    if (block === null || typeof block !== 'object') return null
    const oauth = block as Record<string, unknown>
    const identity: ClaudeIdentity = {
      accountUuid: textOf(oauth['accountUuid']),
      email: textOf(oauth['emailAddress']),
      organizationUuid: textOf(oauth['organizationUuid']),
      organizationName: textOf(oauth['organizationName'])
    }
    return identity.accountUuid === null && identity.email === null ? null : identity
  } catch {
    return null
  }
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Reads identities, keeping each file's answer for as long as its size and modification time
 * stay the same, so the proxy can ask on every request for the cost of a `stat`.
 */
export class ClaudeIdentityReader {
  private readonly cache = new Map<string, { mtime: number; size: number; value: ClaudeIdentity | null }>()

  constructor(private readonly home: () => string = homedir) {}

  /** The login's identity from the first of its files that names somebody, or null. */
  read(login: LoginRef): ClaudeIdentity | null {
    for (const file of claudeIdentityFiles(login, this.home())) {
      const value = this.readFile(file)
      if (value !== null) return value
    }
    return null
  }

  private readFile(file: string): ClaudeIdentity | null {
    try {
      const stat = statSync(file)
      const cached = this.cache.get(file)
      if (cached?.mtime === stat.mtimeMs && cached.size === stat.size) return cached.value
      let value: ClaudeIdentity | null = null
      try {
        value = parseClaudeIdentity(readFileSync(file, 'utf8'))
      } catch { /* A file that cannot be read names nobody. */ }
      this.cache.set(file, { mtime: stat.mtimeMs, size: stat.size, value })
      return value
    } catch {
      this.cache.delete(file)
      return null
    }
  }
}

/** One read, without a cache, for the CLI. */
export function readClaudeIdentity(login: LoginRef, home: string = homedir()): ClaudeIdentity | null {
  return new ClaudeIdentityReader(() => home).read(login)
}
