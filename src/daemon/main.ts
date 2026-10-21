// The daemon process: `kurmis daemon run`. (Interface only; implemented next.)
import type { Output } from '../cli/command.ts'
import type { DaemonApp, DaemonAppOptions } from './app.ts'

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
  /** The longest a stop waits for open proxied requests to finish. */
  drainCapMs?: number
}

/** Runs the daemon until it is stopped. Resolves with the process exit code. */
export async function runDaemon(options: RunDaemonOptions): Promise<number> {
  void options
  throw new Error('runDaemon: not implemented yet')
}
