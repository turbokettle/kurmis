// The rules for login ids, and the per-login routing settings.
//
// A login id is 1 to 32 lowercase letters and digits. Kurmis makes them random
// (`newLoginId` in `src/data/login-id.ts`); the rule here is what a stored id is checked
// against, so that it is always a safe folder name and a safe value for the log.

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
 * `x-kurmis-started-on` header uses for "no kurmis login"; and `invalid`, which
 * `readRouteRequest` answers for a header that names no login.
 */
const RESERVED_IDS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|none|invalid)$/

/** Whether `text` can be a login id, and so a folder name on every platform. */
export function isLoginIdText(text: string): boolean {
  return LOGIN_ID.test(text) && !RESERVED_IDS.test(text)
}
