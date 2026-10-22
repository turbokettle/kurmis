// Who a Claude login is: the `oauthAccount` block the CLI caches in a config folder's
// `.claude.json`. The proxy needs the account uuid for `metadata.user_id` (`rewriteUserId` in
// `src/core/proxy-rules.ts`), `kurmis login` and `status` show the email, and the login's automatic
// alias is made from it (`followEmail` in `config.ts`). The email and the organization uuid
// together tell whether two logins are the same account (`isSameClaudeAccount`).
//
// The block is read only from a config folder that this login's own CLI runs write, so it can
// never name another login: the login's folder for an extra login (written by `claude auth login`
// and by its usage probes), and the probe folder for plain claude's login (written by its
// probes).
// The shared `~/.claude.json` is read for plain claude's login only while the probe folder has no
// `.claude.json`, that is before its first probe, so that `kurmis login` on a new machine can
// tell that an account is already plain claude's. Once a probe has written the file, it alone
// counts, even when it names nobody: every CLI that uses the default config folder writes its
// account to the shared file, including a `kurmis claude` started on an extra login.
//
// The email is personal data. It may be shown to the person on their own terminal, and is never
// written to the log or to any file kurmis keeps.
import { existsSync, readFileSync, statSync } from 'node:fs'
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
 * The file the identity of a login is read from: its own folder's `.claude.json` for an extra
 * login. For plain claude's login it is the probe folder's, or `~/.claude.json` while the probe
 * folder has none.
 */
export function claudeIdentityFile(login: LoginRef, home: string = homedir()): string {
  if (!login.usedByPlainCli) return join(loginFolder(login), CLAUDE_PROFILE_FILE)
  const probed = join(ownClaudeProbeFolder(), CLAUDE_PROFILE_FILE)
  return existsSync(probed) ? probed : join(home, CLAUDE_PROFILE_FILE)
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

  /** The login's identity, or null when its file names nobody. */
  read(login: LoginRef): ClaudeIdentity | null {
    return this.readFile(claudeIdentityFile(login, this.home()))
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

/** What tells two Claude logins apart as accounts: the email and the organization. */
export interface ClaudeAccountKey {
  email: string | null
  organizationUuid: string | null
}

/**
 * Whether two Claude logins are signed in to the same account, which makes them use one
 * subscription. One email can have a personal plan and a seat in a Team or Enterprise
 * organization, which are two subscriptions, so the emails must be the same (without regard to
 * case) and so must the organization uuids. When either side has no organization recorded, the
 * email alone decides. Without an email on both sides, they are not the same account.
 */
export function isSameClaudeAccount(a: ClaudeAccountKey, b: ClaudeAccountKey): boolean {
  if (!isSameEmail(a.email, b.email)) return false
  if (a.organizationUuid === null || b.organizationUuid === null) return true
  return a.organizationUuid.trim().toLowerCase() === b.organizationUuid.trim().toLowerCase()
}

/** Whether two emails are known and the same, without regard to case or surrounding spaces. */
export function isSameEmail(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** One read, without a cache, for the CLI. */
export function readClaudeIdentity(login: LoginRef, home: string = homedir()): ClaudeIdentity | null {
  return new ClaudeIdentityReader(() => home).read(login)
}
