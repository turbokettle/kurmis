// `state.json`: what the daemon knows that should survive a restart. Each login's last usage
// snapshot, each login's cooldown (how long routing skips it after a usage-limit refusal),
// and which login each Claude session is on.
//
// The daemon must start even when this file is damaged, so reading it never throws: a file
// that is not JSON reads as empty, and an entry that does not check out is dropped on its own
// while the rest is kept.
import type { AccountUsage, UsageWindow } from '../core/claude-usage.ts'
import { readJsonFileSync, writeJsonFile, writeJsonFileSync } from './json-file.ts'
import { isLoginId, isLoginProvider, type LoginId } from './login-id.ts'
import { statePath } from './paths.ts'
import { isPlainObject } from './validate.ts'

export const STATE_VERSION = 1

/** Which login a Claude session was last served by, and when. */
export interface SessionPlacement {
  login: LoginId
  /** Milliseconds since epoch. */
  lastUsed: number
}

export interface DaemonState {
  usage: Map<LoginId, AccountUsage>
  /**
   * Until when routing skips a login, in milliseconds since epoch. `Infinity` means until
   * further notice: the refusal named no reset time. The file stores that as `null`, since
   * JSON has no Infinity.
   */
  cooldowns: Map<LoginId, number>
  /** Keyed by the `X-Claude-Code-Session-Id` the CLI sends. */
  sessions: Map<string, SessionPlacement>
}

/** How long a session's placement is kept after its last request. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** The most placements kept; the least recently used go first. */
export const MAX_SESSIONS = 2000

/**
 * A session id as the CLI sends it (a UUID), with some room: letters, digits, `.`, `_`, `:`
 * and `-`, at most 128 characters.
 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
}

export function emptyState(): DaemonState {
  return { usage: new Map(), cooldowns: new Map(), sessions: new Map() }
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isWindow(value: unknown): value is UsageWindow {
  return (
    isPlainObject(value) &&
    typeof value.utilization === 'number' &&
    Number.isFinite(value.utilization) &&
    (value.resetsAt === null || typeof value.resetsAt === 'string')
  )
}

function isWindowOrNull(value: unknown): boolean {
  return value === null || isWindow(value)
}

function isStringOrNull(value: unknown): boolean {
  return value === null || typeof value === 'string'
}

/**
 * Whether a stored snapshot has the fields routing and `status` read, with the right types.
 * The optional Codex fields are only checked to be objects or lists where present; the
 * daemon wrote them and only displays them.
 */
export function isStoredUsage(value: unknown, login: LoginId): value is AccountUsage {
  if (!isPlainObject(value)) return false
  return (
    value.accountId === login &&
    isLoginProvider(value.provider) &&
    isTime(value.fetchedAt) &&
    (value.source === 'probe' || value.source === 'session') &&
    isStringOrNull(value.subscriptionType) &&
    typeof value.rateLimitsAvailable === 'boolean' &&
    isWindowOrNull(value.fiveHour) &&
    isWindowOrNull(value.sevenDay) &&
    isWindowOrNull(value.sevenDayOverage) &&
    isWindowOrNull(value.sevenDayOpus) &&
    isWindowOrNull(value.sevenDaySonnet) &&
    Array.isArray(value.modelScoped) &&
    value.modelScoped.every((window) => isWindow(window) && typeof (window as { displayName?: unknown }).displayName === 'string') &&
    (value.windows === undefined || (Array.isArray(value.windows) && value.windows.every(isWindow))) &&
    (value.extraUsage === null || isPlainObject(value.extraUsage)) &&
    (value.status === null || value.status === 'allowed' || value.status === 'allowed_warning' || value.status === 'rejected') &&
    (value.limited === null || isPlainObject(value.limited)) &&
    isStringOrNull(value.error)
  )
}

/** What `parseState` read, and how many entries it had to drop. */
export interface StateReadResult {
  state: DaemonState
  /** Entries left out because they did not check out. */
  dropped: number
  /** Null when the file was read; otherwise why the state starts empty. */
  problem: 'missing' | 'corrupt' | 'wrong-version' | null
}

/**
 * Reads a parsed `state.json` without ever throwing. Cooldowns that have run out and sessions
 * older than `SESSION_MAX_AGE_MS` are dropped too, but are not counted in `dropped`.
 */
export function parseState(value: unknown, now: number): StateReadResult {
  const state = emptyState()
  if (!isPlainObject(value)) return { state, dropped: 0, problem: 'corrupt' }
  if (value.version !== STATE_VERSION) return { state, dropped: 0, problem: 'wrong-version' }
  let dropped = 0
  const entries = (field: unknown): Array<[string, unknown]> => {
    if (field === undefined) return []
    if (!isPlainObject(field)) {
      dropped++
      return []
    }
    return Object.entries(field)
  }
  for (const [key, usage] of entries(value.usage)) {
    if (isLoginId(key) && isStoredUsage(usage, key)) state.usage.set(key, usage)
    else dropped++
  }
  for (const [key, until] of entries(value.cooldowns)) {
    if (!isLoginId(key) || (until !== null && !isTime(until))) dropped++
    else state.cooldowns.set(key, until === null ? Infinity : until)
  }
  for (const [key, placement] of entries(value.sessions)) {
    if (isSessionId(key) && isPlainObject(placement) && isLoginId(placement.login) && isTime(placement.lastUsed)) {
      state.sessions.set(key, { login: placement.login, lastUsed: placement.lastUsed })
    } else {
      dropped++
    }
  }
  pruneState(state, now)
  return { state, dropped, problem: null }
}

/**
 * Drops cooldowns that have run out, and session placements that are older than
 * `maxAgeMs` or beyond the newest `maxSessions`.
 */
export function pruneState(
  state: DaemonState,
  now: number,
  maxAgeMs = SESSION_MAX_AGE_MS,
  maxSessions = MAX_SESSIONS
): void {
  for (const [login, until] of state.cooldowns) if (until <= now) state.cooldowns.delete(login)
  for (const [session, placement] of state.sessions) {
    if (now - placement.lastUsed > maxAgeMs) state.sessions.delete(session)
  }
  if (state.sessions.size > maxSessions) {
    const newestFirst = [...state.sessions].sort((a, b) => b[1].lastUsed - a[1].lastUsed)
    state.sessions = new Map(newestFirst.slice(0, maxSessions))
  }
}

/** The file's JSON form. */
export function serializeState(state: DaemonState): unknown {
  const usage: Record<string, AccountUsage> = {}
  for (const [login, snapshot] of state.usage) usage[login] = snapshot
  const cooldowns: Record<string, number | null> = {}
  for (const [login, until] of state.cooldowns) cooldowns[login] = Number.isFinite(until) ? until : null
  // No prototype, so a session id such as `__proto__` is stored as an ordinary key.
  const sessions: Record<string, SessionPlacement> = Object.create(null) as Record<string, SessionPlacement>
  for (const [session, placement] of state.sessions) sessions[session] = placement
  return { version: STATE_VERSION, usage, cooldowns, sessions }
}

export function loadState(now = Date.now(), path = statePath()): StateReadResult {
  let read
  try {
    read = readJsonFileSync(path)
  } catch {
    return { state: emptyState(), dropped: 0, problem: 'corrupt' }
  }
  if (read.status === 'missing') return { state: emptyState(), dropped: 0, problem: 'missing' }
  if (read.status === 'corrupt') return { state: emptyState(), dropped: 0, problem: 'corrupt' }
  return parseState(read.value, now)
}

export async function saveState(state: DaemonState, path = statePath()): Promise<void> {
  await writeJsonFile(path, serializeState(state))
}

/** For the daemon's last write while it shuts down. */
export function saveStateSync(state: DaemonState, path = statePath()): void {
  writeJsonFileSync(path, serializeState(state))
}

export interface CoalescedWriter {
  /** Asks for a write. It happens at once, or `minIntervalMs` after the previous one started. */
  schedule(): void
  /** Writes now if a write was asked for and has not happened, and waits for it. */
  flush(): Promise<void>
  /** Whether a write was asked for and has not finished yet. */
  pending(): boolean
}

/**
 * Runs `write` at most once every `minIntervalMs`, however often `schedule` is called. `write`
 * should save the state as it is when it runs, so one write covers every change scheduled
 * before it. Two writes never overlap: a change made during a write schedules the next one.
 * The timer does not keep the process alive, so the daemon calls `flush` before it exits.
 * A failed write is passed to `onError` and the next `schedule` tries again.
 */
export function createCoalescedWriter(
  write: () => Promise<void>,
  options: { minIntervalMs: number; onError?: (error: unknown) => void }
): CoalescedWriter {
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<void> | null = null
  let lastStart = -Infinity

  const run = (): Promise<void> => {
    timer = null
    if (!dirty || inFlight !== null) return inFlight ?? Promise.resolve()
    dirty = false
    lastStart = Date.now()
    const started = write()
      .catch((error: unknown) => options.onError?.(error))
      .finally(() => {
        inFlight = null
        if (dirty) arm()
      })
    inFlight = started
    return started
  }

  const arm = (): void => {
    if (timer !== null || inFlight !== null) return
    const wait = Math.max(0, lastStart + options.minIntervalMs - Date.now())
    timer = setTimeout(() => void run(), wait)
    timer.unref?.()
  }

  return {
    schedule() {
      dirty = true
      arm()
    },
    async flush() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (inFlight !== null) await inFlight
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (dirty) await run()
    },
    pending() {
      return dirty || inFlight !== null
    }
  }
}
