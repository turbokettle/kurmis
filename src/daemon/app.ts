// The daemon's request handling: the proxy, the control API, the login table and the usage
// probes, without the listening socket and the process lifecycle (`main.ts`).
//
// `handle` sorts each request on the daemon's port (`requestKind`): `HEAD|GET /api/hello` is
// answered here without the key, because the CLI checks the base URL with it before its first
// request and without its custom headers; paths under `/_kurmis/` go to the control API
// (`control.ts`); the routed Anthropic paths go to the proxy (`proxy.ts`); everything else is 404.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { requestKind } from '../core/proxy-rules.ts'
import { ClaudeIdentityReader } from '../data/identity.ts'
import type { DaemonLog } from '../data/log.ts'
import { probeClaudeUsage } from './claude-probe.ts'
import { probeCodexUsage } from './codex-probe.ts'
import { createControl } from './control.ts'
import { LoginTable } from './logins.ts'
import { createProxy } from './proxy.ts'
import { createTokenSource } from './tokens.ts'
import { createUpstream, upstreamOrigin } from './upstream.ts'
import { UsagePoller, type ProbeFunction } from './usage-poller.ts'

export interface DaemonAppOptions {
  /**
   * The daemon's environment: `KURMIS_CLAUDE_BIN`, `KURMIS_CODEX_BIN`, `KURMIS_UPSTREAM_URL`
   * (a test hook: the Anthropic API's base URL, default `https://api.anthropic.com`) and
   * `KURMIS_SECURITY_PROGRAM` (a test hook: the `security` program, default `/usr/bin/security`)
   * are read from it, and the CLIs it starts inherit it.
   */
  env: NodeJS.ProcessEnv
  log: DaemonLog
  /** The secret every proxied and control request must carry. */
  key: string
  port: number
  pid: number
  /** Milliseconds since epoch. */
  startedAt: number
  /** Called once a control `stop` request has been answered. `main.ts` then stops the daemon. */
  onStopRequested(): void
  now?: () => number
  /** Shorter timings, fixed randomness and stand-in probes, for tests. The daemon leaves it unset. */
  tuning?: DaemonTuning
}

export interface DaemonTuning {
  /** The capacity hold's length and backoff (`capacity-hold.ts`). */
  holdMs?: number
  holdBaseMs?: number
  holdMaxMs?: number
  /** The 0-1 source of the backoff's jitter. */
  random?: () => number
  pollIntervalMs?: number
  configCheckMs?: number
  stateWriteMs?: number
  renewalWaitMs?: number
  upstreamIdleTimeoutMs?: number
  /** The platform the token source reads for: the Keychain on `darwin`, the file elsewhere. */
  platform?: NodeJS.Platform
  probeClaude?: ProbeFunction
  probeCodex?: ProbeFunction
  /** Whether `start` begins the usage poll. Default true. */
  poll?: boolean
}

export interface DaemonApp {
  /** Loads `config.json` and `state.json`, and starts the usage poll. */
  start(): Promise<void>
  /** Handles one request on the daemon's port: hello, control, proxy or 404. */
  handle(request: IncomingMessage, response: ServerResponse): void
  /** How many proxied requests are open. */
  openRequests(): number
  /** Resolves once no proxied request is open. */
  drained(): Promise<void>
  /** Stops the poll and running probes and writes `state.json`. */
  close(): Promise<void>
}

export function createDaemonApp(options: DaemonAppOptions): DaemonApp {
  const now = options.now ?? Date.now
  const tuning = options.tuning ?? {}
  const { env, log, key } = options
  const tokens = createTokenSource({ env, log, now, ...(tuning.platform === undefined ? {} : { platform: tuning.platform }) })
  const identity = new ClaudeIdentityReader()
  const table = new LoginTable({ tokens, log, now,
    ...(tuning.configCheckMs === undefined ? {} : { configCheckMs: tuning.configCheckMs }),
    ...(tuning.stateWriteMs === undefined ? {} : { stateWriteMs: tuning.stateWriteMs }) })
  const poller = new UsagePoller({ table, tokens, env, log, now,
    probeClaude: tuning.probeClaude ?? probeClaudeUsage,
    probeCodex: tuning.probeCodex ?? probeCodexUsage,
    ...(tuning.pollIntervalMs === undefined ? {} : { intervalMs: tuning.pollIntervalMs }) })
  const upstream = createUpstream({ origin: upstreamOrigin(env),
    ...(tuning.upstreamIdleTimeoutMs === undefined ? {} : { idleTimeoutMs: tuning.upstreamIdleTimeoutMs }) })
  const proxy = createProxy({ key, table, tokens, identity, poller, upstream, log, now,
    ...(tuning.random === undefined ? {} : { random: tuning.random }),
    hold: { ...(tuning.holdMs === undefined ? {} : { holdMs: tuning.holdMs }),
      ...(tuning.holdBaseMs === undefined ? {} : { baseMs: tuning.holdBaseMs }),
      ...(tuning.holdMaxMs === undefined ? {} : { maxMs: tuning.holdMaxMs }) },
    ...(tuning.renewalWaitMs === undefined ? {} : { renewalWaitMs: tuning.renewalWaitMs }) })
  const control = createControl({ key, table, tokens, identity, poller, log, now, pid: options.pid, port: options.port,
    startedAt: options.startedAt, onStopRequested: () => { options.onStopRequested() } })
  let closed: Promise<void> | null = null

  return {
    async start() {
      table.load()
      await tokens.prime(table.claudeLogins().map((login) => login.id))
      if (tuning.poll !== false) poller.start()
    },
    handle(req, res) {
      const kind = requestKind(req.method, req.url)
      switch (kind.kind) {
        case 'hello':
          req.resume()
          res.writeHead(200, { 'content-type': 'application/json' }).end(req.method === 'HEAD' ? undefined : '{"message":"hello"}')
          return
        case 'control':
          void control.handle(req, res, kind.path)
          return
        case 'route':
          void proxy.handle(req, res)
          return
        case 'unknown':
          req.resume()
          res.writeHead(404).end()
      }
    },
    openRequests: () => proxy.openRequests(),
    drained: () => proxy.drained(),
    close() {
      closed ??= (async () => {
        poller.close()
        upstream.close()
        tokens.clear()
        await table.flush()
      })()
      return closed
    }
  }
}
