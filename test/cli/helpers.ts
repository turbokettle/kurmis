// Shared helpers for the command tests: an output collector, a fake daemon client and a status
// answer builder. Every id, label and email here is made up.
import type { LoginStatus, StatusAnswer } from '../../src/core/control-api.ts'
import type { CliContext } from '../../src/cli/command.ts'
import type { DaemonClient } from '../../src/cli/command-deps.ts'
import type { DaemonConnection } from '../../src/cli/daemon-client.ts'
import { DaemonError } from '../../src/cli/daemon-client.ts'

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

export const FAKE_CONNECTION: DaemonConnection = { port: 40123, key: 'a'.repeat(64), pid: 4242, version: '0.1.0' }

/** One login as the daemon would report it, with every setting at its default. */
export function loginStatus(id: string, patch: Partial<LoginStatus> = {}): LoginStatus {
  const provider = id.startsWith('codex:') ? 'codex' : 'claude'
  return {
    id,
    provider,
    label: id.slice(id.indexOf(':') + 1),
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
    probing: false,
    ...patch
  }
}

export function statusAnswer(logins: LoginStatus[], patch: Partial<StatusAnswer> = {}): StatusAnswer {
  return {
    ok: true,
    apiVersion: 1,
    version: '0.1.0',
    pid: FAKE_CONNECTION.pid,
    port: FAKE_CONNECTION.port,
    startedAt: 1_768_478_400_000,
    logins,
    ...patch
  }
}

export interface FakeDaemonClient extends DaemonClient {
  /** Every call made, in order, as `name` or `name:<logins>`. */
  calls: string[]
}

export interface FakeDaemonOptions {
  /** Whether a daemon is running for `findDaemon`. Default true. */
  running?: boolean
  /** The status `readStatus` answers. */
  status?: StatusAnswer
  /** The status `requestProbe` answers; defaults to `status`. */
  probed?: StatusAnswer
  /** Makes `ensureDaemon` throw a `DaemonError` with this message. */
  ensureFails?: string
  /** Makes `requestReload` throw a `DaemonError` with this message. */
  reloadFails?: string
}

/** A daemon client that answers from memory and records what it was asked. */
export function fakeDaemonClient(options: FakeDaemonOptions = {}): FakeDaemonClient {
  const calls: string[] = []
  const status = options.status ?? statusAnswer([loginStatus('claude:default'), loginStatus('codex:default')])
  return {
    calls,
    async findDaemon() {
      calls.push('findDaemon')
      return options.running === false ? null : FAKE_CONNECTION
    },
    async ensureDaemon() {
      calls.push('ensureDaemon')
      if (options.ensureFails !== undefined) throw new DaemonError(options.ensureFails)
      return FAKE_CONNECTION
    },
    async readStatus() {
      calls.push('readStatus')
      return status
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
