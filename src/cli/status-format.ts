// What `kurmis status` prints: the logins as the daemon reports them, or as `config.json` and
// `state.json` hold them when no daemon runs, as text for a terminal or as the JSON of
// `kurmis status --json`. Pure: the caller passes the report and the time.
//
// The JSON is not the control API's `StatusAnswer` as it came. That answer carries each login's
// usage in kurmis' internal snapshot shape, which may change with the daemon. The JSON here has
// its own `format` number, raised when a field is removed or changes meaning, and gives every
// login's windows as they stand at the time of the call (a window whose reset has passed reads
// 0%).
import { limitForWindow, type RouteBlock } from '../core/account-router.ts'
import type { AccountUsage, NamedUsageWindow } from '../core/claude-usage.ts'
import type { LoginStatus, StatusAnswer } from '../core/control-api.ts'
import { resetsInText, spanText } from '../core/countdown.ts'
import { routeBlockText } from '../core/proxy-rules.ts'
import { allUsageWindows, planUsageWindows, usageAsOf, windowHasReset } from '../core/usage-rules.ts'
import { daemonAge } from '../daemon/lifecycle.ts'
import { isSameClaudeAccount } from '../data/identity.ts'
import { PLAIN_CLAUDE_LOGIN } from './command.ts'
import type { GlobalRoutingState } from './global-routing.ts'
import type { CredentialCheck } from './local-credentials.ts'

/** Raised when a field of `StatusJson` is removed or changes meaning. Fields may be added. */
export const STATUS_JSON_FORMAT = 7

export interface StatusJsonWindow {
  /** Anthropic's key for the window: `five_hour`, `seven_day`, ... */
  key: string
  /** The window's name as `kurmis status` shows it: `5 hour`, `7 day Opus`, ... */
  label: string
  /** How long the window is; null when Anthropic did not say. */
  durationMinutes: number | null
  /** Percent used, 0-100 (it can exceed 100). 0 when the reset has passed since the reading. */
  utilization: number
  /** ISO time of the next reset; null when Anthropic gave none. */
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
  /** The plan name Anthropic reported, such as `max` or `pro`; null when it gave none. */
  plan: string | null
  /** Why the last probe failed; the windows are then from the snapshot before it. Null when it did not. */
  error: string | null
  windows: StatusJsonWindow[]
}

export interface StatusJsonBlock {
  kind: RouteBlock['kind']
  /**
   * The reason as a sentence, with how long is left. The text
   * output says the same, except that it gives a cooldown's end in local time.
   */
  text: string
  /** ISO time the block is expected to end (a cooldown's end, or the full window's reset); null when unknown. */
  until: string | null
}

export interface StatusJsonLogin {
  /** The login's id, which never changes. */
  id: string
  /** The name the person sees and types for the login. */
  alias: string
  /** Whether this is the login a plain `claude` uses. */
  usedByPlainClaude: boolean
  /** The login's email as claude cached it for the login; null when unknown. Shown, never stored. */
  email: string | null
  /** Whether the daemon found the login signed in; null when no daemon reported it or it has not looked yet. */
  signedIn: boolean | null
  /**
   * With `source` `files`: whether the login's credentials are on this machine
   * (`checkCredentials` in `local-credentials.ts`), or `unknown` when a check could not run.
   * Null with `source` `daemon`.
   */
  credentials: CredentialCheck | null
  /** Whether a usage probe of the login is running now. */
  probing: boolean
  routing: boolean
  fiveHourLimit: number
  weeklyLimit: number
  useFirst: boolean
  /** Null when the login's usage has not been read yet. */
  usage: StatusJsonUsage | null
  /** Why the daemon's Auto would pass the login over now, or null when it could use it. */
  blocked: StatusJsonBlock | null
  /**
   * Sessions whose last request in the last 7 days this login served. The daemon remembers the
   * 2000 sessions that sent a request most recently.
   */
  sessions: number
}

export interface StatusJson {
  format: typeof STATUS_JSON_FORMAT
  /**
   * The daemon that answered, or null when none runs. `older` says that it is older than this
   * kurmis (`shouldReplaceDaemon`), so the next command that starts the daemon replaces it.
   * `newer` says that it is newer, so no command of this kurmis replaces it.
   */
  daemon: { version: string; pid: number; port: number; startedAt: string; older: boolean; newer: boolean } | null
  /**
   * Where the logins come from: `daemon`, the daemon's status answer; `files`, `config.json` and
   * the usage the daemon last wrote to `state.json`, when no daemon runs or this kurmis cannot
   * read its answer.
   */
  source: StatusSource
  /** Whether a plain claude goes through kurmis (`kurmis setup`). */
  globalRouting: GlobalRoutingState
  /** The logins in `config.json` order, the login plain claude uses first. */
  logins: StatusJsonLogin[]
  /**
   * Sentences about something the person may want to change: two logins signed in to the same
   * account, which makes both use one subscription, and global routing that is
   * on while no daemon runs.
   */
  warnings: string[]
}

export type StatusSource = 'daemon' | 'files'

/** What `kurmis status` shows, put together from the daemon or from the files. */
export interface StatusReport {
  /** The daemon that answered, or null when none runs. `apiVersion` is absent when its answer had none. */
  daemon: { version: string; apiVersion?: number; pid: number; port: number; startedAt: number } | null
  /** Where `logins` come from (`StatusJson.source`). */
  source: StatusSource
  logins: LoginStatus[]
  /** With `source` `files`: whether each login's credentials are on this machine, by login id. */
  credentials: ReadonlyMap<string, CredentialCheck>
  globalRouting: GlobalRoutingState
  /** This kurmis' version, which with `CONTROL_API_VERSION` tells whether the daemon is older or newer. */
  version: string
  /** Why the daemon cannot read the login Keychain (`StatusAnswer.keychainProblem`); null or absent when it can. */
  keychainProblem?: string | null
}

/** A report of the daemon's status answer. */
export function daemonReport(answer: StatusAnswer, globalRouting: GlobalRoutingState, version: string): StatusReport {
  return {
    daemon: daemonOf(answer),
    source: 'daemon',
    logins: answer.logins,
    credentials: new Map(),
    globalRouting,
    version,
    keychainProblem: answer.keychainProblem ?? null
  }
}

/** The daemon of a `StatusReport`, from its status answer. */
export function daemonOf(answer: StatusAnswer): NonNullable<StatusReport['daemon']> {
  const daemon: NonNullable<StatusReport['daemon']> = { version: answer.version, pid: answer.pid, port: answer.port, startedAt: answer.startedAt }
  // An older daemon's status answer may have no `apiVersion`.
  if (typeof answer.apiVersion === 'number') daemon.apiVersion = answer.apiVersion
  return daemon
}

export interface StatusFormatOptions {
  /** Whether the logins' tokens come from the macOS Keychain, which changes a block's wording. */
  keychain: boolean
  /** The IANA time zone the text output gives times in; the machine's time zone when absent. */
  timeZone?: string
}

/** The status as `kurmis status --json` prints it. */
export function statusJson(report: StatusReport, now: number, options: StatusFormatOptions): StatusJson {
  const daemon = report.daemon
  const fromDaemon = report.source === 'daemon'
  return {
    format: STATUS_JSON_FORMAT,
    daemon: daemon === null ? null : {
      version: daemon.version,
      pid: daemon.pid,
      port: daemon.port,
      startedAt: isoTime(daemon.startedAt),
      older: daemonAge(daemon, report.version) === 'older',
      newer: daemonAge(daemon, report.version) === 'newer'
    },
    source: report.source,
    globalRouting: report.globalRouting,
    logins: report.logins.map((login) => ({
      id: login.id,
      alias: login.alias,
      usedByPlainClaude: login.usedByPlainClaude,
      email: login.email ?? null,
      signedIn: fromDaemon ? login.signedIn : null,
      credentials: fromDaemon ? null : report.credentials.get(login.id) ?? 'unknown',
      probing: login.probing === true,
      routing: login.routing,
      fiveHourLimit: login.fiveHourLimit,
      weeklyLimit: login.weeklyLimit,
      useFirst: login.useFirst,
      usage: login.usage === null ? null : usageJson(login, login.usage, now),
      blocked: fromDaemon ? blockJson(login, now, options) : null,
      sessions: login.sessions
    })),
    warnings: [...sameAccountWarnings(report), ...(report.globalRouting === 'on' && daemon === null ? [NO_DAEMON_WARNING] : []),
      ...(report.keychainProblem == null ? [] : [report.keychainProblem])]
  }
}

const NO_DAEMON_WARNING = 'Global routing is on, but the daemon is not running, so a plain claude and the Claude Code ' +
  'editor extensions cannot reach Anthropic. "kurmis daemon start" starts it.'

/**
 * A warning for each login that is signed in to the same account as another, so that both use
 * one subscription. Two logins are the same account when their emails are the same and so are
 * their organizations (`isSameClaudeAccount`). The logins are compared in order, the login plain
 * claude uses first: each is compared with the first login of every account found so far, and
 * the warning says how to remove the later one.
 */
function sameAccountWarnings(answer: { logins: readonly LoginStatus[] }): string[] {
  const warnings: string[] = []
  const ordered = [...answer.logins.filter((login) => login.usedByPlainClaude), ...answer.logins.filter((login) => !login.usedByPlainClaude)]
  const firsts: LoginStatus[] = []
  for (const login of ordered) {
    if (login.email === null || login.email.trim() === '') continue
    const kept = firsts.find((first) => isSameClaudeAccount(first, login))
    if (kept === undefined) {
      firsts.push(login)
      continue
    }
    const keptName = kept.usedByPlainClaude ? `${kept.alias}, ${PLAIN_CLAUDE_LOGIN},` : kept.alias
    warnings.push(`${login.alias} and ${keptName} are the same account (${kept.email!}), ` +
      `so they use one subscription. "kurmis logout ${login.alias}" removes ${login.alias}.`)
  }
  return warnings
}

/** The status as `kurmis status` prints it, ending in a newline. Fits 80 columns. */
export function formatStatus(report: StatusReport, now: number, options: StatusFormatOptions): string {
  const json = statusJson(report, now, options)
  // The text gives times in local time; the JSON keeps them as ISO strings.
  json.logins.forEach((login, index) => {
    const source = report.logins[index]
    const block = source?.block ?? null
    if (login.blocked !== null && block !== null) login.blocked.text = blockText(block, now, options, true)
  })
  const lines = [...daemonLines(json, report, now), '', ...GLOBAL_ROUTING_TEXT[json.globalRouting].flatMap((line) => wrap(line, '', ''))]
  const labelWidth = Math.min(MAX_LABEL_WIDTH, Math.max(0, ...json.logins.flatMap((login) =>
    (login.usage?.windows ?? []).map((window) => window.label.length))))
  for (const warning of json.warnings) lines.push('', ...wrap(`Warning: ${warning}`, '', '  '))
  if (report.source === 'files') lines.push('', 'Logins are read from config.json, and the usage is cached by the daemon:')
  for (const login of json.logins) {
    lines.push('', ...loginLines(login, now, labelWidth))
  }
  return `${lines.join('\n')}\n`
}

/** What starts the daemon, for the text that says it is not running or will be replaced. */
const DAEMON_STARTERS = ['"kurmis claude"', '"kurmis setup"', '"kurmis daemon start"']

/** The lines about the daemon at the top of the text. */
function daemonLines(json: StatusJson, report: StatusReport, now: number): string[] {
  const daemon = report.daemon
  if (daemon === null) {
    return ['The kurmis daemon is not running. It is started automatically by',
      ...DAEMON_STARTERS.flatMap((starter) => wrap(starter, '  - ', '    '))]
  }
  const lines = [`kurmis daemon ${daemon.version}, pid ${String(daemon.pid)}, port ${String(daemon.port)}, ` +
    `running for ${spanText(now - daemon.startedAt)}`]
  if (json.daemon?.older === true) {
    lines.push(...wrap(`It runs an older kurmis than this one (${report.version}). The next ` +
      `${DAEMON_STARTERS.slice(0, -1).join(', ')} or ${DAEMON_STARTERS.at(-1)!} replaces it.`, '', ''))
  }
  if (json.daemon?.newer === true) {
    lines.push(...wrap(report.source === 'daemon'
      ? `It runs a newer kurmis than this one (${report.version}), which this kurmis does not replace.`
      : `It runs a newer kurmis than this one (${report.version}), which this kurmis does not replace and cannot use. ` +
        'Update this kurmis, or stop the daemon with "kurmis daemon stop" and run the command again.', '', ''))
  }
  if (report.source === 'files') {
    lines.push('This kurmis cannot read its status.')
  }
  return lines
}

/** The lines about global routing, each wrapped on its own. */
const GLOBAL_ROUTING_TEXT: Record<GlobalRoutingState, string[]> = {
  on: ['Global routing is on: plain "claude" and the Claude Code editor extensions go through kurmis.',
    'Run "kurmis setup --pause" to pause it.'],
  paused: ['Global routing is paused: only "kurmis claude" goes through kurmis. Plain "claude" does not.',
    'Run "kurmis setup" to turn it on again.'],
  off: ['Global routing is off: only "kurmis claude" goes through kurmis. Plain "claude" does not.',
    'Run "kurmis setup" to turn on global routing.']
}

/** The text output's width. */
const WIDTH = 80
/** Window names longer than this are cut, so the columns after them stay on the line. */
const MAX_LABEL_WIDTH = 24

/** The first line of a login: its alias and its id, without the id while the alias is the id. */
function loginTitle(login: StatusJsonLogin): string {
  return login.alias === login.id ? login.alias : `${login.alias} (id ${login.id})`
}

function credentialsText(check: CredentialCheck): string {
  if (check === 'unknown') return 'credentials on this machine: unknown'
  return check ? 'credentials on this machine' : 'no credentials on this machine'
}

function loginLines(login: StatusJsonLogin, now: number, labelWidth: number): string[] {
  const title = loginTitle(login)
  const lines = login.email === null ? [title]
    : title.length + 2 + login.email.length <= WIDTH ? [`${title}  ${login.email}`]
      : [title, `  ${login.email}`]
  if (login.usedByPlainClaude) lines.push(`  ${PLAIN_CLAUDE_LOGIN}`)
  const facts = [
    login.credentials !== null
      ? credentialsText(login.credentials)
      : login.signedIn === null ? 'sign-in not checked yet' : login.signedIn ? 'signed in' : 'signed out',
    login.routing ? 'routing on' : 'routing off',
    `limits ${String(login.fiveHourLimit)}% 5 hour, ${String(login.weeklyLimit)}% weekly`
  ]
  if (login.useFirst) facts.push('use first')
  facts.push(`${login.sessions === 1 ? '1 session' : `${String(login.sessions)} sessions`} in the last 7 days`)
  if (login.usage?.plan) facts.push(`plan ${login.usage.plan}`)
  if (login.probing) facts.push('reading usage now')
  lines.push(...wrapList(facts, '  '))
  // A signed-out login keeps showing the usage read before it was signed out.
  const signedOut = login.signedIn === false || login.credentials === false
  if (signedOut && (login.usage === null || login.usage.windows.length === 0)) {
    lines.push('  usage unknown')
  } else if (login.usage === null) {
    lines.push('  usage not read yet')
  } else {
    for (const window of login.usage.windows) lines.push(windowLine(window, now, labelWidth))
    if (login.usage.windows.length === 0) lines.push('  no usage windows reported')
    const age = now - Date.parse(login.usage.fetchedAt)
    const when = age < 60_000 ? 'just now' : `${spanText(age)} ago`
    lines.push(`  usage read ${when}`)
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

function blockJson(login: LoginStatus, now: number, options: StatusFormatOptions): StatusJsonBlock | null {
  const block = login.block
  if (block === null) return null
  let until: string | null = null
  if (block.kind === 'cooldown' && block.until !== null) until = isoTime(block.until)
  else if (block.kind === 'over-limit') until = block.resetsAt
  return { kind: block.kind, text: blockText(block, now, options, false), until }
}

/** A block as a sentence with how long is left; with `localTime`, a cooldown's end is in local time rather than ISO. */
function blockText(block: RouteBlock, now: number, options: StatusFormatOptions, localTime: boolean): string {
  if (block.kind === 'cooldown' && block.until !== null) {
    const text = localTime
      ? `cooling down until ${localTimeText(block.until, now, options.timeZone)}`
      : routeBlockText(block, options.keychain)
    const left = resetsInText(block.until, now)
    return left === null ? text : `${text} (${left.replace('resets ', '')})`
  }
  const text = routeBlockText(block, options.keychain)
  if (block.kind !== 'over-limit') return text
  const left = resetsInText(block.resetsAt, now)
  return left === null ? text : `${text}; it ${left}`
}

/**
 * A time as a 24-hour clock in `timeZone` (the machine's time zone when absent) shows it: `03:10`,
 * with the date in front (`2026-09-14 03:10`) when it falls on another day than `now`.
 */
function localTimeText(at: number, now: number, timeZone?: string): string {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  })
  const parts = (time: number): Record<string, string> =>
    Object.fromEntries(format.formatToParts(time).map((part) => [part.type, part.value]))
  const then = parts(at)
  const today = parts(now)
  const clock = `${then.hour ?? ''}:${then.minute ?? ''}`
  const date = `${then.year ?? ''}-${then.month ?? ''}-${then.day ?? ''}`
  return date === `${today.year ?? ''}-${today.month ?? ''}-${today.day ?? ''}` ? clock : `${date} ${clock}`
}

function isoTime(at: number): string {
  return Number.isFinite(at) ? new Date(at).toISOString() : String(at)
}

/** Items joined with commas into lines of at most `WIDTH` columns, each with `indent` in front; an item is never split. */
function wrapList(items: readonly string[], indent: string): string[] {
  const lines: string[] = []
  let line = ''
  for (const [index, item] of items.entries()) {
    const text = index < items.length - 1 ? `${item},` : item
    if (line !== '' && indent.length + line.length + 1 + text.length > WIDTH) {
      lines.push(indent + line)
      line = text
    } else {
      line = line === '' ? text : `${line} ${text}`
    }
  }
  lines.push(indent + line)
  return lines
}

/** Words joined into lines of at most `WIDTH` columns: the first with `first` in front, the rest with `rest`. */
function wrap(text: string, first: string, rest: string): string[] {
  const lines: string[] = []
  let line = first
  let empty = true
  // A command in double quotes, such as "kurmis setup", is kept on one line.
  for (const word of text.match(/"[^"]*"\S*|\S+/g) ?? []) {
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
