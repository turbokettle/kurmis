// Login ids and the per-login routing settings.
//
// A login id carries its provider: `claude:<name>` or `codex:<name>`. Only `<name>` names the
// login's folder on disk (`claude/<name>/`, `codex/<name>/` under the data folder), because a
// colon is not allowed in a Windows path. The machine's own logins are `claude:default` and
// `codex:default`.

export type AccountProvider = 'claude' | 'codex'

export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = ['claude', 'codex']

/** The name part of the machine's own login, for either provider. */
export const DEFAULT_LOGIN_NAME = 'default'

/** The machine's own `~/.claude` login. Always listed and never removable. */
export const CLAUDE_DEFAULT_ACCOUNT_ID = 'claude:default'

/** The machine's own `~/.codex` login. Always listed and never removable. */
export const CODEX_DEFAULT_ACCOUNT_ID = 'codex:default'

/** The five-hour routing limit a login has until one is set, in percent. */
export const DEFAULT_FIVE_HOUR_LIMIT_PERCENT = 100

/** The weekly routing limit a login has until one is set, in percent. */
export const DEFAULT_WEEKLY_LIMIT_PERCENT = 100

/** Whether a newly added login is opted in to routing. */
export const DEFAULT_AUTO_ROUTE = true

/**
 * A login name: lower-case letters, digits, `-` and `_`, starting with a letter or digit, at
 * most 32 characters. Lower case only, because the folder it names must not collide with
 * another on a case-insensitive file system.
 */
const LOGIN_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** Names Windows reserves for devices, which cannot be folder names there. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/

/** Whether `name` can be the name part of a login id, and so a folder name on every platform. */
export function isLoginName(name: string): boolean {
  return LOGIN_NAME.test(name) && !WINDOWS_RESERVED.test(name)
}

/** `('codex', 'work')` -> `codex:work`. */
export function accountId(provider: AccountProvider, name: string): string {
  return `${provider}:${name}`
}

/**
 * The provider and name of a login id, or null when it is not one: no known provider prefix, or
 * a name `isLoginName` refuses.
 */
export function parseAccountId(id: string): { provider: AccountProvider; name: string } | null {
  const colon = id.indexOf(':')
  if (colon < 0) return null
  const provider = id.slice(0, colon)
  const name = id.slice(colon + 1)
  if (provider !== 'claude' && provider !== 'codex') return null
  return isLoginName(name) ? { provider, name } : null
}

/** The provider of a login id, or null when it is not a login id. */
export function accountProviderOf(id: string | null | undefined): AccountProvider | null {
  return typeof id === 'string' ? parseAccountId(id)?.provider ?? null : null
}

/** `codex:work` -> `work`, the name of the login's folder. Null when it is not a login id. */
export function loginNameOf(id: string): string | null {
  return parseAccountId(id)?.name ?? null
}

export function defaultAccountIdFor(provider: AccountProvider): string {
  return provider === 'codex' ? CODEX_DEFAULT_ACCOUNT_ID : CLAUDE_DEFAULT_ACCOUNT_ID
}

/** True for either provider's machine-wide login, which cannot be removed. */
export function isDefaultAccountId(id: string | null | undefined): boolean {
  return id === CLAUDE_DEFAULT_ACCOUNT_ID || id === CODEX_DEFAULT_ACCOUNT_ID
}

/** A stored routing limit held to the whole 1..100 it may be, or null when it is not a number. */
export function asRoutingLimit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(1, Math.round(value)))
}

/** A login's two routing limits as stored, with a missing or broken one at its default. */
export function routingLimitsOf(row: { fiveHourLimitPercent?: unknown; weeklyLimitPercent?: unknown }): {
  fiveHourLimitPercent: number
  weeklyLimitPercent: number
} {
  return {
    fiveHourLimitPercent: asRoutingLimit(row.fiveHourLimitPercent) ?? DEFAULT_FIVE_HOUR_LIMIT_PERCENT,
    weeklyLimitPercent: asRoutingLimit(row.weeklyLimitPercent) ?? DEFAULT_WEEKLY_LIMIT_PERCENT
  }
}
