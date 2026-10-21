// What the operating system that runs the tests can do, for tests that make links or start
// processes, so the same test runs on macOS, Linux and Windows.
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Links `path` to the folder `target`: a directory junction on Windows, which needs no special
 * rights, and a directory symlink elsewhere. A junction stores `target` as an absolute path.
 */
export function linkFolder(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

let symlinksWork: boolean | null = null

/**
 * Whether this process may create symlinks, found by making one. Always on macOS and Linux. On
 * Windows only with Developer Mode on or as an administrator; without it `symlink` fails with
 * EPERM. Tests of a symlink to a file, or of a dangling link, run only when this is true.
 */
export function canCreateSymlinks(): boolean {
  if (symlinksWork !== null) return symlinksWork
  const dir = mkdtempSync(join(tmpdir(), 'kurmis-symlink-probe-'))
  try {
    writeFileSync(join(dir, 'target'), '')
    symlinkSync(join(dir, 'target'), join(dir, 'link'), 'file')
    symlinksWork = true
  } catch {
    symlinksWork = false
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
  }
  return symlinksWork
}

/**
 * Names that libuv puts into a child's environment on Windows when the environment it is given
 * lacks them (`required_vars` in libuv's `src/win/process.c`), so a program started with an
 * environment of its own still finds its Windows folder and its temporary folder.
 */
const WINDOWS_ADDED_VARIABLES = new Set(['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'PATH', 'SYSTEMDRIVE', 'SYSTEMROOT',
  'TEMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'WINDIR'])

/**
 * The environment a child process reported, without what the OS or Node added that the
 * environment it was started with (`given`) did not have: `__CF_USER_TEXT_ENCODING` and other
 * `__CF` variables on macOS, and the variables of `WINDOWS_ADDED_VARIABLES` on Windows.
 */
export function withoutAddedVariables(seen: Record<string, string>, given: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform): Record<string, string> {
  const givenUpper = new Set(Object.keys(given).map((name) => name.toUpperCase()))
  return Object.fromEntries(Object.entries(seen).filter(([name]) => {
    if (name.startsWith('__CF')) return false
    if (platform !== 'win32') return true
    const upper = name.toUpperCase()
    return givenUpper.has(upper) || !WINDOWS_ADDED_VARIABLES.has(upper)
  }))
}
