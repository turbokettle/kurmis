// The daemon's usage probes: one at a time per login, every signed-in login every 15 minutes,
// and on demand (the control API's `probe`, a proxy request whose reading is stale, and the
// renewal of an expiring token, which a Claude probe does because its CLI renews the token).
//
// A probe's answer goes into the login table: the usage snapshot, whether the login is signed
// in, and the end of a cooldown that had no known end (`cooldownAfterProbe`). A failed probe
// keeps the previous windows and records the error on the snapshot.
import type { AccountUsage } from '../core/claude-usage.ts'
import { emptyCodexUsage } from '../core/codex-usage.ts'
import { cooldownAfterProbe } from '../core/proxy-rules.ts'
import { emptyAccountUsage } from '../core/usage.ts'
import type { LoginSettings } from '../data/config.ts'
import type { DaemonLog, LogReason } from '../data/log.ts'
import { isLoginId } from '../data/login-id.ts'
import type { LoginTable } from './logins.ts'
import type { TokenSource } from './tokens.ts'

/** How often every signed-in login is probed. */
export const POLL_INTERVAL_MS = 15 * 60_000

/** What one probe answered: the shape `probeClaudeUsage` and `probeCodexUsage` return. */
export type ProbeAnswer =
  | { ok: true; signedIn: boolean; usage: AccountUsage }
  | { ok: false; signedIn: boolean | null; reason: LogReason; error: string }

export type ProbeFunction = (id: string, options: {
  env: NodeJS.ProcessEnv
  now?: () => number
  signal?: AbortSignal
  previous?: AccountUsage | null
}) => Promise<ProbeAnswer>

/** Why a probe runs, for the log. */
export type ProbeCause = 'start' | 'poll' | 'request' | 'stale' | 'renewal' | 'config'

export interface UsagePollerOptions {
  table: LoginTable
  tokens: TokenSource
  env: NodeJS.ProcessEnv
  log: DaemonLog
  now: () => number
  probeClaude: ProbeFunction
  probeCodex: ProbeFunction
  intervalMs?: number
}

export class UsagePoller {
  private readonly running = new Map<string, Promise<void>>()
  private readonly controller = new AbortController()
  private timer: ReturnType<typeof setInterval> | null = null
  private closed = false

  constructor(private readonly options: UsagePollerOptions) {}

  /** Probes every login once, then every signed-in login each `intervalMs`. */
  start(): void {
    if (this.closed || this.timer !== null) return
    void this.probeMany(this.options.table.logins().map((login) => login.id), 'start')
    this.timer = setInterval(() => { void this.probeMany(this.pollable(), 'poll') }, this.options.intervalMs ?? POLL_INTERVAL_MS)
    this.timer.unref?.()
  }

  /** Stops the timer and kills the probes that are running. */
  close(): void {
    this.closed = true
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.controller.abort()
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

  /** Probes these logins, each once at a time, and resolves when all have finished. Never rejects. */
  async probeMany(ids: readonly string[], cause: ProbeCause): Promise<void> {
    await Promise.all([...new Set(ids)].map((id) => this.probe(id, cause)))
  }

  /**
   * Probes one login. A probe of it that is already running is waited for rather than started
   * again. Never rejects.
   */
  probe(id: string, cause: ProbeCause): Promise<void> {
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
    const logged = isLoginId(id) ? id : undefined
    const startedAt = now()
    log.write(cause === 'renewal' ? 'token_renewal_started' : 'usage_probe_started', { login: logged, provider: login.provider })
    const probe = login.provider === 'claude' ? this.options.probeClaude : this.options.probeCodex
    let answer: ProbeAnswer
    try {
      answer = await probe(id, { env: this.options.env, now, signal: this.controller.signal, previous: table.usage(id) })
    } catch {
      answer = { ok: false, signedIn: null, reason: 'other', error: 'The usage probe failed unexpectedly.' }
    }
    if (this.closed) return
    // A Claude probe's CLI may have renewed the token, so the next read looks again.
    if (login.provider === 'claude') this.options.tokens.invalidate(id)
    const ms = now() - startedAt
    if (answer.ok) {
      table.setUsage(id, answer.usage)
      table.setSignedIn(id, answer.signedIn)
      const before = table.cooldown(id)
      const after = cooldownAfterProbe(before, answer.usage)
      if (after !== before) {
        table.setCooldown(id, after)
        if (after === null) log.write('cooldown_ended', { login: logged })
      }
      log.write(cause === 'renewal' ? 'token_renewal_finished' : 'usage_probe_finished', { login: logged, ms, ok: true })
    } else {
      const previous = table.usage(id)
      const base = previous ?? (login.provider === 'claude' ? emptyAccountUsage(id, now()) : emptyCodexUsage(id, now()))
      table.setUsage(id, { ...base, error: answer.error })
      if (answer.signedIn !== null) table.setSignedIn(id, answer.signedIn)
      log.write(cause === 'renewal' ? 'token_renewal_finished' : 'usage_probe_failed', { login: logged, ms, ok: false, reason: answer.reason })
    }
  }
}
