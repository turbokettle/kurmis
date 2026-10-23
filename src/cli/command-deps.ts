// What the commands reach outside themselves through, so a unit test can hand each command fakes
// instead of a daemon, a real `claude`, or autostart. A command module that its tests run with
// fakes exports a `create<Name>Command(deps)` that takes a `Partial` of what it needs and fills
// the rest with the real functions here.
import {
  ensureDaemon,
  findDaemon,
  requestProbe,
  requestReload,
  type DaemonClientOptions,
  type DaemonConnection,
  type FoundDaemon
} from './daemon-client.ts'
import type { StatusAnswer } from '../core/control-api.ts'
import { finishLikeChild, runInteractive } from './wrapper.ts'

/** The daemon client functions the commands use. */
export interface DaemonClient {
  findDaemon(): Promise<FoundDaemon | null>
  ensureDaemon(options: DaemonClientOptions): Promise<FoundDaemon>
  requestProbe(connection: DaemonConnection, logins?: string[], signal?: AbortSignal): Promise<StatusAnswer>
  requestReload(connection: DaemonConnection): Promise<void>
}

export const realDaemonClient: DaemonClient = { findDaemon, ensureDaemon, requestProbe, requestReload }

/** Starting the interactive child and ending like it (`wrapper.ts`). */
export interface ChildRunner {
  runInteractive: typeof runInteractive
  finishLikeChild: typeof finishLikeChild
}

export const realChildRunner: ChildRunner = { runInteractive, finishLikeChild }

/** What `reloadIfRunning` did. */
export type ReloadResult =
  | { kind: 'reloaded' }
  | { kind: 'not-running' }
  | { kind: 'failed'; message: string }

/**
 * Tells a running daemon to read `config.json` again. Never starts one: a daemon that is not
 * running reads the file when it starts. Never throws.
 */
export async function reloadIfRunning(client: DaemonClient): Promise<ReloadResult> {
  try {
    const connection = await client.findDaemon()
    if (connection === null) return { kind: 'not-running' }
    await client.requestReload(connection)
    return { kind: 'reloaded' }
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
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
 * How the work `start` begins settles within `ms` milliseconds. Never rejects. `start` gets a
 * signal that is aborted when the time is up, so the work can close what it holds open (a
 * request and its connection): a timer or socket left behind would keep the CLI running after
 * it has printed its answer. A later rejection of the work is ignored.
 */
export async function settleWithin<T>(start: (signal: AbortSignal) => Promise<T>, ms: number): Promise<Settled<T>> {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), ms)
  })
  let promise: Promise<T>
  try {
    promise = start(controller.signal)
  } catch (error) {
    clearTimeout(timer)
    return { kind: 'failed', error }
  }
  const settled = promise.then(
    (value): Settled<T> => ({ kind: 'done', value }),
    (error: unknown): Settled<T> => ({ kind: 'failed', error })
  )
  try {
    const result = await Promise.race([settled, timeout])
    if (result.kind === 'timeout') controller.abort()
    return result
  } finally {
    clearTimeout(timer)
  }
}
