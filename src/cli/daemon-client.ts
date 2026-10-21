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
// Two CLIs that start one at the same moment both start a process; the port decides which one
// stays, the other exits at once, and both CLIs connect to the one that stayed. A daemon of an
// older version is replaced by the new process itself (`main.ts` asks it to stop, which frees the
// port at once while it finishes its open requests). An older CLI never replaces a newer daemon.
//
// Where the daemon is started from:
// - macOS, from an ssh login or wherever the login Keychain cannot be read: through launchd, in
//   the user's GUI session (`src/platform/launchd.ts`), since a daemon in the ssh session could
//   read no Keychain token. When launchd refuses (nobody is logged in at the screen), it is
//   started directly with a warning.
// - Windows, from an ssh login: through WMI, outside the job the ssh server ends with the session.
// - Everywhere else: directly, detached.
import { homedir } from 'node:os'
import { CONTROL_PATHS, type StatusAnswer } from '../core/control-api.ts'
import { ConfigError, loadConfig } from '../data/config.ts'
import { readDaemonFile, readKey, readOrCreateKey, removeDaemonFile } from '../data/daemon-file.ts'
import { configPath, keyPath, logPath } from '../data/paths.ts'
import { isPlainObject } from '../data/validate.ts'
import { probeLoginKeychain, SECURITY_PROGRAM } from '../daemon/keychain.ts'
import {
  compareVersions,
  controlRequest,
  delay,
  isStatusAnswer,
  portAcceptsConnections,
  portHolder,
  processExists,
  shouldReplace,
  type ControlResult
} from '../daemon/lifecycle.ts'
import { createThroughWmi, inSshSession, kurmisEntry, nodeForJobs, spawnDetached, type DetachedChild } from '../platform/detach.ts'
import { startThroughLaunchd } from '../platform/launchd.ts'
import { kurmisVersion } from '../version.ts'

export interface DaemonConnection {
  port: number
  /** The secret from the `key` file, for `x-kurmis-key`. */
  key: string
  pid: number
  version: string
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
  /** Start the daemon directly even where it would go through launchd (`daemon start --no-launchd`). */
  noLaunchd?: boolean
  /** How long a start may take before it is an error. */
  startTimeoutMs?: number
  /** How long `stopDaemon` waits for the daemon to exit before it sends SIGTERM. */
  stopTimeoutMs?: number
  /** Told a sentence when something went less well than it should but the command goes on. */
  onWarning?: (text: string) => void
}

/** How long a status request may take while looking for the daemon. */
const FIND_TIMEOUT_MS = 3_000
/** How long a direct start may take: Node starting, the bundle loading, and the daemon binding. */
const DIRECT_START_TIMEOUT_MS = 15_000
/** A start through launchd or WMI also waits for those to start a program. */
const OUTSIDE_START_TIMEOUT_MS = 30_000
/**
 * How long `requestProbe` waits. The daemon runs each probe's `claude` with a deadline of its
 * own, and the probes of several logins run side by side, so this is that deadline with room.
 */
export const PROBE_TIMEOUT_MS = 90_000
/** `stopDaemon` waits this long for the daemon to finish its open requests and exit. */
const STOP_TIMEOUT_MS = 30_000
/** After SIGTERM, which makes a stopping daemon skip the rest of its wait. */
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

function connectionOf(status: StatusAnswer, key: string): DaemonConnection {
  return { port: status.port, key, pid: status.pid, version: status.version }
}

/**
 * The running daemon, or null when none answers. Never starts one. Looks at the port in
 * `daemon.json`, and at the configured port when that finds nothing, since a daemon that has
 * just bound its port may not have written `daemon.json` yet.
 */
export async function findDaemon(options: DaemonClientOptions): Promise<DaemonConnection | null> {
  void options
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
      removeDaemonFile(pid)
    } else {
      triedPort = port
      const holder = await portHolder(port, key, FIND_TIMEOUT_MS)
      if (holder.kind === 'kurmis') return connectionOf(holder.status, key)
    }
  }
  let port: number
  try {
    port = loadConfig().port
  } catch {
    return null
  }
  if (port === triedPort) return null
  const holder = await portHolder(port, key, FIND_TIMEOUT_MS)
  return holder.kind === 'kurmis' ? connectionOf(holder.status, key) : null
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

/** How a new daemon is started on this machine. */
export type StartMethod = 'direct' | 'launchd' | 'wmi'

export interface StartMethodInput {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  noLaunchd: boolean
  /** Whether this process can read the login Keychain (macOS only; asked only when it matters). */
  keychainReadable: () => Promise<boolean>
}

/** Picks how a new daemon is started; see the file's header. */
export async function chooseStartMethod(input: StartMethodInput): Promise<StartMethod> {
  if (input.platform === 'win32') return inSshSession(input.env) ? 'wmi' : 'direct'
  if (input.platform !== 'darwin' || input.noLaunchd) return 'direct'
  if (inSshSession(input.env)) return 'launchd'
  return (await input.keychainReadable()) ? 'direct' : 'launchd'
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

/** The environment a daemon started from `env` gets. */
export function daemonEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }
  for (const name of NOT_FOR_THE_DAEMON) delete out[name]
  return out
}

function portBusyMessage(port: number, reason: string): string {
  return `Port ${String(port)} on 127.0.0.1 is in use by another program (${reason}), so the kurmis daemon cannot ` +
    `listen there. Set "port" in ${configPath()} to a free port from 1024 to 65535, then run the command again.`
}

export interface StartResult {
  connection: DaemonConnection
  /** Whether this call started a daemon (false when one of this version or newer already ran). */
  started: boolean
  /** The version of the daemon this start replaced, or null. */
  replaced: string | null
  method: StartMethod | null
}

/**
 * The running daemon, started first when none runs, or replacing one of an older version or on
 * another port than `config.json` names. The longer form of `ensureDaemon`.
 */
export async function startDaemon(options: DaemonClientOptions): Promise<StartResult> {
  const version = options.version ?? kurmisVersion
  const port = configuredPort()
  const found = await findDaemon(options)
  let replaced: string | null = null
  if (found !== null) {
    if (found.port === port && !shouldReplace(found.version, version)) {
      return { connection: found, started: false, replaced: null, method: null }
    }
    replaced = found.version
    if (found.port !== port) {
      // The new daemon takes over by itself only on its own port, so the one on the old port is
      // asked to stop here.
      await controlRequest({ port: found.port, key: found.key, method: 'POST', path: CONTROL_PATHS.stop })
    }
  }
  const key = readOrCreateKey()
  if (found === null) {
    const holder = await portHolder(port, key, FIND_TIMEOUT_MS)
    if (holder.kind === 'other') throw new DaemonError(portBusyMessage(port, holder.reason))
    if (holder.kind === 'kurmis' && !shouldReplace(holder.status.version, version)) {
      return { connection: connectionOf(holder.status, key), started: false, replaced: null, method: null }
    }
  }
  const entry = options.entry ?? kurmisEntry({ env: options.env })
  if (entry === null) {
    throw new DaemonError('This kurmis runs from its source tree, so there is no bundle to start the daemon from. ' +
      'Run "pnpm bundle" and use dist/kurmis.cjs, or set KURMIS_ENTRY to a built bundle.')
  }
  const platform = options.platform ?? process.platform
  const method = await chooseStartMethod({
    platform,
    env: options.env,
    noLaunchd: options.noLaunchd === true,
    keychainReadable: async () => {
      const program = options.env.KURMIS_SECURITY_PROGRAM || SECURITY_PROGRAM
      return (await probeLoginKeychain(program)).readable
    }
  })
  const env = daemonEnvironment(options.env)
  const warn = options.onWarning ?? (() => undefined)
  let child: DetachedChild | null = null
  let removeJob: (() => Promise<void>) | null = null
  let used: StartMethod = method
  if (method === 'launchd') {
    try {
      const job = await startThroughLaunchd({
        programArguments: [nodeForJobs({ env: options.env, platform }), entry, 'daemon', 'start', '--no-launchd'],
        env
      })
      removeJob = () => job.remove()
    } catch (error) {
      warn(`The daemon could not be started through launchd (${error instanceof Error ? error.message : String(error)}), so ` +
        'it is started from this login, where it cannot read the login Keychain: logins whose token is in the Keychain ' +
        'will not be routed until it is started from a login at the screen.')
      used = 'direct'
    }
  } else if (method === 'wmi') {
    try {
      await createThroughWmi([process.execPath, entry, 'daemon', 'run'], homedir(), env)
    } catch (error) {
      warn(`The daemon could not be started outside this ssh session (${error instanceof Error ? error.message : String(error)}), ` +
        'so it is started inside it and ends when the session closes.')
      used = 'direct'
    }
  }
  if (used === 'direct') {
    try {
      child = await spawnDetached({ command: process.execPath, args: [entry, 'daemon', 'run'], env, cwd: homedir() })
    } catch (error) {
      throw new DaemonError(`The kurmis daemon could not be started: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    const connection = await waitForDaemon({
      port,
      version,
      child,
      timeoutMs: options.startTimeoutMs ?? (used === 'direct' ? DIRECT_START_TIMEOUT_MS : OUTSIDE_START_TIMEOUT_MS)
    })
    return { connection, started: true, replaced, method: used }
  } finally {
    if (removeJob !== null) await removeJob().catch(() => undefined)
  }
}

interface WaitForDaemon {
  port: number
  version: string
  child: DetachedChild | null
  timeoutMs: number
}

/** Waits until a daemon of `version` or newer answers on `port`. */
async function waitForDaemon(wait: WaitForDaemon): Promise<DaemonConnection> {
  const deadline = Date.now() + wait.timeoutMs
  let exitCode: number | null | undefined
  void wait.child?.exited.then((code) => {
    exitCode = code
  })
  for (;;) {
    const found = await findDaemon({ env: {} })
    if (found !== null && found.port === wait.port && compareVersions(found.version, wait.version) !== -1) return found
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

/** The running daemon, started first when none runs, or replacing one of an older version. */
export async function ensureDaemon(options: DaemonClientOptions): Promise<DaemonConnection> {
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

/** `GET /_kurmis/status`. */
export async function readStatus(connection: DaemonConnection): Promise<StatusAnswer> {
  const result = await controlRequest({ port: connection.port, key: connection.key, method: 'GET', path: CONTROL_PATHS.status })
  if (result.kind === 'answered' && result.status === 200 && isStatusAnswer(result.body)) return result.body
  throw failureOf(result, connection, 'a status request')
}

/** `POST /_kurmis/probe`: probes the logins now and answers the status when done. */
export async function requestProbe(connection: DaemonConnection, logins?: string[]): Promise<StatusAnswer> {
  const result = await controlRequest({
    port: connection.port,
    key: connection.key,
    method: 'POST',
    path: CONTROL_PATHS.probe,
    body: logins === undefined ? {} : { logins },
    timeoutMs: PROBE_TIMEOUT_MS
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
 * Stops the running daemon and waits for it to exit. False when none was running. The daemon
 * finishes its open requests first; when it has not exited within `stopTimeoutMs` it gets
 * SIGTERM, which makes it stop waiting for them. Only a pid that answered the keyed status
 * request as the daemon's own is ever signalled.
 */
export async function stopDaemon(options: DaemonClientOptions): Promise<boolean> {
  const found = await findDaemon(options)
  if (found === null) return false
  const result = await controlRequest({ port: found.port, key: found.key, method: 'POST', path: CONTROL_PATHS.stop })
  if (result.kind === 'answered' && result.status !== 200) throw failureOf(result, found, 'the stop request')
  if (await waitForExit(found.pid, options.stopTimeoutMs ?? STOP_TIMEOUT_MS)) return true
  try {
    process.kill(found.pid, 'SIGTERM')
  } catch {
    return true
  }
  if (await waitForExit(found.pid, KILL_WAIT_MS)) return true
  throw new DaemonError(`The kurmis daemon (pid ${String(found.pid)}) was asked to stop but is still running.`)
}

/**
 * Stops the running daemon and starts a new one at once: the old one closes its port as soon
 * as it is asked to stop and finishes its open requests in the background. Refuses to replace a
 * daemon of a newer version than this CLI.
 */
export async function restartDaemon(options: DaemonClientOptions): Promise<StartResult> {
  const version = options.version ?? kurmisVersion
  const found = await findDaemon(options)
  if (found !== null) {
    if (compareVersions(found.version, version) === 1) {
      throw new DaemonError(`The running kurmis daemon is version ${found.version}, newer than this kurmis (${version}), ` +
        'so this kurmis does not replace it. Update kurmis, or run "kurmis daemon stop" first.')
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

