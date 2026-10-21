// The headers a routed Claude CLI sends the kurmis proxy, and the `ANTHROPIC_CUSTOM_HEADERS`
// value that makes it send them.
//
// The CLI reads `ANTHROPIC_CUSTOM_HEADERS` as newline-separated `Name: value` lines and adds
// each to every request its inference client sends (the original router's `src/tools/claude/PROTOCOL.md`,
// "Request headers on an inference call"). Kurmis puts up to three headers there:
// `x-kurmis-key` with the daemon's secret, `x-kurmis-login` when the CLI was started with
// `--login`, which pins the session to that login, and `x-kurmis-started-on` naming the login
// whose credentials the CLI was started on. None of them is forwarded upstream. The CLI also sends
// `X-Claude-Code-Session-Id` by itself, which is what the proxy tells sessions apart by.
import { timingSafeEqual } from 'node:crypto'
import { CLAUDE_DEFAULT_ACCOUNT_ID, parseAccountId } from './accounts.ts'

/** The header that carries the daemon's secret. A proxy request without the right one is refused. */
export const KEY_HEADER = 'x-kurmis-key'

/** The header that pins a request to one Claude login, by id (`claude:<name>`). */
export const LOGIN_HEADER = 'x-kurmis-login'

/**
 * The header naming the login whose credentials the CLI was started on (`claude:<name>`). The
 * proxy may forward the CLI's own `authorization` header only for that login. A request without
 * it was sent by a CLI started on `claude:default`, such as a plain `claude` in global mode.
 */
export const STARTED_ON_HEADER = 'x-kurmis-started-on'

/** The header the CLI names its session in. Its subagents and small-model requests share it. */
export const SESSION_HEADER = 'x-claude-code-session-id'

/** Headers kurmis adds for the proxy alone. The proxy strips them before forwarding. */
export const KURMIS_HEADERS: readonly string[] = [KEY_HEADER, LOGIN_HEADER, STARTED_ON_HEADER]

/** One `Name: value` line of `ANTHROPIC_CUSTOM_HEADERS`. */
export interface CustomHeader {
  name: string
  value: string
}

/**
 * The headers in an `ANTHROPIC_CUSTOM_HEADERS` value, in order. Each line is split at its first
 * colon and both halves are trimmed; a line with no colon or no name is skipped. Lines may end
 * in `\r\n`.
 */
export function parseCustomHeaders(value: string | null | undefined): CustomHeader[] {
  const out: CustomHeader[] = []
  for (const line of (value ?? '').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const name = line.slice(0, colon).trim()
    if (name.length === 0) continue
    out.push({ name, value: line.slice(colon + 1).trim() })
  }
  return out
}

/** The `ANTHROPIC_CUSTOM_HEADERS` value for these headers: one `Name: value` line each. */
export function formatCustomHeaders(headers: readonly CustomHeader[]): string {
  return headers.map((header) => `${header.name}: ${header.value}`).join('\n')
}

/**
 * An `ANTHROPIC_CUSTOM_HEADERS` value with kurmis' headers in it: the key, the pinned login when
 * one is named, and the login the CLI was started on when that is given. Headers the person set
 * themselves are kept, ahead of kurmis' own, and any kurmis header already there (as in a CLI
 * started from inside a routed session) is replaced.
 */
export function withRouteHeaders(existing: string | null | undefined, key: string, login: string | null,
  startedOn: string | null = null): string {
  const own = parseCustomHeaders(existing).filter((header) => !KURMIS_HEADERS.includes(header.name.toLowerCase()))
  const added: CustomHeader[] = [{ name: KEY_HEADER, value: key }]
  if (login !== null) added.push({ name: LOGIN_HEADER, value: login })
  if (startedOn !== null) added.push({ name: STARTED_ON_HEADER, value: startedOn })
  return formatCustomHeaders([...own, ...added])
}

/** Reads one request header, case-insensitively; null or undefined when it is not there. */
export type RequestHeaderGetter = (name: string) => string | null | undefined

/** What the proxy reads off a request before it routes it. */
export interface RouteRequest {
  /** The secret the request carries, or null without one. */
  key: string | null
  /**
   * The Claude login the request is pinned to, or null on Auto. A header that does not name a
   * Claude login reads as `invalid`, which the proxy should refuse rather than route on Auto.
   */
  login: string | null | 'invalid'
  /**
   * The Claude login the CLI was started on: the `x-kurmis-started-on` header, or
   * `claude:default` without one. A header that does not name a Claude login reads as `invalid`.
   */
  startedOn: string | 'invalid'
  /** The CLI's session id, or null when the request has none. */
  sessionId: string | null
}

export function readRouteRequest(get: RequestHeaderGetter): RouteRequest {
  const key = nonEmpty(get(KEY_HEADER))
  const named = nonEmpty(get(LOGIN_HEADER))
  const startedOn = nonEmpty(get(STARTED_ON_HEADER))
  return {
    key,
    login: named === null ? null : claudeLoginOrInvalid(named),
    startedOn: startedOn === null ? CLAUDE_DEFAULT_ACCOUNT_ID : claudeLoginOrInvalid(startedOn),
    sessionId: nonEmpty(get(SESSION_HEADER))
  }
}

function claudeLoginOrInvalid(value: string): string | 'invalid' {
  return parseAccountId(value)?.provider === 'claude' ? value : 'invalid'
}

/** Whether a request's key is the daemon's secret, compared in constant time. */
export function routeKeyMatches(given: string | null, secret: string): boolean {
  if (given === null || secret.length === 0) return false
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(secret, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

function nonEmpty(value: string | null | undefined): string | null {
  const text = value?.trim() ?? ''
  return text.length === 0 ? null : text
}
