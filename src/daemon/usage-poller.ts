// The daemon's usage probes: one at a time per login, every signed-in login every 15 minutes,
// and on demand (the control API's `probe`, a proxy request whose reading is stale, and the
// renewal of an expiring token, which a Claude probe does because its CLI renews the token).
//
// A probe's answer goes into the login table: the usage snapshot, whether the login is signed
// in, and the end of a cooldown that had no known end (`cooldownAfterProbe`). A successful
// probe that finds the login signed in also ends `markRefused` (a token Anthropic refused). A
// failed probe keeps the previous windows and records the error on the snapshot.
//
// A probe's answer describes the login as it was when the probe started, and a probe takes a
// second or more. What a forwarded answer said in that time is newer and wins: its rate-limit
// headers are applied again on top of the probe's snapshot (`setProbeUsage`), and a cooldown or
// a refused token recorded since the probe started is not ended by it.
//
// A probe for a stale reading is not started again for the same login within
// `STALE_PROBE_INTERVAL_MS` of the last one (`recentStaleProbes`), so a probe that keeps
// failing does not run before every request.
//
// A successful probe that finds the login signed in also tells the daemon the login's email:
// for Claude the profile the probe's CLI cached (`ClaudeIdentityReader`), for Codex the probe's
// own answer. The login table then gives an automatic alias the form that email makes
// (`noteEmail`). A probe that failed, or found the login signed out, or a Claude login whose
// profile names no email, changes no alias.
import { emptyCodexUsage } from '../core/codex-usage.ts'
import { cooldownAfterProbe } from '../core/proxy-rules.ts'
import { emptyAccountUsage } from '../core/usage.ts'
import type { LoginSettings } from '../data/config.ts'
import type { ClaudeIdentityReader } from '../data/identity.ts'
import type { DaemonLog } from '../data/log.ts'
import type { LoginRef } from '../data/login-id.ts'
import type { LoginTable } from './logins.ts'
import type { ProbeOptions, ProbeResult } from './probe-result.ts'
import type { TokenSource } from './tokens.ts'

/** How often every signed-in login is probed. */
export const POLL_INTERVAL_MS = 15 * 60_000

/** How long after a probe for a stale reading the proxy does not ask for another one of the same login. */
export const STALE_PROBE_INTERVAL_MS = 60_000

/** What one probe answered: `probeClaudeUsage` and `probeCodexUsage` return it. */
export type ProbeAnswer = ProbeResult

export type ProbeFunction = (login: LoginRef, options: ProbeOptions) => Promise<ProbeResult>

/** Why a probe runs, for the log. */
export type ProbeCause = 'start' | 'poll' | 'request' | 'stale' | 'renewal' | 'config'

export interface UsagePollerOptions {
  table: LoginTable
  tokens: TokenSource
  /** Where a Claude login's email is read after a probe. */
  identity: Pick<ClaudeIdentityReader, 'read'>
  env: NodeJS.ProcessEnv
  log: DaemonLog
  now: () => number
  probeClaude: ProbeFunction
  probeCodex: ProbeFunction
  intervalMs?: number
  /** Default `STALE_PROBE_INTERVAL_MS`. */
  staleProbeIntervalMs?: number
}

export class UsagePoller {
  private readonly running = new Map<string, Promise<void>>()
  /** When each login was last asked for a probe because its reading was stale. */
  private readonly staleProbedAt = new Map<string, number>()
  private readonly controller = new AbortController()
  private timer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private pollStopped = false

  constructor(private readonly options: UsagePollerOptions) {}

  /** Probes every login once, then every signed-in login each `intervalMs`. */
  start(): void {
    if (this.closed || this.pollStopped || this.timer !== null) return
    void this.probeMany(this.options.table.logins().map((login) => login.id), 'start')
    this.timer = setInterval(() => { void this.probeMany(this.pollable(), 'poll') }, this.options.intervalMs ?? POLL_INTERVAL_MS)
    this.timer.unref?.()
  }

  /**
   * Stops the timer of the poll, for a daemon that is stopping. Running probes and probes asked
   * for later still run.
   */
  stopPolling(): void {
    this.pollStopped = true
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Stops the timer, kills the probes that are running and resolves once they have ended. A
   * probe ends only after its process has exited, so after this no probe's process holds the
   * data folder open: on Windows a running process's working folder or open file cannot be
   * deleted.
   */
  async close(): Promise<void> {
    this.closed = true
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.controller.abort()
    await Promise.all(this.running.values())
  }

  /** Whether a probe of this login is running now. */
  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  /**
   * The logins a poll or a probe request without a list covers: every one signed in, and every
   * one not probed yet. A login whose last probe found it signed out is left out until a token
   * appears for it or the config changes.
   */
  pollable(): string[] {
    return this.options.table.logins()
      .filter((login) => this.signedInOrUnknown(login))
      .map((login) => login.id)
  }

  /**
   * The logins a probe for a stale reading was asked for within the last
   * `STALE_PROBE_INTERVAL_MS`, whether that probe succeeded or not.
   */
  recentStaleProbes(): Set<string> {
    const since = this.options.now() - (this.options.staleProbeIntervalMs ?? STALE_PROBE_INTERVAL_MS)
    const recent = new Set<string>()
    for (const [id, at] of this.staleProbedAt) {
      if (at > since) recent.add(id)
      else this.staleProbedAt.delete(id)
    }
    return recent
  }

  /** Probes these logins, each once at a time, and resolves when all have finished. Never rejects. */
  async probeMany(ids: readonly string[], cause: ProbeCause): Promise<void> {
    await Promise.all([...new Set(ids)].map((id) => this.probe(id, cause)))
  }

  /**
   * Probes one login. A probe of it that is already running is waited for rather than started
   * again. Never rejects.
   */
  probe(id: string, cause: ProbeCause): Promise<void> {
    if (cause === 'stale') this.staleProbedAt.set(id, this.options.now())
    const running = this.running.get(id)
    if (running !== undefined) return running
    if (this.closed) return Promise.resolve()
    const login = this.options.table.find(id)
    if (login === undefined) return Promise.resolve()
    const started = this.run(login, cause).finally(() => { this.running.delete(id) })
    this.running.set(id, started)
    return started
  }

  private signedInOrUnknown(login: LoginSettings): boolean {
    if (login.provider === 'claude') return this.options.table.claudeSignedIn(login.id) !== false
    return this.options.table.probedSignedIn(login.id) !== false
  }

  private async run(login: LoginSettings, cause: ProbeCause): Promise<void> {
    const { table, log, now } = this.options
    const id = login.id
    const startedAt = now()
    log.write(cause === 'renewal' ? 'token_renewal_started' : 'usage_probe_started', { login: id, provider: login.provider })
    const probe = login.provider === 'claude' ? this.options.probeClaude : this.options.probeCodex
    const ref: LoginRef = { id, provider: login.provider, usedByPlainCli: login.usedByPlainCli }
    let answer: ProbeAnswer
    try {
      answer = await probe(ref, { env: this.options.env, now, signal: this.controller.signal, previous: table.usage(id) })
    } catch {
      answer = { ok: false, signedIn: null, reason: 'other', error: 'The usage probe failed unexpectedly.' }
    }
    if (this.closed) return
    // A Claude probe's CLI may have renewed the token, so the next read looks again. After a
    // renewal the next request waits for that read; after any other probe it goes on with the
    // token it has while Credential Manager is read again.
    if (login.provider === 'claude') {
      if (cause === 'renewal') this.options.tokens.invalidate(id)
      else this.options.tokens.markStale(id)
    }
    const ms = now() - startedAt
    if (answer.ok) {
      // The probe measured the login as it was when it started. What an answer said since then
      // is newer: its rate-limit headers, a cooldown and a refused token stay.
      table.setProbeUsage(id, answer.usage, startedAt)
      table.setSignedIn(id, answer.signedIn)
      if (answer.signedIn) table.clearRefused(id, startedAt)
      const before = table.cooldown(id)
      const setAt = table.cooldownSince(id)
      const after = setAt !== null && setAt > startedAt ? before : cooldownAfterProbe(before, answer.usage)
      if (after !== before) {
        table.setCooldown(id, after)
        if (after === null) log.write('cooldown_ended', { login: id })
      }
      log.write(cause === 'renewal' ? 'token_renewal_finished' : 'usage_probe_finished', { login: id, ms, ok: true })
      this.learnEmail(ref, answer)
    } else {
      const previous = table.usage(id)
      const base = previous ?? (login.provider === 'claude' ? emptyAccountUsage(id, now()) : emptyCodexUsage(id, now()))
      table.setUsage(id, { ...base, error: answer.error })
      if (answer.signedIn !== null) table.setSignedIn(id, answer.signedIn)
      log.write(cause === 'renewal' ? 'token_renewal_finished' : 'usage_probe_failed', { login: id, ms, ok: false, reason: answer.reason })
    }
  }

  /**
   * Keeps what a successful probe said about the login's email: a Codex login's email in the
   * table's memory, and, when the probe found the login signed in and an email is known, the
   * login's automatic alias made from it.
   */
  private learnEmail(login: LoginRef, answer: Extract<ProbeAnswer, { ok: true }>): void {
    const { table, identity } = this.options
    if (login.provider === 'codex') table.setCodexEmail(login.id, answer.signedIn ? answer.email ?? null : null)
    if (!answer.signedIn) return
    const email = login.provider === 'codex' ? answer.email ?? null : identity.read(login)?.email ?? null
    if (email !== null) table.noteEmail(login.id, email)
  }
}
