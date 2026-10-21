// Preparing an extra Codex login's `CODEX_HOME` before a Codex CLI starts on it, following the
// decisions in `src/core/codex-home.ts` and `src/core/codex-account-config.ts`. The steps
// follow the original router's `prepareSharedDirectories` (`codex-registry.ts`) and `CodexHomeFiles`
// (`codex-home-files.ts`).
//
// The login's home is `loginFolder(id)`. The default home it is prepared from is `CODEX_HOME`
// of the environment the CLI was started with, or `~/.codex`. Each start:
//
// 1. creates the login's home, private to the user, when it is missing;
// 2. links every real folder of the default home into it that `codexHomeEntryAction` shares
//    (`src/platform/links.ts`), leaving a real folder or a link elsewhere at that place alone;
// 3. copies `AGENTS.md` (`codexAgentsCopy`);
// 4. merges `config.toml` (`codexConfigRefresh`).
//
// `config.toml` and `AGENTS.md` of the default home are read through a link, so a file that
// is a symlink into a dotfiles folder is still used. Only folders have to be real to be linked.
//
// Each step that fails adds a warning and the rest still run. Only a home that cannot be
// created is an error, because Codex cannot start on it. No file of the default home other
// than those two is read, and `auth.json` is never copied or linked.
import { randomBytes } from 'node:crypto'
import { constants, type Dirent } from 'node:fs'
import { open, readdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  CODEX_AGENTS_FILE,
  CODEX_CONFIG_FILE,
  CODEX_CONFIG_MERGE_ATTEMPTS,
  codexAgentsCopy,
  codexConfigRefresh,
  codexHomeEntryAction,
  codexLinkAction,
  type CodexHomeEntryKind
} from '../core/codex-home.ts'
import { isDefaultLoginId, providerOfLoginId, toLoginId } from '../data/login-id.ts'
import { loginFolder, providerFolder } from '../data/paths.ts'
import { makePrivateDirSync, PRIVATE_FILE_MODE, replaceFile, syncDirectory } from '../platform/files.ts'
import { linkFolder, pathsOf, readFolderLink } from '../platform/links.ts'

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
  await linkSharedFolders(source, home, platform, warnings)
  await copyAgents(source, home, warnings)
  await refreshConfig(source, home, warnings)
  return { codexHome: home, warnings }
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

function entryKind(entry: Dirent): CodexHomeEntryKind {
  if (entry.isSymbolicLink()) return 'symlink'
  if (entry.isDirectory()) return 'directory'
  if (entry.isFile()) return 'file'
  return 'other'
}

/** Links the folders of `source` that a login shares into `home`. A missing `source` links nothing. */
async function linkSharedFolders(source: string, home: string, platform: NodeJS.Platform, warnings: string[]): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(source, { withFileTypes: true })
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') warnings.push(`Could not list ${source} to link its folders into ${home}: ${errorText(error)}`)
    return
  }
  for (const entry of entries) {
    if (codexHomeEntryAction(entry.name, entryKind(entry)) !== 'link') continue
    const from = join(source, entry.name)
    const place = join(home, entry.name)
    try {
      const action = codexLinkAction(await readFolderLink(place, platform), from, platform)
      if (action === 'create') await linkFolder(from, place, platform)
      else if (action === 'conflict') {
        warnings.push(`${place} is a real folder or a link to somewhere else, so it was left as it is and not linked to ${from}. Move it away to share ${from} with this login.`)
      }
    } catch (error) {
      warnings.push(`Could not link ${place} to ${from}: ${errorText(error)}`)
    }
  }
}

async function copyAgents(source: string, home: string, warnings: string[]): Promise<void> {
  const from = join(source, CODEX_AGENTS_FILE)
  const target = join(home, CODEX_AGENTS_FILE)
  try {
    const text = await readText(from)
    const outcome = await writeIfUnchanged(target, (current) => codexAgentsCopy(text, current), 0o644)
    if (outcome === 'changing') warnings.push(changingWarning(target))
  } catch (error) {
    warnings.push(`Could not copy ${from} to ${target}: ${errorText(error)}`)
  }
}

async function refreshConfig(source: string, home: string, warnings: string[]): Promise<void> {
  const from = join(source, CODEX_CONFIG_FILE)
  const target = join(home, CODEX_CONFIG_FILE)
  try {
    const text = await readText(from)
    // What the last decision said, for the warnings.
    const said = { missingSecrets: false, mergeFailure: null as string | null }
    // The login's file may hold its own secrets, so it is written for the user only.
    const outcome = await writeIfUnchanged(target, (current) => {
      const refresh = codexConfigRefresh(text, current)
      said.missingSecrets = refresh.missingSecrets
      said.mergeFailure = refresh.mergeFailure
      return refresh.action === 'write' ? refresh.content : null
    }, PRIVATE_FILE_MODE)
    if (said.mergeFailure !== null) warnings.push(`Could not refresh ${target} from ${from}: ${said.mergeFailure}.`)
    if (said.missingSecrets) {
      warnings.push(`${from} has a secret, such as an MCP server's env table, that ${target} lacks. It is never copied; add it to ${target} if this login needs it.`)
    }
    if (outcome === 'changing') warnings.push(changingWarning(target))
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
