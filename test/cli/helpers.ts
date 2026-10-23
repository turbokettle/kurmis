// Shared helpers for the command tests: an output collector, a fake daemon client and a status
// answer builder. Every id, alias and email here is made up.
import { CONTROL_API_VERSION, type LoginStatus, type StatusAnswer } from '../../src/core/control-api.ts'
import type { CliContext } from '../../src/cli/command.ts'
import type { DaemonClient } from '../../src/cli/command-deps.ts'
import type { DaemonConnection, FoundDaemon } from '../../src/cli/daemon-client.ts'
import { DaemonError, DaemonNotUsableError } from '../../src/cli/daemon-client.ts'
import { daemonReport, type StatusReport } from '../../src/cli/status-format.ts'
import type { LoginRef } from '../../src/data/login-id.ts'
import { OWN_CLAUDE_REF } from '../logins.ts'

export interface Collected {
  context: CliContext
  stdout: () => string
  stderr: () => string
}

/** A `CliContext` whose output is kept in memory. */
export function collect(env: NodeJS.ProcessEnv = {}): Collected {
  let stdout = ''
  let stderr = ''
  return {
    context: {
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
      env
    },
    stdout: () => stdout,
    stderr: () => stderr
  }
}

export const FAKE_CONNECTION: DaemonConnection = { port: 40123, key: 'a'.repeat(64), pid: 4242, version: '0.1.0', apiVersion: CONTROL_API_VERSION }

/**
 * One login as the daemon would report it, with every setting at its default and, unless
 * `login` has an alias (a `LoginSettings`), its id as its alias.
 */
export function loginStatus(login: LoginRef & { alias?: string }, patch: Partial<LoginStatus> = {}): LoginStatus {
  return {
    id: login.id,
    alias: login.alias ?? login.id,
    usedByPlainClaude: login.usedByPlainClaude,
    routing: true,
    fiveHourLimit: 100,
    weeklyLimit: 100,
    useFirst: false,
    signedIn: true,
    usage: null,
    cooldownUntil: null,
    block: null,
    sessions: 0,
    email: null,
    organizationUuid: null,
    probing: false,
    ...patch
  }
}

export function statusAnswer(logins: LoginStatus[], patch: Partial<StatusAnswer> = {}): StatusAnswer {
  return {
    ok: true,
    apiVersion: CONTROL_API_VERSION,
    version: '0.1.0',
    pid: FAKE_CONNECTION.pid,
    port: FAKE_CONNECTION.port,
    startedAt: 1_768_478_400_000,
    logins,
    ...patch
  }
}

/**
 * A status report made from the daemon's answer, with global routing off and this kurmis
 * reported as the same version as the daemon, unless `patch` says otherwise.
 */
export function daemonStatus(answer: StatusAnswer, patch: Partial<StatusReport> = {}): StatusReport {
  return { ...daemonReport(answer, 'off', answer.version), ...patch }
}

export interface FakeDaemonClient extends DaemonClient {
  /** Every call made, in order, as `name` or `name:<logins>`. */
  calls: string[]
}

export interface FakeDaemonOptions {
  /** Whether a daemon is running for `findDaemon`. Default true. */
  running?: boolean
  /** The status answer `findDaemon` and `ensureDaemon` find the daemon with. */
  status?: StatusAnswer
  /** The status `requestProbe` answers; defaults to `status`. */
  probed?: StatusAnswer
  /** Makes `ensureDaemon` throw a `DaemonError` with this message. */
  ensureFails?: string
  /** Makes `ensureDaemon` throw a `DaemonNotUsableError` with this message: a newer daemon runs. */
  ensureNotUsable?: string
  /** The connection `findDaemon` and `ensureDaemon` answer. `FAKE_CONNECTION` by default. */
  connection?: DaemonConnection
  /** Makes `findDaemon` throw a `DaemonError` with this message. */
  findFails?: string
  /** Makes `requestReload` throw a `DaemonError` with this message. */
  reloadFails?: string
}

/** A daemon client that answers from memory and records what it was asked. */
export function fakeDaemonClient(options: FakeDaemonOptions = {}): FakeDaemonClient {
  const calls: string[] = []
  const status = options.status ?? statusAnswer([loginStatus(OWN_CLAUDE_REF)])
  const found = (): FoundDaemon => ({ ...(options.connection ?? FAKE_CONNECTION), status })
  return {
    calls,
    async findDaemon() {
      calls.push('findDaemon')
      if (options.findFails !== undefined) throw new DaemonError(options.findFails)
      return options.running === false ? null : found()
    },
    async ensureDaemon() {
      calls.push('ensureDaemon')
      if (options.ensureFails !== undefined) throw new DaemonError(options.ensureFails)
      if (options.ensureNotUsable !== undefined) throw new DaemonNotUsableError(options.ensureNotUsable)
      return found()
    },
    async requestProbe(_connection, logins) {
      calls.push(logins === undefined ? 'requestProbe' : `requestProbe:${logins.join(',')}`)
      return options.probed ?? status
    },
    async requestReload() {
      calls.push('requestReload')
      if (options.reloadFails !== undefined) throw new DaemonError(options.reloadFails)
    }
  }
}
