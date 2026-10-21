// The environment a Claude or Codex CLI is started with when kurmis runs it on one login for
// itself: `claude auth login|status|logout`, `codex login|logout`, and the daemon's usage probes.
// A routed Claude session gets `routedClaudeEnv` in `src/core/routed-env.ts` instead.
//
// Each function answers changes to make to an inherited environment: a string sets the
// variable, `undefined` removes it. `applyEnvPatch` applies them.
//
// Every one of them removes the variables a routed session puts in its environment, because a
// kurmis CLI or daemon may itself have been started from inside a routed session (a shell in a
// `kurmis claude` session), and a probe or a login sent through the proxy would loop back into it.
import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { LoginRef } from './login-id.ts'
import { isKurmisCodexHome } from '../core/codex-choice.ts'
import { loginFolder, ownClaudeProbeFolder, providerFolder } from './paths.ts'

export type EnvPatch = Record<string, string | undefined>

/**
 * Variables no CLI kurmis runs for itself may inherit: the routing variables, and every variable
 * that would make the CLI sign with something other than the login's own stored credentials.
 */
const NOT_INHERITED: EnvPatch = {
  ANTHROPIC_API_KEY: undefined,
  ANTHROPIC_AUTH_TOKEN: undefined,
  CLAUDE_CODE_OAUTH_TOKEN: undefined,
  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: undefined,
  ANTHROPIC_BASE_URL: undefined,
  ANTHROPIC_CUSTOM_HEADERS: undefined
}

/**
 * The variable that makes Claude Code on Windows keep its record in Credential Manager,
 * whatever its feature flag says.
 */
export const FORCE_CREDENTIAL_MANAGER_VARIABLE = 'CLAUDE_CODE_FORCE_WINDOWS_CREDMAN'

/**
 * The environment of `claude auth login`, `auth status` and `auth logout` on a login. An extra
 * login runs with its folder as the whole config folder (`CLAUDE_CONFIG_DIR`), so the CLI writes
 * the login's profile (`oauthAccount`) into that folder's `.claude.json`, and on macOS names the
 * Keychain item after the folder, exactly as a routed CLI started with
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR=<folder>` looks it up. The login plain claude uses runs with
 * both variables removed, so the CLI acts on `~/.claude` and `~/.claude.json` as usual. Naming
 * `~/.claude` instead would make the CLI look for `.claude.json` inside it.
 *
 * `forceCredentialManager` (Windows) adds `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1`. The CLI's
 * feature flag for Credential Manager is read from the config folder it runs with, and with it
 * off the CLI uses only `.credentials.json`: `auth logout` deletes the file and leaves a record
 * in Credential Manager, and `auth login` writes the file and leaves the old record, which the
 * CLI and the daemon read first. With the variable the CLI uses Credential Manager with the file
 * as fallback: `auth logout` deletes both, and `auth login` writes the record and deletes the
 * file when there was no record before (Claude Code 2.1.306, read from its bundled source).
 */
export function claudeLoginEnv(login: LoginRef, forceCredentialManager = false): EnvPatch {
  const force: EnvPatch = forceCredentialManager ? { [FORCE_CREDENTIAL_MANAGER_VARIABLE]: '1' } : {}
  if (login.usedByPlainCli) {
    return { CLAUDE_CONFIG_DIR: undefined, CLAUDE_SECURESTORAGE_CONFIG_DIR: undefined, ...NOT_INHERITED, ...force }
  }
  return { CLAUDE_CONFIG_DIR: loginFolder(login), CLAUDE_SECURESTORAGE_CONFIG_DIR: undefined, ...NOT_INHERITED, ...force }
}

/**
 * The environment of a usage probe (`get_usage`) on a login. It always sets `CLAUDE_CONFIG_DIR`,
 * because the CLI answers in well under a second against a config folder with no transcripts
 * and takes about ten seconds against the user's own, and so that the probe writes nothing into
 * `~/.claude.json`.
 *
 * For plain claude's login that moves the credentials too, so `CLAUDE_SECURESTORAGE_CONFIG_DIR` is set
 * to the empty string, which the CLI reads as "the default credentials": `~/.claude/.credentials.json`
 * and the Keychain item with the plain name. Any other value, even the path of `~/.claude`, would
 * name a hashed Keychain item no login ever wrote (`keychain-service.ts`).
 */
export function claudeProbeEnv(login: LoginRef): EnvPatch {
  if (login.usedByPlainCli) {
    return { CLAUDE_CONFIG_DIR: ownClaudeProbeFolder(), CLAUDE_SECURESTORAGE_CONFIG_DIR: '', ...NOT_INHERITED }
  }
  return claudeLoginEnv(login)
}

/**
 * The environment of `codex login`, `codex logout` and the `codex app-server` usage probe on a
 * login: `CODEX_HOME` set to the login's folder for an extra login. The login plain codex uses keeps the
 * inherited `CODEX_HOME`, unless that is an extra login's home inside kurmis' own folder: a
 * kurmis started from a shell inside a `kurmis codex` session on an extra login inherits it, and
 * would otherwise act on that login. Wrapped Codex sessions on an extra login use the folder
 * `prepareCodexHome` prepares, which is the same one.
 */
export function codexLoginEnv(login: LoginRef, inherited: Readonly<Record<string, string | undefined>> = {},
  platform: NodeJS.Platform = process.platform): EnvPatch {
  if (!login.usedByPlainCli) return { CODEX_HOME: loginFolder(login), ...NOT_INHERITED }
  const windows = platform === 'win32'
  const home = windows
    ? Object.entries(inherited).find(([name]) => name.toUpperCase() === 'CODEX_HOME')?.[1]
    : inherited['CODEX_HOME']
  return isKurmisCodexHome(home, providerFolder('codex'), windows)
    ? { CODEX_HOME: undefined, ...NOT_INHERITED }
    : { ...NOT_INHERITED }
}

/**
 * Whether a Claude CLI started with `env` and without `CLAUDE_SECURESTORAGE_CONFIG_DIR` reads
 * credentials other than those of plain claude's login, because `env` sets `CLAUDE_CONFIG_DIR`. The CLI then
 * names its Keychain item (and on Windows its Credential Manager entry) after that value, so any
 * value that is not empty is another store on macOS and Windows, the path of `~/.claude` too. On
 * Linux only the file counts, which is the same one when the folder is `~/.claude` itself
 * (Claude Code 2.1.306, read from its bundled source: `keychain-service.ts`).
 */
export function configDirHasOwnCredentials(env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform, home: string = homedir()): boolean {
  const value = env['CLAUDE_CONFIG_DIR']
  if (value === undefined || value === '') return false
  if (platform === 'darwin' || platform === 'win32') return true
  return !namesDefaultClaudeFolder(value, platform, home)
}

/**
 * Whether `value`, a `CLAUDE_CONFIG_DIR`, names the default config folder `~/.claude`. Both paths
 * are made absolute and, where they exist, have their links resolved. On macOS and Windows,
 * whose file systems usually ignore case, case is ignored too.
 */
export function namesDefaultClaudeFolder(value: string, platform: NodeJS.Platform = process.platform,
  home: string = homedir()): boolean {
  if (value === '') return false
  const real = (path: string): string => {
    const absolute = resolve(path)
    try {
      return realpathSync.native(absolute)
    } catch {
      return absolute
    }
  }
  const comparable = (path: string): string =>
    platform === 'darwin' || platform === 'win32' ? real(path).normalize('NFC').toLowerCase() : real(path)
  return comparable(value) === comparable(join(home, '.claude'))
}

/**
 * Whether `$CLAUDE_CONFIG_DIR/settings.json`, for this `value`, is the default settings file
 * `~/.claude/settings.json` through a link: the folder is another one, but its `settings.json`
 * leads to the default file (or to where it would be created). Both paths have their links
 * resolved, a link whose target does not exist yet included; case is ignored as in
 * `namesDefaultClaudeFolder`.
 */
export function sharesDefaultSettingsFile(value: string, platform: NodeJS.Platform = process.platform,
  home: string = homedir()): boolean {
  if (value === '') return false
  const comparable = (path: string): string => {
    const real = realFilePath(resolve(path))
    return platform === 'darwin' || platform === 'win32' ? real.normalize('NFC').toLowerCase() : real
  }
  return comparable(join(value, 'settings.json')) === comparable(join(home, '.claude', 'settings.json'))
}

/**
 * The path of `path` with every link resolved. A file that does not exist is its folder's real
 * path joined with its name, and a link that leads nowhere yet is followed to its target.
 */
function realFilePath(path: string, hops = 0): string {
  try {
    return realpathSync.native(path)
  } catch { /* Missing, or a link that leads nowhere yet. */ }
  if (hops < 40) {
    try {
      if (lstatSync(path).isSymbolicLink()) return realFilePath(resolve(dirname(path), readlinkSync(path)), hops + 1)
    } catch { /* The path itself does not exist. */ }
  }
  const parent = dirname(path)
  return parent === path ? path : join(realFilePath(parent, hops + 1), basename(path))
}

/**
 * `env` with `patch` applied; the input is not changed. On Windows (`windows`) names are matched
 * without regard to case, as Windows does.
 */
export function applyEnvPatch(env: Readonly<Record<string, string | undefined>>, patch: EnvPatch,
  windows = process.platform === 'win32'): Record<string, string> {
  const same = (a: string, b: string): boolean => (windows ? a.toUpperCase() === b.toUpperCase() : a === b)
  const names = Object.keys(patch)
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || names.some((other) => same(name, other))) continue
    out[name] = value
  }
  for (const [name, value] of Object.entries(patch)) {
    if (value !== undefined) out[name] = value
  }
  return out
}
