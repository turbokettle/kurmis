// The routing proxy: one routed request of a Claude CLI, from its arrival to the end of the
// answer. It applies the decisions of `src/core/proxy-rules.ts` in the order that file's header
// lists, and keeps the per-request bookkeeping the original router's `router/proxy.ts` keeps:
//
// 1. The key (`routeKeyMatches`), then the `x-kurmis-login` / `x-kurmis-started-on` headers. The
//    body is read whole, because a request may be sent more than once (a replay); a body over
//    `MAX_REQUEST_BODY_BYTES` is answered 413 (`refuseTooLarge`).
// 2. A login is chosen (`pick`): stale usage readings are probed first (`staleUsageLogins`, at
//    most once a minute per login), a login whose token is about to expire is renewed by a probe
//    before it is used, and logins the session's capacity backoff is cooling are passed over. A
//    session held to a login after a pin-back is let go when that login cannot serve.
// 3. The request goes upstream, signed with the token read for the chosen login, or with the
//    CLI's own `authorization` header when the chosen login is the one the CLI was started on
//    and no token was read for it. Every answer's rate-limit headers update the login's usage,
//    and a usage-limit refusal starts its cooldown. A 401 on a token the proxy read gets one
//    renewal; after that it reaches the CLI only from the started-on login or the login the
//    request is pinned to, and any other request goes on to the next login (`markRefused`).
// 4. A 529 or a 429 without usage-limit headers puts the login into the session's capacity
//    backoff and holds the request (`capacity-hold.ts`) until the answer's headers arrive. A
//    usage-limit 429 on Auto is sent again on another login before the CLI sees anything, and a
//    400 on a login the session has just moved to sends it back to its previous login
//    (`replayDecision`), which the session is then held to while that login can serve.
// 5. The accepted answer is forwarded byte for byte and the session is placed on its login.
//    When no login is left, the CLI gets the real 429 of the login that is back first, or the
//    proxy's own answer (`refusalAnswer`) when it holds none.
//
// Nothing here logs a token, a body or an email; the log takes fixed fields only.
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  accountsInScope, chooseAccount, effectivePin, isDefinitiveQuotaRejection, parseUnifiedHeaders, quotaCooldownUntil,
  replayDecision, routeBlock, tokenIsFresh, usageFromUnifiedHeaders, type RouteAccount, type RouteSession
} from '../core/account-router.ts'
import { CLAUDE_DEFAULT_ACCOUNT_ID } from '../core/accounts.ts'
import {
  CAPACITY_HOLD_BASE_MS, CAPACITY_HOLD_MAX_MS, CAPACITY_HOLD_MS, CapacityCooling, capacityHoldAnswer, capacityRefusal
} from '../core/capacity-hold.ts'
import {
  downstreamResponseHeaders, poolLimitAnswer, refusalAnswer, staleUsageLogins, upstreamRequest, type ProxyAnswer
} from '../core/proxy-rules.ts'
import { readRouteRequest, routeKeyMatches } from '../core/route-headers.ts'
import type { ClaudeIdentityReader } from '../data/identity.ts'
import { isLoginId, type LoginId } from '../data/login-id.ts'
import { errorCodeOf, methodOf, type DaemonLog, type LogFields } from '../data/log.ts'
import { isSessionId } from '../data/state.ts'
import { NO_SESSION_KEY, type LoginTable } from './logins.ts'
import type { TokenSource } from './tokens.ts'
import { forwardBody, UpstreamError, type Upstream, type UpstreamAnswer } from './upstream.ts'
import type { UsagePoller } from './usage-poller.ts'

/**
 * The largest request body the proxy takes. It holds the body in memory to be able to send it
 * again; a long conversation with images is tens of megabytes at most.
 */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024

/**
 * How long the proxy goes on reading and dropping a request body that is too large after it
 * has answered 413, before it closes the connection. A client that sends its whole body before
 * it reads the answer gets the 413 this way instead of a reset connection.
 */
export const TOO_LARGE_LINGER_MS = 5_000

/** The most of a refused answer's body kept for forwarding later. Anthropic's 429 bodies are a few hundred bytes. */
const MAX_KEPT_ANSWER_BYTES = 256 * 1024

/**
 * How long the proxy waits for the body of a refusal it keeps (a usage-limit 429 it may pass on
 * later, or the 400 before a pin-back) before it goes on without the rest. Such a body is a few
 * hundred bytes that come with the headers, so a body still open after this has stalled, and
 * waiting for it would keep the request from the next login.
 */
export const KEPT_ANSWER_TIMEOUT_MS = 5_000

/**
 * How long a request on Auto waits for the renewal of the chosen login's expiring token when
 * another login could take it. The renewal goes on; the request is sent on the other login. A
 * request that has no other login waits for the renewal as long as the probe takes.
 */
export const RENEWAL_WAIT_MS = 5_000

export interface ProxyOptions {
  key: string
  table: LoginTable
  tokens: TokenSource
  identity: ClaudeIdentityReader
  poller: UsagePoller
  upstream: Upstream
  log: DaemonLog
  now: () => number
  /** The 0-1 source of the capacity backoff's jitter. */
  random?: () => number
  /** The capacity hold's length and backoff; the constants of `capacity-hold.ts` by default. */
  hold?: { holdMs?: number; baseMs?: number; maxMs?: number }
  maxBodyBytes?: number
  renewalWaitMs?: number
  /** Default `KEPT_ANSWER_TIMEOUT_MS`. */
  keptAnswerTimeoutMs?: number
  /** Default `TOO_LARGE_LINGER_MS`. */
  tooLargeLingerMs?: number
}

export interface Proxy {
  /** Handles one request whose path `requestKind` called `route`. Never rejects. */
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>
  /** How many requests are open. */
  openRequests(): number
  /** Resolves once no request is open. */
  drained(): Promise<void>
}

/** A usage-limit 429 kept while the request is sent on other logins. */
interface KeptRefusal {
  login: string
  /** When the login is back, from the answer (`quotaCooldownUntil`); Infinity when it did not say. */
  until: number
  status: number
  headers: Array<[string, string]>
  body: Buffer
}

class ClientGone extends Error {}

export function createProxy(options: ProxyOptions): Proxy {
  const { table, tokens, identity, poller, upstream, log, now } = options
  const random = options.random ?? Math.random
  const holdMs = options.hold?.holdMs ?? CAPACITY_HOLD_MS
  const cooling = new CapacityCooling({ baseMs: options.hold?.baseMs ?? CAPACITY_HOLD_BASE_MS, maxMs: options.hold?.maxMs ?? CAPACITY_HOLD_MAX_MS })
  const maxBodyBytes = options.maxBodyBytes ?? MAX_REQUEST_BODY_BYTES
  const renewalWaitMs = options.renewalWaitMs ?? RENEWAL_WAIT_MS
  const lingerMs = options.tooLargeLingerMs ?? TOO_LARGE_LINGER_MS
  const keptAnswerTimeoutMs = options.keptAnswerTimeoutMs ?? KEPT_ANSWER_TIMEOUT_MS
  let open = 0
  let drainWaiters: Array<() => void> = []

  const finished = (): void => {
    open--
    if (open === 0) {
      const waiters = drainWaiters
      drainWaiters = []
      for (const resolve of waiters) resolve()
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const info = readRouteRequest((name) => headerValue(req, name))
    if (!routeKeyMatches(info.key, options.key)) {
      log.write('proxy_rejected', { reason: 'bad_secret', method: methodOf(req.method) })
      req.resume()
      res.writeHead(403).end()
      return
    }
    if (info.login === 'invalid' || info.startedOn === 'invalid') {
      log.write('proxy_rejected', { reason: 'invalid', method: methodOf(req.method) })
      req.resume()
      send(res, invalidRequest(info.login === 'invalid'
        ? 'The x-kurmis-login header does not name a Claude login (claude:<name>).'
        : 'The x-kurmis-started-on header does not name a Claude login (claude:<name>).'))
      return
    }
    open++
    const controller = new AbortController()
    const onClose = (): void => { if (!res.writableFinished) controller.abort(new ClientGone()) }
    res.on('close', onClose)
    try {
      await route(req, res, info, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) {
        if (!res.writableFinished) res.destroy()
      } else {
        log.write('internal_error', { code: errorCodeOf(error) })
        if (!res.headersSent) send(res, apiError(502, 'The kurmis proxy failed to handle the request.'))
        else res.destroy()
      }
    } finally {
      res.off('close', onClose)
      controller.abort()
      finished()
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse, info: ReturnType<typeof readRouteRequest>,
    signal: AbortSignal): Promise<void> {
    const arrived = now()
    const read = await readBody(req, maxBodyBytes, signal)
    if (read === 'too-large') {
      log.write('proxy_rejected', { reason: 'invalid', status: 413 })
      refuseTooLarge(req, res, maxBodyBytes, lingerMs)
      return
    }
    // The body is checked once and then sent on as the bytes that came (`outgoingBody`).
    const body = read.length === 0 ? undefined : read
    if (body !== undefined && !isJson(body)) {
      log.write('proxy_rejected', { reason: 'invalid', status: 400 })
      send(res, invalidRequest('The request body is not JSON.'))
      return
    }
    table.checkConfig()
    const sessionKey = info.sessionId !== null && isSessionId(info.sessionId) ? info.sessionId : NO_SESSION_KEY
    /**
     * The login the session was sent back to after a 400 (`replayDecision`'s `pin-back`) and is
     * held to (`table.heldLogin`), or null. Never set for a request with `x-kurmis-login`.
     */
    let sentBack: string | null = info.login === null ? table.heldLogin(sessionKey) : null
    /** Whether this request's own pin-back set `sentBack`, which tries that login once whatever its usage. */
    let sentBackHere = false
    /** The 400 of the login this request's pin-back left, passed on when no login serves the request after that. */
    let leftAnswer: KeptRefusal | null = null
    const pinned = info.login ?? sentBack
    const session: RouteSession = {
      homeAccountId: pinned ?? CLAUDE_DEFAULT_ACCOUNT_ID,
      currentAccountId: table.sessionLogin(sessionKey),
      pinnedAccountId: pinned
    }
    const startedOn = info.startedOn
    const callerAuthorization = headerValue(req, 'authorization') ?? null
    const rowsNow = (): RouteAccount[] => table.routeRows(startedOn, callerAuthorization !== null, info.login)
    /** Every login this request was sent on. */
    const attempted = new Set<string>()
    /**
     * Logins this request may not be sent on again: they refused it with a usage limit, their
     * token could not be renewed, or Anthropic refused their token.
     */
    const excluded = new Set<string>()
    /** Logins whose stale usage this request has probed. */
    const refreshed = new Set<string>()
    /** Logins whose token this request has tried to renew. */
    const renewed = new Set<string>()
    /** Logins whose token this request has read again because the one held was about to expire. */
    const reread = new Set<string>()
    const refusals: KeptRefusal[] = []
    /** When the capacity hold started, or null while the request is not held. */
    let holdSince: number | null = cooling.coolingOf(sessionKey, now()) === null ? null : arrived

    // A token that is about to expire is no reason to pass a login over while it can still be
    // renewed: the choice is made as if it were fresh, and the chosen login is renewed.
    const renewable = (row: RouteAccount): boolean =>
      !renewed.has(row.id) && tokens.read(row.id)?.hasRefreshToken === true

    /** Ends the session's hold on `sentBack`: this request and the session's later ones are routed on Auto. */
    const endPinBack = (): void => {
      if (sentBack === null) return
      table.releaseSession(sessionKey)
      sentBack = null
      sentBackHere = false
      session.pinnedAccountId = null
      session.homeAccountId = CLAUDE_DEFAULT_ACCOUNT_ID
    }

    /**
     * Whether the hold on `sentBack` has to end because that login cannot serve: it is signed
     * out, has no token the proxy can sign with, is cooling down after a usage limit, or has a
     * window at 100% (a held session is measured like a pinned one, not to the login's own
     * limits). A token about to expire that can be renewed does not end it.
     */
    const pinBackEnds = (rows: readonly RouteAccount[]): boolean => {
      if (sentBack === null) return false
      if (excluded.has(sentBack)) return true
      // This request's pin-back tries the login once even when it is at a limit or cooling down.
      if (sentBackHere) return false
      const row = rows.find((each) => each.id === sentBack)
      if (row === undefined) return true
      const measured = { ...row, autoRoute: true, fiveHourLimitPercent: 100, weeklyLimitPercent: 100,
        ...(renewable(row) ? { tokenExpiresAt: null } : {}) }
      return routeBlock(measured, now()) !== null
    }

    const pick = async (): Promise<RouteAccount | null> => {
      for (;;) {
        await abortable(tokens.prime(table.claudeLogins().map((login) => login.id)), signal)
        const rows = rowsNow()
        // A login probed for a stale reading in the last minute, by this request or another
        // one, is not probed again: a probe that keeps failing would otherwise run every time.
        const stale = staleUsageLogins(session, rows, now(), new Set([...refreshed, ...poller.recentStaleProbes()]))
        if (stale.length > 0) {
          for (const id of stale) refreshed.add(id)
          await abortable(poller.probeMany(stale, 'stale'), signal)
          continue
        }
        if (sentBack !== null && pinBackEnds(rows)) {
          log.write('session_hold_ended', { login: asLogin(sentBack) })
          endPinBack()
          continue
        }
        const scope = new Set(accountsInScope(session, rows).map((row) => row.id))
        const blocked = new Set([...excluded, ...cooling.waitFor(sessionKey, scope, now()).cooling])
        const candidates = rows.map((row) => (renewable(row) ? { ...row, tokenExpiresAt: null } : row))
        const chosen = chooseAccount(session, candidates, now(), blocked)
        if (chosen === null) return null
        const row = rows.find((each) => each.id === chosen.id) ?? chosen
        if (tokenIsFresh(row.tokenExpiresAt, now())) return row
        // A Keychain answer is kept for up to a minute, and the CLI may have renewed the token
        // since: read it again before deciding that it has to be renewed.
        if (!reread.has(row.id)) {
          reread.add(row.id)
          tokens.invalidate(row.id)
          await abortable(tokens.prime([row.id]), signal)
          continue
        }
        if (!renewable(row)) {
          // No refresh token, or a renewal that did not help: the login just expires.
          excluded.add(row.id)
          continue
        }
        renewed.add(row.id)
        const elsewhere = effectivePin(session, rows) === null &&
          chooseAccount(session, candidates, now(), new Set([...blocked, row.id])) !== null
        const renewal = poller.probe(row.id, 'renewal')
        const finishedInTime = await abortable(elsewhere ? withTimeout(renewal, renewalWaitMs) : renewal.then(() => true), signal)
        if (!finishedInTime) excluded.add(row.id)
        tokens.invalidate(row.id)
      }
    }

    const place = (id: string): void => {
      const placement = table.placeSession(sessionKey, id)
      const login = asLogin(id)
      if (placement.kind === 'placed') log.write('session_placed', { login })
      else if (placement.kind === 'moved') log.write('session_moved', { login, fromLogin: placement.from })
    }

    const giveHoldBack = (): void => {
      const heldMs = now() - (holdSince ?? arrived)
      const answer = capacityHoldAnswer(cooling.coolingOf(sessionKey, now())?.reason ?? '529 Overloaded', heldMs)
      log.write('request_failed', { reason: 'overload', status: answer.status, ms: heldMs })
      send(res, answer)
    }

    for (;;) {
      signal.throwIfAborted()
      if (holdSince !== null && now() >= holdSince + holdMs) {
        giveHoldBack()
        return
      }
      const row = await pick()
      if (row === null) {
        const rows = rowsNow()
        const scope = new Set(accountsInScope(session, rows).map((each) => each.id))
        const { wakeAt } = cooling.waitFor(sessionKey, scope, now())
        if (wakeAt !== null) {
          // Every login left is cooling after an answer without capacity: wait for the first of
          // them, a change in the pool, or the end of the hold.
          holdSince ??= arrived
          await waitForPool(table, Math.min(wakeAt, holdSince + holdMs), now, signal)
          continue
        }
        if (refusals.length === 0 && leftAnswer !== null) {
          // The pin-back found no login to serve: the CLI gets the 400 that started it.
          log.write('request_forwarded', { login: asLogin(leftAnswer.login), method: methodOf(req.method), status: leftAnswer.status,
            ms: now() - arrived, attempt: attempted.size })
          res.writeHead(leftAnswer.status, downstreamResponseHeaders(leftAnswer.headers)).end(leftAnswer.body)
          return
        }
        answerRefusal(res, session, rows, refusals, attempted, excluded)
        return
      }
      const token = tokens.read(row.id)
      const authorization = token !== null
        ? `Bearer ${token.accessToken}`
        : row.id === startedOn ? callerAuthorization : null
      if (authorization === null) {
        excluded.add(row.id)
        continue
      }
      const outgoing = upstreamRequest(req.headers, body, authorization, identity.read(row.id)?.accountUuid ?? null)
      attempted.add(row.id)
      // A held request's wait for the answer's headers ends where the hold does, and the
      // request is given back then. The timer stops once the headers are in: the body of an
      // answer that started within the hold follows only the client's own signal.
      const holdLeft = holdSince === null ? null : holdSince + holdMs - now()
      const holdOver = new AbortController()
      const holdTimer = holdLeft === null ? null : setTimeout(() => { holdOver.abort() }, Math.max(0, holdLeft))
      const attemptSignal = holdLeft === null ? signal : AbortSignal.any([signal, holdOver.signal])
      let answer: UpstreamAnswer
      try {
        answer = await upstream.send({ method: req.method ?? 'GET', path: req.url ?? '/', headers: outgoing.headers,
          ...(outgoing.body === undefined ? {} : { body: outgoing.body }), signal: attemptSignal })
      } catch (error) {
        signal.throwIfAborted()
        if (holdOver.signal.aborted) {
          giveHoldBack()
          return
        }
        const kind = error instanceof UpstreamError ? error.kind : 'network'
        log.write('request_failed', { login: asLogin(row.id), reason: kind === 'timeout' ? 'timeout' : 'network', code: errorCodeOf(error) })
        send(res, apiError(kind === 'timeout' ? 504 : 502, kind === 'timeout'
          ? 'The kurmis proxy got no answer from Anthropic in time.'
          : "The kurmis proxy could not reach Anthropic's API."))
        return
      } finally {
        if (holdTimer !== null) clearTimeout(holdTimer)
      }
      const status = answer.status
      const get = (name: string): string | null => answer.get(name)
      noteUsage(row.id, get)
      const until = quotaCooldownUntil(status, get)
      if (until !== null) {
        table.setCooldown(row.id, until)
        log.write('cooldown_started', { login: asLogin(row.id), ...(Number.isFinite(until) ? { until } : {}) })
      }
      // A token Anthropic refused is one the CLI has renewed since it was read, or one to renew.
      if (status === 401 && token !== null) {
        tokens.invalidate(row.id)
        if (token.hasRefreshToken && !renewed.has(row.id)) {
          answer.discard()
          renewed.add(row.id)
          log.write('retry_other_login', { login: asLogin(row.id), reason: 'unauthorized', status })
          await abortable(poller.probe(row.id, 'renewal'), signal)
          tokens.invalidate(row.id)
          attempted.delete(row.id)
          continue
        }
        // Still refused, or no refresh token to renew it with. Only the CLI started on this login
        // can sign it in again, and a session pinned to it with `x-kurmis-login` asked for it: they
        // get the 401. Any other request goes on to the next login, and Auto passes this login over
        // until a probe of it succeeds (`markRefused`).
        if (row.id !== startedOn && info.login === null) {
          answer.discard()
          excluded.add(row.id)
          table.markRefused(row.id)
          log.write('retry_other_login', { login: asLogin(row.id), reason: 'unauthorized', status })
          continue
        }
      }
      const capacity = capacityRefusal(status, isDefinitiveQuotaRejection(status, get))
      if (capacity !== null) {
        answer.discard()
        const note = cooling.noteNoCapacity(sessionKey, row.id, capacity, get('retry-after'), random(), now())
        holdSince ??= arrived
        log.write('retry_after_backoff', { login: asLogin(row.id), reason: 'overload', status, attempt: note.attempt, ms: note.delayMs })
        continue
      }
      cooling.noteAnswered(sessionKey)
      // A usage limit on the login the session is held to ends the hold, and the 429 is sent
      // again on another login like any Auto request's.
      if (until !== null && sentBack !== null && row.id === sentBack) {
        log.write('session_hold_ended', { login: asLogin(sentBack), reason: 'usage_limit' })
        endPinBack()
      }
      const decision = replayDecision({ status, get, servedBy: row.id, session, attempted })
      if (decision.kind === 'replay') {
        refusals.push({ login: row.id, until: decision.cooldownUntil, status, headers: answer.headers, body: await keepBody(answer, signal, keptAnswerTimeoutMs) })
        excluded.add(row.id)
        log.write('retry_other_login', { login: asLogin(row.id), reason: 'usage_limit', status })
        continue
      }
      if (decision.kind === 'pin-back') {
        // The login that answered 400 cannot take this conversation, so it is not tried again.
        // When the previous login cannot serve either, the CLI gets this 400 (`leftAnswer`).
        leftAnswer = { login: row.id, until: Infinity, status, headers: answer.headers, body: await keepBody(answer, signal, keptAnswerTimeoutMs) }
        excluded.add(row.id)
        session.pinnedAccountId = decision.to
        session.homeAccountId = decision.to
        sentBack = decision.to
        sentBackHere = true
        table.holdSession(sessionKey, decision.to)
        log.write('retry_other_login', { login: asLogin(decision.to), fromLogin: asLogin(row.id), reason: 'pinned', status })
        continue
      }
      if (status < 400) place(row.id)
      res.writeHead(status, downstreamResponseHeaders(answer.headers))
      res.flushHeaders()
      const result = await forwardBody(answer, res, signal)
      log.write(result === 'done' ? 'request_forwarded' : 'request_failed', {
        login: asLogin(row.id), method: methodOf(req.method), status, ms: now() - arrived,
        ...(result === 'failed' ? { reason: 'upstream_error' } : {}),
        ...(attempted.size > 1 ? { attempt: attempted.size } : {})
      })
      return
    }
  }

  /** Folds an answer's rate-limit headers into the login's usage, when it carries any. */
  function noteUsage(id: string, get: (name: string) => string | null): void {
    const observation = parseUnifiedHeaders(get, now())
    if (observation.status === null && observation.representativeClaim === null && Object.keys(observation.windows).length === 0) return
    table.setUsage(id, usageFromUnifiedHeaders(id, table.usage(id), observation))
  }

  /**
   * The answer for a request no login is left for. When the request met usage limits, the CLI
   * gets the real 429 of the login that is back first, as it would from a single account that
   * ran out, unless a login it was not sent on is back earlier: the proxy's own 429 then names
   * that time. A login the request may not be sent on for another reason (`excluded`, such as
   * the login that answered 400 before a pin-back) does not count as back. Without a real 429 in
   * hand the proxy answers itself (`refusalAnswer`).
   */
  function answerRefusal(res: ServerResponse, session: RouteSession, rows: RouteAccount[], refusals: KeptRefusal[],
    attempted: ReadonlySet<string>, excluded: ReadonlySet<string>): void {
    const fields: LogFields = { count: attempted.size }
    if (refusals.length > 0) {
      const first = [...refusals].sort((a, b) => a.until - b.until)[0]!
      const refused = new Set(refusals.map((refusal) => refusal.login))
      const pool = poolLimitAnswer(session, rows.filter((row) => !excluded.has(row.id) || refused.has(row.id)), now())
      if (pool.resetAt !== null && pool.resetAt < first.until) {
        log.write('pool_exhausted', { ...fields, reason: 'usage_limit', status: pool.status, until: pool.resetAt })
        send(res, pool)
        return
      }
      log.write('pool_exhausted', { ...fields, reason: 'usage_limit', status: first.status, login: asLogin(first.login),
        ...(Number.isFinite(first.until) ? { until: first.until } : {}) })
      res.writeHead(first.status, downstreamResponseHeaders(first.headers)).end(first.body)
      return
    }
    const answer = refusalAnswer(session, rows, now())
    log.write('pool_exhausted', { ...fields, reason: answer.kind === 'no-signer' ? 'no_credentials' : 'usage_limit',
      status: answer.status, ...(answer.resetAt === null ? {} : { until: answer.resetAt }) })
    send(res, answer)
  }

  return {
    handle: (req, res) => handle(req, res).catch(() => { if (!res.writableFinished) res.destroy() }),
    openRequests: () => open,
    drained: () => (open === 0 ? Promise.resolve() : new Promise((resolve) => { drainWaiters.push(resolve) }))
  }
}

/** One request header as a string; the first value of a repeated one. */
function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  const text = Array.isArray(value) ? value[0] : value
  return text === undefined || text.length === 0 ? undefined : text
}

function isJson(bytes: Buffer): boolean {
  try {
    JSON.parse(bytes.toString('utf8'))
    return true
  } catch {
    return false
  }
}

function asLogin(id: string): LoginId | undefined {
  return isLoginId(id) ? id : undefined
}

function send(res: ServerResponse, answer: ProxyAnswer): void {
  if (res.headersSent || res.destroyed) return
  res.writeHead(answer.status, answer.headers).end(answer.body)
}

function invalidRequest(message: string): ProxyAnswer {
  return {
    status: 400,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } })
  }
}

function apiError(status: number, message: string): ProxyAnswer {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'error', error: { type: 'api_error', message } })
  }
}

/**
 * The whole request body, or `too-large` once it passes `max`. After `too-large` the request
 * stays readable and nothing keeps what arrives (`refuseTooLarge` drops it). Rejects when
 * `signal` aborts or the request breaks off.
 */
function readBody(req: IncomingMessage, max: number, signal: AbortSignal): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const settle = (): void => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('close', onClose)
      signal.removeEventListener('abort', onAbort)
    }
    const onData = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > max) {
        settle()
        chunks.length = 0
        resolve('too-large')
        return
      }
      chunks.push(bytes)
    }
    const onEnd = (): void => { settle(); resolve(Buffer.concat(chunks)) }
    const onError = (error: Error): void => { settle(); reject(error) }
    const onClose = (): void => { settle(); reject(new Error('the request ended before its body was complete')) }
    const onAbort = (): void => { settle(); reject(signal.reason as Error) }
    if (signal.aborted) {
      onAbort()
      return
    }
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
    req.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Answers 413 for a body that passed the limit, in the shape of Anthropic's own (the CLI does
 * not retry a 413). The rest of the body is read and dropped for at most `lingerMs` after the
 * answer is written, and the connection is closed then: closing it at once, with unread data
 * still arriving, would reset it, and a client that is still sending would see the reset
 * rather than the answer.
 */
function refuseTooLarge(req: IncomingMessage, res: ServerResponse, max: number, lingerMs: number): void {
  if (res.headersSent || res.destroyed) return
  const socket = req.socket
  req.resume()
  res.once('finish', () => {
    // No more answers on this connection: end the server's side, and stop reading at the latest after `lingerMs`.
    socket.end()
    const timer = setTimeout(() => { socket.destroy() }, lingerMs)
    timer.unref()
    socket.once('close', () => { clearTimeout(timer) })
  })
  res.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({
    type: 'error',
    error: { type: 'request_too_large', message: `The request body is larger than the ${String(Math.round(max / 1024 / 1024))} MB the kurmis proxy takes.` }
  }))
}

/**
 * Up to `MAX_KEPT_ANSWER_BYTES` of an answer's body, read for at most `timeoutMs`; what comes
 * later is dropped and the connection closed. Rejects with the signal's reason when `signal`
 * aborts, at once, also while the body is stalled.
 */
async function keepBody(answer: UpstreamAnswer, signal: AbortSignal, timeoutMs: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  const body = answer.body
  const timer = setTimeout(() => { body.destroy() }, timeoutMs)
  const onAbort = (): void => { body.destroy() }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for await (const chunk of body) {
      signal.throwIfAborted()
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      if (size + bytes.length > MAX_KEPT_ANSWER_BYTES) {
        answer.discard()
        break
      }
      chunks.push(bytes)
      size += bytes.length
    }
  } catch {
    signal.throwIfAborted()
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
  signal.throwIfAborted()
  return Buffer.concat(chunks)
}

/** `promise`, or a rejection with the signal's reason once it aborts. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error)
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => { reject(signal.reason as Error) }
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', aborted); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', aborted); reject(error as Error) }
    )
  })
}

/** True when `promise` settles within `ms`, false otherwise. */
function withTimeout(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve(false) }, ms)
    void promise.finally(() => { clearTimeout(timer); resolve(true) })
  })
}

/** Resolves at `until`, or at the next change of the login table, whichever is first; rejects when `signal` aborts. */
function waitForPool(table: LoginTable, until: number, now: () => number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (): void => {
      clearTimeout(timer)
      unsubscribe()
      signal.removeEventListener('abort', aborted)
    }
    const woken = (): void => { settle(); resolve() }
    const aborted = (): void => { settle(); reject(signal.reason as Error) }
    const timer = setTimeout(woken, Math.max(0, until - now()))
    const unsubscribe = table.onChange(woken)
    if (signal.aborted) aborted()
    else signal.addEventListener('abort', aborted, { once: true })
  })
}
