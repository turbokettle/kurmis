// Turns the `codex app-server` answer to `account/rateLimits/read` into the `AccountUsage`
// shape the Claude side produces.
//
// The answer has one bucket kept for older clients (`rateLimits`) and `rateLimitsByLimitId`,
// a map of every limit the plan meters. Each bucket has a `primary` and a `secondary` window
// with a percentage, a duration in minutes and a unix-second reset.
//
// Codex names its windows itself and the set differs per plan, so they land in `windows`
// rather than in the fixed `fiveHour` / `sevenDay` fields.
//
// For the daemon: `codexUsageFromResult` takes the JSON-RPC `result` as it arrived and is the
// one call a usage probe needs. `parseCodexRateLimitsRead` and `usageFromCodexRateLimits` are
// its two halves.
import type * as v2 from './codex-protocol.ts'
import { isoFromSeconds, roundTenth } from './claude-usage.ts'
import type { AccountUsage, BankedResets, NamedUsageWindow } from './claude-usage.ts'

/** The limit id the server gives the plan's general limit, the one it does not name. */
export const CODEX_GENERAL_LIMIT_ID = 'codex'

/**
 * The key a window is stored under: which limit it belongs to and which half it is, such as
 * `codex:primary`.
 */
export function codexWindowKey(limitId: string, half: 'primary' | 'secondary'): string {
  return `${limitId}:${half}`
}

/** The limit a stored window belongs to, read back off its key: `codex:primary` -> `codex`. */
export function codexWindowLimitId(key: string): string {
  const cut = key.lastIndexOf(':')
  return cut <= 0 ? key : key.slice(0, cut)
}

/** The answer to `account/rateLimits/read`, as far as this reads it. A missing field reads as null. */
export type CodexRateLimitsRead = Partial<v2.GetAccountRateLimitsResponse>

/**
 * A Codex snapshot with nothing measured yet, so every field has a value. The daemon can
 * start from it to record a probe that failed before it had any numbers.
 */
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
 * The JSON-RPC `result` of `account/rateLimits/read` as a login's usage, or null when it is
 * not an object at all. Never throws: a part of the answer that has the wrong shape is left
 * out (`parseCodexRateLimitsRead`). `accountId` is the kurmis login id, such as `codex:work`.
 */
export function codexUsageFromResult(accountId: string, result: unknown, now: number): AccountUsage | null {
  const read = parseCodexRateLimitsRead(result)
  return read === null ? null : usageFromCodexRateLimits(accountId, read, now)
}

/**
 * The checked answer to `account/rateLimits/read` as a login's usage. Every bucket in
 * `rateLimitsByLimitId` becomes up to two windows; an answer with no such map falls back to
 * the single `rateLimits` bucket.
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
 * The limit resets the account has banked. Only the credits still `available` count; one
 * being redeemed or already redeemed is spent. The count is the larger of `availableCount`
 * and the number of available credits listed, because the server may cap the list.
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
 * "5h", "7d", "30d": a window named by how long it is. A duration the server did not give
 * reads as "window", and the limit's name in front of it says which one it is.
 */
export function codexWindowLabel(windowDurationMins: number | null | undefined): string {
  if (typeof windowDurationMins !== 'number' || !Number.isFinite(windowDurationMins)) return 'window'
  if (windowDurationMins < 60) return `${Math.round(windowDurationMins)}m`
  const hours = windowDurationMins / 60
  // One decimal at most, so 4.5 hours reads as "4.5h" and 5 hours as "5h".
  if (hours < 24) return `${String(roundTenth(hours))}h`
  return `${String(roundTenth(hours / 24))}d`
}

/** Shortest window first; of two the same length, a primary before a secondary; then by key. */
function sortCodexUsageWindows(windows: readonly NamedUsageWindow[]): NamedUsageWindow[] {
  return [...windows].sort((a, b) =>
    (a.windowDurationMins ?? Number.MAX_SAFE_INTEGER) - (b.windowDurationMins ?? Number.MAX_SAFE_INTEGER) ||
    Number(a.key.endsWith('secondary')) - Number(b.key.endsWith('secondary')) ||
    a.key.localeCompare(b.key)
  )
}

/**
 * The buckets to read: the multi-limit map when the server sent one, else the single bucket
 * kept for older clients. The map already contains the main limit.
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
 * What to call a bucket. The server names a limit it meters apart from the rest, such as
 * one model, and leaves the plan's general limit (`limitId: "codex"`) unnamed.
 */
function codexLimitName(bucket: v2.RateLimitSnapshot): string {
  const named = bucket.limitName
  if (typeof named === 'string' && named.length > 0) return named
  const limitId = bucket.limitId ?? CODEX_GENERAL_LIMIT_ID
  return limitId === CODEX_GENERAL_LIMIT_ID ? 'Codex' : limitId
}

/**
 * One bucket's windows. Every window says which limit it belongs to and how long it is,
 * because a plan can have two 7-day windows that mean different things. `primary` is the
 * shorter window and `secondary` the longer one; which durations they are differs per plan,
 * so the duration is read off the window itself.
 */
function windowsOfBucket(bucket: v2.RateLimitSnapshot): NamedUsageWindow[] {
  const limitId = bucket.limitId ?? CODEX_GENERAL_LIMIT_ID
  const group = codexLimitName(bucket)
  const out: NamedUsageWindow[] = []
  for (const [name, window] of [
    ['primary', bucket.primary],
    ['secondary', bucket.secondary]
  ] as const) {
    if (window === null || window === undefined) continue
    out.push({
      key: codexWindowKey(limitId, name),
      label: `${group} ${codexWindowLabel(window.windowDurationMins)}`,
      group,
      windowDurationMins: window.windowDurationMins,
      utilization: window.usedPercent,
      resetsAt: isoFromSeconds(window.resetsAt)
    })
  }
  return out
}

/**
 * Whether the account can still spend: `rejected` once the plan's general limit or the
 * workspace's spending control has been reached, else null. Codex has no "approaching" state
 * of its own.
 *
 * A bucket that meters one model apart (any limit id but `codex`) reaching its limit stops
 * only that model, so it does not make the whole login refused; its windows still show how
 * full it is. When no bucket is the general limit, every bucket counts, the same rule as
 * `planUsageWindows` in `usage-rules.ts`. The spending control is set on the workspace, so
 * it counts from any bucket.
 */
function statusOf(buckets: readonly v2.RateLimitSnapshot[]): 'rejected' | null {
  if (buckets.some((bucket) => bucket.spendControlReached === true)) return 'rejected'
  const general = buckets.filter((bucket) => (bucket.limitId ?? CODEX_GENERAL_LIMIT_ID) === CODEX_GENERAL_LIMIT_ID)
  const plan = general.length > 0 ? general : buckets
  return plan.some((bucket) => typeof bucket.rateLimitReachedType === 'string') ? 'rejected' : null
}

function isSnapshot(value: v2.RateLimitSnapshot | undefined): value is v2.RateLimitSnapshot {
  return typeof value === 'object' && value !== null
}

// ---- checking the raw answer

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A window, or null when it has no usable percentage. */
function parseWindow(value: unknown): v2.RateLimitWindow | null {
  if (!isObject(value)) return null
  const usedPercent = finiteOrNull(value['usedPercent'])
  if (usedPercent === null) return null
  return {
    usedPercent,
    windowDurationMins: finiteOrNull(value['windowDurationMins']),
    resetsAt: finiteOrNull(value['resetsAt'])
  }
}

/** A bucket, or null when it is not an object. A field of the wrong type reads as null. */
function parseSnapshot(value: unknown): v2.RateLimitSnapshot | null {
  if (!isObject(value)) return null
  const credits = value['credits']
  return {
    limitId: stringOrNull(value['limitId']),
    limitName: stringOrNull(value['limitName']),
    primary: parseWindow(value['primary']),
    secondary: parseWindow(value['secondary']),
    credits: isObject(credits) ? { balance: stringOrNull(credits['balance']) } : null,
    spendControlReached: typeof value['spendControlReached'] === 'boolean' ? value['spendControlReached'] : null,
    planType: stringOrNull(value['planType']),
    rateLimitReachedType: stringOrNull(value['rateLimitReachedType'])
  }
}

/** The banked resets, or null when there is no summary. A credit without a status is left out. */
function parseResetCredits(value: unknown): v2.RateLimitResetCreditsSummary | null {
  if (!isObject(value)) return null
  const list = value['credits']
  const credits = Array.isArray(list)
    ? list.flatMap((credit): v2.RateLimitResetCredit[] =>
        isObject(credit) && typeof credit['status'] === 'string'
          ? [{ status: credit['status'], expiresAt: finiteOrNull(credit['expiresAt']) }]
          : [])
    : null
  return { availableCount: finiteOrNull(value['availableCount']) ?? 0, credits }
}

/**
 * The JSON-RPC `result` of `account/rateLimits/read` checked into `CodexRateLimitsRead`, or
 * null when it is not an object. Never throws. A bucket that is not an object, a window
 * without a numeric `usedPercent` and a credit without a status are left out; any other
 * field of the wrong type reads as null.
 */
export function parseCodexRateLimitsRead(result: unknown): CodexRateLimitsRead | null {
  if (!isObject(result)) return null
  const byId = result['rateLimitsByLimitId']
  let rateLimitsByLimitId: Record<string, v2.RateLimitSnapshot> | null = null
  if (isObject(byId)) {
    rateLimitsByLimitId = Object.create(null) as Record<string, v2.RateLimitSnapshot>
    for (const [limitId, bucket] of Object.entries(byId)) {
      const parsed = parseSnapshot(bucket)
      if (parsed !== null) rateLimitsByLimitId[limitId] = parsed
    }
  }
  return {
    rateLimits: parseSnapshot(result['rateLimits']),
    rateLimitsByLimitId,
    rateLimitResetCredits: parseResetCredits(result['rateLimitResetCredits'])
  }
}
