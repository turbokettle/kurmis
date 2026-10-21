// How kurmis writes "how long until this happens", for `kurmis status` and the daemon's log.
// Copied from the original router's `src/shared/countdown.ts` and `src/shared/duration.ts`.

/** An ISO string, a millisecond count or a Date as milliseconds; null when it is not a time. */
export function parseTime(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const at = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(at) ? at : null
}

/**
 * A span as at most two units, largest first, with a unit that is zero left out: `45m`,
 * `1h 30m`, `3h`, `4d 3h`, `2d`. Every unit is floored, so a span is never rounded up, and
 * seconds are never written: anything under a minute, or a negative span, is `0m`.
 */
export function spanText(milliseconds: number): string {
  const totalMinutes = Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 60_000)) : 0
  const totalHours = Math.floor(totalMinutes / 60)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  const minutes = totalMinutes % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

/** What a countdown says once the moment has passed or is under a minute away. */
export const COUNTDOWN_NOW = 'now'

/**
 * How long until a reset: `1h 30m`, `4d 3h`, `45m`, `2d`. `now` once it has passed or is
 * under a minute away. Null when there is no reset time.
 */
export function resetIn(resetsAt: string | number | Date | null | undefined, now: number): string | null {
  const at = parseTime(resetsAt)
  if (at === null) return null
  const left = at - now
  return left < 60_000 ? COUNTDOWN_NOW : spanText(left)
}

/** "resets in 1h 30m"; null when there is no reset time or it has already passed. */
export function resetsInText(resetsAt: string | number | Date | null | undefined, now: number = Date.now()): string | null {
  const at = parseTime(resetsAt)
  if (at === null || at <= now) return null
  return `resets in ${spanText(at - now)}`
}

/** "in 1h 30m", or `now` once the moment has arrived. Null when there is no moment. */
export function countdownIn(value: string | number | Date | null | undefined, now: number = Date.now()): string | null {
  const until = resetIn(value, now)
  if (until === null) return null
  return until === COUNTDOWN_NOW ? COUNTDOWN_NOW : `in ${until}`
}
