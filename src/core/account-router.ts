// Which login serves the next request of a Claude session, and what an upstream answer means
// for the login that gave it.
//
// `RouteAccount` is what the rules read of one login, `RouteSession` what they read of one
// session. The daemon builds both from `config.json`, `state.json`, the token readers and the
// usage snapshots, and keeps the results (cooldowns, the login a session is on) itself.
import { isoFromSeconds, type AccountUsage, type NamedUsageWindow, type UsageStatus } from './claude-usage.ts'
import { usageFromRateLimitEvent } from './usage.ts'
import { busiestPlanWindow, isSevenDayWindow, planUsageWindows, usageAsOf } from './usage-rules.ts'

/** Reads one header of an answer, case-insensitively; null or undefined when it is not there. */
export type HeaderGetter = (name: string) => string | null | undefined

const PREFIX = 'anthropic-ratelimit-unified-'
const WINDOW_NAMES = {
  '5h': 'five_hour',
  '7d': 'seven_day',
  '7d_oi': 'seven_day_overage_included',
  overage: 'overage'
} as const

interface UnifiedWindow {
  utilization: number | null
  resetsAt: string | null
  status: UsageStatus | null
}

/** What the `anthropic-ratelimit-unified-*` headers of one answer said. */
export interface UnifiedObservation {
  observedAt: number
  status: UsageStatus | null
  resetsAt: string | null
  /** The window the answer's status is about, as the header names it (`five_hour`, `7d`, ...). */
  representativeClaim: string | null
  windows: Partial<Record<keyof typeof WINDOW_NAMES, UnifiedWindow>>
  overageStatus: UsageStatus | null
  overageDisabledReason: string | null
}

/**
 * Reads the `anthropic-ratelimit-unified-*` headers of an answer. A header that is missing or
 * does not read is null, and a window none of whose three headers is there is left out.
 */
export function parseUnifiedHeaders(get: HeaderGetter, now: number): UnifiedObservation {
  const windows: UnifiedObservation['windows'] = {}
  for (const suffix of Object.keys(WINDOW_NAMES) as (keyof typeof WINDOW_NAMES)[]) {
    const utilization = get(`${PREFIX}${suffix}-utilization`)
    const reset = get(`${PREFIX}${suffix}-reset`)
    const status = get(`${PREFIX}${suffix}-status`)
    if (utilization == null && reset == null && status == null) continue
    const fraction = headerNumber(utilization)
    windows[suffix] = {
      utilization: fraction !== null && fraction >= 0 && fraction <= 1 ? fraction : null,
      resetsAt: isoFromSeconds(headerNumber(reset)),
      status: readStatus(status)
    }
  }
  return {
    observedAt: now,
    status: readStatus(get(`${PREFIX}status`)),
    resetsAt: isoFromSeconds(headerNumber(get(`${PREFIX}reset`))),
    representativeClaim: headerText(get(`${PREFIX}representative-claim`)),
    windows,
    overageStatus: readStatus(get(`${PREFIX}overage-status`)),
    overageDisabledReason: headerText(get(`${PREFIX}overage-disabled-reason`))
  }
}

/**
 * Folds what one answer's headers said into the login's usage snapshot. Only the windows the
 * headers carry are replaced; the rest stays as the last probe left it.
 */
export function usageFromUnifiedHeaders(
  accountId: string,
  previous: AccountUsage | null,
  observation: UnifiedObservation
): AccountUsage {
  const unifiedWindows: Record<string, { utilization: number | null; resetsAt: number | null }> = {}
  for (const [suffix, window] of Object.entries(observation.windows)) {
    unifiedWindows[windowName(suffix)] = {
      utilization: window.utilization,
      resetsAt: secondsFromIso(window.resetsAt)
    }
  }
  return usageFromRateLimitEvent(accountId, previous, {
    status: observation.status,
    resetsAt: secondsFromIso(observation.resetsAt),
    rateLimitType: observation.representativeClaim === null ? null : windowName(observation.representativeClaim),
    unifiedWindows
  }, observation.observedAt)
}

/**
 * Whether an answer is a usage-limit refusal: a 429 with the unified rate-limit headers that
 * say the login's plan is used up. A 429 without them is a want of capacity
 * (`capacityRefusal` in `capacity-hold.ts`). The CLI tells the two apart the same way.
 */
export function isDefinitiveQuotaRejection(status: number, get: HeaderGetter): boolean {
  return status === 429 && (
    readStatus(get(`${PREFIX}status`)) === 'rejected' ||
    get(`${PREFIX}representative-claim`) != null ||
    get(`${PREFIX}overage-status`) != null
  )
}

/**
 * Until when a login that refused a request with a usage limit is skipped, in ms since the
 * epoch, or null when the answer is not a usage-limit refusal. The answer's own reset comes
 * first, then the reset of the window it named, then the latest reset of the windows it marks
 * rejected. `Infinity` when none of them says: the login is then skipped until a usage probe
 * says it is back (`cooldownAfterProbe` in `proxy-rules.ts`).
 */
export function quotaCooldownUntil(status: number, get: HeaderGetter): number | null {
  if (!isDefinitiveQuotaRejection(status, get)) return null
  const observation = parseUnifiedHeaders(get, 0)
  const named = observation.representativeClaim
  const window = Object.entries(observation.windows).find(([suffix]) =>
    named !== null && windowName(suffix) === windowName(named))?.[1]
  const reset = observation.resetsAt ?? window?.resetsAt ?? null
  if (reset !== null) return Date.parse(reset)
  const rejected = Object.values(observation.windows).filter((entry) => entry.status === 'rejected')
  return rejected.length === 0 ? Infinity : Math.max(
    ...rejected.map((entry) => entry.resetsAt === null ? Infinity : Date.parse(entry.resetsAt))
  )
}

/** What the routing rules read of one Claude login. */
export interface RouteAccount {
  id: string
  /** The login has credentials here at all, readable or not. */
  loggedIn: boolean
  /** The daemon can sign for it: it read a token, or the CLI's own header signs for it. */
  credentialsReadable: boolean
  /** Milliseconds since epoch; null when expiry is unknown. */
  tokenExpiresAt: number | null
  usage: AccountUsage | null
  /** Opted in to routing: the login is in the pool of every session on Auto. */
  autoRoute: boolean
  /** 1..100, compared only against the five-hour window. */
  fiveHourLimitPercent: number
  /** 1..100, compared only against the seven-day windows. */
  weeklyLimitPercent: number
  /** Taken ahead of every other eligible login. Several marked fall to the weekly reset. */
  useFirst: boolean
  /** Milliseconds since epoch; Infinity for a usage-limit refusal with no known reset. */
  cooldownUntil: number | null
}

/** What the routing rules read of one session. */
export interface RouteSession {
  /**
   * The login the session's CLI was started on: its pinned login, or on Auto the login plain
   * claude or plain codex uses. Ties in the ranking go to it, and an Auto session with no pool runs on
   * it (`effectivePin`).
   */
  homeAccountId: string
  /** The login that served the previous request; change it only after an answer is accepted. */
  currentAccountId: string | null
  /** The login the session is held to, or null on Auto. */
  pinnedAccountId?: string | null
}

/** The fullness of the login's busiest plan window, in percent; null with no reading. */
export function worstUtilisation(usage: AccountUsage | null): number | null {
  return busiestPlanWindow(usage)?.utilization ?? null
}

/** How long a token has to be good for before a login is worth choosing. */
export const TOKEN_MARGIN_MS = 5 * 60_000

/** Whether a token is good for long enough to sign with. A token with no known expiry is. */
export function tokenIsFresh(expiresAt: number | null, now: number): boolean {
  return expiresAt === null || expiresAt > now + TOKEN_MARGIN_MS
}

/**
 * Why a login cannot serve the next request of an Auto session. Null means it can. `eligible`
 * calls `routeBlock`, so `kurmis status` and the proxy apply the same rule. The first reason
 * found is the one reported.
 */
export type RouteBlock =
  | { kind: 'auto-route-off' }
  | { kind: 'signed-out' }
  | { kind: 'no-credentials' }
  | { kind: 'token-expiring' }
  /** A usage-limit refusal the proxy saw. `until` is null when the reset is unknown. */
  | { kind: 'cooldown'; until: number | null }
  /** A plan window has reached the limit this login sets for that window's length. */
  | {
      kind: 'over-limit'
      utilization: number
      /** The limit that window is measured against, not the login's other one. */
      limitPercent: number
      /** The window's name, e.g. `5 hour`. */
      window: string
      resetsAt: string | null
    }

/**
 * The routing limit that applies to one plan window. A login has one per window length, and
 * each window is measured only against its own, so a full five-hour window does not count
 * against the weekly limit.
 */
export function limitForWindow(
  account: Pick<RouteAccount, 'fiveHourLimitPercent' | 'weeklyLimitPercent'>,
  window: NamedUsageWindow
): number {
  return isSevenDayWindow(window) ? account.weeklyLimitPercent : account.fiveHourLimitPercent
}

/**
 * A login's plan windows as they stand at `now`. A window whose reset time has passed is
 * empty, whatever the last reading said, because that figure belongs to the window that
 * ended. Every rule below reads usage through this.
 */
function windowsAsOf(account: RouteAccount, now: number): NamedUsageWindow[] {
  return planUsageWindows(usageAsOf(account.usage, now))
}

/**
 * The plan window that has reached its own limit, or null while every one of them has room.
 * The busiest such window is answered. A login with no usage reading has no window and is not
 * blocked.
 */
function windowOverLimit(account: RouteAccount, now: number): NamedUsageWindow | null {
  let worst: NamedUsageWindow | null = null
  for (const window of windowsAsOf(account, now)) {
    if (window.utilization < limitForWindow(account, window)) continue
    if (worst === null || window.utilization > worst.utilization) worst = window
  }
  return worst
}

export function routeBlock(account: RouteAccount, now: number): RouteBlock | null {
  if (!account.autoRoute) return { kind: 'auto-route-off' }
  if (!account.loggedIn) return { kind: 'signed-out' }
  if (!account.credentialsReadable) return { kind: 'no-credentials' }
  if (!tokenIsFresh(account.tokenExpiresAt, now)) return { kind: 'token-expiring' }
  if (account.cooldownUntil !== null && account.cooldownUntil > now) {
    return { kind: 'cooldown', until: Number.isFinite(account.cooldownUntil) ? account.cooldownUntil : null }
  }
  const over = windowOverLimit(account, now)
  if (over !== null) {
    return {
      kind: 'over-limit',
      utilization: over.utilization,
      limitPercent: limitForWindow(account, over),
      window: over.label,
      resetsAt: over.resetsAt
    }
  }
  return null
}

export function eligible(account: RouteAccount, now: number): boolean {
  return routeBlock(account, now) === null
}

/**
 * When this login's seven-day window comes back, or null when nothing has measured it. The
 * two weekly windows a Claude plan reports share one reset, so the first of them carrying a
 * usable time answers for both.
 */
function sevenDayResetOf(account: RouteAccount): string | null {
  for (const window of planUsageWindows(account.usage)) {
    if (!isSevenDayWindow(window) || window.resetsAt === null) continue
    if (Number.isFinite(Date.parse(window.resetsAt))) return window.resetsAt
  }
  return null
}

/** The same as a number, with an unknown reset sorting after every known one. */
function sevenDayResetTime(account: RouteAccount): number {
  const resetsAt = sevenDayResetOf(account)
  return resetsAt === null ? Infinity : Date.parse(resetsAt)
}

/**
 * The login a session is held to, if any. A pinned session names its own. An Auto session with
 * no login opted in has no pool to choose from, so it runs on `session.homeAccountId`, the
 * login plain claude or plain codex uses, as if pinned there, rather than being told the pool is
 * out of usage. An Auto session whose pool exists but is exhausted keeps null and gets the pool's
 * usage-limit answer.
 */
export function effectivePin(session: RouteSession, accounts: readonly RouteAccount[]): string | null {
  if (session.pinnedAccountId != null) return session.pinnedAccountId
  if (accounts.some((account) => account.autoRoute)) return null
  return session.homeAccountId
}

/** What `autoStartLogin` reads of a login. */
export interface StartableLogin {
  id: string
  /** The login plain claude uses. The list has exactly one such login. */
  usedByPlainCli: boolean
  loggedIn: boolean
  autoRoute: boolean
}

/**
 * The login whose credentials an Auto CLI is started on. The proxy signs an Auto request with
 * whichever login it picks, so this login only has to get the CLI to send at all: a CLI that
 * finds no credentials answers "Not logged in" before it sends anything.
 *
 * So plain claude's login is taken while it is signed in, or when the list does not say.
 * Otherwise `preferred` (the login that served the session last), then the first signed-in
 * login of the pool. When the pool has logins but none of them is signed in, `preferred` is
 * taken when it is in the pool, else the pool's first login: the CLI then fails to sign in on a
 * pool login, which is the problem to fix. With no pool at all, plain claude's login stays,
 * because `effectivePin` holds such a session to it.
 */
export function autoStartLogin(accounts: readonly StartableLogin[], preferred?: string | null): string {
  const own = accounts.find((account) => account.usedByPlainCli)
  if (own === undefined) throw new Error('autoStartLogin: the list has no login that plain claude uses')
  if (own.loggedIn) return own.id
  const pool = accounts.filter((account) => account.autoRoute)
  const signedIn = pool.filter((account) => account.loggedIn)
  const from = signedIn.length > 0 ? signedIn : pool
  return (from.find((account) => account.id === preferred) ?? from[0])?.id ?? own.id
}

/**
 * The logins that could serve this request, best first.
 *
 * A login marked "use first" comes before every other eligible one. Two of them are ordered
 * against each other by the rules below, as any other pair is.
 *
 * Next comes the login that served the session's previous request, for as long as it can
 * serve. Anthropic keeps the prompt cache per login, so the first request on another login
 * reads nothing back and writes the whole conversation to the cache again. A session therefore
 * leaves its login only when that login can no longer serve (a limit, a cooldown, a sign-out,
 * routing turned off for it), or when a login marked "use first" can serve and its own is not
 * marked. A usage-limit refusal moves a request through the replay in the proxy, which excludes
 * the refusing login, and the login that answers is the one the session stays on.
 *
 * Among the rest the one whose seven-day window resets soonest wins: the week is what a login
 * really runs out of, and the login that gets its week back first is the one worth spending
 * now. An unknown weekly reset sorts last. The five-hour window has no say here: a login over
 * its five-hour limit is already out, and one under it gets that window back within hours.
 * Ties go to the session's home login, then to the lower usage.
 */
function rankAccounts(
  session: RouteSession,
  accounts: readonly RouteAccount[],
  now: number,
  exclude: ReadonlySet<string>
): RouteAccount[] {
  return accounts
    .filter((account) => !exclude.has(account.id) && eligible(account, now))
    .sort((a, b) => {
      if (a.useFirst !== b.useFirst) return a.useFirst ? -1 : 1
      const current = Number(b.id === session.currentAccountId) - Number(a.id === session.currentAccountId)
      if (current !== 0) return current
      const resetA = sevenDayResetTime(a)
      const resetB = sevenDayResetTime(b)
      if (resetA !== resetB) return resetA < resetB ? -1 : 1
      return Number(b.id === session.homeAccountId) - Number(a.id === session.homeAccountId) ||
        (worstUtilisation(usageAsOf(a.usage, now)) ?? 100) - (worstUtilisation(usageAsOf(b.usage, now)) ?? 100)
    })
}

/**
 * The login to send the session's next request on, or null when none can. A pinned session
 * (`effectivePin`) gets its login whatever its usage, as long as it is signed in and the
 * daemon can sign for it. `exclude` holds the logins this request has already been sent on.
 */
export function chooseAccount(
  session: RouteSession,
  accounts: readonly RouteAccount[],
  now: number,
  exclude: ReadonlySet<string>
): RouteAccount | null {
  const pinned = effectivePin(session, accounts)
  if (pinned !== null) {
    return accounts.find((account) => account.id === pinned &&
      !exclude.has(account.id) && account.loggedIn && account.credentialsReadable) ?? null
  }
  return rankAccounts(session, accounts, now, exclude)[0] ?? null
}

/** One login's place in the choice, for `kurmis status` to explain it. */
export interface RouteExplanation {
  accountId: string
  /** Why it cannot serve the next request; null when it can. */
  block: RouteBlock | null
  /** The login the router would choose for the next request. At most one row has it. */
  next: boolean
  /** Whether this login is marked to be taken ahead of the others. */
  useFirst: boolean
  /** The plan window with the least left, which says how full the login is. Null with no reading. */
  busiest: { label: string; utilization: number; resetsAt: string | null } | null
  /** When the seven-day window comes back, which is what the ranking compares. */
  sevenDayResetsAt: string | null
  /**
   * The routing limit `busiest` is measured against, in percent: the login's five-hour or
   * weekly one depending on how long that window is. A login with no usage reading reports its
   * five-hour limit.
   */
  limitPercent: number
}

/**
 * Every login the router would look at for this session, and what it makes of each: the ones
 * that can serve in the order it would take them, then the ones it skipped. A pinned session
 * has no choice to explain, so it reports its one login alone.
 */
export function explainRouting(
  session: RouteSession,
  accounts: readonly RouteAccount[],
  now: number
): RouteExplanation[] {
  const pinned = effectivePin(session, accounts)
  const describe = (account: RouteAccount, next: boolean): RouteExplanation => {
    const busiest = busiestPlanWindow(usageAsOf(account.usage, now))
    return {
      accountId: account.id,
      block: routeBlock(account, now),
      next,
      useFirst: account.useFirst,
      busiest: busiest === null
        ? null
        : { label: busiest.label, utilization: busiest.utilization, resetsAt: busiest.resetsAt },
      sevenDayResetsAt: sevenDayResetOf(account),
      limitPercent: busiest === null ? account.fiveHourLimitPercent : limitForWindow(account, busiest)
    }
  }
  if (pinned !== null) {
    const account = accounts.find((row) => row.id === pinned)
    return account === undefined ? [] : [{ ...describe(account, true), block: null }]
  }
  const ranked = rankAccounts(session, accounts, now, new Set())
  const rest = accounts.filter((account) => !ranked.includes(account))
  return [
    ...ranked.map((account, index) => describe(account, index === 0)),
    ...rest.map((account) => describe(account, false))
  ]
}

export interface ReplayInput {
  status: number
  get: HeaderGetter
  servedBy: string
  session: RouteSession
  /** Every login this request was already sent on, including `servedBy`. */
  attempted: ReadonlySet<string>
  /** The answer's body has started reaching the CLI, so nothing can be sent again. */
  responseStarted?: boolean
  deadlineExpired?: boolean
}

/**
 * What to do with an upstream answer before the CLI sees it:
 * - `pass`: forward it.
 * - `replay`: a usage-limit refusal of an Auto session. Skip `servedBy` until `cooldownUntil`
 *   and send the request again on another login. With no other login left, the pool's own
 *   429 answers (`poolLimitAnswer` in `proxy-rules.ts`).
 * - `pin-back`: a 400 on a login the session has just moved to. Some conversations cannot be
 *   continued on another login, so the request goes again on the login that served the session
 *   before, and the session is held to that login from then on.
 *
 * A pinned session gets every answer as it stands. Its login's cooldown still has to be noted
 * (`quotaCooldownUntil`).
 */
export type ReplayDecision =
  | { kind: 'pass' }
  | { kind: 'replay'; reason: 'quota'; cooldownUntil: number }
  | { kind: 'pin-back'; to: string }

export function replayDecision(input: ReplayInput): ReplayDecision {
  const { status, get, servedBy, session, attempted } = input
  if (session.pinnedAccountId != null || input.responseStarted || input.deadlineExpired) return { kind: 'pass' }
  const previous = session.currentAccountId
  if (status === 400 && previous !== null && previous !== servedBy && !attempted.has(previous)) {
    return { kind: 'pin-back', to: previous }
  }
  const cooldownUntil = quotaCooldownUntil(status, get)
  if (cooldownUntil === null) return { kind: 'pass' }
  return { kind: 'replay', reason: 'quota', cooldownUntil }
}

/**
 * The logins a session may be served by: the one it is held to, or every login opted in to
 * routing. A login that is signed out, or that the daemon cannot sign for, is not one of them:
 * it could not have served the request whatever its usage said, which is why an empty scope is
 * never a usage limit.
 */
export function accountsInScope(session: RouteSession, accounts: readonly RouteAccount[]): RouteAccount[] {
  const pinned = effectivePin(session, accounts)
  return accounts.filter((account) => account.loggedIn && account.credentialsReadable &&
    (pinned === null ? account.autoRoute : account.id === pinned))
}

/**
 * The earliest time the pool can serve again, in ms since the epoch: `now` when a login can
 * serve already, null when no reset is known. A pinned session is measured to 100% of its
 * login's windows, an Auto session to each login's own limits.
 *
 * The access token's expiry is ignored: the daemon renews a token that is about to expire
 * before it signs with it, and a token lasts only a few hours, so counting its expiry would
 * hide nearly every reset.
 *
 * `homeAccountId` is the login an empty pool falls back to: on Auto, the login plain claude or
 * plain codex uses.
 */
export function poolReadyAt(accounts: readonly RouteAccount[], now: number, pinnedAccountId: string | null | undefined,
  homeAccountId: string): number | null {
  const session: RouteSession = { homeAccountId, currentAccountId: null, pinnedAccountId }
  const pinned = effectivePin(session, accounts)
  let earliest = Infinity
  for (const account of accountsInScope(session, accounts)) {
    let ready = Math.max(now, account.cooldownUntil ?? now)
    const full = windowsAsOf(account, now).filter((window) =>
      window.utilization >= (pinned === null ? limitForWindow(account, window) : 100))
    for (const window of full) {
      const reset = window.resetsAt === null ? NaN : Date.parse(window.resetsAt)
      ready = Number.isFinite(reset) && reset > now ? Math.max(ready, reset) : Infinity
    }
    earliest = Math.min(earliest, ready)
  }
  return Number.isFinite(earliest) ? earliest : null
}

function readStatus(value: string | null | undefined): UsageStatus | null {
  return value === 'allowed' || value === 'allowed_warning' || value === 'rejected' ? value : null
}

function headerText(value: string | null | undefined): string | null {
  return value == null || value.trim() === '' ? null : value.trim()
}

function headerNumber(value: string | null | undefined): number | null {
  const text = headerText(value)
  if (text === null) return null
  const number = Number(text)
  return Number.isFinite(number) ? number : null
}

function secondsFromIso(value: string | null): number | null {
  return value === null ? null : Date.parse(value) / 1000
}

function windowName(value: string): string {
  return Object.hasOwn(WINDOW_NAMES, value) ? WINDOW_NAMES[value as keyof typeof WINDOW_NAMES] : value
}
