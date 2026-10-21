// The providers, the rules for login ids, and the per-login routing settings.
//
// A login id is 1 to 32 lowercase letters and digits. Kurmis makes them random
// (`newLoginId` in `src/data/login-id.ts`); the rule here is what a stored id is checked
// against, so that it is always a safe folder name and a safe value for the log.

export type AccountProvider = 'claude' | 'codex'

export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = ['claude', 'codex']

/** The five-hour routing limit a login has until one is set, in percent. */
export const DEFAULT_FIVE_HOUR_LIMIT_PERCENT = 100

/** The weekly routing limit a login has until one is set, in percent. */
export const DEFAULT_WEEKLY_LIMIT_PERCENT = 100

/** Whether a newly added login is opted in to routing. */
export const DEFAULT_AUTO_ROUTE = true

/**
 * Lowercase only, because the folder the id names must not collide with another on a
 * case-insensitive file system.
 */
const LOGIN_ID = /^[a-z0-9]{1,32}$/

/**
 * Names Windows reserves for devices, which cannot be folder names there; `none`, which the
 * `x-kurmis-started-on` header uses for "no kurmis login"; `invalid`, which `readRouteRequest`
 * answers for a header that names no login; and the provider names, which `kurmis login` takes
 * in place of a login.
 */
const RESERVED_IDS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|none|invalid|claude|codex)$/

/** Whether `text` can be a login id, and so a folder name on every platform. */
export function isLoginIdText(text: string): boolean {
  return LOGIN_ID.test(text) && !RESERVED_IDS.test(text)
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
