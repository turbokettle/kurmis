// Deleting the data folder for `kurmis setup --uninstall-and-logout`.
//
// Only the entries kurmis writes are deleted (`isKurmisEntry`), so a `KURMIS_HOME` that names a
// folder holding other files loses only kurmis' files. The folder itself is removed once it is
// empty. Each entry goes through `removeTreeSync`, which removes a symbolic link or a junction
// (a Codex home links into `~/.codex`) without following it.
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
const FILES: readonly string[] = ['autostart.js', 'autostart.vbs', 'config.json', 'daemon.json', 'daemon.log', 'key', 'paused.json', 'state.json']

/** Whether a name in the data folder is one kurmis writes. */
export function isKurmisEntry(name: string): boolean {
  if (FOLDERS.includes(name) || FILES.includes(name)) return true
  // The temporary file `readOrCreateKey` links to `key`.
  if (name.startsWith('.key-')) return true
  return FILES.some((file) => name.startsWith(`${file}.`))
}

export interface DataFolderRemoval {
  /** The data folder, as `kurmisHome()` names it. */
  path: string
  /** Whether the folder is gone. */
  removed: boolean
  /** The names left in it that kurmis did not write, when it is not gone. */
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
  for (const name of readdirSync(folder)) {
    if (isKurmisEntry(name)) removeTreeSync(join(folder, name), { platform })
  }
  const left = readdirSync(folder)
  if (left.length > 0) return { path, removed: false, left }
  retryWhileLockedSync(() => rmdirSync(folder), platform)
  if (link) removeTreeSync(path, { platform })
  return { path, removed: true, left: [] }
}
