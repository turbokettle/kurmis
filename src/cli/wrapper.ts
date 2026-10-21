// Starting an interactive child for `kurmis claude`, `kurmis codex` and `kurmis login`: the
// child gets the terminal, and the wrapper waits for it and ends the way it ended.
//
// Signals while the child runs:
//
// - Ctrl-C (SIGINT) and Ctrl-\ (SIGQUIT) on macOS and Linux: the terminal sends them to every
//   process in its foreground process group, which holds the wrapper and the child. The child
//   decides what they do (Claude Code uses Ctrl-C itself), so the wrapper ignores them and keeps
//   waiting. This is what `system(3)` does in a parent while its child runs.
// - SIGTERM and SIGHUP on macOS and Linux: these are usually sent to the wrapper alone (`kill
//   <pid>`, a closed terminal reaching the shell's jobs), so the wrapper sends them on to the
//   child and keeps waiting for it to end.
// - On Windows there are no signals between processes. Ctrl-C and Ctrl-Break reach every process
//   attached to the console, and so does closing the console window, which Node reports as
//   SIGHUP. The child gets each of them itself, so the wrapper ignores them all and waits.
//   Forwarding would be wrong there: `child.kill()` on Windows ends the child at once with
//   TerminateProcess, so it could not save anything. Node never reports SIGTERM on Windows.
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { constants } from 'node:os'
import { refusedByGuard, withGuard } from '../platform/system-program-guard.ts'
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

/**
 * The parts of `process` the wrapper uses for signals. `process` itself fits; tests pass an
 * event emitter so they can send a signal without sending it to the test runner.
 */
export interface SignalProcess {
  readonly pid: number
  on(signal: NodeJS.Signals, listener: () => void): unknown
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown
  removeAllListeners(signal: NodeJS.Signals): unknown
  kill(pid: number, signal: NodeJS.Signals): unknown
}

/** `child_process.spawn`, or a stand-in in tests. */
export type SpawnFunction = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

export interface RunInteractiveOptions {
  platform?: NodeJS.Platform
  /** Defaults to `process`. */
  process?: SignalProcess
  /** Defaults to `child_process.spawn`. */
  spawn?: SpawnFunction
}

/** The signals the wrapper ignores while the child runs, because the child gets them itself. */
export function ignoredSignals(platform: NodeJS.Platform): NodeJS.Signals[] {
  return platform === 'win32' ? ['SIGINT', 'SIGBREAK', 'SIGHUP'] : ['SIGINT', 'SIGQUIT']
}

/** The signals the wrapper sends on to the child. None on Windows (see the top of this file). */
export function forwardedSignals(platform: NodeJS.Platform): NodeJS.Signals[] {
  return platform === 'win32' ? [] : ['SIGTERM', 'SIGHUP']
}

/**
 * Starts the child with `stdio: 'inherit'` and no shell. While it runs, this process ignores
 * SIGINT (Ctrl-C reaches the child through the terminal) and forwards SIGTERM and SIGHUP to it.
 * Resolves when the child has ended; the handlers are removed again by then. Never rejects.
 */
export async function runInteractive(spec: ChildSpec, options: RunInteractiveOptions = {}): Promise<ChildEnd> {
  const platform = options.platform ?? process.platform
  const proc = options.process ?? process
  const spawn = options.spawn ?? nodeSpawn

  return await new Promise<ChildEnd>((resolve) => {
    const installed: Array<[NodeJS.Signals, () => void]> = []
    let child: ChildProcess | undefined
    let started = false
    let settled = false

    const finish = (end: ChildEnd): void => {
      if (settled) return
      settled = true
      for (const [signal, listener] of installed) proc.removeListener(signal, listener)
      resolve(end)
    }

    // The handlers go on before the child starts. Signals are delivered through the event loop,
    // so none can arrive between the spawn call and `child` being set.
    const forward = (signal: NodeJS.Signals): void => {
      if (child?.pid === undefined) return
      try {
        child.kill(signal)
      } catch {
        // The child has just ended; its exit event follows.
      }
    }
    for (const signal of ignoredSignals(platform)) {
      const listener = (): void => {}
      installed.push([signal, listener])
      proc.on(signal, listener)
    }
    for (const signal of forwardedSignals(platform)) {
      const listener = (): void => forward(signal)
      installed.push([signal, listener])
      proc.on(signal, listener)
    }

    const guarded = refusedByGuard(spec.command, spec.env)
    if (guarded !== null) {
      finish(notStarted(spec.command, Object.assign(new Error(guarded), { code: 'EACCES' })))
      return
    }
    try {
      child = spawn(spec.command, spec.args, {
        stdio: 'inherit',
        env: withGuard(spec.env),
        cwd: spec.cwd,
        shell: false,
        // Interactive programs need their console window on Windows, so it is not hidden.
        windowsHide: false
      })
    } catch (error) {
      // spawn throws for arguments it refuses outright, such as a NUL character in one.
      finish(notStarted(spec.command, error))
      return
    }

    child.once('spawn', () => {
      started = true
    })
    child.once('error', (error) => {
      // After a successful start, 'error' only reports a failed kill; the exit event still
      // comes. Before it, the child never ran.
      if (!started) finish(notStarted(spec.command, error))
    })
    child.once('exit', (code, signal) => {
      if (signal !== null) finish({ kind: 'signal', signal })
      else finish({ kind: 'exit', code: code ?? 1 })
    })
  })
}

function notStarted(command: string, error: unknown): ChildEnd {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'
  const why: Record<string, string> = {
    ENOENT: 'there is no such program',
    EACCES: 'it is not executable, or a folder on the way to it cannot be read',
    EPERM: 'the system does not allow starting it',
    ENOEXEC: 'it is not a program this system can run',
    EISDIR: 'it is a folder'
  }
  const reason = why[code] ?? (error instanceof Error ? error.message : String(error))
  return { kind: 'not-started', code, message: `could not start ${command}: ${reason} (${code})` }
}

export interface FinishOptions {
  stderr: Output
  /** The program's name for the message when it could not be started, e.g. `claude`. */
  name: string
  platform?: NodeJS.Platform
  /** Defaults to `process`. */
  process?: SignalProcess
}

/**
 * The exit code for a child that could not be started. These are the codes a POSIX shell gives
 * in the same case (127: no such program, 126: found but it cannot be run), so a script that
 * runs `kurmis claude` where it ran `claude` sees what it saw before. Anything else is 1.
 */
export function notStartedExitCode(code: string): number {
  if (code === 'ENOENT') return 127
  if (code === 'EACCES' || code === 'EPERM' || code === 'ENOEXEC' || code === 'EISDIR') return 126
  return 1
}

/**
 * Signals whose default action writes a core dump. When the child ends by one of these the
 * wrapper exits with 128 + the number instead of raising it on itself, so it does not leave a
 * core file of its own. A shell reports the same `$?` either way.
 */
const CORE_SIGNALS: ReadonlySet<string> = new Set(['SIGQUIT', 'SIGABRT', 'SIGILL', 'SIGTRAP', 'SIGFPE',
  'SIGBUS', 'SIGSEGV', 'SIGSYS', 'SIGXCPU', 'SIGXFSZ', 'SIGIOT'])

/** 128 + the signal's number, as a shell reports a process ended by it. */
export function signalExitCode(signal: NodeJS.Signals): number {
  const number = (constants.signals as Partial<Record<string, number>>)[signal]
  return 128 + (number ?? 0)
}

/**
 * The exit code the wrapper ends with: the child's code; for a child ended by a signal, the
 * signal is first raised on this process with its default handler, so the parent shell sees the
 * same signal (where that does not end the process, as on Windows, 128 + the signal number); for
 * a child that could not be started, a message on stderr and a non-zero code.
 */
export function finishLikeChild(end: ChildEnd, options: FinishOptions): number {
  switch (end.kind) {
    case 'exit':
      return end.code
    case 'not-started':
      options.stderr.write(`kurmis: ${options.name}: ${end.message}\n`)
      return notStartedExitCode(end.code)
    case 'signal': {
      const platform = options.platform ?? process.platform
      // On Windows `process.kill` on this process ends it at once with TerminateProcess and exit
      // code 1, which says less than 128 + n, so the code is returned instead.
      if (platform !== 'win32' && !CORE_SIGNALS.has(end.signal)) {
        const proc = options.process ?? process
        // With no listener the signal has its default action again, which for these signals
        // ends the process. A shell that waits on the wrapper then sees it ended by that signal,
        // which matters for SIGINT: a shell running a script stops the script only then.
        proc.removeAllListeners(end.signal)
        try {
          proc.kill(proc.pid, end.signal)
        } catch {
          // Fall through to the exit code.
        }
      }
      // Reached on Windows, for the core-dump signals, and in the short time before the raised
      // signal is delivered.
      return signalExitCode(end.signal)
    }
  }
}
