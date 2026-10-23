// The daemon's table of logins: the settings from `config.json`, what `state.json` keeps (usage
// snapshots, cooldowns, the login each session is on), whether each login is signed in, and the
// `RouteAccount` rows the routing rules read, built from all of that and the token source.
//
// The proxy, the control API and the usage probes all read and change the logins through this
// table, so a change one of them makes (a cooldown, a probe's answer, a reloaded config) is seen
// by the others at once. `onChange` tells listeners, which is how a request held for capacity
// learns that the pool has changed.
//
// Whether a login is the one plain claude uses is read from its settings in the config (`find`,
// `plainClaudeLogin`), never from its id.
//
// The table also writes one thing into `config.json`: a login's automatic alias, when a usage
// probe has told the daemon the login's email (`noteEmail`). The table keeps no email; it is read
// from the login's profile file when needed.
import { usageFromUnifiedHeaders, type RouteAccount, type UnifiedObservation } from '../core/account-router.ts'
import type { AccountUsage } from '../core/claude-usage.ts'
import {
  changeConfig, configStamp, defaultConfig, findLogin, followEmail, loadConfig, plainClaudeLogin, type KurmisConfig, type LoginSettings
} from '../data/config.ts'
import { isLoginId, type LoginId } from '../data/login-id.ts'
import { LockTimeoutError } from '../data/lock.ts'
import { errorCodeOf, type DaemonLog } from '../data/log.ts'
import { configPath, statePath } from '../data/paths.ts'
import {
  createCoalescedWriter, emptyState, isSessionId, loadState, MAX_SESSIONS, pruneState, saveState, SESSION_MAX_AGE_MS,
  type CoalescedWriter, type DaemonState
} from '../data/state.ts'
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

/**
 * How long the daemon waits for `config.json`'s lock when it writes the file (an automatic
 * alias, or the login of plain claude added to a file that has none). The wait
 * blocks the event loop, so it is short; a write that does not get the lock in time is tried again later.
 */
export const CONFIG_LOCK_TIMEOUT_MS = 500

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

/** Called with the ids of the logins a reloaded config has and the config before it did not. */
export type AddedLoginsListener = (ids: LoginId[]) => void

export class LoginTable {
  /**
   * Until a config has been read, a stand-in with the login of plain claude under a new random
   * id, because the proxy and the control API always need that login.
   * The stand-in is never saved. The first config that reads replaces it, and that drops the
   * usage and cooldowns kept under the stand-in's ids.
   */
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
   * restart lets such a session be placed again. Kept within the same bounds as the session
   * placements (`pruneHolds`).
   */
  private readonly held = new Map<string, { login: LoginId; lastUsed: number }>()
  /**
   * Logins whose token Anthropic refused with a 401 on a request of a CLI that was started on
   * another login, after the one renewal the proxy tries (`markRefused`), with when that was.
   * Routing treats them as signed out until a probe of the login that started later succeeds.
   * In memory only.
   */
  private readonly refused = new Map<string, number>()
  /**
   * What the rate-limit headers of each login's answers said since its last probe started
   * (`noteObservation`, `noteProbeStarted`), merged into one observation: for each window and
   * for the status, the latest answer that reported it. The probe measured an older state, so
   * this is applied again on top of its snapshot (`setProbeUsage`). In memory only; it holds no
   * token or body.
   */
  private readonly observations = new Map<string, UnifiedObservation>()
  /** When each login's current cooldown was set; absent for one read from `state.json`. In memory only. */
  private readonly cooldownSetAt = new Map<string, number>()
  private readonly listeners = new Set<() => void>()
  private readonly addedListeners = new Set<AddedLoginsListener>()
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
   * half-finished edit never empties the pool; the error says why, for the control API. A file
   * that could not be read because another process held its lock is read again at the next
   * check, whether or not it changed.
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
    const before = this.config
    try {
      this.config = loadConfig(this.configFile, { timeoutMs: CONFIG_LOCK_TIMEOUT_MS })
    } catch (error) {
      // A lock that another process holds says nothing about the file. The stamp is not kept,
      // so the next check reads the file again even when its contents stay the same.
      const busy = isLockTimeout(error)
      if (!busy) this.stamp = stamp
      this.options.log.write('config_invalid', { reason: busy ? 'timeout' : 'invalid' })
      return { ok: false, error: messageOf(error) }
    }
    this.stamp = stamp
    const added = this.config.logins.map((login) => login.id).filter((id) => findLogin(before, id) === undefined)
    const ids = new Set<string>(this.config.logins.map((login) => login.id))
    for (const id of [...this.state.usage.keys()]) if (!ids.has(id)) this.state.usage.delete(id)
    for (const id of [...this.state.cooldowns.keys()]) if (!ids.has(id)) this.state.cooldowns.delete(id)
    for (const id of [...this.signedIn.keys()]) if (!ids.has(id)) this.signedIn.delete(id)
    for (const id of [...this.refused.keys()]) if (!ids.has(id)) this.refused.delete(id)
    for (const id of [...this.observations.keys()]) if (!ids.has(id)) this.observations.delete(id)
    for (const id of [...this.cooldownSetAt.keys()]) if (!ids.has(id)) this.cooldownSetAt.delete(id)
    this.options.log.write('config_loaded', { count: this.config.logins.length })
    this.changed()
    if (added.length > 0) for (const listener of [...this.addedListeners]) listener(added)
    return { ok: true, changed: true }
  }

  /** Reloads the config when its contents changed, looking at most every `configCheckMs`. */
  checkConfig(): void {
    if (this.options.now() - this.lastCheck < (this.options.configCheckMs ?? CONFIG_CHECK_MS)) return
    this.reloadConfig()
  }

  /** Every login in `config.json`, the login of plain claude first. */
  logins(): readonly LoginSettings[] {
    return this.config.logins
  }

  find(id: string): LoginSettings | undefined {
    return findLogin(this.config, id)
  }

  /** The login a plain `claude` uses: the one that CLI is signed in to. The config always has one. */
  plainClaudeLogin(): LoginSettings {
    return plainClaudeLogin(this.config)
  }

  /**
   * The routing rows of every login, for one request.
   *
   * `startedOn` is the login the request's CLI was started on, and `callerSigns` whether the
   * request carries an `authorization` header of its own. Null `startedOn` says the CLI's own
   * credentials are no kurmis login's (`STARTED_ON_NONE`): no login is signed with its header,
   * and plain claude's login, whose token belongs to another account than the CLI's,
   * is left out of the request's pool (`loggedIn` and `credentialsReadable` false). The proxy forwards that
   * header for the started-on login when it holds no token for it, so such a login counts as
   * signed in and signable. Every other login is signable only with a token the daemon read.
   *
   * A login whose token Anthropic refused (`markRefused`) counts as signed out, except the
   * started-on login and `pinned`, the login the request names with `x-kurmis-login`: their
   * requests go to it and get its 401 as it is.
   */
  routeRows(startedOn: string | null, callerSigns: boolean, pinned: string | null = null): RouteAccount[] {
    const now = this.options.now()
    return this.config.logins.map((login) => {
      const notTheCli = startedOn === null && login.usedByPlainClaude
      const token = notTheCli ? null : this.options.tokens.read(login.id)
      const passThrough = token === null && callerSigns && login.id === startedOn
      const refused = this.refused.has(login.id) && login.id !== startedOn && login.id !== pinned
      return {
        id: login.id,
        loggedIn: !notTheCli && !refused && (token !== null || passThrough || this.signedIn.get(login.id) === true),
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
    // A login gone from the config (a probe or an answer that ended after the reload) keeps nothing.
    if (!isLoginId(id) || this.find(id) === undefined) return
    this.state.usage.set(id, usage)
    this.save()
    this.changed()
  }

  /**
   * Folds the rate-limit headers of one of the login's answers into its usage, and merges them
   * into what is kept for `setProbeUsage`. Headers that say nothing about usage change nothing.
   */
  noteObservation(id: string, observation: UnifiedObservation): void {
    if (observation.status === null && observation.representativeClaim === null && Object.keys(observation.windows).length === 0) return
    if (!isLoginId(id) || this.find(id) === undefined) return
    const kept = this.observations.get(id)
    this.observations.set(id, kept === undefined ? observation : mergeObservations(kept, observation))
    this.setUsage(id, usageFromUnifiedHeaders(id, this.usage(id), observation))
  }

  /**
   * Called when a probe of the login starts: forgets the headers kept so far, so that what
   * `setProbeUsage` applies on top of the probe is only what answers said after it started.
   * One probe per login runs at a time.
   */
  noteProbeStarted(id: string): void {
    this.observations.delete(id)
  }

  /**
   * Stores a successful probe's snapshot. The probe measured the login when it started
   * (`noteProbeStarted`), so what answers' rate-limit headers said since then is newer and is
   * applied again on top of the snapshot: the probe fills in what the headers did not carry,
   * and does not undo what they said.
   */
  setProbeUsage(id: string, usage: AccountUsage): void {
    const observation = this.observations.get(id)
    this.setUsage(id, observation === undefined ? usage : usageFromUnifiedHeaders(id, usage, observation))
  }

  /** Until when routing skips the login: ms since epoch, `Infinity` for an unknown end, null for none. */
  cooldown(id: string, now = this.options.now()): number | null {
    const until = this.state.cooldowns.get(id as LoginId)
    return until === undefined || until <= now ? null : until
  }

  setCooldown(id: string, until: number | null): void {
    if (!isLoginId(id) || this.find(id) === undefined) return
    if (until === null) {
      this.state.cooldowns.delete(id)
      this.cooldownSetAt.delete(id)
    } else {
      this.state.cooldowns.set(id, until)
      this.cooldownSetAt.set(id, this.options.now())
    }
    this.save()
    this.changed()
  }

  /** When the login's cooldown was set by this daemon, or null (none, or one read from `state.json`). */
  cooldownSince(id: string): number | null {
    return this.cooldownSetAt.get(id) ?? null
  }

  /** Whether the last probe found the login signed in; null before its first probe. */
  probedSignedIn(id: string): boolean | null {
    return this.signedIn.get(id) ?? null
  }

  setSignedIn(id: string, value: boolean): void {
    if (this.signedIn.get(id) === value || this.find(id) === undefined) return
    this.signedIn.set(id, value)
    this.changed()
  }

  /**
   * Gives the login the automatic alias its email makes (`followEmail` in `config.ts`) when its
   * alias is automatic and does not fit the email yet, by writing `config.json` and reading it
   * again. The change is worked out again inside the lock, from the file as it is then. When the
   * lock is not free within `CONFIG_LOCK_TIMEOUT_MS`, or the write fails, the failure is logged
   * with the login's id only and the config stays as it is; the next probe tries again. The log
   * line never names the alias or the email.
   */
  noteEmail(id: string, email: string): void {
    this.checkConfig()
    const login = this.find(id)
    if (login === undefined || followEmail(this.config, id, email) === this.config) return
    try {
      changeConfig((current) => followEmail(current, id, email), this.configFile, { timeoutMs: CONFIG_LOCK_TIMEOUT_MS })
    } catch (error) {
      this.options.log.write('alias_write_failed', { login: login.id, reason: isLockTimeout(error) ? 'timeout' : 'error', code: errorCodeOf(error) })
      return
    }
    this.reloadConfig()
  }

  /** Records that Anthropic refused the login's token after the proxy tried to renew it (see `refused`). */
  markRefused(id: string): void {
    if (this.find(id) === undefined) return
    const known = this.refused.has(id)
    this.refused.set(id, this.options.now())
    if (!known) this.changed()
  }

  /** Whether `markRefused` holds for the login. */
  isRefused(id: string): boolean {
    return this.refused.has(id)
  }

  /**
   * Ends `markRefused`: a probe of the login succeeded. A probe that started at `probeStartedAt`
   * ends only a refusal from before it or from the same millisecond; a refusal that came while
   * it ran is newer and stays.
   */
  clearRefused(id: string, probeStartedAt = Infinity): void {
    const at = this.refused.get(id)
    if (at === undefined || at > probeStartedAt) return
    this.refused.delete(id)
    this.changed()
  }

  /**
   * Whether a login has credentials here: a token read, or a probe that found it
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

  /**
   * The login a session is held to after a pin-back, or null. A hold unused for
   * `SESSION_MAX_AGE_MS` has ended, even when no new hold has pruned it yet.
   */
  heldLogin(key: string): LoginId | null {
    const hold = this.held.get(key)
    if (hold === undefined) return null
    const now = this.options.now()
    if (hold.lastUsed < now - SESSION_MAX_AGE_MS) {
      this.held.delete(key)
      return null
    }
    hold.lastUsed = now
    return hold.login
  }

  holdSession(key: string, id: string): void {
    if (!isLoginId(id)) return
    this.held.delete(key)
    this.held.set(key, { login: id, lastUsed: this.options.now() })
    this.pruneHolds()
  }

  /** How many sessions are held after a pin-back. */
  heldCount(): number {
    return this.held.size
  }

  /** Ends a session's hold, so its requests are routed on Auto again. */
  releaseSession(key: string): void {
    this.held.delete(key)
  }

  /**
   * Calls `listener` after a reload of `config.json` that brought logins the config before it
   * did not have, with their ids. The first read replaces the stand-in config, so it names every
   * login; the usage poll is started after it and probes them all anyway.
   */
  onLoginsAdded(listener: AddedLoginsListener): () => void {
    this.addedListeners.add(listener)
    return () => { this.addedListeners.delete(listener) }
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

  /**
   * Drops holds unused for `SESSION_MAX_AGE_MS`, and beyond the `MAX_SESSIONS` most recently
   * used, the same bounds `state.json` keeps session placements in.
   */
  private pruneHolds(): void {
    const oldest = this.options.now() - SESSION_MAX_AGE_MS
    for (const [key, hold] of this.held) if (hold.lastUsed < oldest) this.held.delete(key)
    if (this.held.size <= MAX_SESSIONS) return
    const byUse = [...this.held].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [key] of byUse.slice(0, this.held.size - MAX_SESSIONS)) this.held.delete(key)
  }
}

/**
 * One observation that, applied with `usageFromUnifiedHeaders`, gives what applying `kept` and
 * then `next` gives. Each window `next` reports with a utilization replaces the kept one; the
 * others stay. `next`'s status replaces the kept status when it has one. The window the status
 * is about (`representativeClaim`, with `resetsAt`) is `next`'s when it names one, none when
 * `next` has a status without naming one, and the kept one otherwise.
 */
function mergeObservations(kept: UnifiedObservation, next: UnifiedObservation): UnifiedObservation {
  const windows = { ...kept.windows }
  for (const [suffix, window] of Object.entries(next.windows)) {
    const key = suffix as keyof UnifiedObservation['windows']
    if (window.utilization !== null || windows[key] === undefined) windows[key] = window
  }
  const claimFromNext = next.representativeClaim !== null || next.status !== null
  return {
    observedAt: next.observedAt,
    status: next.status ?? kept.status,
    resetsAt: claimFromNext ? next.resetsAt : kept.resetsAt,
    representativeClaim: claimFromNext ? next.representativeClaim : kept.representativeClaim,
    windows,
    overageStatus: next.overageStatus ?? kept.overageStatus,
    overageDisabledReason: next.overageDisabledReason ?? kept.overageDisabledReason
  }
}

/** Whether `changeConfig` failed because another process held the config lock for too long. */
function isLockTimeout(error: unknown): boolean {
  return error instanceof Error && error.cause instanceof LockTimeoutError
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

