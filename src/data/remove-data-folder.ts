// Deleting the data folder for `kurmis setup --uninstall-and-logout`.
//
// Only the entries whose names kurmis gives its files and folders are deleted (`isKurmisEntry`),
// each with everything inside it. So an entry of another program or of the person's with one of
// those names is deleted too, and so is anything put inside one of kurmis' folders; an entry with
// any other name is left. When only such other entries are left, the folder stays and their names
// are answered. The files Finder and Explorer put into a folder they showed (`.DS_Store`,
// `Thumbs.db`, `desktop.ini`) do not keep the folder: they are deleted when nothing else is left,
// and are never named.
//
// Each entry goes through `removeTreeSync`, which removes a symbolic link or a junction (a Codex
// home links into `~/.codex`) without following it. On Windows it is given the data folder's real
// path as the folder it must stay inside, so an entry that is a mount point or another reparse
// point leading out of the folder is removed as a link, the entries at the top included.
//
// When the data folder is itself a link, the entries are deleted inside the folder it points
// to, that folder is removed once it is empty, and then the link is removed.
import { lstatSync, readdirSync, realpathSync, rmdirSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { kurmisHome } from './paths.ts'
import { removeTreeSync } from '../platform/remove-tree.ts'
import { retryWhileLockedSync } from '../platform/files.ts'

/** The folders kurmis creates in the data folder. */
const FOLDERS: readonly string[] = ['claude', 'codex', 'codex-merged', 'locks', 'probe', 'settings']

/**
 * The files kurmis writes in the data folder. A name that starts with one of these and a dot is
 * kurmis' too: a temporary file of an atomic write, a lock, the rotated log, a `daemon.json`
 * being removed.
 */
const FILES: readonly string[] = [
  'autostart.js', 'autostart.vbs', 'config.json', 'daemon.json', 'daemon.log', 'key', 'paused.json', 'settings-files.json', 'state.json'
]

/** The files macOS Finder and Windows Explorer write into a folder they showed, in lowercase. */
const DESKTOP_FILES: readonly string[] = ['.ds_store', 'thumbs.db', 'desktop.ini']

/** Whether a name in the data folder is one kurmis writes. */
export function isKurmisEntry(name: string): boolean {
  if (FOLDERS.includes(name) || FILES.includes(name)) return true
  // The temporary file `readOrCreateKey` links to `key`.
  if (name.startsWith('.key-')) return true
  return FILES.some((file) => name.startsWith(`${file}.`))
}

/** Whether a name is one of the files Finder or Explorer write into a folder (`.DS_Store`, `Thumbs.db`, `desktop.ini`). */
export function isDesktopFile(name: string): boolean {
  return DESKTOP_FILES.includes(name.toLowerCase())
}

export interface DataFolderRemoval {
  /** The data folder, as `kurmisHome()` names it. */
  path: string
  /** Whether the folder is gone. */
  removed: boolean
  /** The names left in it that kurmis did not write, when it is not gone, without Finder's and Explorer's files. */
  left: string[]
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Deletes kurmis' entries in the data folder, then the folder when nothing else is in it.
 * Throws the first error a deletion gives, after which the rest of the folder is left as it is.
 */
export function removeDataFolder(platform: NodeJS.Platform = process.platform): DataFolderRemoval {
  const path = kurmisHome()
  const stat = lstatOrNull(path)
  if (stat === null) return { path, removed: true, left: [] }
  const link = stat.isSymbolicLink()
  const folder = link ? realpathSync.native(path) : path
  const root = realpathSync.native(folder)
  for (const name of readdirSync(folder)) {
    if (isKurmisEntry(name)) removeTreeSync(join(folder, name), { platform, root })
  }
  const others = readdirSync(folder)
  const left = others.filter((name) => !isDesktopFile(name))
  if (left.length > 0) return { path, removed: false, left }
  for (const name of others) removeTreeSync(join(folder, name), { platform, root })
  retryWhileLockedSync(() => rmdirSync(folder), platform)
  if (link) removeTreeSync(path, { platform })
  return { path, removed: true, left: [] }
}
