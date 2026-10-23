// The proxy's HTTP client to Anthropic's API, and the code that copies an answer's body to the
// CLI.
//
// It uses `node:http` and `node:https` rather than the built-in `fetch`. `fetch` (undici) gives
// up after 300 s of waiting for the answer's headers, and after 300 s between two pieces of the
// body. A non-streaming request with a long thinking turn can wait longer than that for its
// headers, and a long thinking turn can leave long gaps in a stream. `node:http` has no such
// default, so every limit below is one this file sets on purpose:
//
// - **No limit of its own on the whole request or on the wait for headers.** The CLI has its
//   own request timeout (`API_TIMEOUT_MS`, 10 minutes by default) and aborts its request when
//   it gives up. The proxy turns that into `UpstreamRequest.signal`, which destroys this request
//   at once. The CLI is the one that knows how long it is willing to wait. The proxy's capacity
//   hold also ends the wait for the headers of a request it holds, through the same signal, but
//   never an answer whose headers have arrived.
// - **The idle timeout** (`UPSTREAM_IDLE_TIMEOUT_MS`, 20 minutes): the request fails when its
//   connection carries no data in either direction for that long, from the moment it is
//   connected until the body ends, the wait for the headers included. It is twice the CLI's
//   default request timeout, so the CLI's own abort normally ends a slow request first, also
//   for someone who raised `API_TIMEOUT_MS` somewhat. A stream is never quiet for that long:
//   the API sends `ping` events while it has nothing else to send. Its job is to end a request
//   nothing else would end, such as a stream the CLI keeps waiting on whose server has stopped
//   sending but still answers on the TCP level. A non-streaming answer that takes longer than
//   20 minutes to start is cut off; Anthropic's SDK refuses a non-streaming request it expects
//   to take over 10 minutes unless the caller raises its timeout.
// - **TCP keep-alive probes** (`KEEPALIVE_PROBE_DELAY_MS`, 30 s): after that long without
//   traffic the OS starts sending probes, and a connection whose peer is gone (a laptop that
//   changed networks, a NAT entry that expired) fails with an error instead of waiting for the
//   idle timeout. How far apart the probes are and how many may go unanswered is set by libuv
//   and the OS, not here.
// - **The connect timeout** (`UPSTREAM_CONNECT_TIMEOUT_MS`, 30 s): the name lookup, the TCP
//   connection and the TLS handshake of a new connection must finish within it. Without it a
//   network that drops packets keeps the request waiting for as long as the OS keeps retrying.
// - **Connections are kept open for reuse** for `FREE_SOCKET_TIMEOUT_MS` (30 s) after an answer
//   ends, so the requests of one turn (the answer, a tool call's next request, `count_tokens`)
//   do not each set up a new TLS connection. The server may close an idle connection at the
//   moment a new request is sent on it. Node's documented answer to that is to send the
//   request again when it failed with a reset on a reused connection before any answer came,
//   and `send` does that once, but only when the reset came while the request was still being
//   written or within `RESEND_WINDOW_MS` (2 s) after it was. A server that closed the connection
//   while it was idle cannot have read a request sent on it, and its reset comes within a round
//   trip. A reset that comes later, such as one after minutes of a long thinking turn, may
//   follow a request the server did read and work on, and sending it again could run it twice,
//   so that error goes to the proxy as it is.
//
// Bodies are passed on as raw bytes. `node:http` decodes no `content-encoding`, and the proxy
// asks for `accept-encoding: identity`; a body the server encodes anyway keeps its encoding,
// so its `content-encoding` header has to reach the CLI with it.
//
// Nothing here logs. Error messages name the error code, never a header, token or body.
import http from 'node:http'
import https from 'node:https'
import type { Socket } from 'node:net'
import { finished, type Readable } from 'node:stream'
import { errorCodeOf, type LogErrorCode } from '../data/log.ts'

/** Anthropic's API, where requests go unless `KURMIS_UPSTREAM_URL` names another origin. */
export const ANTHROPIC_API_URL = 'https://api.anthropic.com'

/** A request fails when its connection carries no data for this long. See the file header. */
export const UPSTREAM_IDLE_TIMEOUT_MS = 20 * 60_000

/** A new connection (lookup, TCP, TLS) must be ready within this. */
export const UPSTREAM_CONNECT_TIMEOUT_MS = 30_000

/** The OS starts TCP keep-alive probes after a connection has been quiet this long. */
export const KEEPALIVE_PROBE_DELAY_MS = 30_000

/** A connection with no request on it is closed after this long. */
export const FREE_SOCKET_TIMEOUT_MS = 30_000

/**
 * A request reset on a reused connection is sent again only when the reset came within this long
 * after the request was written. See the file header.
 */
export const RESEND_WINDOW_MS = 2_000

/** `discard` reads at most this much of a body before it closes the connection instead. */
const DISCARD_LIMIT_BYTES = 1024 * 1024

/** `discard` closes the connection when the body has not ended after this long. */
const DISCARD_TIMEOUT_MS = 5_000

/** Error codes that mean the server closed the connection before it answered. */
const RESET_CODES: ReadonlySet<string> = new Set(['ECONNRESET', 'EPIPE'])

/**
 * The origin requests go to: `KURMIS_UPSTREAM_URL` (a test hook) or `ANTHROPIC_API_URL`. An
 * empty value counts as unset. Throws an Error for a value that is not an http(s) origin: a
 * path other than `/`, credentials, a query or a fragment are refused. The message does not
 * repeat the value, which could hold a password.
 */
export function upstreamOrigin(env: NodeJS.ProcessEnv): string {
  const raw = env['KURMIS_UPSTREAM_URL']
  if (raw === undefined || raw === '') return ANTHROPIC_API_URL
  const problem = 'KURMIS_UPSTREAM_URL must be an http or https origin such as http://127.0.0.1:8080'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${problem}; the value is not a URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${problem}; the scheme is not http or https`)
  if (url.username !== '' || url.password !== '') throw new Error(`${problem}; the value has credentials in it`)
  if (raw.includes('?') || raw.includes('#')) throw new Error(`${problem}; the value has a query or fragment`)
  if (url.pathname !== '/') throw new Error(`${problem}; the value has a path`)
  return url.origin
}

export interface UpstreamRequest {
  method: string
  /** Path with query, as the CLI sent it, e.g. `/v1/messages?beta=true`. Must start with `/`. */
  path: string
  /** From `upstreamRequest()`; already has `content-length` when there is a body. */
  headers: Record<string, string>
  body?: Buffer
  /** Aborting it destroys the upstream request, or its answer, at any point. */
  signal: AbortSignal
}

export interface UpstreamAnswer {
  status: number
  /** Raw header pairs in the order they came, names in lower case, repeated headers as separate entries. */
  headers: Array<[string, string]>
  /** A header's value by name in any case, repeated ones joined with `, `; null when absent. */
  get(name: string): string | null
  /**
   * The body as it arrives, not decoded. When the connection fails, the idle timeout passes or
   * the signal aborts before the body ends, the stream is destroyed with the error that says
   * why: an `UpstreamError` for the timeout and the signal. Pausing it stops reading from the
   * connection.
   */
  body: Readable
  /** Reads and drops the rest of the body, for an answer the proxy does not forward (replays). A body that is too long or too slow is destroyed instead. */
  discard(): void
}

/**
 * A request that got no answer, or a body that broke off. `kind` is `aborted` when the
 * request's signal aborted, `timeout` when one of this file's own timers ran out (code
 * `ETIMEDOUT`), and `network` for everything else, with the error's code as the log knows it
 * (`errorCodeOf`), e.g. `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, or `ETIMEDOUT` from the OS.
 */
export class UpstreamError extends Error {
  constructor(readonly kind: 'aborted' | 'timeout' | 'network', readonly code: LogErrorCode, message: string,
    options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'UpstreamError'
  }
}

export interface Upstream {
  /** Sends the request; resolves with the answer once its headers are in. Rejects with `UpstreamError` before that. */
  send(request: UpstreamRequest): Promise<UpstreamAnswer>
  /** Destroys the kept-open connections and any request still running. `send` rejects afterwards. */
  close(): void
}

export interface UpstreamOptions {
  /** An http(s) origin, as `upstreamOrigin` answers. */
  origin: string
  /** Default `UPSTREAM_IDLE_TIMEOUT_MS`. */
  idleTimeoutMs?: number
  /** Default `UPSTREAM_CONNECT_TIMEOUT_MS`. */
  connectTimeoutMs?: number
  /** Default `KEEPALIVE_PROBE_DELAY_MS`. */
  keepAliveProbeDelayMs?: number
  /** Default `FREE_SOCKET_TIMEOUT_MS`. */
  freeSocketTimeoutMs?: number
  /** Default `RESEND_WINDOW_MS`. */
  resendWindowMs?: number
}

export function createUpstream(options: UpstreamOptions): Upstream {
  const url = new URL(options.origin)
  const tls = url.protocol === 'https:'
  if (!tls && url.protocol !== 'http:') throw new Error('the upstream origin must be http or https')
  // `URL.hostname` keeps the brackets of an IPv6 address, which `http.request` does not want.
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1')
  const port = url.port === '' ? undefined : Number(url.port)
  const idleTimeoutMs = options.idleTimeoutMs ?? UPSTREAM_IDLE_TIMEOUT_MS
  const connectTimeoutMs = options.connectTimeoutMs ?? UPSTREAM_CONNECT_TIMEOUT_MS
  const keepAliveProbeDelayMs = options.keepAliveProbeDelayMs ?? KEEPALIVE_PROBE_DELAY_MS
  const resendWindowMs = options.resendWindowMs ?? RESEND_WINDOW_MS
  const agentOptions = {
    keepAlive: true,
    keepAliveMsecs: keepAliveProbeDelayMs,
    // Applies to connections waiting for their next request; a running request sets its own.
    timeout: options.freeSocketTimeoutMs ?? FREE_SOCKET_TIMEOUT_MS,
    scheduling: 'lifo' as const
  }
  const agent = tls ? new https.Agent(agentOptions) : new http.Agent(agentOptions)
  const transport = tls ? https : http
  let closed = false

  function attempt(request: UpstreamRequest, retried: boolean): Promise<UpstreamAnswer> {
    return new Promise((resolve, reject) => {
      const { signal } = request
      if (signal.aborted) {
        reject(abortedError())
        return
      }
      let response: http.IncomingMessage | null = null
      let answered = false
      let over = false
      let connectTimer: NodeJS.Timeout | undefined
      /** When the whole request had been handed to the connection, or null while it is still being written. */
      let writtenAt: number | null = null

      const req = transport.request({
        hostname, port, method: request.method, path: request.path, headers: request.headers, agent
      })

      // Ends the exchange wherever it is: before the headers `req` fails with `error`, after
      // them the body is destroyed with it.
      const fail = (error: UpstreamError): void => {
        if (over) return
        clearTimeout(connectTimer)
        response?.destroy(error)
        req.destroy(error)
      }
      const onAbort = (): void => fail(abortedError())
      const end = (): void => {
        over = true
        clearTimeout(connectTimer)
        signal.removeEventListener('abort', onAbort)
      }
      signal.addEventListener('abort', onAbort, { once: true })

      req.setTimeout(idleTimeoutMs, () => {
        fail(new UpstreamError('timeout', 'ETIMEDOUT', `the Anthropic API connection carried no data for ${String(idleTimeoutMs)} ms`))
      })
      req.on('socket', (socket: Socket) => {
        socket.setKeepAlive(true, keepAliveProbeDelayMs)
        if (!socket.connecting) return
        connectTimer = setTimeout(() => {
          fail(new UpstreamError('timeout', 'ETIMEDOUT', `could not connect to the Anthropic API within ${String(connectTimeoutMs)} ms`))
        }, connectTimeoutMs)
        socket.once(tls ? 'secureConnect' : 'connect', () => clearTimeout(connectTimer))
      })
      req.once('finish', () => { writtenAt = Date.now() })
      // Stays attached for the whole exchange: errors after the headers belong to the body.
      req.on('error', (error) => {
        if (answered) return
        answered = true
        const reusedSocket = req.reusedSocket
        const soonAfterWriting = writtenAt === null || Date.now() - writtenAt <= resendWindowMs
        end()
        if (!retried && reusedSocket && soonAfterWriting && !signal.aborted && !closed && !(error instanceof UpstreamError) &&
          RESET_CODES.has(errorCodeOf(error))) {
          resolve(attempt(request, true))
          return
        }
        reject(toUpstreamError(error))
      })
      req.on('response', (res) => {
        if (answered) {
          res.destroy()
          return
        }
        answered = true
        response = res
        // With a listener attached, an error of the body never goes unhandled while the proxy
        // has not started reading it yet.
        res.on('error', () => undefined)
        res.once('close', end)
        resolve(answerOf(res))
      })
      req.end(request.body)
    })
  }

  return {
    send(request) {
      if (closed) return Promise.reject(new UpstreamError('network', 'other', 'the upstream client is closed'))
      return attempt(request, false)
    },
    close() {
      closed = true
      agent.destroy()
    }
  }
}

function abortedError(): UpstreamError {
  return new UpstreamError('aborted', 'ABORT_ERR', 'the request to the Anthropic API was aborted')
}

function toUpstreamError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error
  const code = errorCodeOf(error)
  return new UpstreamError('network', code, `the request to the Anthropic API failed (${code})`, { cause: error })
}

function answerOf(res: http.IncomingMessage): UpstreamAnswer {
  const headers: Array<[string, string]> = []
  const raw = res.rawHeaders
  for (let index = 0; index + 1 < raw.length; index += 2) {
    headers.push([(raw[index] ?? '').toLowerCase(), raw[index + 1] ?? ''])
  }
  return {
    status: res.statusCode ?? 0,
    headers,
    get(name) {
      const value = res.headers[name.toLowerCase()]
      if (value === undefined) return null
      return Array.isArray(value) ? value.join(', ') : value
    },
    body: res,
    discard() {
      if (res.readableEnded || res.destroyed) return
      let bytes = 0
      const timer = setTimeout(() => res.destroy(), DISCARD_TIMEOUT_MS)
      timer.unref()
      res.once('close', () => clearTimeout(timer))
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > DISCARD_LIMIT_BYTES) res.destroy()
      })
      res.resume()
    }
  }
}

/**
 * Writes the answer's body to `res` byte for byte as it arrives, and ends `res`. When
 * `res.write()` answers false, the body is paused until `res` emits `drain`, so a CLI that
 * reads slowly slows the upstream connection down instead of filling memory. The proxy writes
 * the head (`res.writeHead`) before calling this; nothing here sets a header.
 *
 * Resolves `done` once `res` has finished. Resolves `aborted` when the client went away or
 * `signal` aborted; the upstream body is then destroyed, and so is `res`. Resolves `failed`
 * when the upstream body broke off; `res` is then destroyed so that the client sees a broken
 * answer rather than a complete one. Never rejects.
 */
export function forwardBody(answer: UpstreamAnswer, res: http.ServerResponse,
  signal: AbortSignal): Promise<'done' | 'aborted' | 'failed'> {
  const body = answer.body
  return new Promise((resolve) => {
    let settled = false
    const settle = (outcome: 'done' | 'aborted' | 'failed'): void => {
      if (settled) return
      settled = true
      body.off('data', onData)
      body.off('end', onEnd)
      res.off('drain', onDrain)
      res.off('finish', onFinish)
      res.off('close', onClose)
      signal.removeEventListener('abort', onAbort)
      stopWatching()
      resolve(outcome)
    }
    const onData = (chunk: Buffer): void => {
      if (!res.write(chunk)) body.pause()
    }
    const onDrain = (): void => {
      body.resume()
    }
    const onEnd = (): void => {
      res.end()
    }
    const onFinish = (): void => settle('done')
    const onClose = (): void => {
      if (res.writableFinished) {
        settle('done')
        return
      }
      settle('aborted')
      body.destroy()
    }
    const onAbort = (): void => {
      settle('aborted')
      body.destroy()
      res.destroy()
    }
    // Reports an error or a close before the end; an ended body reports nothing here.
    const stopWatching = finished(body, (error) => {
      if (error === undefined || error === null || settled) return
      settle('failed')
      res.destroy()
    })

    if (signal.aborted) {
      onAbort()
      return
    }
    if (res.destroyed) {
      onClose()
      return
    }
    body.on('data', onData)
    body.once('end', onEnd)
    res.on('drain', onDrain)
    res.once('finish', onFinish)
    res.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
    body.resume()
  })
}
