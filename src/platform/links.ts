// Linking a folder to another place, and reading back what is at a place, for the folders of
// `~/.codex` that each extra Codex login's home shares (`src/cli/codex-home-files.ts`).
//
// On macOS and Linux a link is a directory symlink. On Windows it is a directory junction,
// which any user may create without admin rights or Developer Mode. A junction needs an
// absolute target on a local volume. When Windows refuses one (a FAT or exFAT drive, a target
// on a network share), a directory symlink is tried instead, which works where Developer Mode
// is on or the user is an administrator.
//
// Node's `lstat` reports a junction as a symbolic link, and `readlink` answers its target.
// Some Node versions answer a junction's target with the `\\?\` prefix of Windows' long-path
// form (`\\?\C:\Users\...`, `\\?\UNC\server\share\...`), so the target is read back without it.
import { lstat, readlink, symlink } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { CodexLinkPlace } from '../core/codex-home.ts'

/** The path functions of `platform`: `path.win32` on Windows, `path.posix` elsewhere. */
export function pathsOf(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

/** The `type` given to `fs.symlink` for a folder link: a junction on Windows, a directory symlink elsewhere. */
export function folderLinkType(platform: NodeJS.Platform): 'junction' | 'dir' {
  return platform === 'win32' ? 'junction' : 'dir'
}

/**
 * A link target as Windows reads it back, in the form a person would write it: `\\?\C:\x`
 * and `\??\C:\x` become `C:\x`, and `\\?\UNC\server\share\x` becomes `\\server\share\x`.
 * Elsewhere the target is answered as it is.
 */
export function normaliseLinkTarget(target: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return target
  const unc = /^(?:\\\\\?\\|\\\?\?\\)UNC\\/i.exec(target)
  if (unc !== null) return `\\\\${target.slice(unc[0].length)}`
  const long = /^(?:\\\\\?\\|\\\?\?\\)(?=[a-z]:)/i.exec(target)
  if (long !== null) return target.slice(long[0].length)
  return target
}

/**
 * The absolute target of the link at `place`, from the text `readlink` answered: without the
 * long-path prefix on Windows, and a relative target taken from the folder the link is in.
 */
export function linkTargetPath(place: string, target: string, platform: NodeJS.Platform): string {
  const paths = pathsOf(platform)
  return paths.resolve(paths.dirname(place), normaliseLinkTarget(target, platform))
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * What is at `place`, without following a link there: nothing, a link (symlink or junction)
 * with its absolute target, or anything else (a real folder, a file). An error other than
 * the place not existing is thrown.
 */
export async function readFolderLink(place: string, platform: NodeJS.Platform = process.platform): Promise<CodexLinkPlace> {
  let stats
  try {
    stats = await lstat(place)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { kind: 'missing' }
    throw error
  }
  if (!stats.isSymbolicLink()) return { kind: 'other' }
  return { kind: 'link', target: linkTargetPath(place, await readlink(place), platform) }
}

/**
 * Creates a link at `place` to the folder `target`, which is made absolute first. On Windows
 * a junction is tried first and a directory symlink second; when both fail, the junction's
 * error is thrown, since that is the one a user without Developer Mode can do something about.
 * An existing entry at `place` is never replaced: that fails with EEXIST.
 */
export async function linkFolder(target: string, place: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const absolute = pathsOf(platform).resolve(target)
  if (platform !== 'win32') {
    await symlink(absolute, place, 'dir')
    return
  }
  try {
    await symlink(absolute, place, 'junction')
  } catch (error) {
    if (errorCode(error) === 'EEXIST') throw error
    try {
      await symlink(absolute, place, 'dir')
    } catch {
      throw error
    }
  }
}
