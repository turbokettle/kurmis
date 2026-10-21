// Starting the daemon as a process of its own that outlives the terminal it was started from,
// and finding the program and bundle to start it with.
//
// - **macOS and Linux:** the child is started with `detached: true`, which puts it in a new
//   session (`setsid`), so the terminal's hangup does not reach it, and with its standard
//   streams on `/dev/null`. The daemon writes its own log.
// - **Windows:** `detached: true` gives the child no console (`DETACHED_PROCESS`) and a process
//   group of its own, so closing the terminal window does not end it, and `windowsHide` keeps
//   any window it opens hidden. Node cannot ask for `CREATE_BREAKAWAY_FROM_JOB`, so a child
//   stays in a job object its parent is in. Windows' OpenSSH server puts each session in such a
//   job and ends every process in it when the session closes, detached ones included. So from
//   an ssh session the daemon is created through WMI instead (`Win32_Process.Create`, run by
//   PowerShell): WMI's own host process is its parent and it is in no job of the session.
//   Measured with the original router on Windows 10: such a process outlives the ssh session. Terminals
//   that put their children in a kill-on-close job (some IDE terminals) are not detected; a
//   daemon started from one ends with it, and the next kurmis command starts it again.
//
// Which bundle runs the daemon: the one that is running now, or `KURMIS_ENTRY` (a test hook,
// for tests that run kurmis from the source tree, where there is no bundle to start).
import { spawn } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { runProgram, type RunResult } from './run.ts'
import { refusedByGuard, withGuard } from './system-program-guard.ts'

/** The test hook naming the bundle a daemon is started from. */
export const ENTRY_VARIABLE = 'KURMIS_ENTRY'

export interface EntryOptions {
  env?: NodeJS.ProcessEnv
  /** The running module's file; `__filename` in the bundle. */
  moduleFile?: string | null
}

/** This module's file when it runs from the bundle (`dist/kurmis.cjs`), or null from source. */
function bundleFile(): string | null {
  // `__filename` exists in the CommonJS bundle. Run from source under vitest it names a `.ts`
  // file, which cannot be started with node.
  const file = typeof __filename === 'string' ? __filename : null
  return file !== null && /\.c?js$/i.test(file) ? file : null
}

/**
 * The bundle a daemon is started from: `KURMIS_ENTRY` when it is set, otherwise the bundle that
 * is running, with symlinks resolved (npm links `kurmis` on PATH to it). Null when kurmis runs
 * from the source tree and no `KURMIS_ENTRY` is set.
 */
export function kurmisEntry(options: EntryOptions = {}): string | null {
  const env = options.env ?? process.env
  const named = env[ENTRY_VARIABLE]
  if (named !== undefined && named !== '') return named
  const file = options.moduleFile === undefined ? bundleFile() : options.moduleFile
  if (file === null) return null
  try {
    return realpathSync(file)
  } catch {
    return file
  }
}

export interface NodeForJobsOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** The Node running now. Defaults to `process.execPath`. */
  execPath?: string
  /** Resolves a path's symlinks; `realpathSync` by default. */
  realpath?: (path: string) => string
}

/**
 * The Node a launchd job or a logon entry should run. `process.execPath` is the resolved path,
 * which on Homebrew names one versioned folder that an upgrade removes. So the first `node` on
 * PATH is taken instead when it resolves to the same file, since that path survives upgrades;
 * otherwise `process.execPath`.
 */
export function nodeForJobs(options: NodeForJobsOptions = {}): string {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const execPath = options.execPath ?? process.execPath
  const realpath = options.realpath ?? realpathSync
  let target: string
  try {
    target = realpath(execPath)
  } catch {
    return execPath
  }
  const name = platform === 'win32' ? 'node.exe' : 'node'
  const pathValue = (platform === 'win32' ? env.Path ?? env.PATH : env.PATH) ?? ''
  const separator = platform === 'win32' ? ';' : delimiter
  for (const folder of pathValue.split(separator)) {
    if (folder === '') continue
    const candidate = platform === 'win32' ? `${folder.replace(/[\\/]+$/, '')}\\${name}` : join(folder, name)
    try {
      if (!statSync(candidate).isFile()) continue
      return realpath(candidate) === target ? candidate : execPath
    } catch {
      continue
    }
  }
  return execPath
}

/** Whether this process runs in an ssh session: the ssh server sets these, and children inherit them. */
export function inSshSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY)
}

export interface DetachedStart {
  command: string
  args: readonly string[]
  env: NodeJS.ProcessEnv
  cwd?: string
}

export interface DetachedChild {
  pid: number
  /** Resolves with the exit code (null after a signal) if the child exits while this process runs. */
  exited: Promise<number | null>
}

/**
 * Starts a program detached from this process and its terminal, with no shell and its standard
 * streams ignored, and lets this process exit without waiting for it. Throws when it could not
 * be started.
 */
export function spawnDetached(start: DetachedStart): Promise<DetachedChild> {
  return new Promise((resolve, reject) => {
    const guarded = refusedByGuard(start.command, start.env)
    if (guarded !== null) {
      reject(new Error(guarded))
      return
    }
    const child = spawn(start.command, [...start.args], {
      detached: true,
      stdio: 'ignore',
      env: withGuard(start.env),
      cwd: start.cwd,
      shell: false,
      windowsHide: true
    })
    const exited = new Promise<number | null>((done) => {
      child.once('exit', (code) => done(code))
    })
    child.once('error', (error) => {
      if (child.pid === undefined) reject(error)
    })
    child.once('spawn', () => {
      child.unref()
      if (child.pid === undefined) reject(new Error(`${start.command} could not be started`))
      else resolve({ pid: child.pid, exited })
    })
  })
}

/**
 * One Windows command line from an argument list, quoted the way the Microsoft C runtime (and
 * so Node) splits it again: an argument with a space, tab or quote, or an empty one, is put in
 * quotes, a quote in it is escaped with a backslash, and backslashes before a quote are doubled.
 */
export function windowsCommandLine(argv: readonly string[]): string {
  return argv.map(quoteWindowsArgument).join(' ')
}

function quoteWindowsArgument(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg
  let out = '"'
  let backslashes = 0
  for (const char of arg) {
    if (char === '\\') {
      backslashes++
      continue
    }
    if (char === '"') out += '\\'.repeat(backslashes * 2 + 1) + '"'
    else out += '\\'.repeat(backslashes) + char
    backslashes = 0
  }
  return `${out}${'\\'.repeat(backslashes * 2)}"`
}

/** A PowerShell single-quoted string: a quote inside is doubled. */
export function powerShellQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

/**
 * The PowerShell script that creates `argv` in `cwd` through WMI and prints `pid <n>`. WMI's
 * `ReturnValue` is not 0 when it refused: 2 access denied, 9 path not found, and so on. Every
 * value is in a single-quoted PowerShell string, so nothing in a path is run.
 */
export function wmiCreateScript(argv: readonly string[], cwd: string): string {
  return [
    "$ProgressPreference='SilentlyContinue'",
    "$ErrorActionPreference='Stop'",
    `$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=${powerShellQuote(windowsCommandLine(argv))};` +
      `CurrentDirectory=${powerShellQuote(cwd)}}`,
    'if($r.ReturnValue -ne 0){[Console]::Error.WriteLine("Win32_Process.Create answered $($r.ReturnValue)");exit 1}',
    "[Console]::Out.WriteLine('pid '+$r.ProcessId)"
  ].join('\n')
}

/** `powershell.exe` in the Windows folder, and the arguments that run `script` without a profile. */
export function powerShellInvocation(script: string, env: NodeJS.ProcessEnv): { program: string; args: string[] } {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
  return {
    program: `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
  }
}

/** Reads what `wmiCreateScript` printed: the new process's pid. Throws for anything else. */
export function parseWmiCreateAnswer(result: RunResult): number {
  const match = /^pid ([1-9]\d*)$/m.exec(result.stdout.trim())
  if (result.code === 0 && match !== null) return Number(match[1])
  const said = (result.error ?? result.stderr.trim()) || result.stdout.trim() || `exit ${String(result.code)}`
  throw new Error(`WMI did not create the process: ${said}`)
}

export type ProgramRunner = typeof runProgram

/**
 * Creates `argv` through WMI (Windows only), outside the job object of an ssh session, and
 * answers its pid. The process gets the user's own environment from Windows, not this one's,
 * so whatever it needs from here has to be in `argv`.
 */
export async function createThroughWmi(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv,
  run: ProgramRunner = runProgram): Promise<number> {
  const { program, args } = powerShellInvocation(wmiCreateScript(argv, cwd), env)
  return parseWmiCreateAnswer(await run(program, args, { timeoutMs: 60_000, env }))
}
