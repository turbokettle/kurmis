// The daemon process: `kurmis daemon run`. It listens on `127.0.0.1:<port>`, writes
// `daemon.json`, hands every request to the request handling in `app.ts`, and stops on a
// signal or a control `stop` once the open proxied requests have finished. A `stop` that names
// `maxWaitMs` waits for them at most that long.
//
// The port is the lock that keeps one daemon per user. When the port is busy:
//
// - an older kurmis daemon (a lower version, an earlier build of the same version, or the same
//   build with a lower or missing control API version: `shouldReplaceDaemon`) is asked to stop
//   (the version handover). It stops accepting at once, which frees the port, and finishes its
//   open requests in the background while this daemon binds the port and serves new ones. A
//   routed Claude CLI retries a request that finds no daemon (`CLAUDE_CODE_MAX_RETRIES=15`),
//   which covers the moment in between.
// - any other kurmis daemon (the same build and control API version, a newer one, or a version
//   that cannot be compared, such as `dev`) keeps the port and this process exits 0. Two kurmis
//   commands that start a daemon at the same moment rely on this: the bind decides, and the
//   loser exits. A kurmis command that cannot use the daemon that kept the port says so
//   (`unusableDaemonText` in `src/cli/daemon-client.ts`).
// - any other program is an error that says how to change the port.
//
// `app.start()`, which reads `state.json`, runs only once the port is bound, so a daemon that
// loses the bind never reads or writes the daemon's state.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Output } from '../cli/command.ts'
import { CONTROL_PATHS, type StatusAnswer } from '../core/control-api.ts'
import { ConfigError, loadConfig, MAX_PORT, MIN_PORT } from '../data/config.ts'
import { readOrCreateKey, removeDaemonFile, writeDaemonFile } from '../data/daemon-file.ts'
import { errorCodeOf, openDaemonLog, type DaemonLog, type LogReason } from '../data/log.ts'
import { configPath } from '../data/paths.ts'
import { kurmisVersion } from '../version.ts'
import { createDaemonApp, type DaemonApp, type DaemonAppOptions } from './app.ts'
import {
  CLOSE_WAIT_MS, controlRequest, DAEMON_HOST, delay, portHolder, shouldReplaceDaemon, START_WAIT_MS, type PortHolder
} from './lifecycle.ts'

/** The part of `process` the daemon listens on: signals and uncaught errors. Tests pass an EventEmitter. */
export interface ProcessEvents {
  on(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface RunDaemonOptions {
  env: NodeJS.ProcessEnv
  /** Where `daemon run` says what it did; nothing is written when absent. */
  stdout?: Output
  stderr?: Output
  /** Creates the request handling. `createDaemonApp` by default; tests pass a small fake. */
  createApp?: (options: DaemonAppOptions) => DaemonApp
  /** Signals and uncaught errors are listened for here. `process` by default. */
  processEvents?: ProcessEvents
  /** The longest a stop waits for open proxied requests to finish. `DEFAULT_DRAIN_CAP_MS` by default. */
  drainCapMs?: number
  /**
   * The version this daemon reports and compares with the one on the port. `kurmisVersion` by
   * default; in-process tests set it, since code run from source is `dev`, which never replaces
   * another daemon.
   */
  version?: string
  /**
   * How long this daemon tries to bind a busy port: after it asked an older daemon to stop, or
   * while the port is busy but nothing answers on it. `BIND_DEADLINE_MS` by default.
   */
  bindDeadlineMs?: number
}

/**
 * How long a stop waits for open proxied requests: 15 minutes.
 *
 * A Claude CLI gives up on a request that has had no response headers after `API_TIMEOUT_MS`
 * (600 s by default) less one second, so a cap above that lets every request that is still
 * waiting for its first byte reach its end. A streamed answer that has started has no overall
 * limit in what was read of the CLI; that its longest answer (the output token limit at the
 * usual streaming speed) ends within the remaining minutes is an assumption. A request still
 * open at the cap is cut, and the CLI retries it.
 *
 * The cap seldom costs anything: in a version handover the port is free during the drain, and
 * `kurmis daemon stop` asks for a shorter wait (`maxWaitMs` in its `stop` request).
 */
export const DEFAULT_DRAIN_CAP_MS = 15 * 60_000

/** How long a daemon tries to get a busy port before it gives up. */
export const BIND_DEADLINE_MS = 10_000

/** The pause between two attempts to bind a busy port. */
const BIND_RETRY_MS = 100

/**
 * How often idle keep-alive connections are closed while the daemon drains, so a CLI whose
 * request has finished opens its next connection to the daemon that took the port.
 */
const IDLE_CLOSE_INTERVAL_MS = 1_000

const STOP_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const
const ERROR_EVENTS = ['uncaughtException', 'unhandledRejection'] as const

/** Runs the daemon until it is stopped. Resolves with the process exit code. */
export async function runDaemon(options: RunDaemonOptions): Promise<number> {
  const version = options.version ?? kurmisVersion
  const events = options.processEvents ?? process
  const drainCapMs = options.drainCapMs ?? DEFAULT_DRAIN_CAP_MS
  const bindDeadlineMs = options.bindDeadlineMs ?? BIND_DEADLINE_MS
  const say = (text: string): void => {
    options.stdout?.write(`${text}\n`)
  }
  const complain = (text: string): void => {
    options.stderr?.write(`kurmis daemon: ${text}\n`)
  }

  // The log is opened first, because a daemon started in the background has no terminal and
  // the log is the only place that shows why it stopped.
  const log = openDaemonLog()
  let key: string
  let port: number
  try {
    key = readOrCreateKey()
    port = loadConfig().port
  } catch (error) {
    if (error instanceof ConfigError) {
      log.write('config_invalid', { reason: 'invalid' })
      complain(error.message)
    } else {
      log.write('internal_error', { code: errorCodeOf(error) })
      complain(`could not read its files: ${messageOf(error)}`)
    }
    return 1
  }

  const stop = new StopControl()
  const onSignal = (): void => stop.request('signal')
  const onError = (error: unknown): void => {
    // Only the code: an error's message may quote anything, a token included.
    log.write('internal_error', { code: errorCodeOf(error) })
    stop.request('error')
  }
  for (const signal of STOP_SIGNALS) events.on(signal, onSignal)
  for (const event of ERROR_EVENTS) events.on(event, onError)
  try {
    return await serve({ ...options, version, drainCapMs, bindDeadlineMs, key, port, log, stop, say, complain, onError })
  } finally {
    for (const signal of STOP_SIGNALS) events.off(signal, onSignal)
    for (const event of ERROR_EVENTS) events.off(event, onError)
  }
}

interface ServeOptions extends RunDaemonOptions {
  version: string
  drainCapMs: number
  bindDeadlineMs: number
  key: string
  port: number
  log: DaemonLog
  stop: StopControl
  say(text: string): void
  complain(text: string): void
  onError(error: unknown): void
}

async function serve(options: ServeOptions): Promise<number> {
  const { version, key, port, log, stop, say, complain } = options
  const pid = process.pid
  const startedAt = Date.now()

  let app: DaemonApp
  try {
    app = (options.createApp ?? createDaemonApp)({
      env: options.env, log, key, port, pid, startedAt,
      onStopRequested: (request) => stop.request('shutdown', request.maxWaitMs)
    })
  } catch (error) {
    log.write('internal_error', { code: errorCodeOf(error) })
    complain(`could not set up its request handling: ${messageOf(error)}`)
    return 1
  }

  // Requests that arrive before `app.start()` has finished wait for it. Null until it is called.
  let started: Promise<boolean> | null = null
  let ready = false
  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    try {
      app.handle(request, response)
    } catch (error) {
      log.write('internal_error', { code: errorCodeOf(error) })
      if (!response.headersSent) response.statusCode = 500
      response.end()
    }
  }
  const server = createServer((request, response) => {
    // A connection that is still used while the daemon stops is closed after this answer, so
    // the CLI's next request goes to the daemon that took the port.
    if (stop.requested) response.setHeader('connection', 'close')
    if (ready) {
      handle(request, response)
      return
    }
    void (started ?? Promise.resolve(false)).then((ok) => {
      if (ok) {
        handle(request, response)
        return
      }
      response.statusCode = 503
      response.end()
    })
  })

  const bound = await bindPort(server, options)
  if (bound !== null) return bound
  server.on('error', options.onError)

  if (!stop.requested) {
    try {
      writeDaemonFile({ pid, port, version, startedAt })
    } catch (error) {
      log.write('internal_error', { code: errorCodeOf(error) })
      complain(`could not write daemon.json: ${messageOf(error)}`)
      stop.request('error')
    }
  }
  if (!stop.requested) {
    log.write('daemon_started', { pid, port })
    say(`kurmis daemon ${version} runs on ${DAEMON_HOST}:${String(port)} (pid ${String(pid)})`)
    started = Promise.resolve()
      .then(() => app.start())
      .then(
        () => {
          ready = true
          return true
        },
        (error: unknown) => {
          log.write('internal_error', { code: errorCodeOf(error) })
          complain(`could not start its request handling: ${messageOf(error)}`)
          stop.request('error')
          return false
        }
      )
  }

  await stop.firstRequest
  log.write('daemon_stopping', { reason: stop.reason ?? 'other' })
  // A daemon that is stopping, in a version handover too, probes no more logins on its own: the
  // one that takes the port does. Probes its open requests ask for still run.
  try {
    app.stopPolling()
  } catch (error) {
    log.write('internal_error', { code: errorCodeOf(error) })
  }
  // Stops accepting at once, which frees the port for a successor. Open connections stay.
  server.close()
  server.closeIdleConnections()
  const idleTimer = setInterval(() => server.closeIdleConnections(), IDLE_CLOSE_INTERVAL_MS)
  try {
    if (stop.exitCode === 0) await drain(app, options)
  } finally {
    clearInterval(idleTimer)
  }
  // Requests that are cut lose their client connection before `app.close()` ends their upstream
  // requests, so the client sees a dropped connection, not the proxy's 502 answer.
  if (stop.cutAtOnce || app.openRequests() > 0) server.closeAllConnections()

  if (started !== null) {
    const outcome = await waitAtMost(started, START_WAIT_MS)
    if (outcome.kind === 'done' && outcome.value) {
      const closed = await waitAtMost(Promise.resolve().then(() => app.close()), CLOSE_WAIT_MS)
      if (closed.kind === 'failed') log.write('internal_error', { code: errorCodeOf(closed.error) })
      if (closed.kind === 'timeout') log.write('internal_error', { reason: 'timeout' })
    }
  }
  server.closeAllConnections()
  try {
    removeDaemonFile(pid)
  } catch (error) {
    log.write('internal_error', { code: errorCodeOf(error) })
  }
  log.write('daemon_stopped', { pid, ok: stop.exitCode === 0 })
  say('kurmis daemon stopped')
  return stop.exitCode
}

/**
 * Waits for the open proxied requests, until the cap, a second stop signal, or the end of the
 * wait a `stop` request asked for.
 */
async function drain(app: DaemonApp, options: ServeOptions): Promise<void> {
  if (app.openRequests() === 0) return
  const outcome = await waitAtMost(app.drained(), options.drainCapMs, options.stop.drainSkipped)
  if (outcome.kind === 'done' || outcome.kind === 'failed') {
    if (outcome.kind === 'failed') options.log.write('internal_error', { code: errorCodeOf(outcome.error) })
    return
  }
  const reason: LogReason = outcome.kind === 'timeout' ? 'timeout' : options.stop.skipReason ?? 'signal'
  options.log.write('drain_cut_short', { count: app.openRequests(), reason })
}

/**
 * Binds `127.0.0.1:<port>`, replacing an older kurmis daemon that holds it. Resolves null once
 * the server listens, or with the exit code when this daemon is not to run.
 */
async function bindPort(server: Server, options: ServeOptions): Promise<number | null> {
  const { version, key, port, log, stop, say, complain } = options
  let deadline = Date.now() + options.bindDeadlineMs
  /** The older daemon this one asked to stop, once it has. */
  let askedToStop: StatusAnswer | null = null
  /** Who answered on the port at the last try. */
  let lastHolder: PortHolder | undefined
  for (;;) {
    if (stop.requested) return stop.exitCode
    const error = await listenOnce(server, port)
    if (error === null) return null
    if (error.code !== 'EADDRINUSE') {
      const refused = error.code !== undefined && UNUSABLE_PORT_CODES.has(error.code)
      log.write(refused ? 'port_in_use' : 'internal_error', { code: errorCodeOf(error), port })
      complain(refused ? unusablePortText(port, error.code ?? '', configPath())
        : `could not listen on ${DAEMON_HOST}:${String(port)} (${error.code ?? error.message})`)
      return 1
    }
    const holder = await portHolder(port, key)
    lastHolder = holder
    // A daemon that was asked to stop may answer nothing, or something else, while it closes;
    // that is not another program, and the bind is tried again until the deadline.
    if (holder.kind === 'other' && askedToStop === null) {
      log.write('port_in_use', { port })
      complain(`port ${String(port)} on ${DAEMON_HOST} is used by another program. To use another port, set ` +
        `"port" in ${configPath()} to a number from ${String(MIN_PORT)} to ${String(MAX_PORT)}.`)
      return 1
    }
    if (holder.kind === 'kurmis') {
      const other = holder.status
      if (!shouldReplaceDaemon(other, version)) {
        say(`kurmis daemon ${other.version} already runs on port ${String(port)} (pid ${String(other.pid)})`)
        return 0
      }
      if (askedToStop?.pid !== other.pid) {
        askedToStop = other
        deadline = Date.now() + options.bindDeadlineMs
        log.write('daemon_replacing_older', { pid: other.pid, port })
        say(`Replacing kurmis daemon ${other.version} (pid ${String(other.pid)}) on port ${String(port)}`)
        await controlRequest({ port, key, method: 'POST', path: CONTROL_PATHS.stop })
      }
    }
    if (Date.now() >= deadline) {
      log.write('port_in_use', { port, reason: 'timeout' })
      const seconds = String(Math.round(options.bindDeadlineMs / 1000))
      complain(bindTimeoutText(port, seconds, askedToStop, lastHolder ?? null))
      return 1
    }
    await delay(BIND_RETRY_MS)
  }
}

/**
 * Why the bind gave up at its deadline. The older daemon is named only while it is still the
 * one answering on the port: once it has been asked to stop, something else may answer there,
 * a program that took the port after it, or the old daemon itself while it closes.
 */
function bindTimeoutText(port: number, seconds: string, askedToStop: StatusAnswer | null,
  lastHolder: PortHolder | null): string {
  const where = `port ${String(port)} on ${DAEMON_HOST}`
  if (askedToStop === null) return `${where} stayed busy for ${seconds} s with nothing answering on it`
  const old = `the kurmis daemon ${askedToStop.version} (pid ${String(askedToStop.pid)})`
  if (lastHolder?.kind === 'kurmis' && lastHolder.status.pid === askedToStop.pid) {
    return `${old} did not give up port ${String(port)} within ${seconds} s`
  }
  const answer = lastHolder?.kind === 'other' ? ` (${lastHolder.reason})` : ''
  return `${old} was asked to stop, but ${where} stayed busy for ${seconds} s, and what holds it now does not answer as ` +
    `that daemon${answer}. Another program may have taken the port. To use another port, set "port" in ${configPath()} ` +
    `to a number from ${String(MIN_PORT)} to ${String(MAX_PORT)}.`
}

/**
 * Errors from `listen` that mean this port cannot be used here, whoever holds it. On Windows a
 * port inside a range the system reserves (for Hyper-V, WSL or Docker, for example) gives
 * EACCES even though nothing listens on it.
 */
const UNUSABLE_PORT_CODES: ReadonlySet<string> = new Set(['EACCES', 'EADDRNOTAVAIL'])

/** What the daemon says when `listen` failed with one of `UNUSABLE_PORT_CODES`. */
export function unusablePortText(port: number, code: string, configFile: string): string {
  return `could not listen on ${DAEMON_HOST}:${String(port)} (${code}): the system does not let this program use the port. ` +
    'On Windows a port inside a range the system reserves is refused this way; ' +
    '"netsh int ipv4 show excludedportrange protocol=tcp" lists those ranges. To use another port, set ' +
    `"port" in ${configFile} to a number from ${String(MIN_PORT)} to ${String(MAX_PORT)} outside them.`
}

/** One `listen`. Resolves null once the server listens, or with the error. */
function listenOnce(server: Server, port: number): Promise<NodeJS.ErrnoException | null> {
  return new Promise((resolve) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      resolve(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      resolve(null)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, DAEMON_HOST)
  })
}

/**
 * Collects the reasons to stop. The first request starts the stop. A later stop signal, or an
 * error at any time, ends the drain, and so does the end of the longest wait a request named
 * (`maxWaitMs`, from when it was made). An error makes the exit code 1.
 */
class StopControl {
  requested = false
  reason: LogReason | null = null
  skipReason: LogReason | null = null
  /** A request named a wait of 0 (`kurmis daemon stop --now`): the open requests are cut at once. */
  cutAtOnce = false
  exitCode = 0
  readonly firstRequest: Promise<void>
  readonly drainSkipped: Promise<void>
  private resolveFirst!: () => void
  private resolveSkip!: () => void

  constructor() {
    this.firstRequest = new Promise((resolve) => {
      this.resolveFirst = resolve
    })
    this.drainSkipped = new Promise((resolve) => {
      this.resolveSkip = resolve
    })
  }

  request(reason: LogReason, maxWaitMs?: number): void {
    if (reason === 'error') this.exitCode = 1
    if (maxWaitMs !== undefined && maxWaitMs <= 0) {
      this.cutAtOnce = true
      this.skip('stop_now')
    } else if (maxWaitMs !== undefined) {
      // Unref'd, so a daemon that has finished stopping does not wait for it.
      setTimeout(() => this.skip('timeout'), maxWaitMs).unref()
    }
    if (!this.requested) {
      this.requested = true
      this.reason = reason
      this.resolveFirst()
      if (reason === 'error') this.skip(reason)
      return
    }
    if (reason === 'signal' || reason === 'error') this.skip(reason)
  }

  private skip(reason: LogReason): void {
    this.skipReason ??= reason
    this.resolveSkip()
  }
}

type WaitOutcome<T> =
  | { kind: 'done'; value: T }
  | { kind: 'failed'; error: unknown }
  | { kind: 'timeout' }
  | { kind: 'skipped' }

/** Waits for `promise`, at most `ms`, or until `skip` resolves. The timer is cleared after. */
function waitAtMost<T>(promise: Promise<T>, ms: number, skip?: Promise<void>): Promise<WaitOutcome<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), ms)
    const finish = (outcome: WaitOutcome<T>): void => {
      clearTimeout(timer)
      resolve(outcome)
    }
    promise.then((value) => finish({ kind: 'done', value }), (error: unknown) => finish({ kind: 'failed', error }))
    void skip?.then(() => finish({ kind: 'skipped' }))
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
