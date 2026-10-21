// Preparing an extra Codex login's `CODEX_HOME` before a Codex CLI starts on it, following the
// decisions in `src/core/codex-home.ts` and `src/core/codex-account-config.ts`. The steps
// started from the original router's `prepareSharedDirectories` (`codex-registry.ts`) and `CodexHomeFiles`
// (`codex-home-files.ts`).
//
// The login's home is `loginFolder(id)`. The default home it is prepared from is `CODEX_HOME`
// of the environment the CLI was started with, or `~/.codex`. Each start:
//
// 1. creates the login's home, private to the user, when it is missing;
// 2. removes the links kurmis made there that lead nowhere or to a folder no longer shared
//    (`codexStaleLink`), leaving the user's own links alone, and links every folder of the
//    default home into it that `codexHomeEntryAction` shares (`src/platform/links.ts`). An
//    empty real folder at that place is replaced by the link; a folder with something in it,
//    or a link elsewhere, is left alone with a warning, once;
// 3. copies `AGENTS.md` and `AGENTS.override.md` (`codexAgentsCopy`);
// 4. merges `config.toml` (`codexConfigRefresh`).
//
// What was last merged and copied is kept in `codexMergedRecordPath(id)`, outside the login's
// home: the default home's `config.toml` without secrets as last merged in (the three-way
// merge needs it), a hash of each file copied, the target of each link kurmis made or found
// in place, and the folders already warned about. A home that is empty when the start begins
// (a new login) starts from an empty record, so a record left by an earlier login of the same
// name is not used.
//
// `config.toml` and the copied files of the default home are read through a link, so a file
// that is a symlink into a dotfiles folder is still used.
//
// Each step that fails adds a warning and the rest still run. Only a home that cannot be
// created is an error, because Codex cannot start on it. No file of the default home other
// than those three is read, and `auth.json` is never copied or linked.
import { createHash, randomBytes } from 'node:crypto'
import { constants, type Dirent } from 'node:fs'
import { lstat, open, readdir, readFile, rm, rmdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  CODEX_AGENTS_FILES,
  CODEX_CONFIG_FILE,
  CODEX_CONFIG_MERGE_ATTEMPTS,
  codexAgentsCopy,
  codexConfigRefresh,
  codexHomeEntryAction,
  codexLinkAction,
  codexStaleLink,
  type CodexAgentsCopy,
  type CodexHomeEntryKind,
  type CodexLinkEnd
} from '../core/codex-home.ts'
import { formatJson, readJsonFile, writeJsonFile } from '../data/json-file.ts'
import { isDefaultLoginId, providerOfLoginId, toLoginId } from '../data/login-id.ts'
import { codexMergedRecordPath, loginFolder, providerFolder } from '../data/paths.ts'
import { makePrivateDirSync, PRIVATE_FILE_MODE, replaceFile, syncDirectory } from '../platform/files.ts'
import { linkFolder, pathsOf, readFolderLink, removeFolderLink } from '../platform/links.ts'

export interface PreparedCodexHome {
  /** The `CODEX_HOME` to start codex with, or null for `codex:default`, which keeps the inherited one. */
  codexHome: string | null
  /** Sentences about what could not be prepared, for stderr. Never a secret. */
  warnings: string[]
}

export interface PrepareCodexHomeOptions {
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

/** What kurmis last merged and copied into a login's home (`codexMergedRecordPath`). */
interface CodexMergedRecord {
  /** The default home's `config.toml` without secrets, as last merged in; null before the first merge. */
  config: string | null
  /** For each file copied in, the SHA-256 of the text kurmis last copied there. */
  copied: Record<string, string>
  /**
   * For each link in the login's home that kurmis made, or found leading where it would make
   * it, the target it leads to. Stale-link cleanup removes a link that leads nowhere into
   * another folder only when it is named here, so a link of the user's own stays.
   */
  links: Record<string, string>
  /** The folders a folder or link of the login's own keeps from being linked, already warned about. */
  conflicts: string[]
}

function emptyRecord(): CodexMergedRecord {
  return { config: null, copied: {}, links: {}, conflicts: [] }
}

/**
 * Prepares the home of the extra Codex login `id` and answers it as the `CODEX_HOME` to start
 * codex with. `codex:default` answers null and nothing is touched. Throws only when `id` is
 * not a Codex login id or the login's home cannot be created.
 */
export async function prepareCodexHome(id: string, options: PrepareCodexHomeOptions): Promise<PreparedCodexHome> {
  const login = toLoginId(id)
  if (providerOfLoginId(login) !== 'codex') throw new Error(`${login} is not a Codex login.`)
  if (isDefaultLoginId(login)) return { codexHome: null, warnings: [] }

  const platform = options.platform ?? process.platform
  const home = loginFolder(login)
  try {
    makePrivateDirSync(home)
  } catch (error) {
    throw new Error(`Could not create the Codex home of ${login} at ${home}: ${errorText(error)}`, { cause: error })
  }

  const source = codexSourceHome(options.env, platform)
  const warnings: string[] = []
  const recordPath = codexMergedRecordPath(login)
  const record = (await isEmptyFolder(home)) ? emptyRecord() : await readRecord(recordPath, warnings)
  const next: CodexMergedRecord = { config: record.config, copied: { ...record.copied }, links: {}, conflicts: [] }
  await linkSharedFolders(source, home, platform, warnings, record, next)
  for (const file of CODEX_AGENTS_FILES) await copyAgents(source, home, file, warnings, record, next)
  await refreshConfig(source, home, warnings, record, next)
  next.conflicts.sort()
  if (formatJson(next) !== formatJson(record)) {
    try {
      await writeJsonFile(recordPath, next, { mode: PRIVATE_FILE_MODE })
    } catch (error) {
      warnings.push(`Could not save what was merged into ${home} to ${recordPath}: ${errorText(error)}`)
    }
  }
  return { codexHome: home, warnings }
}

async function isEmptyFolder(folder: string): Promise<boolean> {
  try {
    return (await readdir(folder)).length === 0
  } catch {
    return false
  }
}

/** The record of a login's home; an empty one when there is none or it is damaged. */
async function readRecord(path: string, warnings: string[]): Promise<CodexMergedRecord> {
  let read
  try {
    read = await readJsonFile(path)
  } catch (error) {
    warnings.push(`Could not read ${path}, so this start merges as if nothing had been merged before: ${errorText(error)}`)
    return emptyRecord()
  }
  if (read.status !== 'ok' || read.value === null || typeof read.value !== 'object') return emptyRecord()
  const value = read.value as Record<string, unknown>
  const conflicts = value['conflicts']
  return {
    config: typeof value['config'] === 'string' ? value['config'] : null,
    copied: stringRecord(value['copied']),
    links: stringRecord(value['links']),
    conflicts: Array.isArray(conflicts) ? conflicts.filter((name): name is string => typeof name === 'string') : []
  }
}

/** The string values of an object read from JSON, by key; an empty one for anything else. */
function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * The default Codex home: `CODEX_HOME` when it is set and not empty, else `~/.codex`. A
 * `CODEX_HOME` inside kurmis' own Codex folder is an extra login's home, inherited by a
 * `kurmis codex` run from inside a session on that login. It is not used, since a login's
 * home is not the default one, and `~/.codex` is used instead.
 */
export function codexSourceHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  const fallback = join(homedir(), '.codex')
  const named = env.CODEX_HOME
  if (named === undefined || named === '') return fallback
  const home = resolve(named)
  return insideFolder(providerFolder('codex'), home, platform) ? fallback : home
}

function insideFolder(folder: string, path: string, platform: NodeJS.Platform): boolean {
  const paths = pathsOf(platform)
  const fold = (text: string): string => (platform === 'win32' ? text.toLowerCase() : text)
  const relative = paths.relative(fold(paths.resolve(folder)), fold(paths.resolve(path)))
  return relative === '' || (!relative.startsWith('..') && !paths.isAbsolute(relative))
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** What an entry of the default home is. A link is followed once, to tell a link to a folder from any other. */
async function entryKind(source: string, entry: Dirent): Promise<CodexHomeEntryKind> {
  if (entry.isSymbolicLink()) {
    try {
      return (await stat(join(source, entry.name))).isDirectory() ? 'directory-link' : 'symlink'
    } catch {
      return 'symlink'
    }
  }
  if (entry.isDirectory()) return 'directory'
  if (entry.isFile()) return 'file'
  return 'other'
}

/**
 * The names of the default home's folders a login shares. An empty list when the default
 * home does not exist; null, with a warning, when it cannot be listed, and then no link is
 * made or removed.
 */
async function sharedFolders(source: string, home: string, warnings: string[]): Promise<string[] | null> {
  let entries: Dirent[]
  try {
    entries = await readdir(source, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    warnings.push(`Could not list ${source} to link its folders into ${home}: ${errorText(error)}`)
    return null
  }
  const shared: string[] = []
  for (const entry of entries) {
    if (codexHomeEntryAction(entry.name, await entryKind(source, entry)) === 'link') shared.push(entry.name)
  }
  return shared
}

/** Links the folders of `source` that a login shares into `home`, after removing the links kurmis made that are stale. */
async function linkSharedFolders(
  source: string,
  home: string,
  platform: NodeJS.Platform,
  warnings: string[],
  record: CodexMergedRecord,
  next: CodexMergedRecord
): Promise<void> {
  const shared = await sharedFolders(source, home, warnings)
  if (shared === null) {
    next.conflicts = [...record.conflicts]
    next.links = { ...record.links }
    return
  }
  await removeStaleLinks(source, home, new Set(shared), platform, warnings, record, next)
  for (const name of shared) {
    const from = join(source, name)
    const place = join(home, name)
    try {
      if ((await placeLink(from, place, platform)) === 'linked') {
        next.links[name] = from
        continue
      }
      next.conflicts.push(name)
      if (!record.conflicts.includes(name)) {
        warnings.push(`${place} is a folder of this login's own with something in it, or a link to somewhere else, so it was left as it is and not linked to ${from}. Move it away to share ${from} with this login. This is said once.`)
      }
    } catch (error) {
      warnings.push(`Could not link ${place} to ${from}: ${errorText(error)}`)
    }
  }
}

/** What is at the end of the link at `place`. A link whose end cannot be read counts as leading to something. */
async function linkEnd(place: string): Promise<CodexLinkEnd> {
  try {
    return (await stat(place)).isDirectory() ? 'folder' : 'other'
  } catch (error) {
    const code = errorCode(error)
    return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP' ? 'nothing' : 'other'
  }
}

/**
 * Removes each link in `home` that `codexStaleLink` says kurmis made and has to go. A link the
 * record names that stays is carried into `next`, so it is still known once it leads nowhere.
 */
async function removeStaleLinks(
  source: string,
  home: string,
  shared: ReadonlySet<string>,
  platform: NodeJS.Platform,
  warnings: string[],
  record: CodexMergedRecord,
  next: CodexMergedRecord
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(home, { withFileTypes: true })
  } catch (error) {
    warnings.push(`Could not list ${home} to remove the links that lead nowhere: ${errorText(error)}`)
    return
  }
  for (const entry of entries) {
    if (entry.isFile()) continue
    const place = join(home, entry.name)
    try {
      const found = await readFolderLink(place, platform)
      if (found.kind !== 'link') continue
      const recorded = Object.hasOwn(record.links, entry.name) ? record.links[entry.name]! : null
      const link = { name: entry.name, target: found.target, end: await linkEnd(place), recorded }
      if (!codexStaleLink(link, source, shared.has(entry.name), platform)) {
        if (recorded !== null) next.links[entry.name] = recorded
        continue
      }
      try {
        await removeFolderLink(place, platform)
      } catch (error) {
        // Another start on this login removed it first.
        if (errorCode(error) !== 'ENOENT') throw error
      }
    } catch (error) {
      warnings.push(`Could not remove ${place}, a link that leads nowhere or to a folder this login no longer shares: ${errorText(error)}`)
    }
  }
}

/**
 * Makes `place` a link to `from` unless it is one: `linked` when it is in the end, `conflict`
 * when a folder with something in it or a link elsewhere is there. An empty real folder is
 * removed first (`rmdir` removes only an empty one). Another `kurmis codex` on the same login
 * may do the same at the same moment: then removing the folder fails because it is gone or is
 * the other's link already, or creating the link fails with EEXIST, and the place is read again.
 */
async function placeLink(from: string, place: string, platform: NodeJS.Platform): Promise<'linked' | 'conflict'> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const found = await readFolderLink(place, platform)
    const action = codexLinkAction(found, from, platform)
    if (action === 'linked') return 'linked'
    if (action === 'conflict') {
      if (found.kind !== 'other') return 'conflict'
      if (!(await removeEmptyFolder(place))) continue
    }
    try {
      await linkFolder(from, place, platform)
      return 'linked'
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
    }
  }
  return codexLinkAction(await readFolderLink(place, platform), from, platform) === 'linked' ? 'linked' : 'conflict'
}

/** Removes `place` when it is a real folder with nothing in it. Answers whether it did. */
async function removeEmptyFolder(place: string): Promise<boolean> {
  try {
    if (!(await lstat(place)).isDirectory()) return false
    await rmdir(place)
    return true
  } catch {
    return false
  }
}

async function copyAgents(
  source: string,
  home: string,
  file: string,
  warnings: string[],
  record: CodexMergedRecord,
  next: CodexMergedRecord
): Promise<void> {
  const from = join(source, file)
  const target = join(home, file)
  try {
    const text = await readText(from)
    const said: { decision: CodexAgentsCopy } = { decision: null }
    const outcome = await writeIfUnchanged(target, (current) => {
      said.decision = codexAgentsCopy(text, current, current !== null && record.copied[file] === sha256(current))
      return said.decision?.action === 'write' ? said.decision.content : null
    }, 0o644)
    if (outcome === 'changing') {
      warnings.push(changingWarning(target))
      return
    }
    if (said.decision?.action === 'remove') {
      const current = await readText(target)
      if (current !== null && record.copied[file] === sha256(current)) await rm(target, { force: true })
    }
    if (text === null) delete next.copied[file]
    else next.copied[file] = sha256(text)
  } catch (error) {
    warnings.push(`Could not copy ${from} to ${target}: ${errorText(error)}`)
  }
}

async function refreshConfig(source: string, home: string, warnings: string[], record: CodexMergedRecord, next: CodexMergedRecord): Promise<void> {
  const from = join(source, CODEX_CONFIG_FILE)
  const target = join(home, CODEX_CONFIG_FILE)
  try {
    const text = await readText(from)
    // What the last decision said, for the warnings and the record.
    const said = { missingSecrets: false, heldBack: [] as string[], mergeFailure: null as string | null, merged: null as string | null }
    // The login's file may hold its own secrets, so it is written for the user only.
    const outcome = await writeIfUnchanged(target, (current) => {
      const refresh = codexConfigRefresh(text, current, record.config)
      said.missingSecrets = refresh.missingSecrets
      said.heldBack = refresh.heldBack
      said.mergeFailure = refresh.mergeFailure
      said.merged = refresh.merged
      return refresh.action === 'write' ? refresh.content : null
    }, PRIVATE_FILE_MODE)
    if (said.mergeFailure !== null) warnings.push(`Could not refresh ${target} from ${from}: ${said.mergeFailure}.`)
    if (said.missingSecrets) {
      warnings.push(`${from} has a secret, such as an MCP server's env table, that ${target} lacks. It is never copied; add it to ${target} if this login needs it.`)
    }
    if (said.heldBack.length > 0) {
      warnings.push(`${from} sets ${said.heldBack.join(', ')} differently from ${target}, and a secret stands in the way, so ${target} keeps its own. Secrets are never copied; change ${target} by hand if this login needs the default home's.`)
    }
    if (outcome === 'changing') warnings.push(changingWarning(target))
    else if (said.merged !== null) next.config = said.merged
  } catch (error) {
    warnings.push(`Could not refresh ${target} from ${from}: ${errorText(error)}`)
  }
}

function changingWarning(target: string): string {
  return `${target} kept changing while kurmis refreshed it, so it was left as it is. The next start refreshes it again.`
}

/** A file as text, null when there is none. */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null
    throw error
  }
}

const TEMP_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL

/**
 * Puts `next(current)` in place at `target`, where `current` is what the file held when it was
 * read (null: no file), and `next` answers null when nothing is to be written. The new text
 * goes to a temp file beside it, which is flushed, and the file is read again right before
 * the rename. When it no longer holds `current`, something else (a Codex process) wrote it
 * meanwhile: the temp file is removed and `next` decides again from what it holds now, up to
 * `CODEX_CONFIG_MERGE_ATTEMPTS` times in all. Answers `changing` when the file changed every
 * time. A write that lands between the last read and the rename is still lost; Codex takes
 * no lock, so this is as close as kurmis can check.
 */
export async function writeIfUnchanged(
  target: string,
  next: (current: string | null) => string | null,
  mode: number
): Promise<'written' | 'unchanged' | 'changing'> {
  for (let attempt = 1; attempt <= CODEX_CONFIG_MERGE_ATTEMPTS; attempt++) {
    const current = await readText(target)
    const text = next(current)
    if (text === null) return 'unchanged'
    const temp = `${target}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`
    const handle = await open(temp, TEMP_FLAGS, mode)
    try {
      try {
        await handle.writeFile(text)
        await handle.sync()
      } finally {
        await handle.close()
      }
      if ((await readText(target)) !== current) {
        await rm(temp, { force: true })
        continue
      }
      await replaceFile(temp, target)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
    await syncDirectory(dirname(target))
    return 'written'
  }
  return 'changing'
}
