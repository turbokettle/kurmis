// A small stand-in for `createDaemonApp`, so the daemon's lifecycle (`src/daemon/main.ts`) can
// be tested in this process or in a bundle of its own (`fake-daemon-entry.ts`). It answers:
//
// - `HEAD` / `GET /api/hello`: 200, no key needed.
// - `GET /_kurmis/status`: a `StatusAnswer` with no logins.
// - `POST /_kurmis/stop`: `{ ok: true }`, then calls `onStopRequested` with the body's
//   `maxWaitMs`, as `control.ts` does.
// - `GET /_test/hold?ms=<n>`: counts as an open proxied request and answers
//   `{ ok: true, pid }` after n milliseconds.
// - anything else: 404.
//
// Every path but `/api/hello` needs the key in `x-kurmis-key` and answers 403 without it.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CONTROL_API_VERSION, CONTROL_PATHS, type StatusAnswer } from '../../src/core/control-api.ts'
import { KEY_HEADER } from '../../src/core/route-headers.ts'
import type { DaemonApp, DaemonAppOptions } from '../../src/daemon/app.ts'
import { kurmisVersion } from '../../src/version.ts'

export const HOLD_PATH = '/_test/hold'

export interface FakeAppBehaviour {
  /** `start()` rejects with this. */
  startError?: Error
  /** `start()` resolves after this many milliseconds. */
  startDelayMs?: number
  /** The version the status answer reports. `kurmisVersion` by default. */
  version?: string
}

export interface FakeDaemonApp extends DaemonApp {
  readonly options: DaemonAppOptions
  readonly calls: { start: number; close: number }
}

export function createFakeDaemonApp(options: DaemonAppOptions, behaviour: FakeAppBehaviour = {}): FakeDaemonApp {
  let open = 0
  let waiters: Array<() => void> = []
  const calls = { start: 0, close: 0 }

  const settle = (): void => {
    if (open > 0) return
    const ready = waiters
    waiters = []
    for (const resolve of ready) resolve()
  }

  const answerJson = (response: ServerResponse, status: number, body: unknown): void => {
    const text = JSON.stringify(body)
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
    response.end(text)
  }

  const hold = (url: URL, response: ServerResponse): void => {
    const ms = Number(url.searchParams.get('ms') ?? '0')
    open++
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      open--
      settle()
    }
    const timer = setTimeout(() => {
      answerJson(response, 200, { ok: true, pid: options.pid })
      finish()
    }, Number.isFinite(ms) && ms > 0 ? ms : 0)
    // A connection closed by the daemon (at the drain cap) ends the request too.
    response.on('close', finish)
  }

  return {
    options,
    calls,
    async start() {
      calls.start++
      if (behaviour.startDelayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, behaviour.startDelayMs))
      if (behaviour.startError !== undefined) throw behaviour.startError
    },
    handle(request: IncomingMessage, response: ServerResponse) {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const method = request.method ?? 'GET'
      if (url.pathname === CONTROL_PATHS.stop && method === 'POST' && request.headers[KEY_HEADER] === options.key) {
        const chunks: Buffer[] = []
        request.on('data', (chunk: Buffer) => chunks.push(chunk))
        request.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const body = (text === '' ? {} : JSON.parse(text)) as { maxWaitMs?: number }
          response.on('finish', () => options.onStopRequested(body.maxWaitMs === undefined ? {} : { maxWaitMs: body.maxWaitMs }))
          answerJson(response, 200, { ok: true })
        })
        return
      }
      // The body, if any, is not needed; reading it lets the request end.
      request.resume()
      if (url.pathname === '/api/hello' && (method === 'GET' || method === 'HEAD')) {
        response.writeHead(200, { 'content-length': 0 })
        response.end()
        return
      }
      if (request.headers[KEY_HEADER] !== options.key) {
        response.writeHead(403, { 'content-length': 0 })
        response.end()
        return
      }
      if (url.pathname === CONTROL_PATHS.status && method === 'GET') {
        const status: StatusAnswer = {
          ok: true,
          apiVersion: CONTROL_API_VERSION,
          version: behaviour.version ?? kurmisVersion,
          pid: options.pid,
          port: options.port,
          startedAt: options.startedAt,
          logins: []
        }
        answerJson(response, 200, status)
        return
      }
      if (url.pathname === HOLD_PATH && method === 'GET') {
        hold(url, response)
        return
      }
      response.writeHead(404, { 'content-length': 0 })
      response.end()
    },
    openRequests: () => open,
    drained: () => open === 0 ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve)),
    async close() {
      calls.close++
    }
  }
}

/** A `createApp` for `runDaemon` that keeps each app it creates, for a test to look at. */
export function fakeAppFactory(behaviour: FakeAppBehaviour = {}): {
  createApp: (options: DaemonAppOptions) => FakeDaemonApp
  apps: FakeDaemonApp[]
} {
  const apps: FakeDaemonApp[] = []
  return {
    apps,
    createApp: (options) => {
      const app = createFakeDaemonApp(options, behaviour)
      apps.push(app)
      return app
    }
  }
}
