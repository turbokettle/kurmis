// The daemon's log, `daemon.log`. It must never hold a token, a request or response body, or
// an email address, so it takes no free text at all:
//
// - the message is one of the fixed event names in `LOG_EVENTS`;
// - each field has a fixed name and a type that cannot carry text: a number, a boolean, a
//   checked `LoginId`, or one of the fixed words in the lists below.
//
// TypeScript rejects anything else at compile time, and `formatLogLine` checks every value
// again at run time, writing `[redacted]` for one that does not pass. A new event or word is
// added to the lists here, where a reviewer sees it.
//
// The log is capped at `maxBytes`. When a line would pass the cap the file is renamed to
// `daemon.log.1`, replacing the previous one, and a new file is started.
import { appendFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { makePrivateDirSync, PRIVATE_FILE_MODE, retryWhileLockedSync } from '../platform/files.ts'
import { isLoginId, isLoginProvider, type LoginId, type LoginProvider } from './login-id.ts'
import { logPath, previousLogPath } from './paths.ts'

export const LOG_EVENTS = [
  'daemon_started',
  'daemon_stopping',
  'daemon_stopped',
  'daemon_replacing_older',
  'port_in_use',
  'config_loaded',
  'config_invalid',
  'state_loaded',
  'state_write_failed',
  'control_request',
  'control_rejected',
  'proxy_rejected',
  'request_forwarded',
  'request_failed',
  'retry_other_login',
  'retry_after_backoff',
  'pool_exhausted',
  'cooldown_started',
  'cooldown_ended',
  'session_placed',
  'session_moved',
  'token_read_failed',
  'token_renewal_started',
  'token_renewal_finished',
  'usage_probe_started',
  'usage_probe_finished',
  'usage_probe_failed',
  'internal_error'
] as const

export type LogEvent = (typeof LOG_EVENTS)[number]

/** Why something happened, for `reason`. */
export const LOG_REASONS = [
  'usage_limit',
  'overload',
  'unauthorized',
  'bad_secret',
  'no_credentials',
  'token_expired',
  'timeout',
  'network',
  'upstream_error',
  'invalid',
  'missing',
  'corrupt',
  'wrong_version',
  'shutdown',
  'signal',
  'replaced',
  'config_changed',
  'pinned',
  'out_of_pool',
  'other'
] as const

export type LogReason = (typeof LOG_REASONS)[number]

/** Error codes, for `code`. `errorCodeOf` maps any error to one of these. */
export const LOG_ERROR_CODES = [
  'EADDRINUSE',
  'EACCES',
  'EPERM',
  'EBUSY',
  'ENOENT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ABORT_ERR',
  'other'
] as const

export type LogErrorCode = (typeof LOG_ERROR_CODES)[number]

export const LOG_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'other'] as const

export type LogMethod = (typeof LOG_METHODS)[number]

/** Every field a log line may have. Nothing here can hold free text. */
export interface LogFields {
  login?: LoginId
  /** The login a session moved from, beside `login` for the one it moved to. */
  fromLogin?: LoginId
  provider?: LoginProvider
  reason?: LogReason
  code?: LogErrorCode
  method?: LogMethod
  /** An HTTP status code. */
  status?: number
  /** A duration in milliseconds. */
  ms?: number
  attempt?: number
  count?: number
  port?: number
  pid?: number
  /** A time in milliseconds since epoch, e.g. when a cooldown ends. */
  until?: number
  ok?: boolean
}

type FieldCheck = (value: unknown) => boolean

const isNumber: FieldCheck = (value) => typeof value === 'number' && !Number.isNaN(value)
const oneOf = (words: readonly string[]): FieldCheck => (value) => typeof value === 'string' && words.includes(value)

const FIELD_CHECKS: Record<keyof LogFields, FieldCheck> = {
  login: isLoginId,
  fromLogin: isLoginId,
  provider: isLoginProvider,
  reason: oneOf(LOG_REASONS),
  code: oneOf(LOG_ERROR_CODES),
  method: oneOf(LOG_METHODS),
  status: isNumber,
  ms: isNumber,
  attempt: isNumber,
  count: isNumber,
  port: isNumber,
  pid: isNumber,
  until: isNumber,
  ok: (value) => typeof value === 'boolean'
}

const REDACTED = '[redacted]'

/** The error's `code` when it is one the log knows, otherwise `other`. */
export function errorCodeOf(error: unknown): LogErrorCode {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && (LOG_ERROR_CODES as readonly string[]).includes(code) ? (code as LogErrorCode) : 'other'
}

/** An HTTP method as a log word; anything unusual becomes `other`. */
export function methodOf(method: string | undefined): LogMethod {
  return method !== undefined && (LOG_METHODS as readonly string[]).includes(method) ? (method as LogMethod) : 'other'
}

/**
 * One log line: `<ISO time> <event> key=value ...` and a newline. An unknown event is written
 * as `invalid_event`, an unknown field name as `[redacted]=[redacted]`, and a value that fails
 * its field's check as `key=[redacted]`.
 */
export function formatLogLine(event: LogEvent, fields: LogFields = {}, now = Date.now()): string {
  const name = (LOG_EVENTS as readonly string[]).includes(event) ? event : 'invalid_event'
  const parts = [new Date(now).toISOString(), name]
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (value === undefined) continue
    const check = Object.hasOwn(FIELD_CHECKS, key) ? FIELD_CHECKS[key as keyof LogFields] : undefined
    if (check === undefined) parts.push(`${REDACTED}=${REDACTED}`)
    else parts.push(`${key}=${check(value) ? String(value) : REDACTED}`)
  }
  return `${parts.join(' ')}\n`
}

export interface DaemonLog {
  write(event: LogEvent, fields?: LogFields): void
}

export interface DaemonLogOptions {
  path?: string
  /** Where the rotated file goes. Defaults to `daemon.log.1` beside `path`. */
  previousPath?: string
  /** Default 5 MB. */
  maxBytes?: number
  now?: () => number
}

export const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024

/**
 * Opens the log for appending. A write never throws: a log that cannot be written is
 * skipped, since the daemon must keep serving.
 */
export function openDaemonLog(options: DaemonLogOptions = {}): DaemonLog {
  const path = options.path ?? logPath()
  const previous = options.previousPath ?? (options.path === undefined ? previousLogPath() : `${path}.1`)
  const maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES
  const now = options.now ?? Date.now
  let size: number | null = null

  const currentSize = (): number => {
    try {
      return statSync(path).size
    } catch {
      return 0
    }
  }

  const rotate = (): void => {
    try {
      retryWhileLockedSync(() => renameSync(path, previous))
    } catch {
      // A rename that fails even after the retries (Windows, file held open) starts the log
      // again in place rather than letting it grow.
      rmSync(path, { force: true })
    }
    size = 0
  }

  return {
    write(event, fields) {
      try {
        const line = formatLogLine(event, fields, now())
        const bytes = Buffer.byteLength(line)
        if (size === null) {
          makePrivateDirSync(dirname(path))
          size = currentSize()
        }
        // Another process (an older daemon being replaced) may have written too, so the size
        // is read from the disk again before a rotation.
        if (size + bytes > maxBytes) {
          size = currentSize()
          if (size + bytes > maxBytes && size > 0) rotate()
        }
        appendFileSync(path, line, { mode: PRIVATE_FILE_MODE })
        size += bytes
      } catch {
        // Logging must never stop the daemon.
      }
    }
  }
}
