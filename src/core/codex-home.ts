// What preparing an extra Codex login's home before a start has to do, decided without
// touching the disk. The code that lists `~/.codex`, links folders and writes files calls
// these. The rules are the original router's (`prepareSharedDirectories` in
// `src/tools/claude/main/accounts/codex-registry.ts` and the refresh in `codex-home-files.ts`).
//
// An extra login's `CODEX_HOME` is `codex/<name>/` in the data folder. `codex:default` has
// none of its own and is never prepared. Before every start of `codex` on an extra login:
//
// - every real folder of `~/.codex` is linked into the login's home (a symlink on macOS, a
//   directory junction on Windows), so rollouts, skills and the like are shared, except
//   scratch folders and anything whose name says it holds a credential or a database;
// - `config.toml` is merged in without its secrets, keeping the login's own hook and folder
//   trust (`codexConfigRefresh`, and `codex-account-config.ts` for the trust rules);
// - `AGENTS.md` is copied in (`codexAgentsCopy`);
// - every other file, `auth.json` first of all, is neither copied nor linked. Each login's
//   sign-in stays in its own home.
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
import { mergeAccountConfig, sameTomlSettings, validToml } from './codex-account-config.ts'

/** The default home's file that is merged into each login's home: `codexConfigRefresh`. */
export const CODEX_CONFIG_FILE = 'config.toml'

/** The default home's file that is copied into each login's home: `codexAgentsCopy`. */
export const CODEX_AGENTS_FILE = 'AGENTS.md'

/**
 * How many times in all the `config.toml` refresh is decided and written when the login's
 * file keeps changing while it is written. After the last, the file is left as it is and the
 * start goes on.
 */
export const CODEX_CONFIG_MERGE_ATTEMPTS = 3

/**
 * Folders that stay private to each login. Both are scratch space the CLI clears and fills
 * again on its own, and `.tmp` holds a lock file that a shared folder would make every
 * login wait on.
 */
const PRIVATE_DIRS = new Set(['.tmp', 'tmp'])

/**
 * Whether a name in `~/.codex` holds a credential or a database, which a login's home never
 * shares: `auth.json`, a `secrets` folder, a keychain, a token store, a sqlite file and the
 * like. Upper and lower case are the same.
 */
export function codexPrivateName(name: string): boolean {
  return /^(?:auth\.json|\.credentials\.json|secrets(?:\..*)?|\.sandbox-secrets|\.env(?:\..*)?|vault(?:\..*)?|.*keychain.*|.*keyring.*|.*keystore.*|(?:.*[-_.])?(?:credentials?|oauth|tokens?)(?:[-_.].*)?|.*\.(?:db|sqlite|sqlite3|p12|pfx))$/i.test(name)
}

/**
 * What an entry of `~/.codex` is, as a directory listing that does not follow links says it:
 * `symlink` for a symlink or a junction, whatever it points at.
 */
export type CodexHomeEntryKind = 'directory' | 'file' | 'symlink' | 'other'

/**
 * What to do with one entry of `~/.codex` for a login's home: `link` it, `merge` it
 * (`config.toml`), `copy` it (`AGENTS.md`), or `skip` it.
 */
export type CodexHomeEntryAction = 'link' | 'merge' | 'copy' | 'skip'

/**
 * What to do with one entry of `~/.codex`. Only real folders are linked: a link in the
 * default home is not followed. The two files are matched by their exact names. The code
 * that prepares a home uses this for the folders only: it reads `config.toml` and `AGENTS.md`
 * by path, so a file that is a symlink (into a dotfiles folder, say) is still merged or copied.
 */
export function codexHomeEntryAction(name: string, kind: CodexHomeEntryKind): CodexHomeEntryAction {
  if (kind === 'directory') return PRIVATE_DIRS.has(name) || codexPrivateName(name) ? 'skip' : 'link'
  if (kind !== 'file') return 'skip'
  if (name === CODEX_CONFIG_FILE) return 'merge'
  if (name === CODEX_AGENTS_FILE) return 'copy'
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

/**
 * The text to write as the login's `AGENTS.md`, or null when nothing is to be written:
 * the default home has none (then whatever the login has stays), or the login's copy is
 * the same already. A hand edit of the login's copy is overwritten.
 */
export function codexAgentsCopy(source: string | null, current: string | null): string | null {
  if (source === null || current === source) return null
  return source
}

/** What to do with a login's `config.toml` before a start. */
export interface CodexConfigRefresh {
  /** `write`: put `content` in place. `keep`: leave the login's file as it is. */
  action: 'write' | 'keep'
  /** The text to write; null for `keep`. */
  content: string | null
  /**
   * The default home has a secret the login lacks, such as an MCP server's `env` table.
   * Worth one warning: the user has to set it up on that login if it needs it.
   */
  missingSecrets: boolean
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
 * and `current` that of the login's, each null when the file does not exist.
 *
 * - With a default file, the login's becomes `mergeAccountConfig` of the two.
 * - With no default file, the login's file stays as it is, or absent.
 * - When the login's file is not valid TOML, or the default file cannot be merged, the
 *   login's file stays as it is, and `mergeFailure` says why. A broken login file is not
 *   replaced, because it may hold the login's own secrets.
 * - A result that holds the same settings as the login's file is not written, so a file
 *   laid out by hand stays as it is.
 *
 * Never throws.
 */
export function codexConfigRefresh(source: string | null, current: string | null): CodexConfigRefresh {
  const keep = (missingSecrets: boolean, mergeFailure: string | null): CodexConfigRefresh =>
    ({ action: 'keep', content: null, missingSecrets, mergeFailure })
  if (source === null) return keep(false, null)
  if (current !== null && !validToml(current)) return keep(false, "the login's config.toml is not valid TOML, so it was left as it is")
  let merged: { content: string; missingSecrets: boolean }
  try {
    merged = mergeAccountConfig(source, current ?? '')
  } catch (error) {
    return keep(false, `the default home's config.toml could not be merged in: ${errorText(error)}`)
  }
  try {
    if (current !== null && sameTomlSettings(current, merged.content)) return keep(merged.missingSecrets, null)
  } catch (error) {
    return keep(merged.missingSecrets, `the merged config.toml could not be compared: ${errorText(error)}`)
  }
  return { action: 'write', content: merged.content, missingSecrets: merged.missingSecrets, mergeFailure: null }
}
