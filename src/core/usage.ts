// Reading what Claude says about plan usage into `AccountUsage`.
//
// The `get_usage` control response of a usage probe reports every window as a percentage with
// an ISO reset time. The rate-limit headers of a forwarded answer (`usageFromUnifiedHeaders` in
// `account-router.ts`) report fractions with unix-second reset times, and only for the windows
// they carry, so folding them in leaves the rest of the last probe's answer alone. They also
// name the window their status is about, which is kept as `limited`.
//
// `rate_limits` and `unifiedWindows` are open maps: the keys the window table names are read
// and the rest are ignored.
import {
  CLAUDE_WINDOWS,
  claudeWindowSpec,
  isoFromSeconds,
  roundTenth,
  type AccountUsage,
  type ClaudeWindowField,
  type ExtraUsage,
  type LimitedWindow,
  type ModelUsageWindow,
  type UsageStatus,
  type UsageWindow
} from './claude-usage.ts'

/** A snapshot with nothing in it yet, so every field has a value from the start. */
export function emptyAccountUsage(accountId: string, now: number): AccountUsage {
  return {
    accountId,
    provider: 'claude',
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
    extraUsage: null,
    status: null,
    limited: null,
    error: null
  }
}

/**
 * The `response` object of a `get_usage` control response, as a snapshot. A logged-out CLI
 * answers with `rate_limits: null` and `rate_limits_available: false`, which comes back as a
 * snapshot whose windows are all null. Anything that is not an object reads as that too.
 *
 * A probe carries no status of its own, so `previous` is what the last rate-limit headers
 * said and `statusAfterProbe` decides whether it still stands.
 */
export function usageFromGetUsage(
  accountId: string,
  raw: unknown,
  now: number,
  previous: AccountUsage | null = null
): AccountUsage {
  const body = asRecord(raw)
  const limits = asRecord(body.rate_limits)
  const windows = percentWindows(limits)
  const carried = statusAfterProbe(previous, windows, now)
  return {
    ...emptyAccountUsage(accountId, now),
    subscriptionType: asString(body.subscription_type),
    rateLimitsAvailable: body.rate_limits_available === true,
    ...windows,
    modelScoped: modelScopedWindows(limits.model_scoped),
    extraUsage: extraUsage(limits.extra_usage),
    status: carried.status,
    limited: carried.limited
  }
}

/**
 * Folds one rate-limit report into the login's snapshot. `info` has the shape of the CLI's
 * `rate_limit_event` frame (`status`, `resetsAt` in unix seconds, `rateLimitType`,
 * `unifiedWindows` of 0-1 fractions), which is what `usageFromUnifiedHeaders` builds from an
 * answer's headers. Only the windows it names are replaced; the subscription, the per-model
 * windows and the extra usage stay as the last probe left them.
 */
export function usageFromRateLimitEvent(
  accountId: string,
  previous: AccountUsage | null,
  info: unknown,
  now: number
): AccountUsage {
  const event = asRecord(info)
  const base = previous ?? emptyAccountUsage(accountId, now)
  const windows = eventWindows(event)
  const status = readStatus(event.status)
  const limited = limitedWindow(event)
  return {
    ...base,
    accountId,
    fetchedAt: now,
    source: 'session',
    // A report with windows proves the token can read rate limits, whatever a failed probe said.
    rateLimitsAvailable: base.rateLimitsAvailable || countWindows(windows) > 0,
    fiveHour: windows.fiveHour ?? base.fiveHour,
    sevenDay: windows.sevenDay ?? base.sevenDay,
    sevenDayOverage: windows.sevenDayOverage ?? base.sevenDayOverage,
    sevenDayOpus: windows.sevenDayOpus ?? base.sevenDayOpus,
    sevenDaySonnet: windows.sevenDaySonnet ?? base.sevenDaySonnet,
    status: status ?? base.status,
    limited: limited ?? (status === null ? base.limited : null),
    // Fresh numbers, so whatever the last probe failed at no longer stands.
    error: null
  }
}

/**
 * Whether the status the last rate-limit report gave still stands after a probe that carries
 * none of its own. The status is about one window, so it ends when that window has reset
 * or the probe measures it below the warning's threshold. A window missing from the
 * probe's answer leaves the status alone.
 */
export function statusAfterProbe(
  previous: AccountUsage | null,
  fresh: Partial<Record<ClaudeWindowField, UsageWindow>>,
  now: number
): { status: UsageStatus | null; limited: LimitedWindow | null } {
  const status = previous?.status ?? null
  if (previous === null || status === null) return { status: null, limited: null }
  const limited = previous.limited
  if (limited === null) return { status, limited: null }
  const resetAt = limited.resetsAt === null ? null : Date.parse(limited.resetsAt)
  if (resetAt !== null && Number.isFinite(resetAt) && resetAt <= now) {
    return { status: null, limited: null }
  }
  const spec = claudeWindowSpec(limited.window)
  const measured = spec === null ? undefined : fresh[spec.field]
  if (measured === undefined) return { status, limited }
  if (measured.utilization < (limited.threshold ?? 100)) return { status: null, limited: null }
  return {
    status,
    limited: { ...limited, utilization: measured.utilization, resetsAt: measured.resetsAt }
  }
}

/**
 * The window `rateLimitType` names, with how full it is and where its warning starts.
 * Without a top-level `utilization`, the same window in `unifiedWindows` is read. Null
 * when the report names no window.
 */
function limitedWindow(event: Record<string, unknown>): LimitedWindow | null {
  const name = asString(event.rateLimitType)
  if (name === null) return null
  const unified = asRecord(asRecord(event.unifiedWindows)[name])
  const utilization = asNumber(event.utilization) ?? asNumber(unified.utilization)
  const threshold = asNumber(event.surpassedThreshold)
  return {
    window: name,
    utilization: utilization === null ? null : roundTenth(utilization * 100),
    threshold: threshold === null ? null : roundTenth(threshold * 100),
    resetsAt: isoFromSeconds(event.resetsAt) ?? isoFromSeconds(unified.resetsAt)
  }
}

/**
 * The windows one report carries, converted to percent and ISO. `unifiedWindows` is the usual
 * source; a report without one still names a single window in `rateLimitType` with the
 * utilization and reset time beside it.
 */
function eventWindows(event: Record<string, unknown>): Partial<Record<ClaudeWindowField, UsageWindow>> {
  const out: Partial<Record<ClaudeWindowField, UsageWindow>> = {}
  const unified = asRecord(event.unifiedWindows)
  for (const spec of CLAUDE_WINDOWS) {
    const window = fractionWindow(unified[spec.key])
    if (window !== null) out[spec.field] = window
  }
  const named = claudeWindowSpec(event.rateLimitType)
  if (named !== null && out[named.field] === undefined) {
    const window = fractionWindow(event)
    if (window !== null) out[named.field] = window
  }
  return out
}

/** The same windows out of a `get_usage` answer, where they are already percentages. */
function percentWindows(limits: Record<string, unknown>): Partial<Record<ClaudeWindowField, UsageWindow>> {
  const out: Partial<Record<ClaudeWindowField, UsageWindow>> = {}
  for (const spec of CLAUDE_WINDOWS) {
    const window = percentWindow(limits[spec.key])
    if (window !== null) out[spec.field] = window
  }
  return out
}

function countWindows(windows: Partial<Record<ClaudeWindowField, UsageWindow>>): number {
  return Object.keys(windows).length
}

/** A `get_usage` window: utilization is already a percentage and `resets_at` already ISO. */
function percentWindow(value: unknown): UsageWindow | null {
  const row = asRecord(value)
  const utilization = asNumber(row.utilization)
  if (utilization === null) return null
  return { utilization: roundTenth(utilization), resetsAt: asString(row.resets_at) }
}

/** A rate-limit report's window: a 0-1 fraction and a unix-second reset time. */
function fractionWindow(value: unknown): UsageWindow | null {
  const row = asRecord(value)
  const utilization = asNumber(row.utilization)
  if (utilization === null) return null
  return { utilization: roundTenth(utilization * 100), resetsAt: isoFromSeconds(row.resetsAt) }
}

function modelScopedWindows(value: unknown): ModelUsageWindow[] {
  if (!Array.isArray(value)) return []
  const out: ModelUsageWindow[] = []
  for (const entry of value) {
    const row = asRecord(entry)
    const window = percentWindow(row)
    const displayName = asString(row.display_name)
    if (window === null || displayName === null) continue
    out.push({ ...window, displayName })
  }
  return out
}

function extraUsage(value: unknown): ExtraUsage | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  return {
    isEnabled: row.is_enabled === true,
    monthlyLimit: asNumber(row.monthly_limit),
    usedCredits: asNumber(row.used_credits),
    utilization: asNumber(row.utilization),
    currency: asString(row.currency)
  }
}

function readStatus(value: unknown): UsageStatus | null {
  return value === 'allowed' || value === 'allowed_warning' || value === 'rejected' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
