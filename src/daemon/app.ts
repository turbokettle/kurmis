// The daemon's request handling: the proxy, the control API, the login table and the usage
// probes, without the listening socket and the process lifecycle (`main.ts`).
// (Interface only; implemented next.)
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DaemonLog } from '../data/log.ts'

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
  void options
  throw new Error('createDaemonApp: not implemented yet')
}
