// The rules every reader of a usage snapshot shares: which windows count, which of them are the
// plan's own, what a snapshot says once a window has reset, and when a used-up login comes back.
// One definition each, so the router and `kurmis status` cannot disagree about a login.
import { parseTime } from './countdown.ts'
import {
  CLAUDE_WINDOWS,
  SEVEN_DAY_MINS,
  type AccountUsage,
  type ModelUsageWindow,
  type NamedUsageWindow,
  type UsageWindow
} from './claude-usage.ts'

/**
 * Every window a snapshot carries that is worth looking at: the plan's fixed set plus its
 * per-model windows. Disabled or mirrored extra usage, and a per-model window that repeats the
 * Opus or Sonnet window (`repeatsModelWindow`), are left out.
 */
export function allUsageWindows(usage: AccountUsage | null | undefined): NamedUsageWindow[] {
  if (!usage) return []
  const out: NamedUsageWindow[] = []
  for (const spec of CLAUDE_WINDOWS) {
    const window = spec.field === 'sevenDayOverage' ? extraUsageWindow(usage) : usage[spec.field]
    if (window === null) continue
    out.push({ key: spec.key, label: spec.label, windowDurationMins: spec.windowDurationMins, ...window })
  }
  for (const entry of usage.modelScoped) {
    if (repeatsModelWindow(usage, entry)) continue
    out.push({ key: entry.displayName, label: entry.displayName, windowDurationMins: SEVEN_DAY_MINS, ...entry })
  }
  return out
}

/**
 * Whether a per-model window only repeats the snapshot's seven-day Opus or Sonnet window. The
 * CLI's `get_usage` answer carries the server's `seven_day_opus` and `seven_day_sonnet` windows,
 * and separately `model_scoped`, which the CLI builds from the server's list of per-model weekly
 * limits. The same model's weekly window can be in both, as `seven_day_opus` and as an entry
 * named `Opus`. It counts as the same window when the name matches and the figure and the reset
 * are the same; with different figures both are shown. Both come from the same probe, because
 * the rate-limit headers of a forwarded answer update neither.
 */
export function repeatsModelWindow(usage: AccountUsage, entry: ModelUsageWindow): boolean {
  const name = entry.displayName.trim().toLowerCase()
  const fixed = name === 'opus' ? usage.sevenDayOpus : name === 'sonnet' ? usage.sevenDaySonnet : null
  return fixed !== null && fixed.utilization === entry.utilization && sameTime(fixed.resetsAt, entry.resetsAt)
}

/** Whether two ISO times, either of which may be missing, name the same moment. */
function sameTime(a: string | null, b: string | null): boolean {
  return a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b))
}

/**
 * The seven-day window with extra usage counted in, when extra usage is enabled and the window
 * says something the plain seven-day window does not. With the same figure and reset it only
 * mirrors that window, and is left out.
 */
export function extraUsageWindow(usage: AccountUsage | null | undefined): UsageWindow | null {
  if (usage?.extraUsage?.isEnabled !== true) return null
  const overage = usage.sevenDayOverage ?? null
  const plain = usage.sevenDay
  if (overage === null || plain === null) return overage
  return overage.utilization === plain.utilization && sameTime(overage.resetsAt, plain.resetsAt) ? null : overage
}

/**
 * The windows that are the plan's own usage: the ones that stop every request when they run
 * out, rather than requests on one model. These are the windows the routing limits are
 * measured against: the five-hour window, the seven-day window and the seven-day window with
 * enabled, distinct extra usage counted in. The Opus and Sonnet windows meter one model each.
 */
export function planUsageWindows(usage: AccountUsage | null | undefined): NamedUsageWindow[] {
  if (!usage) return []
  const plan = new Set(CLAUDE_WINDOWS.filter((spec) => spec.plan).map((spec) => spec.key))
  return allUsageWindows(usage).filter((window) => plan.has(window.key))
}

/**
 * The plan window with the least left. Null when the snapshot has no plan window at all. A
 * window with no reset time still counts, because how full it is says something either way.
 */
export function busiestPlanWindow(usage: AccountUsage | null | undefined): NamedUsageWindow | null {
  let busiest: NamedUsageWindow | null = null
  for (const window of planUsageWindows(usage)) {
    if (busiest === null || window.utilization > busiest.utilization) busiest = window
  }
  return busiest
}

/**
 * Whether a window's reset time has gone by. What is on such a window was measured
 * inside the window that ended: the server has started a new one and nothing has
 * read it yet.
 */
export function windowHasReset(
  window: { resetsAt: string | null } | null | undefined,
  now: number
): boolean {
  const at = parseTime(window?.resetsAt ?? null)
  return at !== null && at <= now
}

/** Whether any window of this snapshot has passed its reset time. */
export function usageResetPassed(usage: AccountUsage | null | undefined, now: number): boolean {
  if (!usage) return false
  return everyWindowOf(usage).some((window) => windowHasReset(window, now))
}

/**
 * One snapshot as it stands at `now`. Every window whose reset has passed is emptied, because
 * its figure belongs to the window that ended. The reset time is kept, so a display can tell a
 * window that just turned over from one never read. Every routing rule reads usage through
 * this, because the last reading of a login can be hours old.
 *
 * `status` and `limited` go with the window they are about: a login refused because a window
 * was full is not refused once that window has reset.
 *
 * A snapshot with no expired window is returned as it came.
 */
export function usageAsOf<T extends AccountUsage | null | undefined>(usage: T, now: number): T {
  if (!usage) return usage
  if (!usageResetPassed(usage, now)) return usage
  const next: AccountUsage = {
    ...usage,
    fiveHour: fieldAsOf(usage.fiveHour, now),
    sevenDay: fieldAsOf(usage.sevenDay, now),
    sevenDayOverage: fieldAsOf(usage.sevenDayOverage, now),
    sevenDayOpus: fieldAsOf(usage.sevenDayOpus, now),
    sevenDaySonnet: fieldAsOf(usage.sevenDaySonnet, now),
    modelScoped: usage.modelScoped.map((window) => emptyIfReset(window, now))
  }
  // Only the window the refusal named can clear it. A refusal that named no window
  // is left alone: there is nothing here that says which reset would end it.
  if (usage.limited !== null && windowHasReset(usage.limited, now)) {
    next.limited = null
    next.status = null
  }
  return next as T
}

/** An emptied copy of the window when its reset has passed, and the window itself otherwise. */
function emptyIfReset<T extends UsageWindow>(window: T, now: number): T {
  return windowHasReset(window, now) ? { ...window, utilization: 0 } : window
}

/** The same for one of the fields that may hold no window at all. */
function fieldAsOf<T extends UsageWindow>(window: T | null, now: number): T | null {
  return window === null ? null : emptyIfReset(window, now)
}

/**
 * Every window a snapshot carries a reset time on, including those `allUsageWindows` leaves
 * out. Such a window still turns over, and a snapshot is current or it is not.
 */
function everyWindowOf(usage: AccountUsage): { resetsAt: string | null }[] {
  const out: { resetsAt: string | null }[] = []
  for (const spec of CLAUDE_WINDOWS) {
    const window = usage[spec.field]
    if (window !== null && window !== undefined) out.push(window)
  }
  for (const window of usage.modelScoped) out.push(window)
  return out
}

/**
 * When a login's plan comes back, read off its last usage snapshot.
 *
 * The answer is the latest reset among the plan's own windows that are at or over 100%,
 * because the login is inside none of them until the last one has reset. A refusal without any
 * window at 100% (a plan can refuse on a window it reports no percentage for) falls back to the
 * window the refusal named and then to the busiest window that has a reset time. Null when the
 * login has room.
 */
export function resetsAtFromUsage(usage: AccountUsage | null | undefined): string | null {
  if (!usage) return null
  const full = planUsageWindows(usage)
    .filter((window) => window.utilization >= 100)
    .map((window) => usableReset(window.resetsAt))
    .filter(isString)
  if (full.length > 0) return latest(full)
  if (usage.status !== 'rejected') return null
  const named = usableReset(usage.limited?.resetsAt ?? null)
  if (named !== null) return named
  return busiestReset(allUsageWindows(usage))
}

/** The reset of the window closest to its limit, among those that have one. */
function busiestReset(windows: readonly NamedUsageWindow[]): string | null {
  let best: { utilization: number; resetsAt: string } | null = null
  for (const window of windows) {
    const resetsAt = usableReset(window.resetsAt)
    if (resetsAt === null) continue
    if (best === null || window.utilization > best.utilization) {
      best = { utilization: window.utilization, resetsAt }
    }
  }
  return best?.resetsAt ?? null
}

function usableReset(resetsAt: string | null): string | null {
  if (resetsAt === null || !Number.isFinite(Date.parse(resetsAt))) return null
  return resetsAt
}

function isString(value: string | null): value is string {
  return value !== null
}

function latest(times: readonly string[]): string | null {
  let best: string | null = null
  let bestAt = -Infinity
  for (const time of times) {
    const at = Date.parse(time)
    if (!Number.isFinite(at) || at <= bestAt) continue
    best = time
    bestAt = at
  }
  return best
}

/**
 * Whether a window covers seven days, which is the length of every weekly window. The weekly
 * routing limit is measured against these, the five-hour limit against the rest.
 */
export function isSevenDayWindow(window: { windowDurationMins: number }): boolean {
  return window.windowDurationMins === SEVEN_DAY_MINS
}
