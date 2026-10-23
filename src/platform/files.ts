// File operations that behave differently per OS: renaming over a file another program has
// open, flushing a folder, and file and folder permissions.
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, statSync } from 'node:fs'
import { open, rename } from 'node:fs/promises'

/**
 * Mode for a file only the user may read: `daemon.json`, and anything else that holds a
 * secret. On Windows node ignores the mode (apart from the read-only bit). There the file is
 * protected by the access list it inherits from its folder; under `%USERPROFILE%` that grants
 * access to the user, SYSTEM and Administrators only.
 */
export const PRIVATE_FILE_MODE = 0o600

/** Mode for the data folder and the login folders. Ignored on Windows, as above. */
export const PRIVATE_DIR_MODE = 0o700

/** A file mode with the group and other bits cleared; the user's own bits stay as they are. */
export function userOnlyMode(mode: number): number {
  return mode & 0o700
}

/**
 * Clears the group and other bits of an existing file's mode, so only the user may read it.
 * Answers the mode it had before when that changed it, and null when the mode already had no
 * such bits. A symbolic link's target is changed. On Windows node ignores modes (see
 * `PRIVATE_FILE_MODE`), so this does nothing there and answers null.
 */
export function restrictToUserSync(path: string, platform: NodeJS.Platform = process.platform): number | null {
  if (platform === 'win32') return null
  const mode = statSync(path).mode & 0o777
  if (userOnlyMode(mode) === mode) return null
  chmodSync(path, userOnlyMode(mode))
  return mode
}

/**
 * The codes Windows gives when a rename fails because another program has the destination
 * open: an editor, a virus scanner, a backup tool, or another kurmis process reading the file.
 */
const LOCKED_FILE_CODES: readonly string[] = ['EPERM', 'EBUSY', 'EACCES']

/** Waits between rename attempts on Windows: about 1.1 seconds in all. */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [10, 20, 40, 80, 160, 200, 200, 200, 200]

export function isLockedFileError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return LOCKED_FILE_CODES.includes(String((error as { code?: unknown }).code))
}

/** Blocks this thread for `ms` milliseconds. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Runs `operation`, and on Windows runs it again while it fails because a file is held open.
 * On macOS and Linux an open file never blocks a rename, so EPERM or EACCES there is a real
 * permission error and is thrown at once.
 */
export function retryWhileLockedSync<T>(operation: () => T, platform: NodeJS.Platform = process.platform): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return operation()
    } catch (error) {
      const delay = RENAME_RETRY_DELAYS_MS[attempt]
      if (platform !== 'win32' || delay === undefined || !isLockedFileError(error)) throw error
      sleepSync(delay)
    }
  }
}

/** The same as `retryWhileLockedSync`, without blocking the event loop while it waits. */
export async function retryWhileLocked<T>(
  operation: () => Promise<T>,
  platform: NodeJS.Platform = process.platform
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const delay = RENAME_RETRY_DELAYS_MS[attempt]
      if (platform !== 'win32' || delay === undefined || !isLockedFileError(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

/** Renames `from` over `to`, retrying on Windows while `to` is held open. */
export function replaceFileSync(from: string, to: string): void {
  retryWhileLockedSync(() => renameSync(from, to))
}

export async function replaceFile(from: string, to: string): Promise<void> {
  await retryWhileLocked(() => rename(from, to))
}

/**
 * Flushes a folder's list of files to the disk, so a rename into it survives a power loss.
 * On macOS and Linux a rename is only durable once the folder is flushed. Windows cannot open
 * a folder for this, and NTFS records renames in its journal anyway, so it does nothing there.
 * A folder that refuses the flush is left alone: the rename has happened either way.
 */
export function syncDirectorySync(dir: string): void {
  if (process.platform === 'win32') return
  let fd = -1
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch {
    // Some file systems do not support flushing a folder.
  } finally {
    if (fd >= 0) closeSync(fd)
  }
}

export async function syncDirectory(dir: string): Promise<void> {
  if (process.platform === 'win32') return
  try {
    const handle = await open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // As above.
  }
}

/**
 * Creates a folder, and its parents, that only the user can open. An existing folder keeps
 * the mode it has.
 */
export function makePrivateDirSync(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE })
}
