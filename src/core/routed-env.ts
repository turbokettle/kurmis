// The environment a routed Claude CLI is started with (`docs/architecture.md`, "How a Claude
// CLI reaches the daemon").
import { CLAUDE_DEFAULT_ACCOUNT_ID } from './accounts.ts'
import { withRouteHeaders } from './route-headers.ts'

/**
 * The retry budget a routed CLI is started with. When the daemon is replaced, a request sent in
 * between is retried. The CLI's default of ten retries gives up after about three minutes; 15 is
 * the most the CLI accepts (above that it clamps and warns), and with its backoff of about 40 s
 * each they last about six minutes.
 */
export const ROUTED_CLI_MAX_RETRIES = 15

/** The variables a routed CLI must not inherit: either would sign requests with an API key. */
export const UNROUTED_KEY_VARIABLES: readonly string[] = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']

/**
 * The variables that hand the CLI a subscription token directly (`claude setup-token` makes
 * one). A CLI with one signs its requests with that token instead of the credentials of the
 * login it was started on, and the proxy forwards a started-on login's own header when it has
 * read no token for that login, so a request could be billed to whatever account the token
 * belongs to. A routed CLI does not inherit them, and the wrapper says so once when one was set.
 */
export const OAUTH_TOKEN_VARIABLES: readonly string[] = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR']

/**
 * The variables that point a CLI at the daemon. `kurmis setup` writes these into the `env` of
 * `~/.claude/settings.json`, and the wrapper passes them in its `--settings` argument too,
 * because a variable in `settings.json` beats the process environment (docs/architecture.md).
 */
export const ROUTING_VARIABLES: readonly string[] = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS',
  'ENABLE_TOOL_SEARCH', 'CLAUDE_CODE_MAX_RETRIES']

/**
 * The routing variables the wrapper leaves as they are when the person sets them themselves (in
 * their `--settings`, the user settings file or the environment): routing works without them,
 * so the person's choice wins. `kurmis setup` does the same in `settings.json`.
 */
export const USER_OWNED_ROUTING_VARIABLES: readonly string[] = ['ENABLE_TOOL_SEARCH', 'CLAUDE_CODE_MAX_RETRIES']

/** `routed` without the variables in `names`: the CLI keeps what it would inherit for them. */
export function withoutRoutedVariables(routed: RoutedEnv, names: readonly string[]): RoutedEnv {
  const set: Record<string, string> = {}
  for (const [name, value] of Object.entries(routed.set)) if (!names.includes(name)) set[name] = value
  return { set, unset: routed.unset }
}

export interface RoutedEnvInput {
  /** The daemon's port on 127.0.0.1. */
  port: number
  /** The daemon's secret, sent as `x-kurmis-key`. */
  key: string
  /** The Claude login the CLI is pinned to with `--login` (`claude:<name>`), or null on Auto. */
  login: string | null
  /**
   * The login whose credentials the CLI is started on, sent as `x-kurmis-started-on`. For a
   * pinned CLI it is the pinned login; on Auto it is `autoStartLogin`'s choice. Null leaves the
   * header out, which the proxy reads as `claude:default`.
   */
  startedOn?: string | null
  /**
   * The folder the CLI is started on, as `CLAUDE_SECURESTORAGE_CONFIG_DIR`, when it is started on
   * a login other than `claude:default`; null for the machine's own login. It is passed to the
   * CLI as it stands, because the CLI names the login's Keychain item after exactly this string
   * (`keychainService` in `keychain-service.ts`).
   */
  secureStorageDir: string | null
  /** The `ANTHROPIC_CUSTOM_HEADERS` the CLI would inherit, whose other headers are kept. */
  inheritedCustomHeaders?: string | null
}

/**
 * The value of `CLAUDE_SECURESTORAGE_CONFIG_DIR` for a CLI started on `claude:default`. The CLI
 * reads the empty string as "the default credentials": `~/.claude/.credentials.json` and the
 * Keychain item with the plain name, which are what the daemon reads for `claude:default`,
 * whatever `CLAUDE_CONFIG_DIR` says. Without it, a CLI with `CLAUDE_CONFIG_DIR` set would read
 * the credentials in that folder, which may be another account's (`keychain-service.ts`).
 */
export const DEFAULT_SECURE_STORAGE_DIR = ''

/** Variables to set, and variables to remove, on top of the inherited environment. */
export interface RoutedEnv {
  set: Record<string, string>
  unset: string[]
}

/**
 * What a routed CLI is started with.
 *
 * - `ANTHROPIC_BASE_URL` points it at the daemon.
 * - `ANTHROPIC_CUSTOM_HEADERS` carries the key, the login when one was named, and the login
 *   the CLI was started on.
 * - `ENABLE_TOOL_SEARCH=true`: the CLI turns tool search off unless the base URL's host is
 *   exactly `api.anthropic.com`, which a loopback proxy never is, so every MCP tool schema
 *   would be sent on every turn. The CLI's own log line for this case says to set the variable
 *   if the proxy forwards `tool_reference` blocks, and the kurmis proxy forwards the body as it
 *   came apart from the account uuid.
 * - `CLAUDE_CODE_MAX_RETRIES`, see `ROUTED_CLI_MAX_RETRIES`.
 * - `CLAUDE_SECURESTORAGE_CONFIG_DIR` names the folder of the login the CLI is started on when
 *   that is not the machine's own login. On the machine's own login it is the empty string
 *   (`DEFAULT_SECURE_STORAGE_DIR`), so the CLI signs in with `claude:default`'s credentials even
 *   when `CLAUDE_CONFIG_DIR` is set, and a CLI started from inside a session on another login
 *   does not keep that login's folder.
 * - `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed: a key would sign the requests
 *   itself and no subscription would be billed.
 * - `CLAUDE_CODE_OAUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` are removed, see
 *   `OAUTH_TOKEN_VARIABLES`.
 */
export function routedClaudeEnv(input: RoutedEnvInput): RoutedEnv {
  const startedOn = input.startedOn ?? null
  if (input.login !== null && startedOn !== null && startedOn !== input.login) {
    throw new Error(`routedClaudeEnv: a CLI pinned to ${input.login} is started on that login, not on ${startedOn}`)
  }
  const set: Record<string, string> = {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(input.port)}`,
    ANTHROPIC_CUSTOM_HEADERS: withRouteHeaders(input.inheritedCustomHeaders, input.key, input.login, startedOn),
    ENABLE_TOOL_SEARCH: 'true',
    CLAUDE_CODE_MAX_RETRIES: String(ROUTED_CLI_MAX_RETRIES)
  }
  const unset = [...UNROUTED_KEY_VARIABLES, ...OAUTH_TOKEN_VARIABLES]
  const credentialsOf = startedOn ?? input.login ?? CLAUDE_DEFAULT_ACCOUNT_ID
  if (credentialsOf === CLAUDE_DEFAULT_ACCOUNT_ID) {
    set['CLAUDE_SECURESTORAGE_CONFIG_DIR'] = DEFAULT_SECURE_STORAGE_DIR
  } else {
    if (input.secureStorageDir === null || input.secureStorageDir.length === 0) {
      throw new Error(`routedClaudeEnv: login ${credentialsOf} needs its folder`)
    }
    set['CLAUDE_SECURESTORAGE_CONFIG_DIR'] = input.secureStorageDir
  }
  return { set, unset }
}

/**
 * An environment with a `RoutedEnv` applied to it. The input is not changed. On Windows
 * (`windows`), variable names are matched without regard to case, as Windows does, so an
 * inherited `Anthropic_Api_Key` is removed too and a set variable replaces any spelling of it.
 */
export function applyRoutedEnv(env: Readonly<Record<string, string | undefined>>, routed: RoutedEnv,
  windows = false): Record<string, string> {
  const same = (a: string, b: string): boolean => (windows ? a.toUpperCase() === b.toUpperCase() : a === b)
  const replaced = [...routed.unset, ...Object.keys(routed.set)]
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || replaced.some((other) => same(name, other))) continue
    out[name] = value
  }
  return { ...out, ...routed.set }
}

/**
 * The `OAUTH_TOKEN_VARIABLES` set in `env` to a value that is not empty, by the name as it is
 * spelled there. On Windows names are matched without regard to case. An empty value is left
 * out: Claude Code reads it as unset, and the wrapper's `--settings` sets both to the empty
 * string, which Claude Code puts into its own environment, so every shell in a routed session
 * inherits them empty.
 */
export function inheritedOAuthTokenVariables(env: Readonly<Record<string, string | undefined>>, windows = false): string[] {
  return Object.entries(env)
    .filter(([name, value]) => value !== undefined && value !== '' &&
      OAUTH_TOKEN_VARIABLES.some((other) => (windows ? other.toUpperCase() === name.toUpperCase() : other === name)))
    .map(([name]) => name)
}
