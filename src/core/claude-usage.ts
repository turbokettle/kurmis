// Plan usage of one subscription login: the shape it is kept in, the table of windows a Claude
// plan reports, and the rule for choosing between two snapshots. Copied from the original router's
// `src/shared/claude-usage.ts`.
//
// `AccountUsage` is the only shape a login's usage is kept in.
//
// Claude has two sources. A usage probe (a short-lived `claude` that answers the `get_usage`
// control request) gives every window in percent with ISO reset times. The
// `anthropic-ratelimit-unified-*` headers on every answer the proxy forwards give the same
// windows as fractions with unix-second reset times, plus the window the answer's status is
// about. Both are converted to the shape below before they are merged.
//
// Codex has one source here: `account/rateLimits/read` on a `codex app-server` started on the
// login. Its windows are not a fixed set, so they land in `windows` rather than in the named
// fields.
import type { AccountProvider } from './accounts.ts'

/** One rate-limit window. `utilization` is a percentage, 0-100 (it can exceed 100). */
export type UsageWindow = {
  utilization: number
  /** ISO 8601 timestamp of the next reset, or null when the server gave none. */
  resetsAt: string | null
}

/** A per-model weekly window, e.g. `{ displayName: 'Opus', ... }`. */
export type ModelUsageWindow = UsageWindow & { displayName: string }

/**
 * A window whose set is decided by the server rather than by this app: it carries
 * its own name and a key that says which reported window it is, so a later sparse
 * update can replace exactly the windows it covers.
 *
 * `group` is the limit the window belongs to, because a plan can meter one model
 * apart from the rest, and `title` says in words what that limit is.
 */
export type NamedUsageWindow = UsageWindow & {
  key: string
  label: string
  /** The window's full name, for a display whose label is an abbreviation. */
  name?: string
  group?: string
  title?: string
  windowDurationMins?: number | null
}

/** Extra usage (pay-as-you-go credits beyond the plan), when the account has it. */
export type ExtraUsage = {
  isEnabled: boolean
  /** Monthly limit and used amount in the account's currency (major units). */
  monthlyLimit: number | null
  usedCredits: number | null
  utilization: number | null
  currency: string | null
}

/**
 * Resets of the usage limits that the provider granted the account and that it has
 * not spent yet. Spending one resets the plan's limits at once. Codex reports them
 * as `rateLimitResetCredits` in its answer to `account/rateLimits/read`.
 */
export type BankedResets = {
  count: number
  /**
   * When each available one runs out, soonest first: an ISO time, or null for one
   * that does not expire. The server may describe fewer than `count`, or none.
   */
  expiresAt: Array<string | null>
}

/** What the provider last said about whether the account may still spend. */
export type UsageStatus = 'allowed' | 'allowed_warning' | 'rejected'

/**
 * The window `status` is a statement about, which is often not the busiest one a
 * display draws: a warning on `seven_day_overage_included` at 96% arrives beside a
 * five-hour window at 2%.
 */
export interface LimitedWindow {
  /** The key the provider named, such as `seven_day_overage_included`. */
  window: string
  /** How much of that window is used, as a percentage 0-100; null when it named none. */
  utilization: number | null
  /**
   * The percentage the warning starts at, null when the provider named none. Kept
   * because the event carries it, and because a later probe is measured against it.
   */
  threshold: number | null
  resetsAt: string | null
}

export type AccountUsage = {
  accountId: string
  /** Which CLI the account signs into. */
  provider: AccountProvider
  /** When this snapshot was taken (ms since epoch). */
  fetchedAt: number
  /**
   * `probe` = a `get_usage` or `account/rateLimits/read` answer; `session` = the rate-limit
   * headers of an answer the proxy forwarded.
   */
  source: 'probe' | 'session'
  /** Raw plan name from the CLI: `max`, `pro`, `team`, `enterprise`. */
  subscriptionType: string | null
  /** False for API-key accounts and for tokens without the profile scope. */
  rateLimitsAvailable: boolean
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  /**
   * The seven-day window with pay-as-you-go extra usage counted in. It shares its
   * reset with `sevenDay` and is the higher of the two, so it is the one that says
   * how close the account really is.
   */
  sevenDayOverage: UsageWindow | null
  sevenDayOpus: UsageWindow | null
  sevenDaySonnet: UsageWindow | null
  modelScoped: ModelUsageWindow[]
  /**
   * Windows the provider named itself, ordered for display. Codex fills
   * this and leaves the named windows above null; Claude leaves it absent.
   */
  windows?: NamedUsageWindow[]
  /** Codex only: the pay-as-you-go credit balance, as the app-server wrote it. */
  creditBalance?: string | null
  /** Codex only: the banked limit resets; null when the last read did not say. */
  bankedResets?: BankedResets | null
  extraUsage: ExtraUsage | null
  /** What the provider last said; null until a session or a probe has reported one. */
  status: UsageStatus | null
  /** The window `status` is about, null when nothing named one. */
  limited: LimitedWindow | null
  /** Set when the last probe failed; the window fields then hold the previous snapshot. */
  error: string | null
}

/** Every login's usage, keyed by login id. A missing key means it was never fetched. */
export type AccountUsageMap = Record<string, AccountUsage>


/** How long Claude's own five-hour window is, in minutes. */
const FIVE_HOUR_MINS = 5 * 60

/** Seven days in minutes: how long every weekly window a plan reports is. */
export const SEVEN_DAY_MINS = 7 * 24 * 60

/** The field of `AccountUsage` a Claude window is kept in. */
export type ClaudeWindowField =
  | 'fiveHour'
  | 'sevenDay'
  | 'sevenDayOverage'
  | 'sevenDayOpus'
  | 'sevenDaySonnet'

/** One window a Claude plan reports: what it is called, how long it is, what it limits. */
interface ClaudeWindowSpec {
  /** The key the CLI writes, in `unifiedWindows` and in `get_usage`'s `rate_limits`. */
  key: string
  field: ClaudeWindowField
  /** The window's name in a status line, such as `5 hour`. */
  label: string
  /** A shorter name for a narrow display, such as `5h`. */
  short: string
  windowDurationMins: number
  /**
   * Whether running out of this window stops every request. A window that meters one model
   * stops only that model's requests, so it is not what the plan runs out of.
   */
  plan: boolean
}

/**
 * Every window a Claude plan reports, in display order. A Claude window's length is not in the
 * wire data, because the set is fixed: the five-hour window is five hours and every other one
 * is a week. Writing it out here is what lets a caller tell the weekly windows apart.
 */
export const CLAUDE_WINDOWS: readonly ClaudeWindowSpec[] = [
  {
    key: 'five_hour',
    field: 'fiveHour',
    label: '5 hour',
    short: '5h',
    windowDurationMins: FIVE_HOUR_MINS,
    plan: true
  },
  {
    key: 'seven_day',
    field: 'sevenDay',
    label: '7 day',
    short: '7d',
    windowDurationMins: SEVEN_DAY_MINS,
    plan: true
  },
  {
    key: 'seven_day_overage_included',
    field: 'sevenDayOverage',
    label: '7 day (extra usage)',
    short: '7d+',
    windowDurationMins: SEVEN_DAY_MINS,
    plan: true
  },
  {
    key: 'seven_day_opus',
    field: 'sevenDayOpus',
    label: '7 day Opus',
    short: '7d Opus',
    windowDurationMins: SEVEN_DAY_MINS,
    plan: false
  },
  {
    key: 'seven_day_sonnet',
    field: 'sevenDaySonnet',
    label: '7 day Sonnet',
    short: '7d Sonnet',
    windowDurationMins: SEVEN_DAY_MINS,
    plan: false
  }
]

/** The table row for a wire key, or null when this build does not know the window. */
export function claudeWindowSpec(key: unknown): ClaudeWindowSpec | null {
  return CLAUDE_WINDOWS.find((window) => window.key === key) ?? null
}


/**
 * One decimal place. Percentages come out of 0-1 fractions and carry float noise, and
 * a window's length in hours or days is written to the same precision.
 */
export function roundTenth(value: number): number {
  return Math.round(value * 10) / 10
}

/** A unix-second reset time as an ISO string; null when there is no usable one. */
export function isoFromSeconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}


/**
 * Which of two snapshots of the same login to keep: the newer one. A snapshot with the same
 * timestamp replaces the one held, so a re-read of the same moment still lands.
 */
export function newerUsage(current: AccountUsage | undefined, incoming: AccountUsage): AccountUsage {
  return current === undefined || incoming.fetchedAt >= current.fetchedAt ? incoming : current
}

/** The same, over a whole map: every row of `incoming` folded into `current`. */
export function mergeUsageMaps(
  current: AccountUsageMap,
  incoming: AccountUsageMap
): AccountUsageMap {
  const next = { ...current }
  for (const [key, value] of Object.entries(incoming)) next[key] = newerUsage(next[key], value)
  return next
}
