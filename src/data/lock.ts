// A lock file that lets one kurmis process at a time run a read-modify-write on a data file
// (`config.json`), so two CLIs that change it at the same moment do not lose each other's change.
//
// The lock is a file created with `open(path, 'wx')`, which fails when the file exists, on every
// OS. It holds the owner's pid, when it was taken, and a random token, as JSON. Whoever creates
// it holds the lock; releasing it removes the file, but only while the file still holds the
// owner's token, so a process never removes a lock that another process took over.
//
// A lock is stale, and may be removed by a waiting process, when its owner's pid is no longer
// running, or when it is older than `staleMs` (a pid can be reused by an unrelated process after
// a crash, so a running pid alone does not keep a lock forever). A file that cannot be parsed
// (its owner may have been stopped between creating it and writing it) is stale once its
// modification time is older than `staleMs`.
//
// Reading a lock, checking its owner and removing it are separate steps, and the lock can be
// replaced between them: two waiting processes could both find the same stale lock, or an owner
// could release its lock and exit after a waiter read it, so the waiter finds its pid gone and
// would remove the new lock another process had just taken. On Windows, where opening a file can
// take tens of milliseconds while a virus scanner looks at it, that happened in tests. So every
// removal of the lock, a release as well as the removal of a stale lock, holds a second lock file
// (`<path>.break`), and a waiter reads the lock again while holding it: the lock it reads then
// stays in place until it lets go of `.break`.
import { randomBytes } from 'node:crypto'
import { closeSync, openSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { isLockedFileError, makePrivateDirSync, PRIVATE_FILE_MODE, retryWhileLockedSync } from '../platform/files.ts'

/** How long `acquireFileLockSync` waits for a lock before it gives up. */
export const DEFAULT_LOCK_TIMEOUT_MS = 15_000

/**
 * A lock older than this is stale even when its pid is running. Changing `config.json` takes
 * milliseconds (at most about a second on Windows, where a rename over an open file is retried),
 * so a live owner never holds the lock this long. It is below the timeout, so a waiter always
 * gets the lock of a crashed owner whose pid was reused.
 */
export const DEFAULT_LOCK_STALE_MS = 10_000

/** The longest wait between two attempts to take the lock; each wait is random up to this. */
export const DEFAULT_LOCK_RETRY_MS = 25

export interface FileLockOptions {
  timeoutMs?: number
  staleMs?: number
  retryMs?: number
  /** Whether a pid is running. Defaults to `isProcessAlive`. */
  isAlive?: (pid: number) => boolean
  now?: () => number
  platform?: NodeJS.Platform
}

/** What a lock file says about its owner. */
export interface LockHolder {
  pid: number
  /** Milliseconds since epoch. */
  createdAt: number
}

export interface FileLock {
  path: string
  /** Removes the lock file if it is still this lock's. Safe to call twice. */
  release(): void
}

export class LockTimeoutError extends Error {
  constructor(
    readonly path: string,
    readonly holder: LockHolder | null,
    waitedMs: number
  ) {
    const who = holder === null
      ? 'Another kurmis process holds it'
      : `kurmis process ${String(holder.pid)} has held it since ${new Date(holder.createdAt).toISOString()}`
    const waited = waitedMs < 1000 ? `${String(Math.round(waitedMs))} ms` : `${String(Math.round(waitedMs / 1000))} s`
    super(
      `Could not lock ${path} within ${waited}. ${who}. ` +
        'If no other kurmis command is running, delete the file and try again.'
    )
    this.name = 'LockTimeoutError'
  }
}

/** The lock files this process holds, so taking one of them again fails at once instead of waiting. */
const heldByThisProcess = new Set<string>()

/**
 * Whether a process with this pid is running. `process.kill(pid, 0)` sends nothing and only
 * checks: ESRCH means there is no such process. EPERM means the process exists but belongs to
 * another user, which on Windows is also what a process this user may not open answers, so it
 * counts as running. `kill` is a parameter for tests.
 */
export function isProcessAlive(pid: number, kill: (pid: number, signal: 0) => unknown = (p, s) => process.kill(p, s)): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

interface LockContents extends LockHolder {
  token: string
}

/** The lock file's contents, or null when it does not hold a whole record. Throws ENOENT when it is gone. */
function readLock(path: string): LockContents | null {
  const text = readFileSync(path, 'utf8')
  try {
    const value = JSON.parse(text) as Partial<LockContents> | null
    if (value === null || typeof value !== 'object') return null
    const { pid, createdAt, token } = value
    if (typeof pid !== 'number' || typeof createdAt !== 'number' || typeof token !== 'string') return null
    return { pid, createdAt, token }
  } catch {
    return null
  }
}

/** Who holds the lock at `path`, or null when nobody does or the file says nothing usable. */
export function readLockHolder(path: string): LockHolder | null {
  try {
    const contents = readLock(path)
    return contents === null ? null : { pid: contents.pid, createdAt: contents.createdAt }
  } catch {
    return null
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

/**
 * Creates the file only if it does not exist and writes `text` into it. Returns false when it
 * exists. On Windows a file that another process is deleting cannot be created for a moment
 * (EPERM), and a file another program holds open answers EBUSY or EACCES; those count as
 * "exists, try again".
 */
function createExclusive(path: string, text: string, platform: NodeJS.Platform): boolean {
  let fd: number
  try {
    fd = openSync(path, 'wx', PRIVATE_FILE_MODE)
  } catch (error) {
    if (codeOf(error) === 'EEXIST') return false
    if (platform === 'win32' && isLockedFileError(error)) return false
    throw error
  }
  try {
    writeSync(fd, text)
  } catch (error) {
    closeSync(fd)
    rmSync(path, { force: true })
    throw error
  }
  closeSync(fd)
  return true
}

function removeFile(path: string, platform: NodeJS.Platform): void {
  retryWhileLockedSync(() => rmSync(path, { force: true }), platform)
}

/** Whether the lock as read is stale. `contents` null means the file could not be parsed. */
function isStale(path: string, contents: LockContents | null, options: Required<Pick<FileLockOptions, 'staleMs' | 'isAlive' | 'now'>>): boolean {
  if (contents === null) {
    let modified: number
    try {
      modified = statSync(path).mtimeMs
    } catch {
      return false
    }
    return options.now() - modified > options.staleMs
  }
  if (!options.isAlive(contents.pid)) return true
  return options.now() - contents.createdAt > options.staleMs
}

/**
 * Takes `<path>.break`, which every removal of the lock at `path` holds. Returns false when
 * another process holds it. A `.break` file is held for milliseconds, so one older than `staleMs`
 * was left by a process that died and is removed, for the next attempt to take.
 */
function tryTakeBreakLock(path: string, options: Required<Pick<FileLockOptions, 'staleMs' | 'now' | 'platform'>>): boolean {
  const breakPath = `${path}.break`
  if (createExclusive(breakPath, String(process.pid), options.platform)) return true
  try {
    if (options.now() - statSync(breakPath).mtimeMs > options.staleMs) removeFile(breakPath, options.platform)
  } catch {
    // Gone already.
  }
  return false
}

/** Removes the lock at `path` if it is stale, holding `<path>.break` while it reads the lock again and removes it. */
function breakIfStale(path: string, options: Required<Pick<FileLockOptions, 'staleMs' | 'isAlive' | 'now' | 'platform'>>): void {
  const breakPath = `${path}.break`
  if (!tryTakeBreakLock(path, options)) return
  try {
    let contents: LockContents | null
    try {
      contents = readLock(path)
    } catch {
      return
    }
    if (isStale(path, contents, options)) removeFile(path, options.platform)
  } finally {
    removeFile(breakPath, options.platform)
  }
}

/**
 * Takes the lock at `path`, waiting up to `timeoutMs` for its holder to release it and removing
 * it when it is stale. Throws `LockTimeoutError` when the time runs out, and an `Error` at once
 * when this process already holds it (waiting would never end).
 */
export function acquireFileLockSync(path: string, options: FileLockOptions = {}): FileLock {
  if (heldByThisProcess.has(path)) throw new Error(`${path} is already locked by this process.`)
  const settings = {
    staleMs: options.staleMs ?? DEFAULT_LOCK_STALE_MS,
    isAlive: options.isAlive ?? ((pid: number) => isProcessAlive(pid)),
    now: options.now ?? Date.now,
    platform: options.platform ?? process.platform
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const retryMs = options.retryMs ?? DEFAULT_LOCK_RETRY_MS
  const token = randomBytes(16).toString('hex')
  const started = Date.now()
  makePrivateDirSync(dirname(path))
  for (;;) {
    const contents: LockContents = { pid: process.pid, createdAt: settings.now(), token }
    if (createExclusive(path, `${JSON.stringify(contents)}\n`, settings.platform)) break
    breakIfStale(path, settings)
    const waited = Date.now() - started
    if (waited >= timeoutMs) throw new LockTimeoutError(path, readLockHolder(path), waited)
    sleepSync(Math.min(timeoutMs - waited, 1 + Math.floor(Math.random() * retryMs)))
  }
  heldByThisProcess.add(path)
  let released = false
  return {
    path,
    release() {
      if (released) return
      released = true
      heldByThisProcess.delete(path)
      // Wait for a waiter that is checking this lock to finish (see the top of this file). A
      // `.break` that cannot be taken within `timeoutMs` does not keep the lock forever.
      const waitUntil = Date.now() + timeoutMs
      let holdsBreak = tryTakeBreakLock(path, settings)
      while (!holdsBreak && Date.now() < waitUntil) {
        sleepSync(1 + Math.floor(Math.random() * retryMs))
        holdsBreak = tryTakeBreakLock(path, settings)
      }
      try {
        let current: LockContents | null
        try {
          // On Windows a waiter reading the file at this moment can make the read fail briefly.
          current = retryWhileLockedSync(() => readLock(path), settings.platform)
        } catch {
          return
        }
        if (current?.token === token) removeFile(path, settings.platform)
      } finally {
        if (holdsBreak) removeFile(`${path}.break`, settings.platform)
      }
    }
  }
}

/** Runs `work` while holding the lock at `path`, and releases it however `work` ends. */
export function withFileLockSync<T>(path: string, work: () => T, options: FileLockOptions = {}): T {
  const lock = acquireFileLockSync(path, options)
  try {
    return work()
  } finally {
    lock.release()
  }
}
