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
// - `config.toml` is merged in without its secrets (`codexConfigRefresh`);
// - `AGENTS.md` is copied in (`codexAgentsCopy`);
// - every other file, `auth.json` first of all, is neither copied nor linked. Each login's
//   sign-in stays in its own home.
//
// A link or copy that fails is logged and the start goes on. A `config.toml` whose trust
// cannot be checked stops the start (`refuse`), because the login would otherwise run with
// trust nobody checked.
//
// Two rules for the code doing the file work, which no function here can enforce:
//
// - A Codex process can write the login's `config.toml` while it is being refreshed. Write
//   the new file next to it, check right before the rename that the file still holds what
//   was merged, and when it changed, read it and decide again, up to
//   `CODEX_CONFIG_MERGE_ATTEMPTS` times in all.
// - Removing a login's home must unlink the links first. A recursive delete that followed
//   one would delete the folder of `~/.codex` it points to.
import { resolve } from 'node:path'
import { filterAccountTrust, mergeAccountConfig, sameTomlSettings } from './codex-account-config.ts'

/** The default home's file that is merged into each login's home: `codexConfigRefresh`. */
export const CODEX_CONFIG_FILE = 'config.toml'

/** The default home's file that is copied into each login's home: `codexAgentsCopy`. */
export const CODEX_AGENTS_FILE = 'AGENTS.md'

/**
 * How many times in all the `config.toml` refresh is decided and written when the login's
 * file keeps changing while it is written. After the last, the start is refused.
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
 * default home is not followed. The two files are matched by their exact names.
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
 * own files. Targets are compared as absolute paths, ignoring case.
 */
export function codexLinkAction(place: CodexLinkPlace, source: string): 'create' | 'linked' | 'conflict' {
  if (place.kind === 'missing') return 'create'
  if (place.kind === 'link' && resolve(place.target).toLowerCase() === resolve(source).toLowerCase()) return 'linked'
  return 'conflict'
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
export type CodexConfigRefresh =
  | {
      /** `write`: put `content` in place. `keep`: the file holds the right settings already. */
      action: 'write' | 'keep'
      /** The text to write; null for `keep`. */
      content: string | null
      /**
       * The default home has a secret the login lacks, such as an MCP server's `env` table.
       * Worth one log line: the user has to set it up on that login if it needs it.
       */
      missingSecrets: boolean
      /**
       * Why the default home's file could not be merged, so that only the login's own trust
       * was checked; null when it merged or there was none. Worth one log line.
       */
      mergeFailure: string | null
    }
  | {
      /** The login's own file cannot be checked: do not start Codex on this login. */
      action: 'refuse'
      reason: string
    }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * What to do with a login's `config.toml`. `source` is the text of `~/.codex/config.toml`
 * and `current` that of the login's, each null when the file does not exist.
 *
 * - With a default file, the login's becomes `mergeAccountConfig` of the two.
 * - With no default file, or one that cannot be merged, the login keeps its own settings
 *   and only its trust is checked (`filterAccountTrust`). A login with no file of its own
 *   then gets none.
 * - A result that holds the same settings as the login's file is not written, so a file
 *   laid out by hand stays as it is.
 *
 * Never throws. No `reason` or `mergeFailure` repeats a value from either file.
 */
export function codexConfigRefresh(source: string | null, current: string | null): CodexConfigRefresh {
  try {
    let next: string | null = null
    let missingSecrets = false
    let mergeFailure: string | null = null
    if (source !== null) {
      try {
        const merged = mergeAccountConfig(source, current ?? '')
        next = merged.content
        missingSecrets = merged.missingSecrets
      } catch (error) {
        mergeFailure = errorText(error)
      }
    }
    if (next === null) {
      if (current === null) return { action: 'keep', content: null, missingSecrets, mergeFailure }
      next = filterAccountTrust(current)
    }
    if (current !== null && sameTomlSettings(current, next)) {
      return { action: 'keep', content: null, missingSecrets, mergeFailure }
    }
    return { action: 'write', content: next, missingSecrets, mergeFailure }
  } catch (error) {
    return { action: 'refuse', reason: `the hook and folder trust in the login's config.toml could not be checked: ${errorText(error)}` }
  }
}
