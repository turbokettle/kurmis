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
//   job and ends every process in it when the session closes, and some IDE terminals do the
//   same when they close. A daemon started there ends with them, and the next `kurmis claude`
//   starts it again.
//
// Which bundle runs the daemon: the one that is running now, or `KURMIS_ENTRY` (a test hook,
// for tests that run kurmis from the source tree, where there is no bundle to start).
import { spawn } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { posix, win32 } from 'node:path'
import { posixPathFolders, windowsPathFolders } from './programs.ts'
import { refusedByGuard, withGuard } from './system-program-guard.ts'
import { envValue } from './system-programs.ts'

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
  /** Folders whose contents may be gone by the next login. `temporaryFolders(env, platform)` by default. */
  temporaryFolders?: readonly string[]
}

/**
 * The temporary folders: `os.tmpdir()`, `TMPDIR`, `TEMP` and `TMP`, and on macOS and Linux also
 * `/tmp` and `/var/folders` (macOS' per-user temporary folders), with their `/private` forms.
 */
export function temporaryFolders(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const named = ['TMPDIR', 'TEMP', 'TMP'].map((name) => (platform === 'win32' ? envValue(env, name) : env[name]))
  const fixed = platform === 'win32' ? [] : ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders']
  return [...new Set([tmpdir(), ...named, ...fixed].filter((folder): folder is string => folder !== undefined && folder !== ''))]
}

/**
 * Whether a Node at `path` may be gone by the next login: it is in one of `folders`, or in a
 * folder named `fnm_multishells`, where fnm makes a link folder for each shell and deletes it
 * later.
 */
export function isTemporaryPath(path: string, folders: readonly string[], platform: NodeJS.Platform): boolean {
  const separators = platform === 'win32' ? /[\\/]+/ : /\/+/
  const fold = (text: string): string => (platform === 'win32' ? text.toLowerCase() : text)
  if (path.split(separators).some((part) => fold(part) === 'fnm_multishells')) return true
  const join = platform === 'win32' ? '\\' : '/'
  const plain = fold(path.split(separators).join(join))
  return folders.some((folder) => {
    const root = fold(folder.split(separators).join(join)).replace(/[\\/]+$/, '')
    return root !== '' && (plain === root || plain.startsWith(root + join))
  })
}

/**
 * The Node a launchd job or a logon entry should run. `process.execPath` is the resolved path
 * on macOS, which on Homebrew names one versioned folder that an upgrade removes. So the first
 * `node` on PATH is taken instead when it resolves to the same file, since that path survives
 * upgrades; otherwise `process.execPath`. A `node` on PATH in a temporary folder, or in fnm's
 * per-shell `fnm_multishells` folder, is passed over, since it may be gone at the next login.
 * On Windows `process.execPath` is the path Node was started by, links not resolved, which under
 * fnm is in `fnm_multishells`; when it is in such a folder and its resolved path is not, the
 * resolved path is used.
 */
export function nodeForJobs(options: NodeForJobsOptions = {}): string {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const execPath = options.execPath ?? process.execPath
  const realpath = options.realpath ?? realpathSync
  const temporary = options.temporaryFolders ?? temporaryFolders(env, platform)
  let target: string
  try {
    target = realpath(execPath)
  } catch {
    return execPath
  }
  const running = isTemporaryPath(execPath, temporary, platform) && !isTemporaryPath(target, temporary, platform) ? target : execPath
  const windows = platform === 'win32'
  const folders = windows ? windowsPathFolders(envValue(env, 'PATH')) : posixPathFolders(env.PATH)
  for (const folder of folders) {
    const candidate = windows ? win32.join(folder, 'node.exe') : posix.join(folder, 'node')
    try {
      if (!statSync(candidate).isFile()) continue
    } catch {
      continue
    }
    if (isTemporaryPath(candidate, temporary, platform)) continue
    try {
      return realpath(candidate) === target ? candidate : running
    } catch {
      continue
    }
  }
  return running
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
    const guarded = refusedByGuard(start.command, start.env, start.args)
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
