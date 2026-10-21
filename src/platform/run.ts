// Running a short-lived program and collecting what it printed.
//
// Every run has standard input closed, a deadline after which the program is killed, and a cap
// on how much output is kept. A failed run is an answer, never a thrown error: a missing
// program, a non-zero exit, a timeout and too much output all come back in `RunResult`.
//
// No shell is ever involved. On Windows that rules out `.cmd` and `.bat` files: Node starts
// those only through `cmd.exe`, where the arguments can be changed or run as commands, so they
// are refused on every platform rather than run (`docs/architecture.md`, "Windows"). A `.js`,
// `.cjs` or `.mjs` entry point runs through the Node that runs kurmis (`process.execPath`), so
// a script works the same on every platform.
import { spawn } from 'node:child_process'
import { clearTimeout, setTimeout } from 'node:timers'

/** What `runProgram` keeps of a run's output, per stream, unless told otherwise. */
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024

export interface RunOptions {
  /** How long the program may run before it is killed, in milliseconds. */
  timeoutMs: number
  /**
   * How many bytes of stdout, and separately of stderr, are kept. A program that prints more is
   * killed, and the run answers `outputTooLarge`. Defaults to `DEFAULT_MAX_OUTPUT_BYTES`.
   */
  maxOutputBytes?: number
  /** The program's environment. Defaults to this process's. */
  env?: NodeJS.ProcessEnv
  cwd?: string
}

export interface RunResult {
  /** What the program printed on stdout, as UTF-8, up to the cap. */
  stdout: string
  /** What the program printed on stderr, as UTF-8, up to the cap. */
  stderr: string
  /** The exit code, or null when the program was killed, ended by a signal, or never started. */
  code: number | null
  /** True when the program was killed at the deadline. */
  timedOut: boolean
  /** True when the program was killed for printing more than the cap. */
  outputTooLarge: boolean
  /**
   * Why the program did not run or did not finish on its own, or null when it exited by itself.
   * A non-zero exit code alone leaves this null.
   */
  error: string | null
}

/** The command and arguments that start `program`, or why it may not be started. */
export type Invocation = { command: string; args: string[] } | { refused: string }

/**
 * How `program` is started with `args`: directly, or through `nodePath` for a JavaScript entry
 * point. A `.cmd` or `.bat` file is refused, whatever the platform.
 */
export function invocationFor(program: string, args: readonly string[], nodePath: string = process.execPath): Invocation {
  if (/\.(cmd|bat)$/i.test(program)) {
    return { refused: `${program} is a batch file, which only cmd.exe can start; kurmis never starts a program through a shell` }
  }
  if (/\.(js|cjs|mjs)$/i.test(program)) return { command: nodePath, args: [program, ...args] }
  return { command: program, args: [...args] }
}

/** Runs `program` with `args` and answers what happened. Never rejects. */
export function runProgram(program: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
  const invocation = invocationFor(program, args)
  if ('refused' in invocation) {
    return Promise.resolve({ stdout: '', stderr: '', code: null, timedOut: false, outputTooLarge: false, error: invocation.refused })
  }
  const cap = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  return new Promise((resolve) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let outputTooLarge = false
    let settled = false

    const child = spawn(invocation.command, invocation.args, {
      // Standard input is closed, so a program that reads it gets end-of-file at once rather
      // than waiting on a terminal until the deadline.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ?? process.env,
      cwd: options.cwd,
      shell: false,
      windowsHide: true
    })

    const finish = (code: number | null, error: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code,
        timedOut,
        outputTooLarge,
        error
      })
    }

    // SIGKILL, because a program that is waiting on something may ignore a polite signal. On
    // Windows any signal ends the process with TerminateProcess. Only the program itself is
    // killed, not processes it started. The pipes are closed too, so a child the program left
    // behind holding them cannot keep the run open.
    const kill = (): void => {
      child.kill('SIGKILL')
      child.stdout.destroy()
      child.stderr.destroy()
    }

    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, options.timeoutMs)

    const keep = (chunks: Buffer[], chunk: Buffer, kept: number): number => {
      if (outputTooLarge || timedOut) return kept
      if (kept + chunk.length > cap) {
        chunks.push(chunk.subarray(0, cap - kept))
        outputTooLarge = true
        kill()
        return cap
      }
      chunks.push(chunk)
      return kept + chunk.length
    }
    child.stdout.on('data', (chunk: Buffer) => { stdoutBytes = keep(stdout, chunk, stdoutBytes) })
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes = keep(stderr, chunk, stderrBytes) })

    child.on('error', (error) => {
      // A program that could not be started has no pid and no exit to wait for.
      if (child.pid === undefined) finish(null, `${program} could not be started: ${error.message}`)
    })
    child.on('close', (code, signal) => {
      if (timedOut) finish(null, `${program} did not finish within ${String(options.timeoutMs)} ms and was killed`)
      else if (outputTooLarge) finish(null, `${program} printed more than ${String(cap)} bytes and was killed`)
      else if (code === null) finish(null, `${program} was ended by ${signal ?? 'a signal'}`)
      else finish(code, null)
    })
  })
}
