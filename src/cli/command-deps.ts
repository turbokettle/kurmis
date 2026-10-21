// What the commands reach outside themselves through, so a unit test can hand each command fakes
// instead of a daemon, a real `claude` or `codex`, or autostart. Every command module exports a
// `create<Name>Command(deps)` that takes a `Partial` of what it needs and fills the rest with the
// real functions here.
import { findProgram } from '../platform/programs.ts'
import { prepareCodexHome } from './codex-home-files.ts'
import {
  DaemonError,
  ensureDaemon,
  findDaemon,
  readStatus,
  requestProbe,
  requestReload,
  type DaemonClientOptions,
  type DaemonConnection
} from './daemon-client.ts'
import type { StatusAnswer } from '../core/control-api.ts'
import { finishLikeChild, runInteractive } from './wrapper.ts'

/** The daemon client functions the commands use. */
export interface DaemonClient {
  findDaemon(options: DaemonClientOptions): Promise<DaemonConnection | null>
  ensureDaemon(options: DaemonClientOptions): Promise<DaemonConnection>
  readStatus(connection: DaemonConnection): Promise<StatusAnswer>
  requestProbe(connection: DaemonConnection, logins?: string[]): Promise<StatusAnswer>
  requestReload(connection: DaemonConnection): Promise<void>
}

export const realDaemonClient: DaemonClient = { findDaemon, ensureDaemon, readStatus, requestProbe, requestReload }

/** Starting the interactive child and ending like it (`wrapper.ts`). */
export interface ChildRunner {
  runInteractive: typeof runInteractive
  finishLikeChild: typeof finishLikeChild
}

export const realChildRunner: ChildRunner = { runInteractive, finishLikeChild }

export const realFindProgram: typeof findProgram = findProgram
export const realPrepareCodexHome: typeof prepareCodexHome = prepareCodexHome

/** What `reloadIfRunning` did. */
export type ReloadResult =
  | { kind: 'reloaded' }
  | { kind: 'not-running' }
  | { kind: 'failed'; message: string }

/**
 * Tells a running daemon to read `config.json` again. Never starts one: a daemon that is not
 * running reads the file when it starts. Never throws.
 */
export async function reloadIfRunning(client: DaemonClient, env: NodeJS.ProcessEnv): Promise<ReloadResult> {
  try {
    const connection = await client.findDaemon({ env })
    if (connection === null) return { kind: 'not-running' }
    await client.requestReload(connection)
    return { kind: 'reloaded' }
  } catch (error) {
    return { kind: 'failed', message: error instanceof DaemonError || error instanceof Error ? error.message : String(error) }
  }
}

/** One line about a `ReloadResult` for the person, or null when there is nothing to say. */
export function reloadText(result: ReloadResult): string | null {
  switch (result.kind) {
    case 'reloaded': return 'The running daemon has read the change.'
    case 'not-running': return null
    case 'failed': return `The daemon could not be told about the change (${result.message}); it reads config.json again once it notices the change.`
  }
}

export type Settled<T> =
  | { kind: 'done'; value: T }
  | { kind: 'failed'; error: unknown }
  | { kind: 'timeout' }

/**
 * How `promise` settles within `ms` milliseconds. Never rejects. The timer does not keep the
 * process running. On a timeout the promise goes on, and a later rejection of it is ignored.
 */
export async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<Settled<T>> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), ms)
    timer.unref()
  })
  const settled = promise.then(
    (value): Settled<T> => ({ kind: 'done', value }),
    (error: unknown): Settled<T> => ({ kind: 'failed', error })
  )
  try {
    return await Promise.race([settled, timeout])
  } finally {
    clearTimeout(timer)
  }
}
