// Running a program that kurmis talks to over its standard input and output, one JSON value per
// line in each direction: `claude -p --input-format stream-json` and `codex app-server`, which
// the daemon's usage probes start.
//
// `runProgram` in `run.ts` closes stdin, so it cannot be used here. This keeps its other rules:
// no shell, `windowsHide`, a deadline after which the program is killed, a cap on how much
// output is buffered, and `.cmd`/`.bat` files refused and `.js` entry points run through
// `process.execPath` (`invocationFor`). On top of that an AbortSignal kills the program.
//
// stderr is not read at all (it goes to the null device), because nothing the program writes
// there may be shown or stored by kurmis, and a pipe nobody reads would block the program once
// it is full.
//
// Killing takes the program's child processes with it where the OS allows it. On macOS and
// Linux the program is started in a process group of its own and the whole group gets SIGKILL.
// On Windows `taskkill /T /F` ends the process tree, because the Codex npm entry point is a
// `node` process that starts the native `codex.exe`, and TerminateProcess on the `node` alone
// would leave `codex.exe` running.
import { spawn, type ChildProcess } from 'node:child_process'
import { win32 } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { invocationFor } from './run.ts'

/** The longest single line kept while it is incomplete, unless told otherwise. */
export const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024

/** How many bytes of stdout a run may print in all, unless told otherwise. */
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/**
 * How long after the program has exited its stdout may stay open. A process the program left
 * behind can hold the pipe; after this the pipe is closed and the run counts as ended.
 */
const PIPE_CLOSE_WAIT_MS = 1000

/** Why a run ended. */
export type FrameProcessEnd =
  /** The program exited by itself; `code` or `signal` says how. */
  | 'exited'
  /** The deadline passed and the program was killed. */
  | 'timeout'
  /** The AbortSignal fired, before the start or while it ran, and the program was killed. */
  | 'aborted'
  /** A line or the whole output passed its cap, and the program was killed. */
  | 'output_too_large'
  /** `close` ended its input and the program did not exit within the grace time. */
  | 'close_timeout'
  /** `kill` was called. */
  | 'killed'
  /** The program could not be started, for example because the file does not exist. */
  | 'start_failed'
  /** The program is a `.cmd` or `.bat` file, which kurmis never starts. */
  | 'refused'

export interface FrameProcessExit {
  end: FrameProcessEnd
  /** The exit code, or null when the program was killed, ended by a signal or never started. */
  code: number | null
  signal: NodeJS.Signals | null
  /** For `start_failed`, Node's error code such as `ENOENT` or `EACCES`; otherwise null. */
  errorCode: string | null
}

export interface FrameProcessOptions {
  env: NodeJS.ProcessEnv
  cwd?: string
  /** How long the program may run in all, counted from the start, in milliseconds. */
  timeoutMs: number
  /** Aborting kills the program. A signal that is already aborted means it is not started. */
  signal?: AbortSignal
  /** Called with each line of stdout that is JSON, in order. Other lines are skipped. */
  onFrame: (frame: unknown) => void
  maxFrameBytes?: number
  maxOutputBytes?: number
  /** For tests of the kill branch; defaults to `process.platform`. */
  platform?: NodeJS.Platform
}

export interface FrameProcess {
  /** The process id, or undefined when the program was not started. */
  readonly pid: number | undefined
  /** Resolves once the run has ended, however it ended. Never rejects. */
  readonly exited: Promise<FrameProcessExit>
  /** Writes one value as a line of JSON. Does nothing once the input is closed. */
  send(frame: unknown): void
  /** Closes the program's stdin, which tells both CLIs to finish and exit. */
  endInput(): void
  /**
   * Closes stdin and waits for the program to exit, killing it when it has not exited after
   * `graceMs`. The deadline still applies. Answers the same as `exited`.
   */
  close(graceMs: number): Promise<FrameProcessExit>
  /** Kills the program now. */
  kill(): void
}

/** How to end a whole process tree on this platform, or null to signal the process group. */
export function treeKillCommand(
  pid: number,
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>
): { command: string; args: string[] } | null {
  if (platform !== 'win32') return null
  // The full path, so a `taskkill` earlier on PATH is never what runs.
  const root = envValue(env, 'SystemRoot', true) ?? 'C:\\Windows'
  return { command: win32.join(root, 'System32', 'taskkill.exe'), args: ['/PID', String(pid), '/T', '/F'] }
}

/** A variable by name; on Windows names are matched without regard to case. */
function envValue(env: Readonly<Record<string, string | undefined>>, name: string, windows: boolean): string | undefined {
  if (!windows) return env[name]
  const upper = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper && value !== undefined && value !== '') return value
  }
  return undefined
}

/**
 * Splits a byte stream into lines. Each complete line is handed to `onLine` without its line
 * ending. Answers false when an incomplete line has grown past `maxLineBytes`.
 */
export function createLineSplitter(maxLineBytes: number, onLine: (line: string) => void): (chunk: Buffer) => boolean {
  let pending: Buffer[] = []
  let pendingBytes = 0
  return (chunk) => {
    let start = 0
    for (;;) {
      const newline = chunk.indexOf(0x0a, start)
      if (newline === -1) break
      const piece = chunk.subarray(start, newline)
      const line = pendingBytes === 0 ? piece : Buffer.concat([...pending, piece])
      pending = []
      pendingBytes = 0
      onLine(line.toString('utf8').replace(/\r$/, ''))
      start = newline + 1
    }
    if (start < chunk.length) {
      const rest = chunk.subarray(start)
      pending.push(rest)
      pendingBytes += rest.length
    }
    return pendingBytes <= maxLineBytes
  }
}

/** Starts `program` with `args` and answers a handle to it. Never throws. */
export function startFrameProcess(program: string, args: readonly string[], options: FrameProcessOptions): FrameProcess {
  const platform = options.platform ?? process.platform
  const invocation = invocationFor(program, args)
  if ('refused' in invocation) return endedBeforeStart('refused', null)
  if (options.signal?.aborted === true) return endedBeforeStart('aborted', null)

  let child: ChildProcess
  try {
    child = spawn(invocation.command, invocation.args, {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: options.env,
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      // Its own process group on macOS and Linux, so a kill reaches what it started. Never on
      // Windows, where `detached` would give the program a console window of its own.
      detached: platform !== 'win32'
    })
  } catch (error) {
    // spawn throws at once for some bad arguments, such as a variable that is not a string.
    return endedBeforeStart('start_failed', errorCode(error))
  }
  const stdin = child.stdin
  const stdout = child.stdout
  if (stdin === null || stdout === null) {
    child.kill('SIGKILL')
    return endedBeforeStart('start_failed', null)
  }

  const maxFrame = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  let cause: FrameProcessEnd | null = null
  let inputOpen = true
  let outputBytes = 0
  let exitedAt: { code: number | null; signal: NodeJS.Signals | null } | null = null
  let settled = false
  let pipeTimer: ReturnType<typeof setTimeout> | undefined
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let resolveExited!: (exit: FrameProcessExit) => void
  const exited = new Promise<FrameProcessExit>((resolve) => { resolveExited = resolve })

  const finish = (exit: FrameProcessExit): void => {
    if (settled) return
    settled = true
    clearTimeout(deadline)
    clearTimeout(pipeTimer)
    clearTimeout(graceTimer)
    options.signal?.removeEventListener('abort', onAbort)
    inputOpen = false
    stdin.destroy()
    stdout.destroy()
    resolveExited(exit)
  }

  const kill = (why: FrameProcessEnd): void => {
    if (settled) return
    cause ??= why
    inputOpen = false
    killTree(child, platform, options.env)
    // Closing the pipes means a process the program started cannot keep the run open.
    stdin.destroy()
    stdout.destroy()
  }

  const deadline = setTimeout(() => kill('timeout'), options.timeoutMs)
  const onAbort = (): void => kill('aborted')
  options.signal?.addEventListener('abort', onAbort, { once: true })

  // A program that exits while a frame is being written makes the write fail with EPIPE.
  stdin.on('error', () => { inputOpen = false })

  const split = createLineSplitter(maxFrame, (line) => {
    if (cause !== null || line.trim() === '') return
    let frame: unknown
    try {
      frame = JSON.parse(line)
    } catch {
      return
    }
    options.onFrame(frame)
  })
  stdout.on('data', (chunk: Buffer) => {
    if (cause !== null) return
    outputBytes += chunk.length
    if (!split(chunk) || outputBytes > maxOutput) kill('output_too_large')
  })
  stdout.on('error', () => undefined)

  child.on('error', (error) => {
    // A program that could not be started has no pid and no exit to wait for.
    if (child.pid === undefined) finish({ end: 'start_failed', code: null, signal: null, errorCode: errorCode(error) })
  })
  child.on('exit', (code, signal) => {
    exitedAt = { code, signal }
    // `close` follows once stdout has been read to its end. When something else holds the
    // pipe, stop waiting for it after a moment.
    pipeTimer = setTimeout(() => stdout.destroy(), PIPE_CLOSE_WAIT_MS)
  })
  child.on('close', (code, signal) => {
    const status = exitedAt ?? { code, signal }
    finish({
      end: cause ?? 'exited',
      code: cause === null ? status.code : null,
      signal: status.signal,
      errorCode: null
    })
  })

  const endInput = (): void => {
    if (!inputOpen) return
    inputOpen = false
    stdin.end()
  }

  return {
    pid: child.pid,
    exited,
    send(frame) {
      if (!inputOpen || settled) return
      stdin.write(`${JSON.stringify(frame)}\n`)
    },
    endInput,
    close(graceMs) {
      endInput()
      if (!settled && graceTimer === undefined) graceTimer = setTimeout(() => kill('close_timeout'), graceMs)
      return exited
    },
    kill() {
      kill('killed')
    }
  }
}

/** A handle for a run that never started. */
function endedBeforeStart(end: FrameProcessEnd, code: string | null): FrameProcess {
  const exit: FrameProcessExit = { end, code: null, signal: null, errorCode: code }
  const exited = Promise.resolve(exit)
  return {
    pid: undefined,
    exited,
    send: () => undefined,
    endInput: () => undefined,
    close: () => exited,
    kill: () => undefined
  }
}

/**
 * Ends the program and what it started. SIGKILL, because a program that is waiting on something
 * may ignore a polite signal.
 */
function killTree(child: ChildProcess, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): void {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const command = treeKillCommand(pid, platform, env)
  if (command === null) {
    try {
      // A negative pid is the process group the program leads (`detached` above).
      process.kill(-pid, 'SIGKILL')
      return
    } catch {
      child.kill('SIGKILL')
      return
    }
  }
  // taskkill needs the program still running to find its children, so it goes first, and the
  // program itself is ended directly when taskkill fails or leaves it running.
  const fallback = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  try {
    const taskkill = spawn(command.command, command.args, { stdio: 'ignore', shell: false, windowsHide: true, env })
    taskkill.on('error', fallback)
    taskkill.on('exit', fallback)
  } catch {
    fallback()
  }
}

function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : null
}
