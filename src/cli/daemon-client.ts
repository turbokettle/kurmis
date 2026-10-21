// How the CLI reaches the daemon: finding it through `daemon.json`, starting it when it is not
// running (or replacing one of an older version), and the control API requests.
// (Interface only; implemented next.)
import type { StatusAnswer } from '../core/control-api.ts'

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
}

/** The running daemon, or null when none answers. Never starts one. */
export async function findDaemon(options: DaemonClientOptions): Promise<DaemonConnection | null> {
  void options
  throw new DaemonError('findDaemon: not implemented yet')
}

/** The running daemon, started first when none runs, or replacing one of an older version. */
export async function ensureDaemon(options: DaemonClientOptions): Promise<DaemonConnection> {
  void options
  throw new DaemonError('ensureDaemon: not implemented yet')
}

/** `GET /_kurmis/status`. */
export async function readStatus(connection: DaemonConnection): Promise<StatusAnswer> {
  void connection
  throw new DaemonError('readStatus: not implemented yet')
}

/** `POST /_kurmis/probe`: probes the logins now and answers the status when done. */
export async function requestProbe(connection: DaemonConnection, logins?: string[]): Promise<StatusAnswer> {
  void connection
  void logins
  throw new DaemonError('requestProbe: not implemented yet')
}

/** `POST /_kurmis/reload`: the daemon reads `config.json` again. */
export async function requestReload(connection: DaemonConnection): Promise<void> {
  void connection
  throw new DaemonError('requestReload: not implemented yet')
}

/** Stops the running daemon and waits for it to exit. False when none was running. */
export async function stopDaemon(options: DaemonClientOptions): Promise<boolean> {
  void options
  throw new DaemonError('stopDaemon: not implemented yet')
}
