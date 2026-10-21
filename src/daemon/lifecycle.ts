// What the daemon process and the CLI both need to find out about a daemon on a port: a keyed
// control request, whether the program holding a port is a kurmis daemon, and how two kurmis
// versions compare. `main.ts` uses it when its port is busy, and `src/cli/daemon-client.ts`
// uses it to find, start and stop the daemon.
import { request } from 'node:http'
import { createConnection } from 'node:net'
import { CONTROL_PATHS, type StatusAnswer } from '../core/control-api.ts'
import { KEY_HEADER } from '../core/route-headers.ts'
import { isPlainObject } from '../data/validate.ts'

/** The loopback address the daemon listens on. */
export const DAEMON_HOST = '127.0.0.1'

/** How long a quick control request (status, reload, stop) may take. */
export const CONTROL_TIMEOUT_MS = 5_000

/** The most of a control answer that is read. A status answer with many logins is a few kB. */
const MAX_ANSWER_BYTES = 4 * 1024 * 1024

export type ControlResult =
  /** The daemon answered; `body` is the parsed JSON, or null when the answer was not JSON. */
  | { kind: 'answered'; status: number; body: unknown }
  /** Nothing listens on the port. */
  | { kind: 'refused' }
  /** Something else went wrong: a timeout, a reset connection, an answer too large. */
  | { kind: 'failed'; reason: string }

export interface ControlRequest {
  port: number
  key: string
  method: 'GET' | 'POST'
  path: string
  /** Sent as JSON. */
  body?: unknown
  timeoutMs?: number
}

/**
 * One control request to `127.0.0.1:<port>`, with the key in `x-kurmis-key`. Never rejects.
 * Each request has a connection of its own (no keep-alive), so a CLI that made one can exit at
 * once.
 */
export function controlRequest(options: ControlRequest): Promise<ControlResult> {
  const timeoutMs = options.timeoutMs ?? CONTROL_TIMEOUT_MS
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: ControlResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const headers: Record<string, string> = { [KEY_HEADER]: options.key, connection: 'close' }
    if (payload !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(payload))
    }
    const outgoing = request({ host: DAEMON_HOST, port: options.port, method: options.method, path: options.path, headers, agent: false },
      (incoming) => {
        const chunks: Buffer[] = []
        let size = 0
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_ANSWER_BYTES) {
            finish({ kind: 'failed', reason: 'the answer was too large' })
            outgoing.destroy()
            return
          }
          chunks.push(chunk)
        })
        incoming.on('error', (error) => finish({ kind: 'failed', reason: error.message }))
        incoming.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let body: unknown
          try {
            body = text === '' ? null : JSON.parse(text)
          } catch {
            body = null
          }
          finish({ kind: 'answered', status: incoming.statusCode ?? 0, body })
        })
      })
    const timer = setTimeout(() => {
      finish({ kind: 'failed', reason: `no answer within ${String(timeoutMs)} ms` })
      outgoing.destroy()
    }, timeoutMs)
    outgoing.on('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ECONNREFUSED' ? { kind: 'refused' } : { kind: 'failed', reason: error.code ?? error.message })
    })
    outgoing.end(payload)
  })
}

/** Whether `value` looks like a `StatusAnswer`: enough for the CLI to rely on its fields. */
export function isStatusAnswer(value: unknown): value is StatusAnswer {
  return isPlainObject(value) && value.ok === true && typeof value.version === 'string' &&
    typeof value.pid === 'number' && typeof value.port === 'number' && typeof value.startedAt === 'number' &&
    Array.isArray(value.logins)
}

export type PortHolder =
  /** Nothing listens on the port. */
  | { kind: 'free' }
  /** A kurmis daemon with this key answers there. */
  | { kind: 'kurmis'; status: StatusAnswer }
  /**
   * Something listens there that is not a kurmis daemon with this key, or does not answer.
   * `status` is the HTTP status it answered with, when it answered: 403 is what a kurmis daemon
   * with another key answers.
   */
  | { kind: 'other'; reason: string; status?: number }

/** Who holds `127.0.0.1:<port>`: a keyed `GET /_kurmis/status` decides. */
export async function portHolder(port: number, key: string, timeoutMs = CONTROL_TIMEOUT_MS): Promise<PortHolder> {
  const result = await controlRequest({ port, key, method: 'GET', path: CONTROL_PATHS.status, timeoutMs })
  if (result.kind === 'refused') return { kind: 'free' }
  if (result.kind === 'failed') return { kind: 'other', reason: result.reason }
  if (result.status === 200 && isStatusAnswer(result.body)) return { kind: 'kurmis', status: result.body }
  return { kind: 'other', reason: `it answered ${String(result.status)} to a kurmis status request`, status: result.status }
}

/** Whether anything accepts a connection on `127.0.0.1:<port>` now. */
export function portAcceptsConnections(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: DAEMON_HOST, port })
    const done = (accepted: boolean): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(accepted)
    }
    const timer = setTimeout(() => done(true), timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('error', (error: NodeJS.ErrnoException) => done(error.code !== 'ECONNREFUSED'))
  })
}

/**
 * Compares two kurmis versions numerically, part by part: `0.10.0` is newer than `0.9.1`. A
 * pre-release (`1.0.0-beta.1`) is older than the same version without one, and two
 * pre-releases of one version compare by their text. Answers -1, 0 or 1, or null when either is
 * not a version (such as `dev`, which code run from the source tree reports), since then
 * neither may replace the other.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return null
  const length = Math.max(left.parts.length, right.parts.length)
  for (let index = 0; index < length; index++) {
    const x = left.parts[index] ?? 0
    const y = right.parts[index] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  if (left.pre === right.pre) return 0
  if (left.pre === null) return 1
  if (right.pre === null) return -1
  return left.pre < right.pre ? -1 : 1
}

function parseVersion(text: string): { parts: number[]; pre: string | null } | null {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim())
  if (match === null) return null
  return { parts: (match[1] ?? '').split('.').map(Number), pre: match[2] ?? null }
}

/** Whether a daemon of `daemonVersion` should be replaced by one of `cliVersion`. */
export function shouldReplace(daemonVersion: string, cliVersion: string): boolean {
  return compareVersions(daemonVersion, cliVersion) === -1
}

/** Resolves after `ms`. The timer keeps the process alive, so a CLI waiting on it does not exit. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Whether a process with this pid exists. A process of another user (EPERM) counts. */
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
