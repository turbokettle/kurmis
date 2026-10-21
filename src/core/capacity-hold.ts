// What the proxy does when Anthropic has no room for a request, as opposed to a login whose
// usage is used up (`replayDecision` in `account-router.ts`). Copied from the original router's
// `src/tools/claude/core/capacity-hold.ts`, together with the per-session bookkeeping of
// the original router's router proxy (`router/proxy.ts`), which kurmis keeps here as `CapacityCooling`.
//
// When Anthropic answers a request 529 (overloaded), or 429 without the headers of a usage
// limit, the proxy does not pass the answer on. It leaves that login alone for a backoff that
// grows with each such answer the session gets in a row and is jittered, sends the request on
// another login at once when the session may use one that is not cooling, and otherwise waits.
// Any change in the pool (a login freeing up or being added) should end the wait early, and the
// CLI closing the request ends it at once.
//
// The CLI gives up on a request that has sent back no response headers for three minutes
// (`CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS`, 180 s for a subscription login in CLI 2.1.287, with
// one retry after that). So the proxy holds one request for at most `CAPACITY_HOLD_MS` and then
// answers it 529 itself (`capacityHoldAnswer`). The CLI counts that as one of its retries
// (`ROUTED_CLI_MAX_RETRIES`), sends the request again, and the proxy holds it again, with the
// backoff carrying on from where it was. A request that Anthropic answers with a usage limit
// leaves the hold for the usual path: another login, or the pool's own 429.

/** The longest the proxy holds one request of the CLI before answering it 529 itself. */
export const CAPACITY_HOLD_MS = 120_000

/** The wait after the first answer without capacity; each later one doubles it, up to `CAPACITY_HOLD_MAX_MS`. */
export const CAPACITY_HOLD_BASE_MS = 5_000

export const CAPACITY_HOLD_MAX_MS = 30_000

/** How long a session's count of answers without capacity in a row is kept after the last one. */
export const CAPACITY_STREAK_MS = 10 * 60_000

/**
 * Why an upstream answer means Anthropic had no room for the request right now, or null.
 * A 429 that names a usage limit (`usageLimit`, from `isDefinitiveQuotaRejection`) is not
 * this: that login is used up, and waiting on it would sleep through a login with room.
 */
export function capacityRefusal(status: number, usageLimit: boolean): string | null {
  if (status === 529) return '529 Overloaded'
  if (status === 429 && !usageLimit) return '429 Too Many Requests'
  return null
}

/** The `retry-after` an answer names, in milliseconds; null for none or one that does not read. */
export function retryAfterMs(value: string | null | undefined): number | null {
  if (value == null || value.trim().length === 0) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  return null
}

/**
 * The wait before trying a login again after answer `attempt` (from 1): the base doubled for
 * each answer before it, capped, with a random part of up to half of that added, and never
 * shorter than what the answer's `retry-after` asked for. `random` is a 0-1 source, so a test
 * can fix it.
 */
export function capacityHoldDelayMs(attempt: number, asked: number | null, random: number,
  baseMs = CAPACITY_HOLD_BASE_MS, maxMs = CAPACITY_HOLD_MAX_MS): number {
  const step = Math.min(Math.max(baseMs, maxMs), baseMs * 2 ** Math.max(0, attempt - 1))
  const fraction = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0
  return Math.max(asked ?? 0, Math.round(step + (step / 2) * fraction))
}

/**
 * The 529 the proxy answers a held request with once `CAPACITY_HOLD_MS` is spent, so the CLI
 * retries it before its own first-byte timeout gives up on it. `retry-after` is short because
 * the proxy does the waiting: the CLI gives up on a wait it is asked to make that is longer
 * than a minute.
 */
export function capacityHoldAnswer(reason: string, heldMs: number): { status: number; headers: Record<string, string>; body: string } {
  const message = `Anthropic's API had no capacity for this request (${reason}) for ${String(Math.round(heldMs / 1000))} s. ` +
    'The kurmis proxy holds it again when it is sent again.'
  return {
    status: 529,
    headers: { 'content-type': 'application/json', 'retry-after': '1' },
    body: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message } })
  }
}

/** What `CapacityCooling.noteNoCapacity` decided for one answer without capacity. */
export interface CapacityNote {
  /** How many answers without capacity the session has had in a row, counting this one. */
  attempt: number
  /** The backoff this answer earned the login, in milliseconds. */
  delayMs: number
  /** When the login may be tried again for this session, in ms since the epoch. */
  until: number
}

/**
 * Per session, which logins answered without capacity and until when each is left alone, and
 * how many such answers the session has had in a row. In memory only, with the clock passed in.
 *
 * The cooling is kept per session and across requests, so a request the CLI sends again after a
 * hold was given back does not go to a login whose backoff has not passed. Requests of one
 * session answered at the same time share it: a shorter backoff never cuts a longer one short,
 * such as a `retry-after` of ten minutes. The count in a row is what the backoff grows with, and
 * it is forgotten `CAPACITY_STREAK_MS` after the last such answer, or as soon as the session
 * gets an answer that is not a want of capacity.
 */
export class CapacityCooling {
  private readonly streaks = new Map<string, { attempt: number; at: number }>()
  private readonly cooling = new Map<string, { logins: Map<string, number>; reason: string }>()

  constructor(private readonly options: { baseMs?: number; maxMs?: number } = {}) {}

  /**
   * Records that `loginId` answered a request of the session without capacity. `reason` is
   * what `capacityRefusal` said, `retryAfter` the answer's `retry-after` header, and `random`
   * a 0-1 number for the jitter.
   */
  noteNoCapacity(sessionId: string, loginId: string, reason: string, retryAfter: string | null,
    random: number, now: number): CapacityNote {
    this.dropExpired(now)
    const attempt = (this.streaks.get(sessionId)?.attempt ?? 0) + 1
    this.streaks.set(sessionId, { attempt, at: now })
    const delayMs = capacityHoldDelayMs(attempt, retryAfterMs(retryAfter), random,
      this.options.baseMs ?? CAPACITY_HOLD_BASE_MS, this.options.maxMs ?? CAPACITY_HOLD_MAX_MS)
    const entry = this.cooling.get(sessionId) ?? { logins: new Map<string, number>(), reason }
    entry.reason = reason
    const until = Math.max(entry.logins.get(loginId) ?? 0, now + delayMs)
    entry.logins.set(loginId, until)
    this.cooling.set(sessionId, entry)
    return { attempt, delayMs, until }
  }

  /** The session got an answer that was not a want of capacity, so its count in a row starts over. */
  noteAnswered(sessionId: string): void {
    this.streaks.delete(sessionId)
  }

  /** The session's count of answers without capacity in a row, or 1 when it has none. */
  attempt(sessionId: string, now: number): number {
    this.dropExpired(now)
    return this.streaks.get(sessionId)?.attempt ?? 1
  }

  /**
   * The session's logins that are still cooling, each with the time it may be tried again, and
   * what the last answer without capacity was. Null when none is cooling, which is when a new
   * request of the session needs no hold from the start.
   */
  coolingOf(sessionId: string, now: number): { logins: ReadonlyMap<string, number>; reason: string } | null {
    this.dropExpired(now)
    return this.cooling.get(sessionId) ?? null
  }

  /** Whether this login is cooling for the session now. */
  isCooling(sessionId: string, loginId: string, now: number): boolean {
    return (this.coolingOf(sessionId, now)?.logins.get(loginId) ?? 0) > now
  }

  /**
   * What a held request of the session waits for. `usable` is the logins the session may use
   * now (`accountsInScope`): a login that has left the session's pool is no reason to wait.
   * `cooling` is the usable logins still cooling, which the next choice of a login must pass
   * over, and `wakeAt` is when the first of them may be tried again, or null when none is
   * cooling. A held request that finds no login and nothing cooling is answered with the pool's
   * own refusal, because then it is a usage limit or a sign-in problem, not a want of capacity.
   */
  waitFor(sessionId: string, usable: ReadonlySet<string>, now: number): { cooling: Set<string>; wakeAt: number | null } {
    const cooling = new Set<string>()
    let wakeAt: number | null = null
    for (const [id, until] of this.coolingOf(sessionId, now)?.logins ?? []) {
      if (until <= now || !usable.has(id)) continue
      cooling.add(id)
      wakeAt = wakeAt === null ? until : Math.min(wakeAt, until)
    }
    return { cooling, wakeAt }
  }

  /** Forgets a session, as when the daemon drops its route. */
  forget(sessionId: string): void {
    this.streaks.delete(sessionId)
    this.cooling.delete(sessionId)
  }

  private dropExpired(now: number): void {
    for (const [id, streak] of this.streaks) {
      if (now - streak.at > CAPACITY_STREAK_MS) this.streaks.delete(id)
    }
    for (const [id, entry] of this.cooling) {
      for (const [login, until] of entry.logins) if (until <= now) entry.logins.delete(login)
      if (entry.logins.size === 0) this.cooling.delete(id)
    }
  }
}
