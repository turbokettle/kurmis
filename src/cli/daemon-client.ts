// How the CLI reaches the daemon: finding it through `daemon.json`, starting it when it is not
// running (or replacing one of an older version), stopping it, and the control API requests.
//
// **Finding.** `daemon.json` names the daemon's pid and port. A daemon counts as running only
// when it answers a status request with the key from the `key` file and its own pid. A
// `daemon.json` whose pid no longer exists is removed. One whose pid exists but does not answer
// is left alone: that daemon may be finishing its open requests before it stops.
//
// **Starting.** `ensureDaemon` starts `<node> <bundle> daemon run` detached
// (`src/platform/detach.ts`) and waits until a daemon of this version or a newer one answers.
// A daemon is older when its version is lower or it is an earlier build of the same version, or
// it is the same build with a lower control API version (`daemonAge`, `shouldReplaceDaemon`).
// Only an older daemon is replaced.
// The start is the same from an ssh session as from a terminal at the screen. Two CLIs that
// start one at the same moment both start a process; the port decides which one stays, the
// other exits at once, and both CLIs connect to the one that stayed. A daemon of an
// older version is replaced by the new process itself (`main.ts` asks it to stop, which frees the
// port at once while it finishes its open requests). A daemon on another port than `config.json`
// names is asked to stop by the CLI, unless it is newer than this kurmis, or its version cannot
// be compared with this kurmis' own and is another.
//
// **A newer daemon.** A newer daemon (a higher version, a later build of the same version, or
// the same build with a higher control API version; `daemonAge`) is never replaced. When its control API version is this kurmis' own, it
// is used. Otherwise this kurmis cannot read its answers, so `startDaemon` and `ensureDaemon`
// fail with a `DaemonNotUsableError` that says so and what to do: update this kurmis, or stop the
// daemon with `kurmis daemon stop` and run the command again. The same goes for a daemon whose
// version cannot be compared with this one (`dev`) and whose control API version is another.
//
// **A daemon that refuses the key.** When `daemon.json` names a pid that exists and the program
// on its port answers the keyed status request with 403, the `key` file was most likely changed
// or deleted while that daemon ran. Its pid cannot be shown to be a kurmis daemon (it answers
// nothing without its key, and a pid can be reused), so it is never signalled: the CLI says
// what happened and names the pid and the command to stop it.
//
// **Stopping.** `stopDaemon` sends `stop` with its own deadline as `maxWaitMs`, since a daemon
// that has answered `stop` no longer listens on its port and cannot be sent a second request.
// The daemon stops waiting for its open requests by itself at that deadline. A daemon older than
// `maxWaitMs` ignores it, so after the deadline the CLI sends SIGTERM on macOS and Linux, which
// the daemon takes as a second stop signal. On Windows `process.kill` ends the process at once
// (TerminateProcess), so there the CLI first waits `STOP_GRACE_MS` more for the daemon to write
// `state.json` and exit by itself. A stop with `now` sends `maxWaitMs` 0, so the daemon cuts its
// open requests at once; the CLI then waits `NOW_STOP_TIMEOUT_MS` (25 seconds) for the daemon to
// kill its probes, write `state.json` and exit.
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { CONTROL_API_VERSION, CONTROL_PATHS, type StatusAnswer, type StopRequest } from '../core/control-api.ts'
import { ConfigError, loadConfig, readConfig } from '../data/config.ts'
import { readDaemonFile, readKey, readOrCreateKey, removeDaemonFile, type DaemonInfo } from '../data/daemon-file.ts'
import { configPath, keyPath, logPath } from '../data/paths.ts'
import { isPlainObject } from '../data/validate.ts'
import {
  canUseDaemon,
  controlRequest,
  daemonAge,
  delay,
  isStatusAnswer,
  portAcceptsConnections,
  portHolder,
  processExists,
  shouldReplaceDaemon,
  STOP_FINISH_MAX_MS,
  versionText,
  type ControlResult
} from '../daemon/lifecycle.ts'
import { kurmisEntry, spawnDetached, type DetachedChild } from '../platform/detach.ts'
import { inheritedTestHooks } from '../platform/system-programs.ts'
import { kurmisVersion } from '../version.ts'

export interface DaemonConnection {
  port: number
  /** The secret from the `key` file, for `x-kurmis-key`. */
  key: string
  pid: number
  version: string
  /** The daemon's control API version (`CONTROL_API_VERSION`); absent when its status answer has none. */
  apiVersion?: number
}

/** A running daemon as `findDaemon` found it. */
export interface FoundDaemon extends DaemonConnection {
  /** The answer to the status request that found it. */
  status: StatusAnswer
}

/** A control request that failed, with a sentence a person can read. */
export class DaemonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DaemonError'
  }
}

export interface DaemonClientOptions {
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** The bundle a new daemon runs. Defaults to `kurmisEntry` (the running bundle, or `KURMIS_ENTRY`). */
  entry?: string
  /** This CLI's version, which decides whether a running daemon is replaced. Defaults to `kurmisVersion`. */
  version?: string
  /**
   * This CLI's control API version, which decides whether a running daemon of the same version is
   * replaced (`shouldReplaceDaemon`). Defaults to `CONTROL_API_VERSION`.
   */
  apiVersion?: number
  /** How long a start may take before it is an error. */
  startTimeoutMs?: number
  /**
   * How long `stopDaemon` lets the daemon wait for its open requests (`maxWaitMs`), and waits
   * for it to exit before it signals it.
   */
  stopTimeoutMs?: number
  /**
   * `stopDaemon` asks the daemon to cut its open requests instead of waiting for them, and
   * waits `stopTimeoutMs` (`NOW_STOP_TIMEOUT_MS` by default) for it to exit.
   */
  now?: boolean
  /** Windows: how much longer `stopDaemon` waits before it ends the process. `STOP_GRACE_MS` by default. */
  stopGraceMs?: number
  /** Sends a signal to a pid; `process.kill` by default. For tests. */
  kill?: (pid: number, signal: NodeJS.Signals) => void
}

/**
 * How long a status request may take while looking for the daemon. A daemon that is busy, or
 * runs on a loaded machine, can take seconds to answer, and one that does not answer in time
 * is reported as not running, so this is generous.
 */
const FIND_TIMEOUT_MS = 10_000
/** How long a start may take: Node starting, the bundle loading, and the daemon binding. */
const START_TIMEOUT_MS = 15_000
/**
 * How long `requestProbe` waits. The daemon runs each probe's `claude` with a deadline of its
 * own, and the probes of several logins run side by side, so this is that deadline with room.
 */
const PROBE_TIMEOUT_MS = 90_000
/** `stopDaemon` waits this long for the daemon to finish its open requests and exit. */
const STOP_TIMEOUT_MS = 30_000
/**
 * How long `stopDaemon` with `now` waits for the daemon to exit: the longest the daemon takes
 * once its wait for open requests is over (`STOP_FINISH_MAX_MS`, 20 seconds), and 5 seconds more.
 * On Windows the process is ended after this, so a shorter wait could end it before `state.json`
 * is written.
 */
export const NOW_STOP_TIMEOUT_MS = STOP_FINISH_MAX_MS + 5_000
/**
 * Windows: how long after its deadline `stopDaemon` waits for a daemon that ended its wait by
 * itself to write `state.json` and exit, before it ends the process. The same as
 * `NOW_STOP_TIMEOUT_MS`, for the same reason.
 */
export const STOP_GRACE_MS = STOP_FINISH_MAX_MS + 5_000
/**
 * After the signal: SIGTERM makes a stopping daemon skip the rest of its wait; on Windows it
 * ends the process.
 */
const KILL_WAIT_MS = 5_000
/** How long a replaced or restarted daemon gets to close its port. */
const PORT_FREE_TIMEOUT_MS = 5_000
const POLL_MS = 100

/** The port the daemon should listen on: `port` in `config.json`. */
function configuredPort(): number {
  try {
    return loadConfig().port
  } catch (error) {
    if (error instanceof ConfigError) throw new DaemonError(error.message)
    throw error
  }
}

function foundDaemon(status: StatusAnswer, key: string): FoundDaemon {
  const found: FoundDaemon = { port: status.port, key, pid: status.pid, version: status.version, status }
  // An older daemon's status answer may have no `apiVersion`.
  if (typeof status.apiVersion === 'number') found.apiVersion = status.apiVersion
  return found
}

/**
 * The running daemon, or null when none answers. Never starts one. Looks at the port in
 * `daemon.json`, and at the configured port when that finds nothing, since a daemon that has
 * just bound its port may not have written `daemon.json` yet. Each status request may take
 * `FIND_TIMEOUT_MS`; with `timeoutMs`, the requests together also take at most about that long.
 */
export async function findDaemon(timeoutMs?: number): Promise<FoundDaemon | null> {
  const until = timeoutMs === undefined ? null : Date.now() + timeoutMs
  const requestTimeout = (): number => until === null ? FIND_TIMEOUT_MS : Math.min(FIND_TIMEOUT_MS, Math.max(1, until - Date.now()))
  const key = readKey()
  if (key === null) return null
  const read = readDaemonFile()
  let triedPort: number | null = null
  if (read.status === 'invalid') {
    // No daemon writes a damaged file (the writes are atomic), so it is of no use to anyone.
    removeDaemonFileIfDamaged()
  } else if (read.status === 'ok') {
    const { pid, port } = read.info
    if (!processExists(pid)) {
      try {
        removeDaemonFile(pid)
      } catch {
        // It could not be moved aside (on Windows, held open); the next command tries again.
      }
    } else {
      triedPort = port
      const holder = await portHolder(port, key, requestTimeout())
      if (holder.kind === 'kurmis') return foundDaemon(holder.status, key)
    }
  }
  let port: number
  try {
    // Read without writing, so that looking for the daemon changes no file.
    port = readConfig().port
  } catch {
    return null
  }
  if (port === triedPort) return null
  const holder = await portHolder(port, key, requestTimeout())
  return holder.kind === 'kurmis' ? foundDaemon(holder.status, key) : null
}

function removeDaemonFileIfDamaged(): void {
  const again = readDaemonFile()
  if (again.status !== 'invalid') return
  try {
    // `removeDaemonFile` removes a damaged file whatever pid it is given.
    removeDaemonFile(-1)
  } catch {
    // Another CLI removed it first.
  }
}

/**
 * Variables the daemon does not inherit from the CLI that starts it: a key or a base URL from a
 * routed session would make its probes sign their own requests or loop back into the proxy.
 */
const NOT_FOR_THE_DAEMON = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_SECURESTORAGE_CONFIG_DIR'
]

/**
 * The environment a daemon started from `env` gets. `KURMIS_HOME` is made absolute, because the
 * daemon runs in another folder (the home folder) than the CLI. In tests, the stand-ins of this
 * process are added when `env` lacks them (`inheritedTestHooks`).
 */
export function daemonEnvironment(env: NodeJS.ProcessEnv, processEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, ...inheritedTestHooks(env, processEnv) }
  for (const name of NOT_FOR_THE_DAEMON) delete out[name]
  if (out.KURMIS_HOME !== undefined && out.KURMIS_HOME !== '') out.KURMIS_HOME = resolve(out.KURMIS_HOME)
  return out
}

function portBusyMessage(port: number, reason: string): string {
  return `Port ${String(port)} on 127.0.0.1 is in use by another program (${reason}), so the kurmis daemon cannot ` +
    `listen there. Set "port" in ${configPath()} to a free port from 1024 to 65535, then run the command again.`
}

export interface StartResult {
  connection: FoundDaemon
  /** Whether this call started a daemon (false when one of this version or newer already ran). */
  started: boolean
  /** The version of the daemon this start replaced, or null. */
  replaced: string | null
}

/**
 * Why this kurmis (`version`, `apiVersion`) cannot use the running daemon `daemon`, which it does
 * not replace either, or null when it can use it (`canUseDaemon`).
 */
function unusableDaemonText(daemon: DaemonConnection, version: string = kurmisVersion,
  apiVersion: number = CONTROL_API_VERSION): string | null {
  if (canUseDaemon(daemon, apiVersion)) return null
  const age = daemonAge(daemon, version, apiVersion)
  const where = `on port ${String(daemon.port)} (pid ${String(daemon.pid)})`
  const versions = `The daemon is ${versionText(daemon.version, daemon.apiVersion)}, this kurmis is ${versionText(version, apiVersion)}.`
  if (age === 'newer') {
    return `A newer kurmis daemon runs ${where}, so this kurmis does not replace it, and it cannot use a daemon of another ` +
      `control API version. ${versions} Update this kurmis, or stop the daemon with "kurmis daemon stop" and run the command again.`
  }
  if (age === 'unknown') {
    return `The kurmis daemon ${where} has a version that cannot be compared with this kurmis' own, so this kurmis does not ` +
      `replace it, and it cannot use a daemon of another control API version. ${versions} Stop the daemon with ` +
      '"kurmis daemon stop" and run the command again.'
  }
  return `The kurmis daemon ${where} is older than this kurmis and has another control API version. ${versions} ` +
    '"kurmis daemon restart" replaces it.'
}

/**
 * A daemon runs, but this kurmis cannot use it and does not replace it (`unusableDaemonText`).
 * The message is the whole explanation, with what to do.
 */
export class DaemonNotUsableError extends DaemonError {
  constructor(message: string) {
    super(message)
    this.name = 'DaemonNotUsableError'
  }
}

/** `connection` when this kurmis can use it; otherwise throws a `DaemonNotUsableError` that says why. */
function usable<T extends DaemonConnection>(connection: T, version: string, apiVersion: number): T {
  const problem = unusableDaemonText(connection, version, apiVersion)
  if (problem !== null) throw new DaemonNotUsableError(problem)
  return connection
}

/**
 * The running daemon, started first when none runs, or replacing one that is older
 * (`shouldReplaceDaemon`) or on another port than `config.json` names. The longer form of
 * `ensureDaemon`. A newer daemon is kept; when this kurmis cannot use it (`unusableDaemonText`),
 * this throws a `DaemonNotUsableError`.
 */
export async function startDaemon(options: DaemonClientOptions): Promise<StartResult> {
  const version = options.version ?? kurmisVersion
  const apiVersion = options.apiVersion ?? CONTROL_API_VERSION
  const port = configuredPort()
  const found = await findDaemon()
  let replaced: string | null = null
  if (found !== null) {
    const age = daemonAge(found, version, apiVersion)
    if (found.port === port && age !== 'older') {
      return { connection: usable(found, version, apiVersion), started: false, replaced: null }
    }
    replaced = found.version
    if (found.port !== port) {
      // The new daemon takes over by itself only on its own port, so the one on the old port is
      // asked to stop here, but only by a kurmis at least as new as it.
      if (age === 'newer' || (age === 'unknown' && found.version !== version)) {
        throw new DaemonError(`The kurmis daemon ${found.version} runs on port ${String(found.port)}, but ${configPath()} names port ` +
          `${String(port)}. It is ${age === 'newer' ? 'newer than' : 'not comparable with'} this kurmis ` +
          `(${versionText(found.version, found.apiVersion)}; this kurmis is ${versionText(version, apiVersion)}), so this ` +
          'kurmis does not stop it to move it. Update this kurmis, or stop the daemon with "kurmis daemon stop" and run the command again.')
      }
      const stopped = await controlRequest({ port: found.port, key: found.key, method: 'POST', path: CONTROL_PATHS.stop })
      // `refused` means it has already closed its port, which is what a stop does first.
      if (stopped.kind === 'failed' || (stopped.kind === 'answered' && stopped.status !== 200)) {
        throw new DaemonError(`The kurmis daemon ${found.version} on port ${String(found.port)} (pid ${String(found.pid)}) could ` +
          `not be stopped to move it to port ${String(port)}, which ${configPath()} names: ` +
          `${stopped.kind === 'failed' ? stopped.reason : `it answered HTTP ${String(stopped.status)}`}. ` +
          'Stop it with "kurmis daemon stop" after setting the old port back, or end that process, and run the command again.')
      }
    }
  }
  const key = readOrCreateKey()
  if (found === null) {
    const refusing = await keyRefusingDaemon(key)
    if (refusing !== null) throw new DaemonError(keyRefusedMessage(refusing, options.platform ?? process.platform))
    const holder = await portHolder(port, key, FIND_TIMEOUT_MS)
    if (holder.kind === 'other') {
      // daemon.json's daemon that holds the port but did not answer in time is not "another
      // program".
      const silent = silentDaemon()
      if (silent !== null && silent.port === port && holder.status === undefined) {
        throw new DaemonError(notAnsweringMessage(silent, holder.reason, options.platform ?? process.platform))
      }
      throw new DaemonError(portBusyMessage(port, holder.reason))
    }
    if (holder.kind === 'kurmis' && !shouldReplaceDaemon(holder.status, version, apiVersion)) {
      return { connection: usable(foundDaemon(holder.status, key), version, apiVersion), started: false, replaced: null }
    }
  }
  const entry = options.entry ?? kurmisEntry({ env: options.env })
  if (entry === null) {
    throw new DaemonError('This kurmis runs from its source tree, so there is no bundle to start the daemon from. ' +
      'Run "pnpm bundle" and use dist/kurmis.cjs, or set KURMIS_ENTRY to a built bundle.')
  }
  const env = daemonEnvironment(options.env)
  let child: DetachedChild
  try {
    child = await spawnDetached({ command: process.execPath, args: [entry, 'daemon', 'run'], env, cwd: homedir() })
  } catch (error) {
    throw new DaemonError(`The kurmis daemon could not be started: ${error instanceof Error ? error.message : String(error)}`)
  }
  const connection = await waitForDaemon({ port, version, apiVersion, child, timeoutMs: options.startTimeoutMs ?? START_TIMEOUT_MS })
  // A newer daemon that took the port first keeps it, and the new process exits.
  return { connection: usable(connection, version, apiVersion), started: true, replaced }
}

interface WaitForDaemon {
  port: number
  version: string
  apiVersion: number
  child: DetachedChild
  timeoutMs: number
}

/** Waits until a daemon answers on `port` that `shouldReplaceDaemon` keeps: as old as this kurmis, or newer. */
async function waitForDaemon(wait: WaitForDaemon): Promise<FoundDaemon> {
  const deadline = Date.now() + wait.timeoutMs
  let exitCode: number | null | undefined
  void wait.child.exited.then((code) => {
    exitCode = code
  })
  for (;;) {
    // The lookup gets only the time that is left, so a status request that hangs cannot stretch the wait.
    const found = await findDaemon(Math.max(1, deadline - Date.now()))
    if (found !== null && found.port === wait.port && !shouldReplaceDaemon(found, wait.version, wait.apiVersion)) return found
    // A child that exited 0 lost the port to another daemon starting at the same moment, which
    // this loop finds next. Any other exit is a failure.
    if (exitCode !== undefined && exitCode !== 0) {
      throw new DaemonError(`The kurmis daemon exited at start (${exitCode === null ? 'ended by a signal' : `exit code ${String(exitCode)}`}). ` +
        `Run "kurmis daemon run" to see why, or look in ${logPath()}.`)
    }
    if (Date.now() >= deadline) {
      throw new DaemonError(`The kurmis daemon did not answer on port ${String(wait.port)} within ` +
        `${String(Math.round(wait.timeoutMs / 1000))} seconds of starting. Run "kurmis daemon run" to see why, or look in ${logPath()}.`)
    }
    await delay(POLL_MS)
  }
}

/**
 * The running daemon, started first when none runs, or replacing one that is older
 * (`shouldReplaceDaemon`). Throws a `DaemonNotUsableError` when a newer daemon runs that this
 * kurmis cannot use (`unusableDaemonText`).
 */
export async function ensureDaemon(options: DaemonClientOptions): Promise<FoundDaemon> {
  return (await startDaemon(options)).connection
}

/** Turns a control answer that is not a success into a `DaemonError`. */
function failureOf(result: ControlResult, connection: DaemonConnection, what: string): DaemonError {
  const port = String(connection.port)
  if (result.kind === 'refused') return new DaemonError(`The kurmis daemon is not running (nothing answers on port ${port}).`)
  if (result.kind === 'failed') return new DaemonError(`The kurmis daemon on port ${port} did not answer ${what}: ${result.reason}.`)
  if (result.status === 403) {
    return new DaemonError(`The program on port ${port} did not accept the key in ${keyPath()}. If it is a kurmis daemon of ` +
      'another data folder, stop it, or set another "port" in config.json.')
  }
  const said = isPlainObject(result.body) && typeof result.body.error === 'string' ? result.body.error : `HTTP ${String(result.status)}`
  return new DaemonError(`The kurmis daemon refused ${what}: ${said}`)
}

/**
 * `POST /_kurmis/probe`: probes the logins now and answers the status when done. `signal` ends
 * the request and closes its connection, so a CLI that stops waiting can exit; the daemon still
 * finishes the probe.
 */
export async function requestProbe(connection: DaemonConnection, logins?: string[], signal?: AbortSignal): Promise<StatusAnswer> {
  const result = await controlRequest({
    port: connection.port,
    key: connection.key,
    method: 'POST',
    path: CONTROL_PATHS.probe,
    body: logins === undefined ? {} : { logins },
    timeoutMs: PROBE_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal })
  })
  if (result.kind === 'answered' && result.status === 200 && isStatusAnswer(result.body)) return result.body
  throw failureOf(result, connection, 'a usage probe')
}

/** `POST /_kurmis/reload`: the daemon reads `config.json` again. */
export async function requestReload(connection: DaemonConnection): Promise<void> {
  const result = await controlRequest({ port: connection.port, key: connection.key, method: 'POST', path: CONTROL_PATHS.reload })
  if (result.kind === 'answered' && result.status === 200 && isPlainObject(result.body) && result.body.ok === true) return
  throw failureOf(result, connection, 'a reload')
}

/** Waits until `pid` has exited, up to `timeoutMs`. Answers whether it did. */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (processExists(pid)) {
    if (Date.now() >= deadline) return false
    await delay(POLL_MS)
  }
  return true
}

/** Waits until nothing accepts connections on `port`, up to `timeoutMs`. */
async function waitForPortFree(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (await portAcceptsConnections(port)) {
    if (Date.now() >= deadline) return false
    await delay(POLL_MS)
  }
  return true
}

/**
 * `daemon.json`'s daemon when its pid exists and the program on its port refuses `key` with
 * 403, which is what a kurmis daemon answers to a key that is not its own; null otherwise.
 */
async function keyRefusingDaemon(key: string): Promise<DaemonInfo | null> {
  const read = readDaemonFile()
  if (read.status !== 'ok' || !processExists(read.info.pid)) return null
  const holder = await portHolder(read.info.port, key, FIND_TIMEOUT_MS)
  return holder.kind === 'other' && holder.status === 403 ? read.info : null
}

/** What the CLI says when `daemon.json`'s daemon holds the port but did not answer in time. */
function notAnsweringMessage(info: { pid: number; port: number }, reason: string, platform: NodeJS.Platform): string {
  const pid = String(info.pid)
  const stopIt = platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill ${pid}`
  return `The kurmis daemon (pid ${pid}, named in daemon.json) holds port ${String(info.port)} but did not answer a status ` +
    `request (${reason}). It may be busy, or finishing its open requests before it stops. Run the command again in a ` +
    `moment. If it keeps happening, look in ${logPath()}, and stop it with "${stopIt}".`
}

/** What the CLI says about a daemon that refuses the key (`keyRefusingDaemon`). */
function keyRefusedMessage(info: DaemonInfo, platform: NodeJS.Platform): string {
  const pid = String(info.pid)
  const stopIt = platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill ${pid}`
  return `The program on port ${String(info.port)} refused the key in ${keyPath()}, and daemon.json names pid ${pid} on that ` +
    'port, which still runs. Most likely that is a kurmis daemon started before the key file was changed or deleted, so ' +
    `its key no longer matches the key file. If pid ${pid} is that daemon, stop it with "${stopIt}" and run the command ` +
    'again. If you ran "kurmis setup", run it again after that, so your Claude Code settings hold the key from the key file.'
}

/**
 * The sentence `keyRefusedMessage` gives when `daemon.json`'s daemon refuses the key, or null.
 * For `kurmis daemon status`, which finds no daemon in that case.
 */
export async function keyRefusedProblem(options: DaemonClientOptions): Promise<string | null> {
  const refusing = await keyRefusingDaemon(readKey() ?? '')
  return refusing === null ? null : keyRefusedMessage(refusing, options.platform ?? process.platform)
}

/**
 * Stops the running daemon and waits for it to exit. Answers its pid, or null when none was
 * running. The daemon finishes its open requests first, for at most `stopTimeoutMs` (sent as
 * `maxWaitMs`), or cuts them at once with `now`. When it has not exited by then it gets SIGTERM on macOS and Linux,
 * which makes a daemon that ignored `maxWaitMs` stop waiting; on Windows, where that ends the
 * process at once, the CLI first waits `stopGraceMs` more (not with `now`). Only a pid that
 * answered the keyed status request as the daemon's own is ever signalled.
 */
export async function stopDaemon(options: DaemonClientOptions): Promise<number | null> {
  const platform = options.platform ?? process.platform
  const found = await findDaemon()
  if (found === null) {
    const problem = await keyRefusedProblem(options)
    if (problem !== null) throw new DaemonError(problem)
    return null
  }
  const now = options.now === true
  const waitMs = options.stopTimeoutMs ?? (now ? NOW_STOP_TIMEOUT_MS : STOP_TIMEOUT_MS)
  const body: StopRequest = { maxWaitMs: now ? 0 : waitMs }
  const result = await controlRequest({ port: found.port, key: found.key, method: 'POST', path: CONTROL_PATHS.stop, body })
  if (result.kind === 'answered' && result.status !== 200) throw failureOf(result, found, 'the stop request')
  // With `now` the wait above is already the time the daemon needs to exit after its requests.
  const graceMs = platform === 'win32' && !now ? options.stopGraceMs ?? STOP_GRACE_MS : 0
  if (await waitForExit(found.pid, waitMs + graceMs)) return found.pid
  const kill = options.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal))
  try {
    kill(found.pid, 'SIGTERM')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return found.pid
    // EPERM: the daemon runs as another user, or on Windows as administrator while this
    // command does not.
    const stopIt = platform === 'win32' ? `taskkill /PID ${String(found.pid)} /F` : `kill ${String(found.pid)}`
    throw new DaemonError(`The kurmis daemon (pid ${String(found.pid)}) was asked to stop but is still running, and this ` +
      `command may not end it (${code ?? String(error)}). It probably runs as another user or as administrator; end it from ` +
      `there with "${stopIt}".`)
  }
  if (await waitForExit(found.pid, KILL_WAIT_MS)) return found.pid
  throw new DaemonError(`The kurmis daemon (pid ${String(found.pid)}) was asked to stop but is still running.`)
}

/**
 * Stops the running daemon and starts a new one at once: the old one closes its port as soon
 * as it is asked to stop and finishes its open requests in the background. Refuses to replace a
 * newer daemon (`daemonAge`).
 */
export async function restartDaemon(options: DaemonClientOptions): Promise<StartResult> {
  const version = options.version ?? kurmisVersion
  const apiVersion = options.apiVersion ?? CONTROL_API_VERSION
  const found = await findDaemon()
  if (found !== null) {
    if (daemonAge(found, version, apiVersion) === 'newer') {
      throw new DaemonError(`The running kurmis daemon is newer than this kurmis (the daemon is ` +
        `${versionText(found.version, found.apiVersion)}, this kurmis is ${versionText(version, apiVersion)}), so this kurmis ` +
        'does not replace it. Update this kurmis, or run "kurmis daemon stop" and then "kurmis daemon start".')
    }
    const result = await controlRequest({ port: found.port, key: found.key, method: 'POST', path: CONTROL_PATHS.stop })
    if (result.kind === 'answered' && result.status !== 200) throw failureOf(result, found, 'the stop request')
    if (!(await waitForPortFree(found.port, PORT_FREE_TIMEOUT_MS))) {
      throw new DaemonError(`The kurmis daemon (pid ${String(found.pid)}) was asked to stop but still holds port ${String(found.port)}.`)
    }
  }
  const started = await startDaemon(options)
  return { ...started, replaced: found?.version ?? started.replaced }
}

/** What `daemon.json` says when no daemon answers: a pid that exists but does not answer, or nothing. */
export function silentDaemon(): { pid: number; port: number; version: string } | null {
  const read = readDaemonFile()
  if (read.status !== 'ok' || !processExists(read.info.pid)) return null
  return { pid: read.info.pid, port: read.info.port, version: read.info.version }
}

