// Plan usage of one subscription: the one model the whole app reads, the table of
// windows a Claude plan reports, and the two rules for choosing between snapshots.
//
// `AccountUsage` is the only shape a login's usage is kept in. A running session's
// `rate_limit_event` folds into its account's snapshot in main, and a session view reads
// that snapshot back with `usageForSession`.
//
// Claude has two sources. A usage probe (a headless `claude` run that answers the
// `get_usage` control request) gives every window in percent with ISO reset times. A
// running session's `rate_limit_event` frames give the same windows as fractions with
// unix-second reset times, plus the window that event's status is about; main converts
// both to the shape below before merging.
//
// Codex has the same two: `account/rateLimits/read` on a connection bound to the
// account, and `account/rateLimits/updated` from a running session. Its windows are
// not a fixed set, so they land in `windows` rather than in the named fields.
import { accountKey, defaultAccountIdFor, type AccountProvider } from './accounts.ts'

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
  /** `probe` = a `get_usage` answer; `session` = the latest `rate_limit_event` of a live session. */
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
  /** Which machine the account lives on. Stamped by the shell, never stored. */
  backendId?: string
}

/**
 * Every account's usage, keyed by `accountKey(backendId, accountId)`: the bare id
 * for a local account, `<backendId>#<id>` for one on another machine.
 * Missing key = never fetched.
 */
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
  /** The name a card writes beside the bar. */
  label: string
  /** The abbreviation a compact display writes instead. */
  short: string
  windowDurationMins: number
  /**
   * Whether running out of this window stops every turn. A window that meters one
   * model stops only that model's turns, so it is drawn but is not what the plan
   * runs out of.
   */
  plan: boolean
  /** What the limit behind the window is, for a hover. */
  title?: string
}

/**
 * Every window a Claude plan reports, in the order they are drawn. A Claude window's
 * length is not in the wire data, because the set is fixed: the five-hour window is
 * five hours and every other one is a week. Writing it out here is what lets a caller
 * tell the weekly windows apart from the rest.
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
    plan: true,
    title:
      'The seven-day window with pay-as-you-go extra usage counted in. It shares its reset ' +
      'with the plain seven-day window and is the higher of the two.'
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
 * Which of two snapshots of the same row to keep: the newer one. A fresh snapshot
 * with the same timestamp replaces the one held, so a late cache reply cannot undo a
 * live sample and a re-read of the same moment still lands.
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

/**
 * Which of two machines' snapshots of one login to show. The limits belong to the
 * account and are the same from every machine, so a machine whose probe found no
 * login — or failed — is only shown when no machine has numbers at all; between two
 * that have them, the newest wins.
 */
export function preferredUsage(
  current: AccountUsage | undefined,
  candidate: AccountUsage | undefined
): AccountUsage | undefined {
  if (candidate === undefined) return current
  if (current === undefined) return candidate
  if (candidate.rateLimitsAvailable !== current.rateLimitsAvailable) {
    return candidate.rateLimitsAvailable ? candidate : current
  }
  return candidate.fetchedAt > current.fetchedAt ? candidate : current
}

/** One machine's row for a login: which machine, and the account id there. */
interface UsageRowAddress {
  backendId?: string | null
  accountId: string
}

/**
 * The snapshot of one login, taken from the machines that have a row for it. This is
 * the one join from the account map to a login; the session view, the account card
 * and the sidebar all read the same answer through it.
 */
export function usageForAccount(
  usage: AccountUsageMap,
  rows: readonly UsageRowAddress[]
): AccountUsage | undefined {
  let best: AccountUsage | undefined
  for (const row of rows) best = preferredUsage(best, usage[accountKey(row.backendId ?? undefined, row.accountId)])
  return best
}

/** What the join needs to know about a session: which machine and which login. */
interface UsageSessionAddress {
  runner?: AccountProvider | null
  /** Null selects Auto for Claude and the default login for Codex. */
  accountId?: string | null
  servingAccountId?: string | null
  backendId?: string | null
}

/**
 * The snapshot the session view draws: the login the session is set to, or for a Claude
 * session on Auto the login that served its last request. Auto has no account usage to
 * show until an account has answered.
 *
 * On Auto, that login's refusal is dropped from the snapshot (`status` null), and the
 * windows are kept. The login can be refused after the session's last turn, by other
 * sessions' requests, and the router sends this session's next request to a login that
 * still has room. The status line and the end-of-turn line read `status: 'rejected'` as
 * "this session's next turn is refused", which is then false. When the whole pool is out,
 * the session's own turn is refused and its result and wait row say so.
 */
export function usageForSession(
  usage: AccountUsageMap,
  session: UsageSessionAddress
): AccountUsage | undefined {
  const auto = session.runner !== 'codex' && session.accountId == null
  const accountId = session.runner === 'codex'
    ? session.accountId ?? defaultAccountIdFor('codex')
    : session.servingAccountId ?? session.accountId
  if (accountId == null) return undefined
  const found = usageForAccount(usage, [{ backendId: session.backendId ?? undefined, accountId }])
  if (!auto || found?.status !== 'rejected') return found
  return { ...found, status: null }
}
