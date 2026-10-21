// The control API between the kurmis CLI and its daemon: the paths, and the JSON each one
// answers with. The daemon serves it on the proxy's port, under `/_kurmis/`. Every request
// carries the key from the `key` file in the `x-kurmis-key` header (`KEY_HEADER`); a request
// without the right key gets 403 and no body.
//
// The daemon and the CLI are written against this file, so a change here changes both. Fields
// may be added; a field is not removed or given another meaning without raising
// `CONTROL_API_VERSION`.
import type { RouteBlock } from './account-router.ts'
import type { AccountProvider } from './accounts.ts'
import type { AccountUsage } from './claude-usage.ts'
import { CONTROL_PREFIX } from './proxy-rules.ts'

/** Raised when an answer changes in a way an older CLI would misread. */
export const CONTROL_API_VERSION = 1

export const CONTROL_PATHS = {
  /** `GET`: `StatusAnswer`. */
  status: `${CONTROL_PREFIX}status`,
  /** `POST` with a `ProbeRequest`: probes the logins now and answers `StatusAnswer` when done. */
  probe: `${CONTROL_PREFIX}probe`,
  /** `POST`: reads `config.json` again. Answers `OkAnswer`. */
  reload: `${CONTROL_PREFIX}reload`,
  /**
   * `POST`: answers `OkAnswer`, then stops taking new requests and exits once the open ones
   * have finished.
   */
  stop: `${CONTROL_PREFIX}stop`
} as const

export interface OkAnswer {
  ok: true
}

/** An error answer from any control path, with a sentence a person can read. */
export interface ErrorAnswer {
  ok: false
  error: string
}

export interface ProbeRequest {
  /** The logins to probe; every signed-in login when absent. */
  logins?: string[]
}

/** One login as the daemon sees it. */
export interface LoginStatus {
  id: string
  provider: AccountProvider
  label: string
  /** Opted in to routing. */
  routing: boolean
  fiveHourLimit: number
  weeklyLimit: number
  useFirst: boolean
  /** Whether the login has credentials here; null when the daemon has not looked yet. */
  signedIn: boolean | null
  /** The latest usage snapshot, from a probe or from the headers of a forwarded answer. */
  usage: AccountUsage | null
  /**
   * When a usage-limit refusal stops the proxy using this login: milliseconds since epoch, or
   * the string `unknown` when the refusal named no reset. Null when there is no cooldown.
   */
  cooldownUntil: number | 'unknown' | null
  /** Why Auto would pass this login over now, or null when it could serve. Claude only. */
  block: RouteBlock | null
  /** Sessions whose last request this login served. Claude only. */
  sessions: number
}

export interface StatusAnswer {
  ok: true
  apiVersion: number
  /** The daemon's kurmis version. */
  version: string
  pid: number
  port: number
  /** Milliseconds since epoch. */
  startedAt: number
  /** Every login in `config.json`, the two default logins first. */
  logins: LoginStatus[]
}
