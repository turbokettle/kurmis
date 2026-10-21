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
import { chmodSync, lstatSync, readdirSync, rmdirSync, unlinkSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { retryWhileLockedSync } from './files.ts'

/** The file operations the walk uses, so a test can stand in for Windows. */
export interface RemoveTreeFs {
  lstatSync(path: string): Pick<Stats, 'isDirectory' | 'isSymbolicLink'>
  readdirSync(path: string): string[]
  unlinkSync(path: string): void
  rmdirSync(path: string): void
  chmodSync(path: string, mode: number): void
}

const nodeFs: RemoveTreeFs = {
  lstatSync: (path) => lstatSync(path),
  readdirSync: (path) => readdirSync(path),
  unlinkSync: (path) => unlinkSync(path),
  rmdirSync: (path) => rmdirSync(path),
  chmodSync: (path, mode) => chmodSync(path, mode)
}

export interface RemoveTreeOptions {
  platform?: NodeJS.Platform
  fs?: RemoveTreeFs
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
  const fs = options.fs ?? nodeFs
  const platform = options.platform ?? process.platform
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
    for (const name of fs.readdirSync(path)) removeTreeSync(join(path, name), { fs, platform })
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
