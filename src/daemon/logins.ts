// The daemon's table of logins: the settings from `config.json`, what `state.json` keeps (usage
// snapshots, cooldowns, the login each session is on), whether each login is signed in, and the
// `RouteAccount` rows the routing rules read, built from all of that and the token source.
//
// The proxy, the control API and the usage probes all read and change the logins through this
// table, so a change one of them makes (a cooldown, a probe's answer, a reloaded config) is seen
// by the others at once. `onChange` tells listeners, which is how a request held for capacity
// learns that the pool has changed.
import type { RouteAccount } from '../core/account-router.ts'
import { CLAUDE_DEFAULT_ACCOUNT_ID } from '../core/accounts.ts'
import type { AccountUsage } from '../core/claude-usage.ts'
import { configStamp, defaultConfig, loadConfig, type KurmisConfig, type LoginSettings } from '../data/config.ts'
import { isLoginId, type LoginId } from '../data/login-id.ts'
import { errorCodeOf, type DaemonLog } from '../data/log.ts'
import { configPath, statePath } from '../data/paths.ts'
import { createCoalescedWriter, emptyState, isSessionId, loadState, pruneState, saveState, type CoalescedWriter, type DaemonState } from '../data/state.ts'
import type { TokenSource } from './tokens.ts'

/**
 * The key under which requests that carry no `X-Claude-Code-Session-Id` share one placement.
 * A session id the CLI sends is a UUID, so it never looks like this, and the colon keeps it
 * a valid key for `state.json` (`isSessionId`).
 */
export const NO_SESSION_KEY = ':no-session'

/** How often a request may check whether `config.json` changed (a read and a hash). */
export const CONFIG_CHECK_MS = 2_000

/** The shortest time between two writes of `state.json`. */
export const STATE_WRITE_MS = 2_000

export interface LoginTableOptions {
  tokens: TokenSource
  log: DaemonLog
  now: () => number
  configCheckMs?: number
  stateWriteMs?: number
}

/** What `placeSession` did. */
export type Placement =
  | { kind: 'same' }
  | { kind: 'placed' }
  | { kind: 'moved'; from: LoginId }

/** What `reloadConfig` found. */
export type ConfigReload = { ok: true; changed: boolean } | { ok: false; error: string }

export class LoginTable {
  private config: KurmisConfig = defaultConfig()
  private stamp: string | null = null
  private lastCheck = -Infinity
  private state: DaemonState = emptyState()
  /** What the last probe of each login said about its sign-in. Absent: not probed yet. */
  private readonly signedIn = new Map<string, boolean>()
  /**
   * Sessions held to one login after a 400 on the login they had just moved to
   * (`replayDecision`'s `pin-back`). The proxy lets go of a hold when the held login cannot
   * serve (`releaseSession`). In memory only: `state.json` has no field for it, and a daemon
   * restart lets such a session be placed again.
   */
  private readonly held = new Map<string, LoginId>()
  /**
   * Logins whose token Anthropic refused with a 401 on a request of a CLI that was started on
   * another login, after the one renewal the proxy tries (`markRefused`). Routing treats them
   * as signed out until a probe of the login succeeds. In memory only.
   */
  private readonly refused = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private readonly writer: CoalescedWriter
  /** The files, fixed when the table is made, so a later change of `KURMIS_HOME` cannot move them. */
  private readonly configFile = configPath()
  private readonly stateFile = statePath()

  constructor(private readonly options: LoginTableOptions) {
    this.writer = createCoalescedWriter(async () => {
      pruneState(this.state, this.options.now())
      await saveState(this.state, this.stateFile)
    }, {
      minIntervalMs: options.stateWriteMs ?? STATE_WRITE_MS,
      onError: (error) => { this.options.log.write('state_write_failed', { code: errorCodeOf(error) }) }
    })
  }

  /** Reads `config.json` and `state.json`. A config that does not read leaves the defaults. */
  load(): void {
    this.reloadConfig()
    const read = loadState(this.options.now(), this.stateFile)
    this.state = read.state
    this.options.log.write('state_loaded', {
      count: read.state.sessions.size,
      ...(read.problem === 'corrupt' ? { reason: 'corrupt' } : read.problem === 'wrong-version' ? { reason: 'wrong_version' } : {}),
      ...(read.dropped > 0 ? { attempt: read.dropped } : {})
    })
  }

  /**
   * Reads `config.json` again. A file that does not read keeps the config the daemon has, so a
   * half-finished edit never empties the pool; the error says why, for the control API.
   */
  reloadConfig(): ConfigReload {
    this.lastCheck = this.options.now()
    let stamp: string
    try {
      stamp = configStamp(this.configFile)
    } catch (error) {
      this.options.log.write('config_invalid', { code: errorCodeOf(error) })
      return { ok: false, error: `${this.configFile} could not be read: ${messageOf(error)}` }
    }
    if (stamp === this.stamp) return { ok: true, changed: false }
    try {
      this.config = loadConfig(this.configFile)
    } catch (error) {
      this.stamp = stamp
      this.options.log.write('config_invalid', { reason: 'invalid' })
      return { ok: false, error: messageOf(error) }
    }
    this.stamp = stamp
    const ids = new Set<string>(this.config.logins.map((login) => login.id))
    for (const id of [...this.state.usage.keys()]) if (!ids.has(id)) this.state.usage.delete(id)
    for (const id of [...this.state.cooldowns.keys()]) if (!ids.has(id)) this.state.cooldowns.delete(id)
    for (const id of [...this.signedIn.keys()]) if (!ids.has(id)) this.signedIn.delete(id)
    for (const id of [...this.refused]) if (!ids.has(id)) this.refused.delete(id)
    this.options.log.write('config_loaded', { count: this.config.logins.length })
    this.changed()
    return { ok: true, changed: true }
  }

  /** Reloads the config when its contents changed, looking at most every `configCheckMs`. */
  checkConfig(): void {
    if (this.options.now() - this.lastCheck < (this.options.configCheckMs ?? CONFIG_CHECK_MS)) return
    this.reloadConfig()
  }

  /** Every login in `config.json`, the two default logins first. */
  logins(): readonly LoginSettings[] {
    return this.config.logins
  }

  claudeLogins(): LoginSettings[] {
    return this.config.logins.filter((login) => login.provider === 'claude')
  }

  find(id: string): LoginSettings | undefined {
    return this.config.logins.find((login) => login.id === id)
  }

  port(): number {
    return this.config.port
  }

  /**
   * The routing rows of the Claude logins, for one request.
   *
   * `startedOn` is the login the request's CLI was started on, and `callerSigns` whether the
   * request carries an `authorization` header of its own. The proxy forwards that header for
   * the started-on login when it holds no token for it (decision 5), so such a login counts as
   * signed in and signable. Every other login is signable only with a token the daemon read.
   *
   * A login whose token Anthropic refused (`markRefused`) counts as signed out, except the
   * started-on login and `pinned`, the login the request names with `x-kurmis-login`: their
   * requests go to it and get its 401 as it is.
   */
  routeRows(startedOn: string, callerSigns: boolean, pinned: string | null = null): RouteAccount[] {
    const now = this.options.now()
    return this.claudeLogins().map((login) => {
      const token = this.options.tokens.read(login.id)
      const passThrough = token === null && callerSigns && login.id === startedOn
      const refused = this.refused.has(login.id) && login.id !== startedOn && login.id !== pinned
      return {
        id: login.id,
        loggedIn: !refused && (token !== null || passThrough || this.signedIn.get(login.id) === true),
        credentialsReadable: token !== null || passThrough,
        tokenExpiresAt: token?.expiresAt ?? null,
        usage: this.usage(login.id),
        autoRoute: login.routing,
        fiveHourLimitPercent: login.fiveHourLimit,
        weeklyLimitPercent: login.weeklyLimit,
        useFirst: login.useFirst,
        cooldownUntil: this.cooldown(login.id, now)
      }
    })
  }

  usage(id: string): AccountUsage | null {
    return this.state.usage.get(id as LoginId) ?? null
  }

  setUsage(id: string, usage: AccountUsage): void {
    if (!isLoginId(id)) return
    this.state.usage.set(id, usage)
    this.save()
    this.changed()
  }

  /** Until when routing skips the login: ms since epoch, `Infinity` for an unknown end, null for none. */
  cooldown(id: string, now = this.options.now()): number | null {
    const until = this.state.cooldowns.get(id as LoginId)
    return until === undefined || until <= now ? null : until
  }

  setCooldown(id: string, until: number | null): void {
    if (!isLoginId(id)) return
    if (until === null) this.state.cooldowns.delete(id)
    else this.state.cooldowns.set(id, until)
    this.save()
    this.changed()
  }

  /** Whether the last probe found the login signed in; null before its first probe. */
  probedSignedIn(id: string): boolean | null {
    return this.signedIn.get(id) ?? null
  }

  setSignedIn(id: string, value: boolean): void {
    if (this.signedIn.get(id) === value) return
    this.signedIn.set(id, value)
    this.changed()
  }

  /** Records that Anthropic refused the login's token after the proxy tried to renew it (see `refused`). */
  markRefused(id: string): void {
    if (this.refused.has(id)) return
    this.refused.add(id)
    this.changed()
  }

  /** Whether `markRefused` holds for the login. */
  isRefused(id: string): boolean {
    return this.refused.has(id)
  }

  /** Ends `markRefused`: a probe of the login succeeded. */
  clearRefused(id: string): void {
    if (!this.refused.delete(id)) return
    this.changed()
  }

  /**
   * Whether a Claude login has credentials here: a token read, or a probe that found it
   * signed in. Null when neither has said yet.
   */
  claudeSignedIn(id: string): boolean | null {
    if (this.options.tokens.read(id) !== null) return true
    return this.probedSignedIn(id)
  }

  /** The login that served the session's last accepted answer, or null. */
  sessionLogin(key: string): LoginId | null {
    return this.state.sessions.get(key)?.login ?? null
  }

  /** Records that `id` served the session's request, after the answer was accepted. */
  placeSession(key: string, id: string): Placement {
    if (!isSessionId(key) || !isLoginId(id)) return { kind: 'same' }
    const previous = this.state.sessions.get(key)?.login
    this.state.sessions.set(key, { login: id, lastUsed: this.options.now() })
    this.save()
    if (previous === undefined) return { kind: 'placed' }
    return previous === id ? { kind: 'same' } : { kind: 'moved', from: previous }
  }

  /** How many sessions' last request this login served. */
  sessionCount(id: string): number {
    let count = 0
    for (const placement of this.state.sessions.values()) if (placement.login === id) count++
    return count
  }

  /** The login a session is held to after a pin-back, or null. */
  heldLogin(key: string): LoginId | null {
    return this.held.get(key) ?? null
  }

  holdSession(key: string, id: string): void {
    if (isLoginId(id)) this.held.set(key, id)
  }

  /** Ends a session's hold, so its requests are routed on Auto again. */
  releaseSession(key: string): void {
    this.held.delete(key)
  }

  /** Calls `listener` after every change of a login's usage, cooldown, sign-in or settings. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  changed(): void {
    for (const listener of [...this.listeners]) listener()
  }

  /** Writes `state.json` now if a change is waiting, and waits for it. */
  flush(): Promise<void> {
    return this.writer.flush()
  }

  private save(): void {
    this.writer.schedule()
  }
}

/** The default login's id, for code that needs it as a `LoginId`. */
export const CLAUDE_DEFAULT_LOGIN = CLAUDE_DEFAULT_ACCOUNT_ID as LoginId

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

