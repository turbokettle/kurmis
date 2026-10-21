// An in-process HTTP server on 127.0.0.1 that stands in for Anthropic's Messages API. Tests
// point the daemon's upstream (or a fake claude's ANTHROPIC_BASE_URL) at it, script what each
// request is answered with, and assert on the requests it recorded. Bodies are kept in memory
// for assertions and never written to disk.
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'

/** Unix seconds, the unit of every `*-reset` header. */
type Seconds = number

/** One usage window as the `anthropic-ratelimit-unified-<window>-*` headers describe it. */
export interface WindowHeaders {
  /** 0 to 1, as the real headers send it (0.42 is 42 %). */
  utilization: number
  /** When the window resets. A `Date`, or unix milliseconds. */
  resetsAt: Date | number
  /** Defaults to `rejected` at utilization 1 and over, else `allowed`. */
  status?: 'allowed' | 'allowed_warning' | 'rejected'
}

/** The rate-limit headers to put on an answer. Windows left out are not sent. */
export interface UnifiedHeaders {
  fiveHour?: WindowHeaders
  sevenDay?: WindowHeaders
  /** `7d_oi`, the weekly window with overage included. */
  sevenDayOverageIncluded?: WindowHeaders
  /** The overall status. Defaults to the worst window status. */
  status?: 'allowed' | 'allowed_warning' | 'rejected'
  /** Defaults to the window that is rejected, else the fullest one. */
  representativeClaim?: 'five_hour' | 'seven_day' | 'seven_day_overage_included' | string
  /** Defaults to `rejected` with `overage-disabled-reason: org_level_disabled`, as a plan without extra usage answers. Null sends neither. */
  overageStatus?: 'allowed' | 'allowed_warning' | 'rejected' | null
}

export interface ReplyBase {
  /** Waits this long before sending anything. */
  delayMs?: number
  /** Waits for this promise too (after `delayMs`), so a test decides when the answer is sent. */
  hold?: Promise<unknown>
  /** Extra response headers, sent after (and so over) the ones the reply builds. */
  headers?: Record<string, string>
}

export type Reply =
  | (ReplyBase & {
    kind: 'ok'
    /** The answer's text. Default `Hello from the fake API.` */
    text?: string
    /** The answer's model. Default: the request's `model`, else `claude-sonnet-5`. */
    model?: string
    /** Rate-limit headers. Default: five-hour 0.1 and weekly 0.05, both allowed. Null sends none. */
    unified?: UnifiedHeaders | null
    /** Usage numbers on message_start and message_delta. */
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
    /** Waits this long between SSE events, so a test can see a stream that is still open. */
    eventDelayMs?: number
  })
  | (ReplyBase & {
    /** A usage-limit 429, the way the API refuses a login that is out of its plan. */
    kind: 'quota'
    /** Which window ran out. Default `five_hour`. */
    claim?: 'five_hour' | 'seven_day' | 'seven_day_overage_included' | string
    /** When it resets. Default one hour from now. Null leaves the reset headers out. */
    resetsAt?: Date | number | null
    /** Sent as `retry-after` in seconds when given. The real API usually sends none for a usage limit. */
    retryAfter?: number
  })
  | (ReplyBase & { kind: 'overloaded'; retryAfter?: number })
  | (ReplyBase & {
    /** A 429 with no usage-limit headers: an ordinary rate limit, which the CLI retries. */
    kind: 'rateLimited'
    retryAfter?: number
  })
  | (ReplyBase & { kind: 'unauthorized'; message?: string })
  | (ReplyBase & { kind: 'serverError'; status?: number })
  | (ReplyBase & { kind: 'raw'; status: number; body?: string })
  /** Never answers. The request stays open until the client gives up or the server closes. */
  | (ReplyBase & { kind: 'hang' })
  /** Destroys the connection without an answer. */
  | (ReplyBase & { kind: 'drop' })

/** A reply, or a function choosing one from the request it answers. */
export type ReplyRule = Reply | ((request: RecordedRequest) => Reply)

export interface RecordedRequest {
  /** 1 for the first request the server received. */
  seq: number
  method: string
  /** Path with the query string, e.g. `/v1/messages?beta=true`. */
  url: string
  /** Path without the query string. */
  path: string
  /** Header names in lower case. Repeated headers are joined with `, `. */
  headers: Record<string, string>
  /** The token of `Authorization: Bearer <token>`, or null. */
  bearer: string | null
  /** The `x-api-key` header, or null. */
  apiKey: string | null
  /** The `x-claude-code-session-id` header, or null. */
  sessionId: string | null
  /** The body as text (gunzipped when it came compressed). Kept in memory only. */
  body: string
  /** The body parsed as JSON, or null. */
  json: unknown
  /** What the server answered with: the reply's kind, and the status (0 for `hang`/`drop`). */
  answeredWith: { kind: Reply['kind'] | 'hello' | 'notFound'; status: number } | null
}

export interface FakeAnthropic {
  /** `http://127.0.0.1:<port>`. */
  url: string
  port: number
  /** Every request received, in order, `HEAD /api/hello` included. */
  requests: RecordedRequest[]
  /** The requests that were not `/api/hello`. */
  apiRequests(): RecordedRequest[]
  /** Queues replies for the next requests, whatever token signed them. */
  script(...replies: ReplyRule[]): void
  /** Queues replies for the next requests signed with this bearer token (or API key). These go before the shared queue. */
  scriptFor(token: string, ...replies: ReplyRule[]): void
  /** The reply used when no queue has one. Default `{ kind: 'ok' }`. */
  setDefault(reply: ReplyRule): void
  /** Resolves once `count` requests other than `/api/hello` have arrived. */
  waitForRequests(count: number, timeoutMs?: number): Promise<RecordedRequest[]>
  /** Drops the queues, keeps the recorded requests. */
  reset(): void
  /** Closes open connections and stops listening. */
  close(): Promise<void>
}

/** Builders for the replies, so a script reads `reply.quota({ claim: 'seven_day' })`. */
export const reply = {
  ok: (options: Omit<Extract<Reply, { kind: 'ok' }>, 'kind'> = {}): Reply => ({ kind: 'ok', ...options }),
  quota: (options: Omit<Extract<Reply, { kind: 'quota' }>, 'kind'> = {}): Reply => ({ kind: 'quota', ...options }),
  overloaded: (options: Omit<Extract<Reply, { kind: 'overloaded' }>, 'kind'> = {}): Reply => ({ kind: 'overloaded', ...options }),
  rateLimited: (options: Omit<Extract<Reply, { kind: 'rateLimited' }>, 'kind'> = {}): Reply => ({ kind: 'rateLimited', ...options }),
  unauthorized: (options: Omit<Extract<Reply, { kind: 'unauthorized' }>, 'kind'> = {}): Reply => ({ kind: 'unauthorized', ...options }),
  serverError: (status = 500, options: ReplyBase = {}): Reply => ({ kind: 'serverError', status, ...options }),
  raw: (status: number, body = '', options: ReplyBase = {}): Reply => ({ kind: 'raw', status, body, ...options }),
  hang: (): Reply => ({ kind: 'hang' }),
  drop: (): Reply => ({ kind: 'drop' })
}

const PREFIX = 'anthropic-ratelimit-unified-'
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** A made-up organisation id, sent as `anthropic-organization-id` like the real API does. */
export const FAKE_ORGANIZATION_ID = '00000000-0000-4000-8000-00000000f00d'

/** Starts the fake API on a free loopback port. */
export async function startFakeAnthropic(): Promise<FakeAnthropic> {
  const requests: RecordedRequest[] = []
  const shared: ReplyRule[] = []
  const byToken = new Map<string, ReplyRule[]>()
  let fallback: ReplyRule = { kind: 'ok' }
  const waiters = new Set<() => void>()

  const server = createServer((req, res) => {
    void handle(req, res)
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req)
    const headers = headerRecord(req)
    const url = req.url ?? '/'
    const path = url.split('?')[0] ?? url
    const body = headers['content-encoding'] === 'gzip' ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
    const record: RecordedRequest = {
      seq: requests.length + 1,
      method: req.method ?? 'GET',
      url,
      path,
      headers,
      bearer: bearerOf(headers['authorization']),
      apiKey: headers['x-api-key'] ?? null,
      sessionId: headers['x-claude-code-session-id'] ?? null,
      body,
      json: parseJson(body),
      answeredWith: null
    }
    requests.push(record)
    if (path === '/api/hello') {
      record.answeredWith = { kind: 'hello', status: 200 }
      notify()
      res.writeHead(200, { 'content-type': 'application/json' }).end(record.method === 'HEAD' ? undefined : '{"message":"hello"}')
      return
    }
    if (!path.startsWith('/v1/')) {
      record.answeredWith = { kind: 'notFound', status: 404 }
      notify()
      sendError(res, 404, 'not_found_error', `Not found: ${path}`)
      return
    }
    const rule = nextRule(record)
    const chosen = typeof rule === 'function' ? rule(record) : rule
    record.answeredWith = { kind: chosen.kind, status: statusOf(chosen) }
    notify()
    if (chosen.delayMs !== undefined && chosen.delayMs > 0) await sleep(chosen.delayMs)
    if (chosen.hold !== undefined) await chosen.hold
    await answer(chosen, record, res)
  }

  function nextRule(record: RecordedRequest): ReplyRule {
    const token = record.bearer ?? record.apiKey
    const own = token === null ? undefined : byToken.get(token)
    return own?.shift() ?? shared.shift() ?? fallback
  }

  function notify(): void {
    for (const waiter of [...waiters]) waiter()
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const apiRequests = (): RecordedRequest[] => requests.filter((r) => r.path !== '/api/hello')

  return {
    url: `http://127.0.0.1:${String(port)}`,
    port,
    requests,
    apiRequests,
    script: (...replies) => {
      shared.push(...replies)
    },
    scriptFor: (token, ...replies) => {
      const queue = byToken.get(token) ?? []
      queue.push(...replies)
      byToken.set(token, queue)
    },
    setDefault: (rule) => {
      fallback = rule
    },
    waitForRequests: (count, timeoutMs = 5000) => new Promise((resolve, reject) => {
      const check = (): void => {
        const seen = apiRequests().filter((r) => r.answeredWith !== null)
        if (seen.length < count) return
        cleanup()
        resolve(seen)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`the fake API saw ${String(apiRequests().length)} requests, not ${String(count)}, within ${String(timeoutMs)} ms`))
      }, timeoutMs)
      const cleanup = (): void => {
        clearTimeout(timer)
        waiters.delete(check)
      }
      waiters.add(check)
      check()
    }),
    reset: () => {
      shared.length = 0
      byToken.clear()
      fallback = { kind: 'ok' }
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

/** The `anthropic-ratelimit-unified-*` headers for the given windows, as the real API names them. */
export function unifiedHeaders(options: UnifiedHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  const windows: [string, string, WindowHeaders | undefined][] = [
    ['5h', 'five_hour', options.fiveHour],
    ['7d', 'seven_day', options.sevenDay],
    ['7d_oi', 'seven_day_overage_included', options.sevenDayOverageIncluded]
  ]
  let worst: 'allowed' | 'allowed_warning' | 'rejected' = 'allowed'
  let claim: { name: string; utilization: number; rejected: boolean; reset: Seconds } | null = null
  for (const [suffix, name, window] of windows) {
    if (window === undefined) continue
    const status = window.status ?? (window.utilization >= 1 ? 'rejected' : 'allowed')
    const reset = toSeconds(window.resetsAt)
    out[`${PREFIX}${suffix}-status`] = status
    out[`${PREFIX}${suffix}-reset`] = String(reset)
    out[`${PREFIX}${suffix}-utilization`] = String(window.utilization)
    if (rank(status) > rank(worst)) worst = status
    const rejected = status === 'rejected'
    if (claim === null || (rejected && !claim.rejected) || (rejected === claim.rejected && window.utilization > claim.utilization)) {
      claim = { name, utilization: window.utilization, rejected, reset }
    }
  }
  out[`${PREFIX}status`] = options.status ?? worst
  const representative = options.representativeClaim ?? claim?.name
  if (representative !== undefined) out[`${PREFIX}representative-claim`] = representative
  if (claim !== null) out[`${PREFIX}reset`] = String(claim.reset)
  out[`${PREFIX}fallback-percentage`] = '0.5'
  const overage = options.overageStatus === undefined ? 'rejected' : options.overageStatus
  if (overage !== null) {
    out[`${PREFIX}overage-status`] = overage
    if (overage === 'rejected') out[`${PREFIX}overage-disabled-reason`] = 'org_level_disabled'
  }
  return out
}

function statusOf(chosen: Reply): number {
  switch (chosen.kind) {
    case 'ok': return 200
    case 'quota': case 'rateLimited': return 429
    case 'overloaded': return 529
    case 'unauthorized': return 401
    case 'serverError': return chosen.status ?? 500
    case 'raw': return chosen.status
    case 'hang': case 'drop': return 0
  }
}

async function answer(chosen: Reply, record: RecordedRequest, res: ServerResponse): Promise<void> {
  const base = { 'request-id': `req_fake_${randomUUID().replaceAll('-', '').slice(0, 24)}`, 'anthropic-organization-id': FAKE_ORGANIZATION_ID }
  const extra = chosen.headers ?? {}
  switch (chosen.kind) {
    case 'ok':
      await answerOk(chosen, record, res, base)
      return
    case 'quota': {
      const resetsAt = chosen.resetsAt === undefined ? Date.now() + HOUR_MS : chosen.resetsAt
      const claim = chosen.claim ?? 'five_hour'
      const headers: Record<string, string> = { ...base, 'content-type': 'application/json' }
      const suffix = claim === 'seven_day' ? '7d' : claim === 'seven_day_overage_included' ? '7d_oi' : claim === 'five_hour' ? '5h' : null
      headers[`${PREFIX}status`] = 'rejected'
      headers[`${PREFIX}representative-claim`] = claim
      if (resetsAt !== null) headers[`${PREFIX}reset`] = String(toSeconds(resetsAt))
      if (suffix !== null) {
        headers[`${PREFIX}${suffix}-status`] = 'rejected'
        headers[`${PREFIX}${suffix}-utilization`] = '1.0'
        if (resetsAt !== null) headers[`${PREFIX}${suffix}-reset`] = String(toSeconds(resetsAt))
      }
      headers[`${PREFIX}fallback-percentage`] = '0.5'
      headers[`${PREFIX}overage-status`] = 'rejected'
      headers[`${PREFIX}overage-disabled-reason`] = 'org_level_disabled'
      if (chosen.retryAfter !== undefined) headers['retry-after'] = String(chosen.retryAfter)
      sendError(res, 429, 'rate_limit_error', 'This request would exceed your account\'s rate limit. Please try again later.', { ...headers, ...extra })
      return
    }
    case 'overloaded':
      sendError(res, 529, 'overloaded_error', 'Overloaded', { ...base, ...retryAfter(chosen.retryAfter), ...extra })
      return
    case 'rateLimited':
      sendError(res, 429, 'rate_limit_error', 'Number of request tokens has exceeded your per-minute rate limit. Please try again later.',
        { ...base, ...retryAfter(chosen.retryAfter), ...extra })
      return
    case 'unauthorized':
      sendError(res, 401, 'authentication_error', chosen.message ?? 'Invalid bearer token', { ...base, ...extra })
      return
    case 'serverError':
      sendError(res, chosen.status ?? 500, 'api_error', 'Internal server error', { ...base, ...extra })
      return
    case 'raw':
      res.writeHead(chosen.status, { ...base, ...extra }).end(chosen.body ?? '')
      return
    case 'hang':
      return
    case 'drop':
      res.destroy()
      return
  }
}

async function answerOk(chosen: Extract<Reply, { kind: 'ok' }>, record: RecordedRequest, res: ServerResponse, base: Record<string, string>): Promise<void> {
  const unified = chosen.unified === null ? {} : unifiedHeaders(chosen.unified ?? defaultUnified())
  const headers = { ...base, ...unified, ...(chosen.headers ?? {}) }
  const body = (record.json ?? {}) as { model?: unknown; stream?: unknown }
  const model = chosen.model ?? (typeof body.model === 'string' ? body.model : 'claude-sonnet-5')
  if (record.path === '/v1/messages/count_tokens') {
    res.writeHead(200, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify({ input_tokens: 12 }))
    return
  }
  if (record.path === '/v1/models') {
    res.writeHead(200, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify({
      data: [{ type: 'model', id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', created_at: '2026-01-01T00:00:00Z' }],
      has_more: false, first_id: 'claude-sonnet-5', last_id: 'claude-sonnet-5'
    }))
    return
  }
  const text = chosen.text ?? 'Hello from the fake API.'
  const id = `msg_fake_${randomUUID().replaceAll('-', '').slice(0, 24)}`
  const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1, ...chosen.usage }
  if (body.stream !== true) {
    res.writeHead(200, { ...headers, 'content-type': 'application/json' }).end(JSON.stringify({
      id, type: 'message', role: 'assistant', model, content: [{ type: 'text', text }],
      stop_reason: 'end_turn', stop_sequence: null, usage
    }))
    return
  }
  res.writeHead(200, { ...headers, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
  const events = sseEvents({ id, model, text, usage })
  for (const event of events) {
    if (res.destroyed) return
    res.write(event)
    if (chosen.eventDelayMs !== undefined && chosen.eventDelayMs > 0) await sleep(chosen.eventDelayMs)
  }
  res.end()
}

/** The SSE events of one streamed text answer, in the order the real API sends them. */
export function sseEvents(options: { id: string; model: string; text: string; usage: Record<string, number> }): string[] {
  const event = (name: string, data: unknown): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
  const chunks = options.text.match(/[\s\S]{1,16}/g) ?? ['']
  return [
    event('message_start', {
      type: 'message_start',
      message: {
        id: options.id, type: 'message', role: 'assistant', model: options.model, content: [],
        stop_reason: null, stop_sequence: null, usage: options.usage
      }
    }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    event('ping', { type: 'ping' }),
    ...chunks.map((chunk) => event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } })),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('message_delta', {
      type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: options.usage['output_tokens'] ?? 1 }
    }),
    event('message_stop', { type: 'message_stop' })
  ]
}

function defaultUnified(): UnifiedHeaders {
  const now = Date.now()
  return {
    fiveHour: { utilization: 0.1, resetsAt: now + 3 * HOUR_MS },
    sevenDay: { utilization: 0.05, resetsAt: now + 4 * DAY_MS }
  }
}

function sendError(res: ServerResponse, status: number, type: string, message: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
    .end(JSON.stringify({ type: 'error', error: { type, message } }))
}

function retryAfter(seconds: number | undefined): Record<string, string> {
  return seconds === undefined ? {} : { 'retry-after': String(seconds) }
}

function rank(status: 'allowed' | 'allowed_warning' | 'rejected'): number {
  return status === 'rejected' ? 2 : status === 'allowed_warning' ? 1 : 0
}

function toSeconds(value: Date | number): Seconds {
  const ms = typeof value === 'number' ? value : value.getTime()
  return Math.floor(ms / 1000)
}

function headerRecord(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    out[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

function bearerOf(value: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? '')
  return match?.[1] ?? null
}

function parseJson(text: string): unknown {
  if (text.length === 0) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
