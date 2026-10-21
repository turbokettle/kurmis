// Starting an interactive child for `kurmis claude`, `kurmis codex` and `kurmis login`: the
// child gets the terminal, and the wrapper waits for it and ends the way it ended.
// (Interface only; implemented next.)
import type { Output } from './command.ts'

/** The program to start and how. `command` and `args` come from `findProgram` plus the caller's arguments. */
export interface ChildSpec {
  command: string
  args: string[]
  /** The child's whole environment. */
  env: Record<string, string>
  cwd?: string
}

/** How an interactive child ended. */
export type ChildEnd =
  | { kind: 'exit'; code: number }
  | { kind: 'signal'; signal: NodeJS.Signals }
  /** The child could not be started at all; `message` is a sentence for stderr. */
  | { kind: 'not-started'; code: string; message: string }

export interface RunInteractiveOptions {
  platform?: NodeJS.Platform
}

/**
 * Starts the child with `stdio: 'inherit'` and no shell. While it runs, this process ignores
 * SIGINT (Ctrl-C reaches the child through the terminal) and forwards SIGTERM and SIGHUP to it.
 * Resolves when the child has ended; the handlers are removed again by then. Never rejects.
 */
export async function runInteractive(spec: ChildSpec, options: RunInteractiveOptions = {}): Promise<ChildEnd> {
  void spec
  void options
  throw new Error('runInteractive: not implemented yet')
}

export interface FinishOptions {
  stderr: Output
  /** The program's name for the message when it could not be started, e.g. `claude`. */
  name: string
  platform?: NodeJS.Platform
}

/**
 * The exit code the wrapper ends with: the child's code; for a child ended by a signal, the
 * signal is first raised on this process with its default handler, so the parent shell sees the
 * same signal (where that does not end the process, as on Windows, 128 + the signal number); for
 * a child that could not be started, a message on stderr and a non-zero code.
 */
export function finishLikeChild(end: ChildEnd, options: FinishOptions): number {
  void end
  void options
  throw new Error('finishLikeChild: not implemented yet')
}
