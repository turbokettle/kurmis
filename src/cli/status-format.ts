// What `kurmis status` prints: the daemon's status answer as text for a terminal, or as the JSON
// of `kurmis status --json`. Pure: the caller passes the answer and the time.
//
// The JSON is not the control API's `StatusAnswer` as it came. That answer carries each login's
// usage in kurmis' internal snapshot shape, which differs between Claude and Codex and may change
// with the daemon. The JSON here has its own `format` number, raised when a field is removed or
// changes meaning, and gives every login's windows in one shape for both providers, already as
// they stand at the time of the call (a window whose reset has passed reads 0%).
import { limitForWindow, type RouteBlock } from '../core/account-router.ts'
import type { AccountProvider } from '../core/accounts.ts'
import type { AccountUsage, NamedUsageWindow } from '../core/claude-usage.ts'
import { chooseCodexLogin, codexRouteBlock, type CodexChoice } from '../core/codex-choice.ts'
import type { LoginStatus, StatusAnswer } from '../core/control-api.ts'
import { resetsInText, spanText } from '../core/countdown.ts'
import { routeBlockText } from '../core/proxy-rules.ts'
import { allUsageWindows, planUsageWindows, usageAsOf, windowHasReset } from '../core/usage-rules.ts'

/** Raised when a field of `StatusJson` is removed or changes meaning. Fields may be added. */
export const STATUS_JSON_FORMAT = 1

export interface StatusJsonWindow {
  /** The provider's key for the window: `five_hour`, `seven_day`, `codex:primary`, ... */
  key: string
  /** The window's name as `kurmis status` shows it: `5 hour`, `Codex 7d`, ... */
  label: string
  /** How long the window is; null when the provider did not say. */
  durationMinutes: number | null
  /** Percent used, 0-100 (it can exceed 100). 0 when the reset has passed since the reading. */
  utilization: number
  /** ISO time of the next reset; null when the provider gave none. */
  resetsAt: string | null
  /** Whether running out of this window stops every request; the routing limits apply only to these. */
  plan: boolean
  /** The routing limit this window is measured against, in percent; null when `plan` is false. */
  limitPercent: number | null
}

export interface StatusJsonUsage {
  /** ISO time the snapshot was taken. */
  fetchedAt: string
  /** `probe`: a usage probe; `session`: the rate-limit headers of an answer the proxy forwarded. */
  source: 'probe' | 'session'
  /** The plan name the provider reported, such as `max` or `plus`; null when it gave none. */
  plan: string | null
  /** Why the last probe failed; the windows are then from the snapshot before it. Null when it did not. */
  error: string | null
  windows: StatusJsonWindow[]
}

export interface StatusJsonBlock {
  kind: RouteBlock['kind']
  /** The reason as a sentence, the same as the text output. */
  text: string
  /** ISO time the block is expected to end (a cooldown's end, or the full window's reset); null when unknown. */
  until: string | null
}

export interface StatusJsonLogin {
  id: string
  provider: AccountProvider
  label: string
  /** Whether the login has credentials here; null when the daemon has not looked yet. */
  signedIn: boolean | null
  routing: boolean
  fiveHourLimit: number
  weeklyLimit: number
  useFirst: boolean
  /** Null when the login's usage has not been read yet. */
  usage: StatusJsonUsage | null
  /**
   * Why routing would pass the login over now, or null when it could use it. For a Claude login
   * this is what the daemon's Auto would decide; for a Codex login, what `kurmis codex` would.
   */
  blocked: StatusJsonBlock | null
  /** Sessions whose last request this login served; null for Codex logins, which have no proxy. */
  sessions: number | null
}

export interface StatusJson {
  format: typeof STATUS_JSON_FORMAT
  daemon: { version: string; pid: number; port: number; startedAt: string }
  /** The logins in `config.json` order, the two default logins first. */
  logins: StatusJsonLogin[]
  /** The login `kurmis codex` without `--login` would start on now, and its note; null with no Codex login. */
  codexStart: { login: string; note: string | null } | null
}

export interface StatusFormatOptions {
  /** Whether the logins' tokens come from the macOS Keychain, which changes a block's wording. */
  keychain: boolean
}

/** The status as `kurmis status --json` prints it. */
export function statusJson(answer: StatusAnswer, now: number, options: StatusFormatOptions): StatusJson {
  return {
    format: STATUS_JSON_FORMAT,
    daemon: { version: answer.version, pid: answer.pid, port: answer.port, startedAt: isoTime(answer.startedAt) },
    logins: answer.logins.map((login) => ({
      id: login.id,
      provider: login.provider,
      label: login.label,
      signedIn: login.signedIn,
      routing: login.routing,
      fiveHourLimit: login.fiveHourLimit,
      weeklyLimit: login.weeklyLimit,
      useFirst: login.useFirst,
      usage: login.usage === null ? null : usageJson(login, login.usage, now),
      blocked: blockJson(answer, login, now, options),
      sessions: login.provider === 'claude' ? login.sessions : null
    })),
    codexStart: codexStart(answer, now)
  }
}

/** The status as `kurmis status` prints it, ending in a newline. Fits 80 columns. */
export function formatStatus(answer: StatusAnswer, now: number, options: StatusFormatOptions): string {
  const json = statusJson(answer, now, options)
  const lines: string[] = [
    `kurmis daemon ${answer.version}, pid ${String(answer.pid)}, port ${String(answer.port)}, ` +
      `running for ${spanText(now - answer.startedAt)}`
  ]
  const labelWidth = Math.min(MAX_LABEL_WIDTH, Math.max(0, ...json.logins.flatMap((login) =>
    (login.usage?.windows ?? []).map((window) => window.label.length))))
  for (const login of json.logins) {
    lines.push('', ...loginLines(login, now, labelWidth))
  }
  if (json.codexStart !== null) {
    lines.push('', ...wrap(`kurmis codex would start on ${json.codexStart.login}.` +
      (json.codexStart.note === null ? '' : ` ${json.codexStart.note}`), '', ''))
  }
  return `${lines.join('\n')}\n`
}

/** The text output's width. */
const WIDTH = 80
/** Window names longer than this are cut, so the columns after them stay on the line. */
const MAX_LABEL_WIDTH = 24

function loginLines(login: StatusJsonLogin, now: number, labelWidth: number): string[] {
  const name = login.id.slice(login.id.indexOf(':') + 1)
  const lines = [login.label === name ? login.id : `${login.id}  "${login.label}"`]
  const facts = [
    login.signedIn === null ? 'sign-in not checked yet' : login.signedIn ? 'signed in' : 'signed out',
    login.routing ? 'routing on' : 'routing off',
    `limits ${String(login.fiveHourLimit)}% 5 hour, ${String(login.weeklyLimit)}% weekly`
  ]
  if (login.useFirst) facts.push('use first')
  if (login.sessions !== null) facts.push(login.sessions === 1 ? '1 session' : `${String(login.sessions)} sessions`)
  if (login.usage?.plan) facts.push(`plan ${login.usage.plan}`)
  lines.push(...wrap(facts.join(', '), '  ', '  '))
  if (login.usage === null) {
    lines.push('  usage not read yet')
  } else {
    for (const window of login.usage.windows) lines.push(windowLine(window, now, labelWidth))
    if (login.usage.windows.length === 0) lines.push('  no usage windows reported')
    const age = now - Date.parse(login.usage.fetchedAt)
    const when = age < 60_000 ? 'just now' : `${spanText(age)} ago`
    lines.push(`  usage read ${when}${login.usage.source === 'session' ? ' from a forwarded answer' : ''}`)
    if (login.usage.error !== null) lines.push(...wrap(`last probe failed: ${login.usage.error}`, '  ', '    '))
  }
  // A login that is off or signed out already says so above.
  if (login.blocked !== null && login.blocked.kind !== 'auto-route-off' && login.blocked.kind !== 'signed-out') {
    lines.push(...wrap(`passed over: ${login.blocked.text}`, '  ', '    '))
  }
  return lines
}

function windowLine(window: StatusJsonWindow, now: number, labelWidth: number): string {
  const label = window.label.length > labelWidth ? `${window.label.slice(0, labelWidth - 1)}~` : window.label
  const percent = `${String(Math.round(window.utilization))}%`.padStart(4)
  const reset = windowHasReset(window, now)
    ? 'reset since read'
    : resetsInText(window.resetsAt, now) ?? ''
  const limit = window.limitPercent === null ? '' : `limit ${String(window.limitPercent)}%`
  return `  ${label.padEnd(labelWidth)}  ${percent}  ${reset.padEnd(20)}  ${limit}`.trimEnd()
}

function usageJson(login: LoginStatus, usage: AccountUsage, now: number): StatusJsonUsage {
  const current = usageAsOf(usage, now)
  const planKeys = new Set(planUsageWindows(current).map((window) => window.key))
  const limits = { fiveHourLimitPercent: login.fiveHourLimit, weeklyLimitPercent: login.weeklyLimit }
  return {
    fetchedAt: isoTime(usage.fetchedAt),
    source: usage.source,
    plan: usage.subscriptionType,
    error: usage.error,
    windows: allUsageWindows(current).map((window: NamedUsageWindow) => {
      const plan = planKeys.has(window.key)
      return {
        key: window.key,
        label: window.label,
        durationMinutes: window.windowDurationMins ?? null,
        utilization: window.utilization,
        resetsAt: window.resetsAt,
        plan,
        limitPercent: plan ? limitForWindow(limits, window) : null
      }
    })
  }
}

function blockJson(answer: StatusAnswer, login: LoginStatus, now: number, options: StatusFormatOptions): StatusJsonBlock | null {
  const block = login.provider === 'codex' ? codexRouteBlock(answer, login.id, now) : login.block
  if (block === null) return null
  let text = routeBlockText(block, options.keychain)
  let until: string | null = null
  if (block.kind === 'cooldown' && block.until !== null) {
    until = isoTime(block.until)
    const left = resetsInText(block.until, now)
    if (left !== null) text += ` (${left.replace('resets ', '')})`
  } else if (block.kind === 'over-limit') {
    until = block.resetsAt
    const left = resetsInText(block.resetsAt, now)
    if (left !== null) text += `; it ${left}`
  }
  return { kind: block.kind, text, until }
}

function codexStart(answer: StatusAnswer, now: number): StatusJson['codexStart'] {
  if (!answer.logins.some((login) => login.provider === 'codex')) return null
  const choice: CodexChoice = chooseCodexLogin(answer, now)
  return { login: choice.login, note: choice.note }
}

function isoTime(at: number): string {
  return Number.isFinite(at) ? new Date(at).toISOString() : String(at)
}

/** Words joined into lines of at most `WIDTH` columns: the first with `first` in front, the rest with `rest`. */
function wrap(text: string, first: string, rest: string): string[] {
  const lines: string[] = []
  let line = first
  let empty = true
  for (const word of text.split(' ')) {
    if (!empty && line.length + 1 + word.length > WIDTH) {
      lines.push(line)
      line = rest + word
    } else {
      line += empty ? word : ` ${word}`
    }
    empty = false
  }
  lines.push(line)
  return lines
}
