// Which Codex login `kurmis codex` starts on when no `--login` is given, read off the daemon's
// status answer. Codex has no proxy, so the choice is made once, when the CLI starts, with the
// same ranking Claude's Auto uses for each request (`chooseAccount` in `account-router.ts`).
// Pure: the caller passes the status and the time.
import {
  accountsInScope,
  chooseAccount,
  effectivePin,
  poolReadyAt,
  routeBlock,
  type RouteAccount,
  type RouteBlock,
  type RouteSession
} from './account-router.ts'
import { CODEX_DEFAULT_ACCOUNT_ID } from './accounts.ts'
import type { AccountUsage } from './claude-usage.ts'
import type { LoginStatus, StatusAnswer } from './control-api.ts'
import { countdownIn } from './countdown.ts'
import { resetsAtFromUsage } from './usage-rules.ts'

/**
 * How old a Codex usage snapshot may be before `kurmis codex` asks for a new one: the daemon's
 * 15-minute probe interval plus 5 minutes, so a snapshot is only called old when a scheduled
 * probe was missed (the daemon was asleep, or just started), not while the next one is due.
 * Codex usage comes only from probes, because no Codex request passes through the daemon.
 */
export const CODEX_USAGE_MAX_AGE_MS = 20 * 60_000

/**
 * Whether a Codex login counts as signed in for the choice. `signedIn: null` means the daemon
 * has not looked yet, which happens only right after it starts. It counts as signed in: every
 * extra login was added by a `kurmis login` that succeeded, and if the guess is wrong Codex says
 * so itself when it starts. Counting it as signed out would make a freshly started daemon send
 * every `kurmis codex` to the fallback.
 */
export function codexSignedIn(login: Pick<LoginStatus, 'signedIn'>): boolean {
  return login.signedIn !== false
}

/** The Codex logins of a status answer as the routing rules read them. */
export function codexRouteAccounts(status: Pick<StatusAnswer, 'logins'>): RouteAccount[] {
  return status.logins.filter((login) => login.provider === 'codex').map((login) => {
    const signedIn = codexSignedIn(login)
    return {
      id: login.id,
      loggedIn: signedIn,
      // Codex signs its own requests, so a login it is signed in to is one it can use.
      credentialsReadable: signedIn,
      tokenExpiresAt: null,
      usage: login.usage,
      autoRoute: login.routing,
      fiveHourLimitPercent: login.fiveHourLimit,
      weeklyLimitPercent: login.weeklyLimit,
      useFirst: login.useFirst,
      cooldownUntil: refusedUntil(login.usage)
    }
  })
}

/**
 * Until when a Codex login is out although no window may read 100%: the server said the account
 * may not spend (a limit was reached or the spending control is on). Codex has no proxy that
 * would see a refusal, so this stands in for the cooldown a Claude login gets. Until its reset,
 * or until a probe says otherwise when it names none (Infinity). Null when the server said nothing.
 */
function refusedUntil(usage: AccountUsage | null): number | null {
  if (usage?.status !== 'rejected') return null
  const reset = resetsAtFromUsage(usage)
  const at = reset === null ? NaN : Date.parse(reset)
  return Number.isFinite(at) ? at : Infinity
}

/** The session the choice is made for: a new one, at home on `codex:default`, on Auto. */
const CODEX_SESSION: RouteSession = { homeAccountId: CODEX_DEFAULT_ACCOUNT_ID, currentAccountId: null, pinnedAccountId: null }

/** Why `chooseCodexLogin` answered the login it did. */
export type CodexChoiceKind =
  /** The login that ranks first. */
  | 'ranked'
  /** No Codex login is opted in to routing, so the machine's own login is used. */
  | 'default'
  /** Every login routing may use is at a limit; this one gets its usage back first. */
  | 'all-out'
  /** No login routing may use is signed in, or `codex:default` is not when it is the only choice. */
  | 'none-signed-in'

export interface CodexChoice {
  login: string
  kind: CodexChoiceKind
  /** One sentence for stderr when the choice is not the plain ranked one; null otherwise. */
  note: string | null
}

/**
 * The Codex login to start on. Normally the one `chooseAccount` ranks first. When every login
 * routing may use is at one of its limits, the one whose usage comes back first, with a note
 * that says when. When none of them is signed in, `codex:default`, with a note.
 */
export function chooseCodexLogin(status: Pick<StatusAnswer, 'logins'>, now: number): CodexChoice {
  const rows = codexRouteAccounts(status)
  const chosen = chooseAccount(CODEX_SESSION, rows, now, new Set())
  const pinned = effectivePin(CODEX_SESSION, rows)
  if (chosen !== null) return { login: chosen.id, kind: pinned === null ? 'ranked' : 'default', note: null }
  if (pinned !== null) {
    return {
      login: pinned,
      kind: 'none-signed-in',
      note: `${pinned} does not look signed in; starting Codex on it anyway.`
    }
  }
  const inScope = accountsInScope(CODEX_SESSION, rows)
  if (inScope.length === 0) {
    return {
      login: CODEX_DEFAULT_ACCOUNT_ID,
      kind: 'none-signed-in',
      note: `No Codex login that routing may use is signed in; starting on ${CODEX_DEFAULT_ACCOUNT_ID}.`
    }
  }
  let best: { id: string; readyAt: number } | null = null
  for (const row of inScope) {
    // One login on its own: when it can serve again, measured against its own limits.
    const readyAt = poolReadyAt([row], now, null, CODEX_DEFAULT_ACCOUNT_ID)
    if (readyAt !== null && (best === null || readyAt < best.readyAt)) best = { id: row.id, readyAt }
  }
  if (best === null) {
    const first = inScope[0] as RouteAccount
    return {
      login: first.id,
      kind: 'all-out',
      note: `Every Codex login is at its limit and none says when it resets; starting on ${first.id}.`
    }
  }
  const when = countdownIn(best.readyAt, now) ?? 'now'
  return {
    login: best.id,
    kind: 'all-out',
    note: `Every Codex login is at its limit; starting on ${best.id}, whose usage comes back first (${when}).`
  }
}

/**
 * Why the Codex choice would pass this login over now, or null when it could be chosen. The
 * daemon reports blocks for Claude logins only, so `kurmis status` asks this for Codex ones.
 */
export function codexRouteBlock(status: Pick<StatusAnswer, 'logins'>, id: string, now: number): RouteBlock | null {
  const row = codexRouteAccounts(status).find((account) => account.id === id)
  return row === undefined ? null : routeBlock(row, now)
}

/**
 * Whether a login's usage snapshot is missing or older than `CODEX_USAGE_MAX_AGE_MS`. A
 * snapshot from the future (a clock that moved back) is not old.
 */
export function codexUsageStale(login: Pick<LoginStatus, 'usage'>, now: number): boolean {
  return login.usage === null || now - login.usage.fetchedAt > CODEX_USAGE_MAX_AGE_MS
}

/**
 * The Codex logins worth a usage probe before choosing: opted in to routing, signed in (or not
 * yet checked), and with missing or old usage. Empty when fewer than two logins are in the
 * running, because then the usage cannot change the choice: the one login is taken whether it
 * has room or not.
 */
export function codexLoginsToProbe(status: Pick<StatusAnswer, 'logins'>, now: number): string[] {
  const candidates = status.logins.filter((login) =>
    login.provider === 'codex' && login.routing && codexSignedIn(login))
  if (candidates.length < 2) return []
  return candidates.filter((login) => codexUsageStale(login, now)).map((login) => login.id)
}

/**
 * Whether an inherited `CODEX_HOME` is one kurmis set for an extra login: a folder inside the
 * data folder's `codex/` folder (`codexLoginsFolder`). A `kurmis codex` started from a shell
 * inside another `kurmis codex` session on an extra login inherits that session's
 * `CODEX_HOME`, and a start on `codex:default` must not run on it. A `CODEX_HOME` anywhere
 * else is the user's own and is the machine's own login. Paths are compared as given, after
 * removing trailing separators; on Windows (`windows`) without regard to case and with either
 * slash.
 */
export function isKurmisCodexHome(codexHome: string | undefined, codexLoginsFolder: string, windows: boolean): boolean {
  if (codexHome === undefined || codexHome === '') return false
  const normal = (path: string): string => {
    const slashes = windows ? path.replace(/\//g, '\\') : path
    const trimmed = slashes.replace(windows ? /\\+$/ : /\/+$/, '')
    return windows ? trimmed.toLowerCase() : trimmed
  }
  const home = normal(codexHome)
  const folder = normal(codexLoginsFolder)
  return home.startsWith(folder + (windows ? '\\' : '/'))
}
