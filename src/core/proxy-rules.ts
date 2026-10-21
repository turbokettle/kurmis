// The decisions of the routing proxy that are not I/O: which requests it routes, which headers
// go upstream and back, how the body is changed, what it answers when no login can serve, and
// how a usage probe ends a cooldown.
//
// The order the proxy applies them in, for one request (the daemon's job):
// 1. `requestKind`; a `route` request needs the key (`readRouteRequest`, `routeKeyMatches`).
// 2. Build the session's `RouteSession` and the logins' `RouteAccount` rows, re-probe the
//    logins `staleUsageLogins` names (leaving out those probed for that in the last minute),
//    and pick one with `chooseAccount`. A login whose token is about to expire is renewed first
//    (a usage probe); see `tokenIsFresh`.
// 3. Send `upstreamRequest(...)` to Anthropic. Fold the answer's rate-limit headers into the
//    login's usage (`usageFromUnifiedHeaders`), and note `quotaCooldownUntil` as its cooldown.
//    A 401 is renewed once, and then passed on only from the started-on or pinned login.
// 4. A want of capacity (`capacityRefusal`) goes to `CapacityCooling` and the hold; otherwise
//    `replayDecision` says whether to pass the answer on, send it again on another login, or
//    pin the session back. The pin-back holds the session to that login only while the login
//    can serve. With no login left, answer `refusalAnswer(...)`.
// 5. Forward the answer with `downstreamResponseHeaders` and the body byte for byte, and only
//    then record the login as the session's current one.
import {
  accountsInScope, effectivePin, limitForWindow, poolReadyAt, routeBlock, tokenIsFresh,
  type RouteAccount, type RouteBlock, type RouteSession
} from './account-router.ts'
import type { AccountUsage } from './claude-usage.ts'
import { KURMIS_HEADERS } from './route-headers.ts'
import { busiestPlanWindow, planUsageWindows, resetsAtFromUsage, usageAsOf } from './usage-rules.ts'

/** The Anthropic endpoints the proxy routes. Everything else under the base URL is a 404. */
export const ROUTE_PATHS = [
  { method: 'POST', path: '/v1/messages' },
  { method: 'POST', path: '/v1/messages/count_tokens' },
  { method: 'GET', path: '/v1/models' }
] as const

/** The path the CLI checks the base URL with, before its first request and without the custom headers. */
export const HELLO_PATH = '/api/hello'

/** Paths under this prefix are the daemon's control API, not the proxy. */
export const CONTROL_PREFIX = '/_kurmis/'

/** What kind of request arrived on the daemon's port. */
export type RequestKind =
  | { kind: 'hello' }
  | { kind: 'control'; path: string }
  | { kind: 'route'; path: string }
  | { kind: 'unknown' }

export function requestKind(method: string | undefined, url: string | undefined): RequestKind {
  const path = (url ?? '').split('?')[0] ?? ''
  if (path === HELLO_PATH && (method === 'HEAD' || method === 'GET')) return { kind: 'hello' }
  if (path.startsWith(CONTROL_PREFIX)) return { kind: 'control', path }
  if (ROUTE_PATHS.some((entry) => entry.method === method && entry.path === path)) return { kind: 'route', path }
  return { kind: 'unknown' }
}

/** The status of every refusal the proxy makes by itself. Anthropic's API does not use 599. */
export const ROUTER_REFUSAL_STATUS = 599

const HOP_HEADERS: ReadonlySet<string> = new Set(['connection', 'keep-alive', 'proxy-authenticate',
  'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

/** The request headers the proxy replaces itself, so the CLI's are never forwarded. */
const REPLACED_REQUEST_HEADERS: ReadonlySet<string> = new Set(['authorization', 'x-api-key', 'host',
  'content-length', 'accept-encoding'])

/** Hop-by-hop headers, and the ones a `connection` header names. */
function droppedHeaders(connection: string | null | undefined): Set<string> {
  return new Set([...HOP_HEADERS, ...(connection ?? '').toLowerCase().split(',').map((name) => name.trim())])
}

/** Request headers as Node's `IncomingMessage.headers` holds them. */
export type IncomingHeaders = Readonly<Record<string, string | string[] | undefined>>

/**
 * The request to send upstream: every header the CLI sent except the hop-by-hop ones, kurmis'
 * own (`KURMIS_HEADERS`) and the five the proxy replaces, with `authorization` set to sign for
 * the chosen login and `accept-encoding: identity` so the answer can be forwarded as it comes.
 * The body is the CLI's bytes, with only the account uuid in `metadata.user_id` changed to the
 * chosen login's (`outgoingBody`).
 *
 * `authorization` is `Bearer <token>` for a token the daemon read, or the CLI's own
 * `authorization` header when the chosen login is the one the CLI was started on and the
 * daemon holds no token for it.
 */
export function upstreamRequest(incoming: IncomingHeaders, body: Buffer | undefined, authorization: string,
  accountUuid: string | null): { headers: Record<string, string>; body: Buffer | undefined } {
  const connection = incoming['connection']
  const drop = droppedHeaders(Array.isArray(connection) ? connection.join(',') : connection)
  const headers: Record<string, string> = {}
  for (const [rawName, value] of Object.entries(incoming)) {
    const name = rawName.toLowerCase()
    if (value === undefined || drop.has(name) || REPLACED_REQUEST_HEADERS.has(name) || KURMIS_HEADERS.includes(name)) continue
    headers[name] = Array.isArray(value) ? value.join(', ') : value
  }
  headers['authorization'] = authorization
  headers['accept-encoding'] = 'identity'
  const outgoing = body === undefined ? undefined : outgoingBody(body, accountUuid)
  if (outgoing !== undefined) headers['content-length'] = String(outgoing.length)
  return { headers, body: outgoing }
}

/**
 * The answer's headers to pass back to the CLI: all but the hop-by-hop ones and those its
 * `connection` header names, and without `content-length`, because the proxy sends the body on
 * in chunks as it arrives. `content-encoding` is kept: the daemon's HTTP client decodes nothing
 * and the body goes on as raw bytes, so a body Anthropic encoded despite `accept-encoding:
 * identity` reaches the CLI encoded, with the header that says so.
 */
export function downstreamResponseHeaders(upstream: Iterable<[string, string]>): Array<[string, string]> {
  const entries = [...upstream].map(([name, value]): [string, string] => [name.toLowerCase(), value])
  const drop = droppedHeaders(entries.find(([name]) => name === 'connection')?.[1])
  return entries.filter(([name]) => !drop.has(name) && name !== 'content-length')
}

/**
 * `metadata.user_id` with its `account_uuid` set to the chosen login's. The CLI sends a JSON
 * string with `device_id`, `account_uuid`, `session_id` and more. Only the `account_uuid` value
 * is replaced in the text, or added at the end of the object when it is missing, so every other
 * field keeps its bytes and its place. A value that is not a JSON object is left as it is.
 * The proxy does this on every request. A conversation moved between logins this way has been
 * measured to go on working; whether the rewrite is needed at all was not measured.
 */
export function rewriteUserId(userId: string, accountUuid: string): string {
  let value: unknown
  try {
    value = JSON.parse(userId)
  } catch {
    return userId
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return userId
  if ((value as Record<string, unknown>)['account_uuid'] === accountUuid) return userId
  const bytes = Buffer.from(userId, 'utf8')
  const open = skipWhitespace(bytes, 0)
  const found = memberValue(bytes, open, 'account_uuid')
  const uuid = Buffer.from(JSON.stringify(accountUuid), 'utf8')
  if (found.span !== null) return splice(bytes, found.span.start, found.span.end, uuid).toString('utf8')
  // The closing brace of the object: add the member just before it.
  const close = skipValue(bytes, open) - 1
  const member = Buffer.concat([Buffer.from(`${found.members > 0 ? ',' : ''}"account_uuid":`, 'utf8'), uuid])
  return splice(bytes, close, close, member).toString('utf8')
}

/**
 * The request body as sent upstream: the CLI's bytes, unchanged unless an account uuid is known
 * and the body has a string `metadata.user_id` whose `account_uuid` differs from it. Then only
 * that string is replaced (`rewriteUserId`), so the rest of the body keeps its exact bytes: key
 * order, white space, and numbers that a parse and a re-serialization would change, such as
 * integers above 2^53. `body` must be valid JSON; the proxy checks that before it gets here.
 */
export function outgoingBody(body: Buffer, accountUuid: string | null): Buffer {
  if (accountUuid === null) return body
  const open = skipWhitespace(body, 0)
  if (body[open] !== BRACE_OPEN) return body
  const metadata = memberValue(body, open, 'metadata').span
  if (metadata === null || body[metadata.start] !== BRACE_OPEN) return body
  const userId = memberValue(body, metadata.start, 'user_id').span
  if (userId === null || body[userId.start] !== QUOTE) return body
  const current = JSON.parse(body.subarray(userId.start, userId.end).toString('utf8')) as string
  const rewritten = rewriteUserId(current, accountUuid)
  if (rewritten === current) return body
  return splice(body, userId.start, userId.end, Buffer.from(JSON.stringify(rewritten), 'utf8'))
}

// A small scanner over JSON text as UTF-8 bytes, enough to find where one member's value is
// without parsing the rest. Every byte it looks at is ASCII, and in UTF-8 no byte of a
// multi-byte character is, so it never stops inside a character. It assumes valid JSON.

const QUOTE = 0x22
const BACKSLASH = 0x5c
const BRACE_OPEN = 0x7b
const BRACE_CLOSE = 0x7d
const BRACKET_OPEN = 0x5b
const BRACKET_CLOSE = 0x5d
const COMMA = 0x2c
const COLON = 0x3a

function isWhitespace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d
}

function skipWhitespace(bytes: Buffer, index: number): number {
  let at = index
  while (at < bytes.length && isWhitespace(bytes[at])) at++
  return at
}

/** The index just after the string whose opening quote is at `index`. */
function skipString(bytes: Buffer, index: number): number {
  let at = index + 1
  while (at < bytes.length) {
    const byte = bytes[at]
    if (byte === BACKSLASH) at += 2
    else if (byte === QUOTE) return at + 1
    else at++
  }
  return at
}

/** The index just after the value that starts at `index`. */
function skipValue(bytes: Buffer, index: number): number {
  const first = bytes[index]
  if (first === QUOTE) return skipString(bytes, index)
  if (first === BRACE_OPEN || first === BRACKET_OPEN) {
    let depth = 0
    let at = index
    while (at < bytes.length) {
      const byte = bytes[at]
      if (byte === QUOTE) {
        at = skipString(bytes, at)
        continue
      }
      if (byte === BRACE_OPEN || byte === BRACKET_OPEN) depth++
      else if (byte === BRACE_CLOSE || byte === BRACKET_CLOSE) {
        depth--
        if (depth === 0) return at + 1
      }
      at++
    }
    return at
  }
  // A number, true, false or null: it runs to the next separator.
  let at = index
  while (at < bytes.length) {
    const byte = bytes[at]
    if (byte === COMMA || byte === BRACE_CLOSE || byte === BRACKET_CLOSE || isWhitespace(byte)) break
    at++
  }
  return at
}

/**
 * Where the value of the member `name` is in the object whose `{` is at `open`: its start and
 * the index just after it, or null when the object has no such member. A name that is repeated
 * gives the last one, as `JSON.parse` keeps the last. `members` is how many members the object has.
 */
function memberValue(bytes: Buffer, open: number, name: string): { span: { start: number; end: number } | null; members: number } {
  let span: { start: number; end: number } | null = null
  let members = 0
  let at = skipWhitespace(bytes, open + 1)
  while (at < bytes.length && bytes[at] === QUOTE) {
    const keyEnd = skipString(bytes, at)
    const key = JSON.parse(bytes.subarray(at, keyEnd).toString('utf8')) as string
    at = skipWhitespace(bytes, keyEnd)
    if (bytes[at] !== COLON) break
    const start = skipWhitespace(bytes, at + 1)
    const end = skipValue(bytes, start)
    members++
    if (key === name) span = { start, end }
    at = skipWhitespace(bytes, end)
    if (bytes[at] !== COMMA) break
    at = skipWhitespace(bytes, at + 1)
  }
  return { span, members }
}

/** `bytes` with `[start, end)` replaced by `insert`. */
function splice(bytes: Buffer, start: number, end: number, insert: Buffer): Buffer {
  return Buffer.concat([bytes.subarray(0, start), insert, bytes.subarray(end)])
}

/** An answer the proxy makes itself. */
export interface ProxyAnswer {
  status: number
  headers: Record<string, string>
  body: string
}

/**
 * Logins whose usage reading has a busiest plan window whose reset has passed, among those the
 * session may use, and that are not in `refreshed`: the proxy passes the logins this request has
 * re-probed already and those probed for a stale reading in the last minute. The proxy probes
 * them before it chooses, because the reading belongs to a window that has ended.
 */
export function staleUsageLogins(session: RouteSession, rows: readonly RouteAccount[], now: number,
  refreshed: ReadonlySet<string>): string[] {
  const pinned = effectivePin(session, rows)
  return rows.filter((row) => {
    const reset = busiestPlanWindow(row.usage)?.resetsAt
    return !refreshed.has(row.id) && row.loggedIn && row.credentialsReadable &&
      (pinned === null ? row.autoRoute : row.id === pinned) &&
      reset != null && Date.parse(reset) <= now
  }).map((row) => row.id)
}

/**
 * The rows with every login whose token runs out within `TOKEN_MARGIN_MS` marked unreadable,
 * once the proxy has already tried to renew it for this request. Such a login cannot serve the
 * session until a later token arrives, and when that comes is not known, so neither its room
 * nor its reset says when the pool can serve. A login a session is pinned to keeps its reset,
 * and loses only its room.
 */
export function withoutExpiringTokens(rows: readonly RouteAccount[], now: number,
  session: RouteSession): RouteAccount[] {
  const pinned = effectivePin(session, rows)
  return rows.map((row) => row.tokenExpiresAt !== null && !tokenIsFresh(row.tokenExpiresAt, now) &&
    (pinned === null || poolReadyAt([row], now, pinned, session.homeAccountId) === now)
    ? { ...row, credentialsReadable: false }
    : row)
}

/**
 * What to answer when no login could serve the request. `rows` are the logins as the proxy
 * could sign for them after its tries. Only a pool that has a login in it and is out of usage is
 * a usage limit (`poolLimitAnswer`); a pool with nothing it can sign for could not have served
 * the request whatever anybody's usage said, and gets the proxy's own 599 (`noSignerAnswer`).
 */
export function refusalAnswer(session: RouteSession, rows: readonly RouteAccount[], now: number,
  cliOnOwnCredentials = false): ProxyAnswer & { kind: 'no-signer' | 'pool-limit'; resetAt: number | null } {
  const usable = withoutExpiringTokens(rows, now, session)
  if (accountsInScope(session, usable).length === 0) return { ...noSignerAnswer(cliOnOwnCredentials), kind: 'no-signer', resetAt: null }
  return { ...poolLimitAnswer(session, usable, now), kind: 'pool-limit' }
}

/**
 * The proxy's own 599 for a request no login here can sign. Not a usage limit, and never a 401,
 * which would send the CLI off to renew a token that is not the problem. The CLI retries a 5xx
 * and honours `retry-after`. `cliOnOwnCredentials` is a request whose CLI said its credentials
 * are no kurmis login's (`STARTED_ON_NONE`), and the message then says why `claude:default` was
 * not used.
 */
export function noSignerAnswer(cliOnOwnCredentials = false): ProxyAnswer {
  const message = cliOnOwnCredentials
    ? 'No Claude login kurmis may use for this session could sign the request. This Claude CLI runs with ' +
      'CLAUDE_CONFIG_DIR set, so it is signed in with the login in that folder, which is not kurmis\' claude:default, ' +
      'and kurmis signs its requests only with its extra logins. Add one with `kurmis login claude`, start Claude ' +
      'with `kurmis claude`, or run `kurmis setup --pause` with that CLAUDE_CONFIG_DIR.'
    : 'No Claude login kurmis may use for this session could sign the request. ' +
      'Run `kurmis status` to see which logins are signed in.'
  return {
    status: ROUTER_REFUSAL_STATUS,
    headers: { 'content-type': 'application/json', 'retry-after': '5' },
    body: JSON.stringify({ type: 'error', error: { type: 'api_error', message } })
  }
}

/**
 * The 429 for a pool that is out of usage, in the shape of Anthropic's own, so the CLI behaves
 * as it does when a single login runs out. It names when the pool is back (`poolReadyAt`) and
 * the window that keeps the first login to come back out, so the CLI's message is right.
 * `resetAt` is that time, or null when nothing says.
 */
export function poolLimitAnswer(session: RouteSession, all: readonly RouteAccount[], now: number):
  ProxyAnswer & { resetAt: number | null } {
  const pinned = effectivePin(session, all)
  const rows = all.filter((row) => pinned === null || row.id === pinned)
  const reset = poolReadyAt(rows, now, pinned, session.homeAccountId)
  const next = reset === null ? undefined : rows.find((row) => poolReadyAt([row], now, pinned, session.homeAccountId) === reset)
  const blocking = next === undefined ? undefined : planUsageWindows(usageAsOf(next.usage, now))
    .filter((window) => window.utilization >= (pinned === null ? limitForWindow(next, window) : 100))
    .sort((a, b) => Date.parse(b.resetsAt ?? '') - Date.parse(a.resetsAt ?? ''))[0]
  const claim = blocking?.key ?? next?.usage?.limited?.window ?? 'five_hour'
  const message = `Usage limit reached for every login kurmis may use.${reset === null ? '' : ` Resets at ${new Date(reset).toISOString()}.`}`
  return {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'anthropic-ratelimit-unified-status': 'rejected',
      'anthropic-ratelimit-unified-representative-claim': claim,
      ...(reset === null ? {} : { 'anthropic-ratelimit-unified-reset': String(reset / 1000) }),
      'retry-after': String(reset === null ? 1 : Math.max(1, Math.ceil((reset - now) / 1000)))
    },
    body: JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message } }),
    resetAt: reset
  }
}

/**
 * A login's cooldown after a usage snapshot arrives. A cooldown with no known end (`Infinity`,
 * from a refusal that named no reset) ends with the first successful probe: at the reset the
 * probe names, or at once when the probe shows nothing used up. Every other cooldown is kept.
 */
export function cooldownAfterProbe(cooldownUntil: number | null, snapshot: AccountUsage): number | null {
  if (cooldownUntil !== Infinity || snapshot.source !== 'probe' || snapshot.error !== null || !snapshot.rateLimitsAvailable) {
    return cooldownUntil
  }
  const reset = resetsAtFromUsage(snapshot)
  if (reset !== null && Number.isFinite(Date.parse(reset))) return Date.parse(reset)
  return snapshot.status === 'rejected' ? cooldownUntil : null
}

/** What `whyPassedOver` needs to know beyond the row. */
export interface PassedOverContext {
  /** The session is pinned, which measures the login to 100% and ignores its opt-in. */
  pinned: boolean
  /** The logins this request was already sent on. */
  attempted: ReadonlySet<string>
  /** The daemon reads tokens from the macOS Keychain rather than from `.credentials.json`. */
  keychain: boolean
  /** The login the CLI was started on, whose own `authorization` header the proxy may forward. */
  startedOn: string
}

/**
 * Why the proxy did not send a request on this login, as a phrase for the daemon's log line
 * about a refused request. Names no token, email or body.
 */
export function whyPassedOver(row: RouteAccount, context: PassedOverContext, now: number): string {
  if (context.attempted.has(row.id)) return 'already tried for this request'
  const block = routeBlock(context.pinned ? { ...row, autoRoute: true, fiveHourLimitPercent: 100, weeklyLimitPercent: 100 } : row, now)
  if (block === null) return 'usable now, so it had room only after the choice was made'
  return routeBlockText(block, context.keychain, row.id === context.startedOn)
}

/**
 * A `RouteBlock` as a phrase, for the log and for `kurmis status`. Without the Keychain, a login
 * on Windows has its token in Credential Manager or in `.credentials.json`, elsewhere only in
 * the file.
 */
export function routeBlockText(block: RouteBlock, keychain = false, startedOn = false, platform: NodeJS.Platform = process.platform): string {
  switch (block.kind) {
    case 'auto-route-off': return 'not opted in to routing'
    case 'signed-out': return 'signed out'
    case 'no-credentials':
      if (!keychain) {
        return platform === 'win32'
          ? 'no token, neither Windows Credential Manager nor its .credentials.json gave one'
          : 'no token, its .credentials.json did not read'
      }
      return startedOn
        ? 'no token, its Keychain item did not read and the request carried no authorization header of its own'
        : 'no token, its Keychain item did not read and the CLI signs only for the login it was started on'
    case 'token-expiring': return 'its token expires within 5 minutes'
    case 'cooldown':
      return block.until === null ? 'cooling down until a usage probe says it is back' : `cooling down until ${new Date(block.until).toISOString()}`
    case 'over-limit':
      return `at its limit, the ${block.window} window is at ${String(Math.round(block.utilization))}% of ${String(block.limitPercent)}%`
  }
}
