// The control API (`src/core/control-api.ts`): status, probe, reload and stop, on paths under
// `/_kurmis/` of the daemon's port. Every request needs the key; one without it gets 403 and
// no body, the same as a proxied request.
//
// `status` shows each Claude login's email from its identity file, for `kurmis status` and
// `kurmis list` on the person's own terminal. The control API answers only on 127.0.0.1 and only
// with the key, which only the user can read. The email is never logged.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { routeBlock } from '../core/account-router.ts'
import { CLAUDE_DEFAULT_ACCOUNT_ID } from '../core/accounts.ts'
import {
  CONTROL_API_VERSION, CONTROL_PATHS, type ErrorAnswer, type LoginStatus, type OkAnswer, type ProbeRequest, type StatusAnswer
} from '../core/control-api.ts'
import { KEY_HEADER, routeKeyMatches } from '../core/route-headers.ts'
import type { ClaudeIdentityReader } from '../data/identity.ts'
import { methodOf, type DaemonLog } from '../data/log.ts'
import { kurmisVersion } from '../version.ts'
import type { LoginTable } from './logins.ts'
import type { TokenSource } from './tokens.ts'
import type { UsagePoller } from './usage-poller.ts'

/** The largest control request body: a probe request names a few login ids. */
const MAX_CONTROL_BODY_BYTES = 64 * 1024

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
  onStopRequested(): void
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
    const rows = table.routeRows(CLAUDE_DEFAULT_ACCOUNT_ID, false)
    const at = now()
    const logins: LoginStatus[] = table.logins().map((login) => {
      const row = rows.find((each) => each.id === login.id)
      const cooldown = table.cooldown(login.id, at)
      return {
        id: login.id,
        provider: login.provider,
        label: login.label,
        routing: login.routing,
        fiveHourLimit: login.fiveHourLimit,
        weeklyLimit: login.weeklyLimit,
        useFirst: login.useFirst,
        signedIn: login.provider === 'claude' ? table.claudeSignedIn(login.id) : table.probedSignedIn(login.id),
        usage: table.usage(login.id),
        cooldownUntil: cooldown === null ? null : Number.isFinite(cooldown) ? cooldown : 'unknown',
        block: row === undefined ? null : routeBlock(row, at),
        sessions: login.provider === 'claude' ? table.sessionCount(login.id) : 0,
        email: login.provider === 'claude' ? identity.read(login.id)?.email ?? null : null,
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
          const result = table.reloadConfig()
          if (!result.ok) {
            answer(res, 500, failure(result.error))
            return
          }
          // A login added since the last read has not been probed yet.
          const fresh = table.logins().filter((login) => table.probedSignedIn(login.id) === null).map((login) => login.id)
          if (fresh.length > 0) void poller.probeMany(fresh, 'config')
          answer(res, 200, ok())
          return
        }
        case CONTROL_PATHS.stop:
          if (!allow(req, res, 'POST')) return
          req.resume()
          res.once('finish', () => { options.onStopRequested() })
          answer(res, 200, ok())
          return
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

/** The probe request's body: empty or `{}` for every login, or `{ logins: [...] }`. A string is why it does not read. */
async function readProbeRequest(req: IncomingMessage): Promise<ProbeRequest | string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += bytes.length
    if (size > MAX_CONTROL_BODY_BYTES) return 'The probe request is too large.'
    chunks.push(bytes)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return 'The probe request is not JSON.'
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'The probe request must be a JSON object.'
  const logins = (value as { logins?: unknown }).logins
  if (logins === undefined) return {}
  if (!Array.isArray(logins) || !logins.every((id) => typeof id === 'string')) return '"logins" must be a list of login ids.'
  return { logins }
}
