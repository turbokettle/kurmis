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
import { CLAUDE_DEFAULT_ACCOUNT_ID, CODEX_DEFAULT_ACCOUNT_ID } from '../core/accounts.ts'
import { claudeDefaultProbeFolder, loginFolder } from './paths.ts'

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
 * The environment of `claude auth login`, `auth status` and `auth logout` on a login. An extra
 * login runs with its folder as the whole config folder (`CLAUDE_CONFIG_DIR`), so the CLI writes
 * the login's profile (`oauthAccount`) into that folder's `.claude.json`, and on macOS names the
 * Keychain item after the folder, exactly as a routed CLI started with
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR=<folder>` looks it up. `claude:default` runs with both
 * variables removed, so the CLI acts on `~/.claude` and `~/.claude.json` as usual. Naming
 * `~/.claude` instead would make the CLI look for `.claude.json` inside it.
 */
export function claudeLoginEnv(id: string): EnvPatch {
  if (id === CLAUDE_DEFAULT_ACCOUNT_ID) {
    return { CLAUDE_CONFIG_DIR: undefined, CLAUDE_SECURESTORAGE_CONFIG_DIR: undefined, ...NOT_INHERITED }
  }
  return { CLAUDE_CONFIG_DIR: loginFolder(id), CLAUDE_SECURESTORAGE_CONFIG_DIR: undefined, ...NOT_INHERITED }
}

/**
 * The environment of a usage probe (`get_usage`) on a login. It always sets `CLAUDE_CONFIG_DIR`,
 * because the CLI answers in well under a second against a config folder with no transcripts
 * and takes about ten seconds against the user's own, and so that the probe writes nothing into
 * `~/.claude.json`.
 *
 * For `claude:default` that moves the credentials too, so `CLAUDE_SECURESTORAGE_CONFIG_DIR` is set
 * to the empty string, which the CLI reads as "the default credentials": `~/.claude/.credentials.json`
 * and the Keychain item with the plain name. Any other value, even the path of `~/.claude`, would
 * name a hashed Keychain item no login ever wrote (`keychain-service.ts`).
 */
export function claudeProbeEnv(id: string): EnvPatch {
  if (id === CLAUDE_DEFAULT_ACCOUNT_ID) {
    return { CLAUDE_CONFIG_DIR: claudeDefaultProbeFolder(), CLAUDE_SECURESTORAGE_CONFIG_DIR: '', ...NOT_INHERITED }
  }
  return claudeLoginEnv(id)
}

/**
 * The environment of `codex login`, `codex logout` and the `codex app-server` usage probe on a
 * login: `CODEX_HOME` set to the login's folder for an extra login, and left as inherited for
 * `codex:default`. Wrapped Codex sessions on an extra login use the folder `prepareCodexHome`
 * prepares, which is the same one.
 */
export function codexLoginEnv(id: string): EnvPatch {
  if (id === CODEX_DEFAULT_ACCOUNT_ID) return { ...NOT_INHERITED }
  return { CODEX_HOME: loginFolder(id), ...NOT_INHERITED }
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
