// The control API (`src/core/control-api.ts`): status, probe, reload and stop, on paths under
// `/_kurmis/` of the daemon's port. Every request needs the key; one without it gets 403 and
// no body, the same as a proxied request.
//
// `status` shows each login's email, for `kurmis status` and `kurmis login` on the person's own
// terminal: a Claude login's from its identity file, a Codex login's from its last usage probe,
// which the daemon keeps in memory only. The control API answers only on 127.0.0.1 and only with
// the key, which only the user can read. The email is never logged.
//
// A request body larger than `MAX_CONTROL_BODY_BYTES` is answered 413 with an `ErrorAnswer`.
// The answer is sent at once, and the rest of the body is still read and thrown away (for at
// most `DISCARD_BODY_MS`): a connection closed while the client is still sending is reset, and a
// reset can lose the answer before the client has read it.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { routeBlock } from '../core/account-router.ts'
import {
  CONTROL_API_VERSION, CONTROL_PATHS, MAX_CONTROL_BODY_BYTES, type ErrorAnswer, type LoginStatus, type OkAnswer, type ProbeRequest,
  type StatusAnswer, type StopRequest
} from '../core/control-api.ts'
import { KEY_HEADER, routeKeyMatches } from '../core/route-headers.ts'
import type { ClaudeIdentityReader } from '../data/identity.ts'
import { methodOf, type DaemonLog } from '../data/log.ts'
import { kurmisVersion } from '../version.ts'
import type { LoginTable } from './logins.ts'
import type { TokenSource } from './tokens.ts'
import type { UsagePoller } from './usage-poller.ts'

/** How long the rest of a too-large body is read and thrown away before the connection is closed. */
const DISCARD_BODY_MS = 30_000

export interface ControlOptions {
  key: string
  table: LoginTable
  tokens: TokenSource
  identity: ClaudeIdentityReader
  poller: UsagePoller
  log: DaemonLog
  now: () => number
  pid: number
  port: number
  startedAt: number
  /** Called once a `stop` request has been answered, with what the request asked for. */
  onStopRequested(request: StopRequest): void
}

export interface Control {
  /** Handles one request whose path is under `/_kurmis/`. Never rejects. */
  handle(request: IncomingMessage, response: ServerResponse, path: string): Promise<void>
  /** The status answer, as `GET /_kurmis/status` gives it. */
  status(): Promise<StatusAnswer>
}

export function createControl(options: ControlOptions): Control {
  const { table, tokens, identity, poller, log, now } = options

  async function status(): Promise<StatusAnswer> {
    table.checkConfig()
    await tokens.prime(table.claudeLogins().map((login) => login.id))
    // As the proxy sees a request with no authorization header of its own: a login counts as
    // signable only with a token the daemon read.
    const rows = table.routeRows(table.ownLogin('claude').id, false)
    const at = now()
    const logins: LoginStatus[] = table.logins().map((login) => {
      const row = rows.find((each) => each.id === login.id)
      const cooldown = table.cooldown(login.id, at)
      const claude = login.provider === 'claude' ? identity.read(login) : null
      return {
        id: login.id,
        provider: login.provider,
        alias: login.alias,
        usedByPlainCli: login.usedByPlainCli,
        routing: login.routing,
        fiveHourLimit: login.fiveHourLimit,
        weeklyLimit: login.weeklyLimit,
        useFirst: login.useFirst,
        signedIn: login.provider === 'claude' ? table.claudeSignedIn(login.id) : table.probedSignedIn(login.id),
        usage: table.usage(login.id),
        cooldownUntil: cooldown === null ? null : Number.isFinite(cooldown) ? cooldown : 'unknown',
        block: row === undefined ? null : routeBlock(row, at),
        sessions: login.provider === 'claude' ? table.sessionCount(login.id) : 0,
        email: login.provider === 'claude' ? claude?.email ?? null : table.codexEmail(login.id),
        organizationUuid: claude?.organizationUuid ?? null,
        probing: poller.isRunning(login.id)
      }
    })
    return {
      ok: true,
      apiVersion: CONTROL_API_VERSION,
      version: kurmisVersion,
      pid: options.pid,
      port: options.port,
      startedAt: options.startedAt,
      logins
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const key = req.headers[KEY_HEADER]
    if (!routeKeyMatches(typeof key === 'string' ? key : null, options.key)) {
      log.write('control_rejected', { reason: 'bad_secret', method: methodOf(req.method) })
      req.resume()
      res.writeHead(403).end()
      return
    }
    log.write('control_request', { method: methodOf(req.method) })
    try {
      switch (path) {
        case CONTROL_PATHS.status:
          if (!allow(req, res, 'GET')) return
          req.resume()
          answer(res, 200, await status())
          return
        case CONTROL_PATHS.probe: {
          if (!allow(req, res, 'POST')) return
          const asked = await readProbeRequest(req)
          if (asked === TOO_LARGE) {
            refuseTooLarge(req, res)
            return
          }
          if (typeof asked === 'string') {
            answer(res, 400, failure(asked))
            return
          }
          const unknown = asked.logins?.filter((id) => table.find(id) === undefined) ?? []
          if (unknown.length > 0) {
            answer(res, 400, failure(`There is no login ${unknown.join(', ')}.`))
            return
          }
          await poller.probeMany(asked.logins ?? poller.pollable(), 'request')
          answer(res, 200, await status())
          return
        }
        case CONTROL_PATHS.reload: {
          if (!allow(req, res, 'POST')) return
          req.resume()
          // A login the reload adds is probed through the table's `onLoginsAdded` (`app.ts`).
          const result = table.reloadConfig()
          if (!result.ok) {
            answer(res, 500, failure(result.error))
            return
          }
          answer(res, 200, ok())
          return
        }
        case CONTROL_PATHS.stop: {
          if (!allow(req, res, 'POST')) return
          const asked = await readStopRequest(req)
          if (asked === TOO_LARGE) {
            refuseTooLarge(req, res)
            return
          }
          if (typeof asked === 'string') {
            answer(res, 400, failure(asked))
            return
          }
          res.once('finish', () => { options.onStopRequested(asked) })
          answer(res, 200, ok())
          return
        }
        default:
          req.resume()
          answer(res, 404, failure(`The daemon has no control path ${path}.`))
      }
    } catch {
      log.write('internal_error', { method: methodOf(req.method) })
      if (!res.headersSent) answer(res, 500, failure('The daemon failed to answer the control request.'))
      else res.destroy()
    }
  }

  return { handle, status }
}

function allow(req: IncomingMessage, res: ServerResponse, method: 'GET' | 'POST'): boolean {
  if (req.method === method) return true
  req.resume()
  res.setHeader('allow', method)
  answer(res, 405, failure(`This control path takes ${method}.`))
  return false
}

function answer(res: ServerResponse, status: number, body: OkAnswer | ErrorAnswer | StatusAnswer): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
}

function ok(): OkAnswer {
  return { ok: true }
}

function failure(error: string): ErrorAnswer {
  return { ok: false, error }
}

/** What `readBody` answers for a body larger than `MAX_CONTROL_BODY_BYTES`. */
const TOO_LARGE = Symbol('too large')

/**
 * The request body as text, or `TOO_LARGE`. A body whose `content-length` is too large is not
 * read at all; one that grows too large while it is read stops being kept. Either way the
 * request is left to be read on and thrown away (`refuseTooLarge`), not destroyed.
 */
function readBody(req: IncomingMessage): Promise<string | typeof TOO_LARGE> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > MAX_CONTROL_BODY_BYTES) return Promise.resolve(TOO_LARGE)
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const stopListening = (): void => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    const onData = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > MAX_CONTROL_BODY_BYTES) {
        stopListening()
        resolve(TOO_LARGE)
        return
      }
      chunks.push(bytes)
    }
    const onEnd = (): void => {
      stopListening()
      resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onError = (error: Error): void => {
      stopListening()
      reject(error)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

/**
 * Answers 413 at once, then reads the rest of the body and throws it away, so the client can
 * finish sending and read the answer. A client still sending after `DISCARD_BODY_MS` has its
 * connection closed.
 */
function refuseTooLarge(req: IncomingMessage, res: ServerResponse): void {
  answer(res, 413, failure(`The control request's body is larger than ${String(MAX_CONTROL_BODY_BYTES / 1024)} KB.`))
  if (req.complete) return
  const timer = setTimeout(() => { req.socket.destroy() }, DISCARD_BODY_MS)
  timer.unref()
  const done = (): void => { clearTimeout(timer) }
  req.once('end', done)
  req.once('close', done)
  req.resume()
}

/** A JSON object body, or a string saying why it is not one. An empty body is `{}`. */
async function readJsonObject(req: IncomingMessage, what: string): Promise<Record<string, unknown> | string | typeof TOO_LARGE> {
  const body = await readBody(req)
  if (body === TOO_LARGE) return TOO_LARGE
  const text = body.trim()
  if (text.length === 0) return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return `The ${what} is not JSON.`
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return `The ${what} must be a JSON object.`
  return value as Record<string, unknown>
}

/** The stop request's body: empty or `{}`, or `{ maxWaitMs: <n> }`. A string is why it does not read. */
async function readStopRequest(req: IncomingMessage): Promise<StopRequest | string | typeof TOO_LARGE> {
  const value = await readJsonObject(req, 'stop request')
  if (typeof value !== 'object') return value
  const maxWaitMs = value.maxWaitMs
  if (maxWaitMs === undefined) return {}
  if (typeof maxWaitMs !== 'number' || !Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
    return '"maxWaitMs" must be a number of milliseconds, 0 or more.'
  }
  return { maxWaitMs }
}

/** The probe request's body: empty or `{}` for every login, or `{ logins: [...] }`. A string is why it does not read. */
async function readProbeRequest(req: IncomingMessage): Promise<ProbeRequest | string | typeof TOO_LARGE> {
  const value = await readJsonObject(req, 'probe request')
  if (typeof value !== 'object') return value
  const logins = value.logins
  if (logins === undefined) return {}
  if (!Array.isArray(logins) || !logins.every((id) => typeof id === 'string')) return '"logins" must be a list of login ids.'
  return { logins }
}
