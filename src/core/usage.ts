// Reading the `get_usage` control response of a usage probe into `AccountUsage`. It reports every
// window as a percentage with an ISO reset time. `rate_limits` is an open map: the keys the
// window table names are read and the rest are ignored.
//
// The rate-limit headers of a forwarded answer are read by `usageFromUnifiedHeaders` in
// `account-router.ts`.
import {
  CLAUDE_WINDOWS,
  claudeWindowSpec,
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
 * Whether the status the last rate-limit headers gave still stands after a probe that carries
 * none of its own. The status is about one window, so it ends when that window has reset or the
 * probe measures it under 100%. A window missing from the probe's answer leaves the status alone.
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
  if (measured.utilization < 100) return { status: null, limited: null }
  return {
    status,
    limited: { ...limited, utilization: measured.utilization, resetsAt: measured.resetsAt }
  }
}

/** The windows of a `get_usage` answer, where they are already percentages. */
function percentWindows(limits: Record<string, unknown>): Partial<Record<ClaudeWindowField, UsageWindow>> {
  const out: Partial<Record<ClaudeWindowField, UsageWindow>> = {}
  for (const spec of CLAUDE_WINDOWS) {
    const window = percentWindow(limits[spec.key])
    if (window !== null) out[spec.field] = window
  }
  return out
}

/** A `get_usage` window: utilization is already a percentage and `resets_at` already ISO. */
function percentWindow(value: unknown): UsageWindow | null {
  const row = asRecord(value)
  const utilization = asNumber(row.utilization)
  if (utilization === null) return null
  return { utilization: roundTenth(utilization), resetsAt: asString(row.resets_at) }
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
