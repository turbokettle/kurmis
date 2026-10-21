// What preparing an extra Codex login's home before a start has to do, decided without
// touching the disk. The code that lists `~/.codex`, links folders and writes files calls
// these. The rules started from the original router's (`prepareSharedDirectories` in
// `src/tools/claude/main/accounts/codex-registry.ts` and the refresh in `codex-home-files.ts`).
//
// An extra login's `CODEX_HOME` is `codex/<name>/` in the data folder. `codex:default` has
// none of its own and is never prepared. Before every start of `codex` on an extra login:
//
// - every folder of `~/.codex` is linked into the login's home (a symlink on macOS, a
//   directory junction on Windows), so rollouts, skills and the like are shared, except
//   scratch folders, the Windows sandbox's folders, and anything whose name says it holds a
//   credential or a database. A link in `~/.codex` that leads to a folder counts as a folder.
// - a link kurmis made that leads nowhere any more, or to a folder that is no longer shared,
//   is removed (`codexStaleLink`, which uses the links kurmis recorded to tell its own
//   from the user's);
// - `config.toml` is merged in three ways without its secrets (`codexConfigRefresh`, and
//   `codex-account-config.ts` for the rules);
// - `AGENTS.md` and `AGENTS.override.md` are copied in, and a copy kurmis made is removed
//   when the default home no longer has the file (`codexAgentsCopy`);
// - every other file, `auth.json` first of all, is neither copied nor linked. Each login's
//   sign-in stays in its own home.
//
// What kurmis last merged and copied into a login's home is kept outside it, in
// `codex-merged/<name>.json` in the data folder (`src/cli/codex-home-files.ts`).
//
// A link, copy or merge that fails is reported and the start goes on. the original router refuses the
// start when the login's own `config.toml` cannot be checked for trust; kurmis keeps the
// login's own trust, so there is nothing to check and nothing to refuse.
//
// Two rules for the code doing the file work, which no function here can enforce:
//
// - A Codex process can write the login's `config.toml` while it is being refreshed. Write
//   the new file next to it, check right before the rename that the file still holds what
//   was merged, and when it changed, read it and decide again, up to
//   `CODEX_CONFIG_MERGE_ATTEMPTS` times in all.
// - Removing a login's home must unlink the links first. A recursive delete that followed
//   one would delete the folder of `~/.codex` it points to.
import { posix, win32 } from 'node:path'
import { mergeAccountConfig, sameTomlSettings, validToml, type AccountConfigMerge } from './codex-account-config.ts'

/** The default home's file that is merged into each login's home: `codexConfigRefresh`. */
export const CODEX_CONFIG_FILE = 'config.toml'

/**
 * The default home's files that are copied into each login's home: `codexAgentsCopy`. Codex
 * reads `AGENTS.override.md` instead of `AGENTS.md` when both are there.
 */
export const CODEX_AGENTS_FILES: readonly string[] = ['AGENTS.md', 'AGENTS.override.md']

/**
 * How many times in all the `config.toml` refresh is decided and written when the login's
 * file keeps changing while it is written. After the last, the file is left as it is and the
 * start goes on.
 */
export const CODEX_CONFIG_MERGE_ATTEMPTS = 3

/**
 * Folders that stay private to each login. `tmp` and `.tmp` are scratch space the CLI clears
 * and fills again on its own, and `.tmp` holds a lock file that a shared folder would make
 * every login wait on.
 */
const PRIVATE_DIRS = new Set(['.tmp', 'tmp'])

/**
 * The Windows sandbox's folders (`.sandbox`, `.sandbox-bin`, `.sandbox-secrets`, and any
 * other `.sandbox` folder a later Codex adds) stay private to each login. Codex's
 * `windows-sandbox-rs` keeps a setup marker in `.sandbox` that is only valid together with
 * the sandbox users' passwords in `.sandbox-secrets`, and its sandbox service refuses a
 * `CODEX_HOME` whose `.sandbox` folders are links. Upper and lower case are the same.
 */
function sandboxFolder(name: string): boolean {
  return /^\.sandbox(?:[-_.].*)?$/i.test(name)
}

/**
 * Whether a name in `~/.codex` holds a credential or a database, which a login's home never
 * shares: `auth.json`, a `secrets` folder, a keychain, a token store, a sqlite file and the
 * like. Upper and lower case are the same.
 */
export function codexPrivateName(name: string): boolean {
  return /^(?:auth\.json|\.credentials\.json|secrets(?:\..*)?|\.env(?:\..*)?|vault(?:\..*)?|.*keychain.*|.*keyring.*|.*keystore.*|(?:.*[-_.])?(?:credentials?|oauth|tokens?)(?:[-_.].*)?|.*\.(?:db|sqlite|sqlite3|p12|pfx))$/i.test(name)
}

/**
 * What an entry of `~/.codex` is. `directory` is a real folder, `directory-link` a symlink or
 * junction that leads to a folder, and `symlink` any other link (one that leads to a file or
 * nowhere).
 */
export type CodexHomeEntryKind = 'directory' | 'directory-link' | 'file' | 'symlink' | 'other'

/**
 * What to do with one entry of `~/.codex` for a login's home: `link` it, `merge` it
 * (`config.toml`), `copy` it (`AGENTS.md`, `AGENTS.override.md`), or `skip` it.
 */
export type CodexHomeEntryAction = 'link' | 'merge' | 'copy' | 'skip'

/**
 * What to do with one entry of `~/.codex`. A folder is linked, and so is a link that leads to
 * a folder (into a dotfiles folder, say): the login's link then leads to the link in
 * `~/.codex`, so it follows when that link changes. The files are matched by their exact
 * names. The code that prepares a home uses this for the folders only: it reads the files by
 * path, so a file that is a symlink is still merged or copied.
 */
export function codexHomeEntryAction(name: string, kind: CodexHomeEntryKind): CodexHomeEntryAction {
  if (kind === 'directory' || kind === 'directory-link') return PRIVATE_DIRS.has(name) || sandboxFolder(name) || codexPrivateName(name) ? 'skip' : 'link'
  if (kind !== 'file') return 'skip'
  if (name === CODEX_CONFIG_FILE) return 'merge'
  if (CODEX_AGENTS_FILES.includes(name)) return 'copy'
  return 'skip'
}

/** What is at the place in the login's home where a folder of `~/.codex` is to be linked. */
export type CodexLinkPlace =
  | { kind: 'missing' }
  /** A symlink or junction, with the target it reads back. */
  | { kind: 'link'; target: string }
  /** A real folder, a file, or anything else. */
  | { kind: 'other' }

/**
 * What to do at one link's place: `create` the link, leave it because it is `linked` to
 * `source` already, or leave it because it is a `conflict` (a real folder, or a link that
 * points elsewhere), which is logged. A conflict is never replaced: it may hold the login's
 * own files.
 *
 * Targets are compared as absolute paths of `platform`. On Windows that is with `path.win32`
 * and ignoring case, as Windows does; on macOS and Linux exactly. A link kurmis made reads
 * back with the same spelling it was given, so an exact comparison finds it.
 */
export function codexLinkAction(
  place: CodexLinkPlace,
  source: string,
  platform: NodeJS.Platform = process.platform
): 'create' | 'linked' | 'conflict' {
  if (place.kind === 'missing') return 'create'
  if (place.kind === 'link' && sameFolderPath(place.target, source, platform)) return 'linked'
  return 'conflict'
}

function sameFolderPath(a: string, b: string, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return posix.resolve(a) === posix.resolve(b)
  return win32.resolve(a).toLowerCase() === win32.resolve(b).toLowerCase()
}

/** What is at the end of a link in the login's home: nothing, a folder, or something else (a file). */
export type CodexLinkEnd = 'nothing' | 'folder' | 'other'

/** A link found in the login's home. */
export interface CodexHomeLink {
  /** Its name in the login's home. */
  name: string
  /** The target it reads back. */
  target: string
  /** What is at its end. */
  end: CodexLinkEnd
  /** The target kurmis recorded when it made or last found this link, or null when the record has none. */
  recorded: string | null
}

/**
 * Whether a link in the login's home is one kurmis made that has to go. Kurmis links only
 * folders, each to the place of the same name in the default home, and records each link.
 *
 * - A link to the place of the same name in the current default home goes when that place is
 *   no longer a folder the login shares (`shared` false: gone, private now, such as a
 *   `.sandbox` folder an earlier kurmis linked, or no longer a folder). A link that leads to a
 *   file there is left alone unless the record names it, since kurmis never made one.
 * - A link to anywhere else goes only when it leads nowhere and the record names it with this
 *   target: a link into a default home used before, which is gone.
 *
 * Any other link is left alone, since it is the user's own: one to a file, or one into a
 * volume that is not mounted now.
 */
export function codexStaleLink(link: CodexHomeLink, source: string, shared: boolean, platform: NodeJS.Platform = process.platform): boolean {
  const paths = platform === 'win32' ? win32 : posix
  const recorded = link.recorded !== null && sameFolderPath(link.target, link.recorded, platform)
  if (sameFolderPath(link.target, paths.join(source, link.name), platform)) return !shared && (link.end !== 'other' || recorded)
  return link.end === 'nothing' && recorded
}

/** What to do with the login's copy of `AGENTS.md` or `AGENTS.override.md`. */
export type CodexAgentsCopy = { action: 'write'; content: string } | { action: 'remove' } | null

/**
 * What to do with the login's copy of one of `CODEX_AGENTS_FILES`. `source` is the default
 * home's file and `current` the login's, each null when there is none. `copiedBefore` says
 * that `current` is what kurmis copied there last.
 *
 * - The default home's file is copied when the login's differs. A hand edit of the login's
 *   copy is overwritten.
 * - When the default home has none, a copy kurmis made is removed, so a removed
 *   `AGENTS.override.md` no longer overrides the login's instructions. A file kurmis did
 *   not put there stays.
 * - Otherwise nothing is done (null).
 */
export function codexAgentsCopy(source: string | null, current: string | null, copiedBefore: boolean): CodexAgentsCopy {
  if (source !== null) return current === source ? null : { action: 'write', content: source }
  return current !== null && copiedBefore ? { action: 'remove' } : null
}

/** What to do with a login's `config.toml` before a start. */
export interface CodexConfigRefresh {
  /** `write`: put `content` in place. `keep`: leave the login's file as it is. */
  action: 'write' | 'keep'
  /** The text to write; null for `keep`. */
  content: string | null
  /**
   * The default home's settings without secrets, as merged in this time: the new last merged
   * copy, to be kept once the login's file holds the merge (it was written, or `keep` because
   * it held it already). Null when nothing was merged, and then the last merged copy stays
   * as it was. '' when the default home has no `config.toml` and there is no last merged copy.
   */
  merged: string | null
  /**
   * The default home has a secret the login lacks, such as an MCP server's `env` table.
   * Worth one warning: the user has to set it up on that login if it needs it.
   */
  missingSecrets: boolean
  /**
   * Settings, as dotted paths, that were not taken from the default home because a secret
   * stands in the way (`mergeAccountConfig`). Worth one warning. Never holds a value.
   */
  heldBack: string[]
  /**
   * Why the two files could not be merged, so that the login's file was left as it is; null
   * when they merged or there was nothing to merge. Worth one warning. Never repeats a value
   * from either file.
   */
  mergeFailure: string | null
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * What to do with a login's `config.toml`. `source` is the text of `~/.codex/config.toml`
 * and `current` that of the login's, each null when the file does not exist. `lastMerged`
 * is the `merged` text of the last refresh that reached the login's file, or null when
 * there is none (a new login, or the first refresh since kurmis kept one).
 *
 * - With a default file, the login's becomes the three-way `mergeAccountConfig` of the three.
 * - With no default file, the login's file stays as it is, or absent, and so does the last
 *   merged copy. A default home that has no `config.toml` for a moment (it is being
 *   replaced, or `CODEX_HOME` named another folder for one start) removes nothing. When
 *   there is no last merged copy yet (a new login, made before the user had a
 *   `config.toml`), an empty one is answered as `merged`: without it, the first merge after
 *   the file appears would count every setting Codex wrote into the login's file as merged in
 *   before and remove what the default home lacks.
 * - When the login's file is not valid TOML, or the default file cannot be merged, the
 *   login's file stays as it is, and `mergeFailure` says why. A broken login file is not
 *   replaced, because it may hold the login's own secrets.
 * - A result that holds the same settings as the login's file is not written, so a file
 *   laid out by hand stays as it is.
 *
 * Never throws.
 */
export function codexConfigRefresh(source: string | null, current: string | null, lastMerged: string | null): CodexConfigRefresh {
  const keep = (merged: string | null, missingSecrets: boolean, heldBack: string[], mergeFailure: string | null): CodexConfigRefresh =>
    ({ action: 'keep', content: null, merged, missingSecrets, heldBack, mergeFailure })
  // With no default file and no last merged copy yet, an empty copy is recorded, so that the
  // first merge once the file appears treats every setting of the login as its own.
  if (source === null) return keep(lastMerged === null ? '' : null, false, [], null)
  if (current !== null && !validToml(current)) return keep(null, false, [], "the login's config.toml is not valid TOML, so it was left as it is")
  let merge: AccountConfigMerge
  try {
    merge = mergeAccountConfig(source, current ?? '', lastMerged)
  } catch (error) {
    return keep(null, false, [], `the default home's config.toml could not be merged in: ${errorText(error)}`)
  }
  try {
    if (current !== null && sameTomlSettings(current, merge.content)) return keep(merge.merged, merge.missingSecrets, merge.heldBack, null)
  } catch (error) {
    return keep(null, merge.missingSecrets, merge.heldBack, `the merged config.toml could not be compared: ${errorText(error)}`)
  }
  return { action: 'write', content: merge.content, merged: merge.merged, missingSecrets: merge.missingSecrets, heldBack: merge.heldBack, mergeFailure: null }
}
