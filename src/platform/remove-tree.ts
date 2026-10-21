// Deleting a folder and everything in it without ever following a link out of it. A Codex
// login's home holds symbolic links (junctions on Windows) into `~/.codex`; deleting the login
// must remove those links and leave what they point at alone.
//
// Node's `fs.rmSync(path, { recursive: true })` also removes a symbolic link without following
// it, but kurmis does not rely on that for junctions: older Node versions followed junctions
// on Windows and emptied their targets. This walk decides per entry with `lstat`, which reports
// a junction as a symbolic link, and never lists the contents of a link.
//
// How a link is removed:
// - macOS and Linux: `unlink` removes the link itself, whether it points at a file or a folder.
// - Windows: a junction or a symbolic link to a folder is a folder entry. libuv's `unlink`
//   removes it, but answers EPERM when it does not recognise the reparse point; then `rmdir`
//   (RemoveDirectoryW, without recursion) removes the link; Windows documents that it removes a
//   junction whatever its target holds, and never touches the target. A read-only file is made
//   writable first, since Windows refuses to delete it, and a file or folder another program
//   holds open is retried for about a second.
//
// On Windows a folder entry is also checked before the walk goes into it: libuv reports some
// reparse points as plain folders, such as a volume mounted into a folder (a mount point to
// `\\?\Volume{…}\`). Going into one would delete the files of that volume. So the folder's
// real path (`realpathSync.native`, which resolves every reparse point) has to be inside the
// real path of the folder being removed; a folder entry whose real path is elsewhere is removed
// as a link, with `rmdir` and without recursion.
import { chmodSync, lstatSync, readdirSync, realpathSync, rmdirSync, unlinkSync, type Stats } from 'node:fs'
import { join, win32 } from 'node:path'
import { retryWhileLockedSync } from './files.ts'

/** The file operations the walk uses, so a test can stand in for Windows. */
export interface RemoveTreeFs {
  lstatSync(path: string): Pick<Stats, 'isDirectory' | 'isSymbolicLink'>
  readdirSync(path: string): string[]
  unlinkSync(path: string): void
  rmdirSync(path: string): void
  chmodSync(path: string, mode: number): void
  /** The path with every link and reparse point resolved. Only asked on Windows. */
  realpathSync(path: string): string
}

const nodeFs: RemoveTreeFs = {
  lstatSync: (path) => lstatSync(path),
  readdirSync: (path) => readdirSync(path),
  unlinkSync: (path) => unlinkSync(path),
  rmdirSync: (path) => rmdirSync(path),
  chmodSync: (path, mode) => chmodSync(path, mode),
  realpathSync: (path) => realpathSync.native(path)
}

export interface RemoveTreeOptions {
  platform?: NodeJS.Platform
  fs?: RemoveTreeFs
  /**
   * Windows only: the real path of a folder the removal must stay inside, checked for `path`
   * itself too. Without it, the real path of `path` is that folder, so `path` itself is never
   * checked. A caller that removes the entries of a folder one by one passes that folder's real
   * path, so an entry that is a mount point is removed as a link.
   */
  root?: string
}

function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

/**
 * Removes `path` and, when it is a real folder, everything inside it. A symbolic link or
 * junction, at the top or anywhere inside, is removed as a link and its target is left as it
 * was. A missing `path` is not an error.
 */
export function removeTreeSync(path: string, options: RemoveTreeOptions = {}): void {
  removeEntry(path, options.fs ?? nodeFs, options.platform ?? process.platform, options.root ?? null)
}

/** Whether `path` is `root` or inside it, comparing Windows paths without regard to case. */
function insideWindowsFolder(path: string, root: string): boolean {
  const a = win32.normalize(path).replace(/^\\\\\?\\/, '').toLowerCase()
  const b = win32.normalize(root).replace(/^\\\\\?\\/, '').replace(/\\+$/, '').toLowerCase()
  return a === b || a.startsWith(`${b}\\`)
}

/** `root` is the real path of the folder `removeTreeSync` was asked to remove, once it is known (Windows only). */
function removeEntry(path: string, fs: RemoveTreeFs, platform: NodeJS.Platform, root: string | null): void {
  let stat
  try {
    stat = fs.lstatSync(path)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink()) {
    removeLink(path, fs, platform)
  } else if (stat.isDirectory()) {
    let inside = root
    if (platform === 'win32') {
      let real: string | null
      try {
        real = fs.realpathSync(path)
      } catch {
        real = null
      }
      if (real === null || (root !== null && !insideWindowsFolder(real, root))) {
        // A mount point or another reparse point that leads out of the folder: remove the entry
        // only. `rmdir` without recursion never touches what it leads to.
        retryWhileLockedSync(() => fs.rmdirSync(path), platform)
        return
      }
      inside = root ?? real
    }
    for (const name of fs.readdirSync(path)) removeEntry(join(path, name), fs, platform, inside)
    retryWhileLockedSync(() => fs.rmdirSync(path), platform)
  } else {
    removeFile(path, fs, platform)
  }
}

function removeLink(path: string, fs: RemoveTreeFs, platform: NodeJS.Platform): void {
  if (platform !== 'win32') {
    fs.unlinkSync(path)
    return
  }
  try {
    fs.unlinkSync(path)
  } catch (error) {
    const code = codeOf(error)
    if (code !== 'EPERM' && code !== 'EISDIR' && code !== 'EACCES' && code !== 'EBUSY') throw error
    // A link to a folder: `rmdir` without recursion removes the link, not the target.
    retryWhileLockedSync(() => fs.rmdirSync(path), platform)
  }
}

function removeFile(path: string, fs: RemoveTreeFs, platform: NodeJS.Platform): void {
  if (platform !== 'win32') {
    fs.unlinkSync(path)
    return
  }
  try {
    fs.unlinkSync(path)
  } catch (error) {
    const code = codeOf(error)
    if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw error
    // Windows will not delete a read-only file, so the flag is cleared; a file another program
    // holds open is tried again for about a second.
    if (code === 'EPERM') fs.chmodSync(path, 0o666)
    retryWhileLockedSync(() => fs.unlinkSync(path), platform)
  }
}
