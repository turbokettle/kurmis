// Turns what the Codex app-server says about plan usage into the same
// `AccountUsage` shape the Claude side produces.
//
// Two sources. `account/rateLimits/read` answers with one backward-compatible
// bucket plus `rateLimitsByLimitId`, a map of every metered limit the plan has;
// each bucket carries a `primary` and a `secondary` window with a percentage, a
// duration in minutes and a unix-second reset. `account/rateLimits/updated`
// arrives once per turn on a running session with a single bucket, which replaces
// the windows of the same limit and leaves the rest alone.
//
// Codex names its windows itself and the set differs per plan, so they land in
// `windows` rather than in the fixed `fiveHour` / `sevenDay` fields.
import type * as v2 from './codex-protocol.ts'
import { isoFromSeconds, roundTenth } from './claude-usage.ts'
import type { AccountUsage, BankedResets, NamedUsageWindow } from './claude-usage.ts'

/** The limit id the server gives the plan's general limit, the one it does not name. */
export const CODEX_GENERAL_LIMIT_ID = 'codex'

/** The key a window is stored under: which limit it belongs to and which half it is. */
export function codexWindowKey(limitId: string, half: 'primary' | 'secondary'): string {
  return `${limitId}:${half}`
}

/** The limit a stored window belongs to, read back off its key. */
export function codexWindowLimitId(key: string): string {
  const cut = key.lastIndexOf(':')
  return cut <= 0 ? key : key.slice(0, cut)
}

/** The answer to `account/rateLimits/read`, as far as this reads it. */
export interface CodexRateLimitsRead {
  rateLimits?: v2.RateLimitSnapshot | null
  rateLimitsByLimitId?: Record<string, v2.RateLimitSnapshot | undefined> | null
  rateLimitResetCredits?: v2.RateLimitResetCreditsSummary | null
}

/** A snapshot with nothing measured yet, so every field has a value from the start. */
export function emptyCodexUsage(accountId: string, now: number): AccountUsage {
  return {
    accountId,
    provider: 'codex',
    fetchedAt: now,
    source: 'probe',
    subscriptionType: null,
    rateLimitsAvailable: false,
    fiveHour: null,
    sevenDay: null,
    sevenDayOverage: null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    modelScoped: [],
    windows: [],
    creditBalance: null,
    bankedResets: null,
    extraUsage: null,
    status: null,
    limited: null,
    error: null
  }
}

/**
 * The whole answer to `account/rateLimits/read`. Every bucket in
 * `rateLimitsByLimitId` becomes up to two windows; a response with no such map
 * falls back to the single `rateLimits` bucket.
 */
export function usageFromCodexRateLimits(
  accountId: string,
  response: CodexRateLimitsRead | null | undefined,
  now: number
): AccountUsage {
  const main = response?.rateLimits ?? null
  const buckets = bucketList(response)
  const windows = sortCodexUsageWindows(buckets.flatMap((bucket) => windowsOfBucket(bucket)))
  return {
    ...emptyCodexUsage(accountId, now),
    subscriptionType: main?.planType ?? buckets[0]?.planType ?? null,
    rateLimitsAvailable: windows.length > 0,
    windows,
    creditBalance: main?.credits?.balance ?? null,
    bankedResets: bankedResetsOf(response?.rateLimitResetCredits),
    status: statusOf(buckets)
  }
}

/**
 * The limit resets the account has banked. `availableCount` is typed as a bigint
 * because the server's type is a u64, but the JSON carries a plain number. Only the
 * credits still `available` count; one being redeemed or already redeemed is spent.
 */
export function bankedResetsOf(
  summary: v2.RateLimitResetCreditsSummary | null | undefined
): BankedResets | null {
  if (summary === null || summary === undefined) return null
  const available = (summary.credits ?? []).filter((credit) => credit.status === 'available')
  const expiresAt = available
    .map((credit) => isoFromSeconds(credit.expiresAt))
    // Soonest first, and one that never runs out last.
    .sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0) || (a ?? '').localeCompare(b ?? ''))
  const reported = Number(summary.availableCount)
  const count = Math.max(Number.isFinite(reported) && reported > 0 ? Math.floor(reported) : 0, available.length)
  return { count, expiresAt }
}

/**
 * Folds one `account/rateLimits/updated` into the account's snapshot. The
 * notification is sparse: only the windows of the limit it names are replaced,
 * and a field it left out does not clear what the last read reported.
 */
export function usageFromCodexSnapshot(
  accountId: string,
  previous: AccountUsage | null,
  snapshot: v2.RateLimitSnapshot | null | undefined,
  now: number
): AccountUsage {
  const base = previous ?? emptyCodexUsage(accountId, now)
  if (snapshot === null || snapshot === undefined) {
    return { ...base, accountId, provider: 'codex', fetchedAt: now, source: 'session' }
  }
  const fresh = windowsOfBucket(snapshot)
  const keys = new Set(fresh.map((window) => window.key))
  const kept = (base.windows ?? []).filter((window) => !keys.has(window.key))
  return {
    ...base,
    accountId,
    provider: 'codex',
    fetchedAt: now,
    source: 'session',
    subscriptionType: snapshot.planType ?? base.subscriptionType,
    // A snapshot proves the account reports limits, whatever a failed read said.
    rateLimitsAvailable: base.rateLimitsAvailable || fresh.length > 0,
    windows: sortCodexUsageWindows([...kept, ...fresh]),
    creditBalance: snapshot.credits?.balance ?? base.creditBalance ?? null,
    status: statusOf([snapshot]) ?? base.status,
    // Fresh numbers, so whatever the last read failed at no longer stands.
    error: null
  }
}

/**
 * "5h", "7d", "30d" — a window named by how long it is. A duration the server did
 * not give leaves the limit's own name to say what the bar is.
 */
export function codexWindowLabel(windowDurationMins: number | null | undefined): string {
  if (typeof windowDurationMins !== 'number' || !Number.isFinite(windowDurationMins)) return 'window'
  if (windowDurationMins < 60) return `${Math.round(windowDurationMins)}m`
  const hours = windowDurationMins / 60
  // One decimal at most, so 4.5 hours reads as "4.5h" and 5 hours as "5h".
  if (hours < 24) return `${String(roundTenth(hours))}h`
  return `${String(roundTenth(hours / 24))}d`
}

export function sortCodexUsageWindows(windows: readonly NamedUsageWindow[]): NamedUsageWindow[] {
  return [...windows].sort((a, b) =>
    (a.windowDurationMins ?? Number.MAX_SAFE_INTEGER) - (b.windowDurationMins ?? Number.MAX_SAFE_INTEGER) ||
    Number(a.key.endsWith('secondary')) - Number(b.key.endsWith('secondary')) ||
    a.key.localeCompare(b.key)
  )
}

/**
 * The buckets to draw: the multi-limit map when the server sent one, else the
 * single backward-compatible bucket. The map already contains the main limit.
 */
function bucketList(response: CodexRateLimitsRead | null | undefined): v2.RateLimitSnapshot[] {
  const byId = response?.rateLimitsByLimitId
  if (byId !== null && byId !== undefined) {
    const rows = Object.values(byId).filter(isSnapshot)
    if (rows.length > 0) return rows
  }
  const single = response?.rateLimits
  return single === null || single === undefined ? [] : [single]
}

/**
 * What to call a bucket. The server names a limit it meters apart from the rest
 * (`GPT-5.3-Codex-Spark` on the prolite plan) and leaves the plan's general limit
 * (`limitId: "codex"`) unnamed.
 */
function codexLimitName(bucket: v2.RateLimitSnapshot): string {
  const named = bucket.limitName
  if (typeof named === 'string' && named.length > 0) return named
  return (bucket.limitId ?? 'codex') === 'codex' ? 'Codex' : (bucket.limitId ?? 'codex')
}

/** What the limit is, for the hover on its bars. */
function codexLimitMeaning(bucket: v2.RateLimitSnapshot): string {
  const limitId = bucket.limitId ?? 'codex'
  const named = bucket.limitName
  if (typeof named === 'string' && named.length > 0) {
    return `${named} is metered on its own, apart from the plan's general Codex limit (limit id ${limitId}).`
  }
  if (limitId === 'codex') {
    return 'The plan\'s general Codex limit. The server gives it no name of its own (limit id codex).'
  }
  return `A limit the plan meters on its own (limit id ${limitId}).`
}

/**
 * One bucket's windows. Every window says which limit it belongs to and how long
 * it is, because a plan can have two 7-day bars that mean different things.
 * `primary` is the shorter window and `secondary` the longer one; which durations
 * they are differs per plan, so the duration is read off the window itself.
 */
function windowsOfBucket(bucket: v2.RateLimitSnapshot): NamedUsageWindow[] {
  const limitId = bucket.limitId ?? CODEX_GENERAL_LIMIT_ID
  const group = codexLimitName(bucket)
  const meaning = codexLimitMeaning(bucket)
  const out: NamedUsageWindow[] = []
  for (const [name, window] of [
    ['primary', bucket.primary],
    ['secondary', bucket.secondary]
  ] as const) {
    if (window === null || window === undefined) continue
    const duration = codexWindowLabel(window.windowDurationMins)
    out.push({
      key: codexWindowKey(limitId, name),
      label: `${group} ${duration}`,
      group,
      windowDurationMins: window.windowDurationMins,
      title: `${group}, ${duration} window. ${meaning}`,
      utilization: window.usedPercent,
      resetsAt: isoFromSeconds(window.resetsAt)
    })
  }
  return out
}

/**
 * Whether the account can still spend: `rejected` once a limit has been reached
 * or the spending control has, else null. Codex has no "approaching" state of its
 * own; the transcript raises that from the percentages.
 */
function statusOf(buckets: readonly v2.RateLimitSnapshot[]): 'rejected' | null {
  for (const bucket of buckets) {
    if (bucket.spendControlReached === true) return 'rejected'
    if (typeof bucket.rateLimitReachedType === 'string') return 'rejected'
  }
  return null
}

function isSnapshot(value: v2.RateLimitSnapshot | undefined): value is v2.RateLimitSnapshot {
  return typeof value === 'object' && value !== null
}
