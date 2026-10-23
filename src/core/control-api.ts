// The control API between the kurmis CLI and its daemon: the paths, and the JSON each one
// answers with. The daemon serves it on the proxy's port, under `/_kurmis/`. Every request
// carries the key from the `key` file in the `x-kurmis-key` header (`KEY_HEADER`); a request
// without the right key gets 403 and no body.
//
// The daemon and the CLI are written against this file, so a change here changes both. Fields
// may be added; a field is not removed or given another meaning without raising
// `CONTROL_API_VERSION`.
import type { RouteBlock } from './account-router.ts'
import type { AccountUsage } from './claude-usage.ts'
import { CONTROL_PREFIX } from './proxy-rules.ts'

/** Raised when an answer changes in a way an older CLI would misread. */
export const CONTROL_API_VERSION = 4

export const CONTROL_PATHS = {
  /** `GET`: `StatusAnswer`. */
  status: `${CONTROL_PREFIX}status`,
  /** `POST` with a `ProbeRequest`: probes the logins now and answers `StatusAnswer` when done. */
  probe: `${CONTROL_PREFIX}probe`,
  /** `POST`: reads `config.json` again. Answers `OkAnswer`. */
  reload: `${CONTROL_PREFIX}reload`,
  /**
   * `POST` with an optional `StopRequest` (no body is the same as `{}`): answers `OkAnswer`,
   * then stops taking new requests and exits once the open ones have finished.
   */
  stop: `${CONTROL_PREFIX}stop`
} as const

/**
 * The largest body a control request may have; a probe request names a few login ids. A larger
 * one is answered 413 with an `ErrorAnswer`.
 */
export const MAX_CONTROL_BODY_BYTES = 64 * 1024

export interface OkAnswer {
  ok: true
}

/** An error answer from any control path, with a sentence a person can read. */
export interface ErrorAnswer {
  ok: false
  error: string
}

/**
 * The body of a `stop` request. A daemon older than a field ignores it, so a client must not
 * rely on it being honoured.
 */
export interface StopRequest {
  /**
   * The longest the daemon waits for its open proxied requests before it stops without them,
   * in milliseconds from the moment it answered. Without it the daemon waits up to its own cap
   * (15 minutes). `kurmis daemon stop` sends its own deadline here, because once the daemon has
   * answered it no longer listens on its port and cannot be sent a second request.
   */
  maxWaitMs?: number
}

export interface ProbeRequest {
  /** The logins to probe; every signed-in login when absent. */
  logins?: string[]
}

/** One login as the daemon sees it. */
export interface LoginStatus {
  id: string
  /** The name the person sees and types for the login (`alias` in `config.json`). */
  alias: string
  /** The login plain claude uses, which follows what that CLI is signed in to. */
  usedByPlainClaude: boolean
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
  /** Why Auto would pass this login over now, or null when it could serve. */
  block: RouteBlock | null
  /** Sessions whose last request this login served. */
  sessions: number
  /**
   * The login's email, or null when none is known, from the profile its own CLI runs cached
   * (`ClaudeIdentityReader`). For the person's own terminal; never logged or stored.
   */
  email: string | null
  /**
   * The login's organization uuid from the same profile as its email, or null when none is
   * recorded. With the email it tells whether two logins are the
   * same account (`isSameClaudeAccount` in `src/data/identity.ts`).
   */
  organizationUuid: string | null
  /** A usage probe of this login is running now. */
  probing: boolean
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
  /** Every login in `config.json`, the login of plain claude first. */
  logins: LoginStatus[]
}
