// `daemon.json`: how the CLI finds the running daemon and proves it is the same user. The
// daemon writes it when it has its port and removes it when it stops; the CLI reads it.
//
// It holds the secret every control request and every proxied request must carry, so only
// the user may read it. On macOS and Linux the file is created with mode 0600 inside a 0700
// folder. On Windows the mode does nothing; the file is protected by the access list it
// inherits from `%USERPROFILE%`, which grants the user, SYSTEM and Administrators only. A
// `KURMIS_HOME` outside the profile gets that folder's access list instead.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { rmSync } from 'node:fs'
import { PRIVATE_FILE_MODE } from '../platform/files.ts'
import { readJsonFileSync, writeJsonFileSync } from './json-file.ts'
import { daemonFilePath } from './paths.ts'
import { isPlainObject } from './validate.ts'

export interface DaemonInfo {
  pid: number
  port: number
  /** The kurmis version the daemon runs, so a newer CLI can replace an older daemon. */
  version: string
  /** Sent by clients in `x-kurmis-key`. 64 hex characters. */
  secret: string
  /** Milliseconds since epoch. */
  startedAt: number
}

/** 32 random bytes as hex. */
export function generateDaemonSecret(): string {
  return randomBytes(32).toString('hex')
}

const SECRET_PATTERN = /^[0-9a-f]{64}$/

/** Compares a secret a client sent with the daemon's in constant time. */
export function secretMatches(expected: string, given: string | undefined | null): boolean {
  if (typeof given !== 'string') return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(given, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export type DaemonFileRead =
  | { status: 'missing' }
  | { status: 'ok'; info: DaemonInfo }
  /** The file exists but does not hold a usable record. `reason` never contains the secret. */
  | { status: 'invalid'; reason: string }

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Checks a parsed `daemon.json`. Returns the record, or a sentence saying which field is wrong. */
export function parseDaemonInfo(value: unknown): DaemonInfo | string {
  if (!isPlainObject(value)) return 'is not an object'
  if (!isPositiveInteger(value.pid)) return 'pid must be a positive whole number'
  if (!isPositiveInteger(value.port) || value.port > 65535) return 'port must be a whole number from 1 to 65535'
  if (typeof value.version !== 'string' || value.version === '') return 'version must be a string'
  if (typeof value.secret !== 'string' || !SECRET_PATTERN.test(value.secret)) return 'secret must be 64 hex characters'
  if (typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)) return 'startedAt must be a number'
  return { pid: value.pid, port: value.port, version: value.version, secret: value.secret, startedAt: value.startedAt }
}

export function readDaemonFile(path = daemonFilePath()): DaemonFileRead {
  let read
  try {
    read = readJsonFileSync(path)
  } catch (error) {
    return { status: 'invalid', reason: `${path} could not be read (${String((error as NodeJS.ErrnoException).code)})` }
  }
  if (read.status === 'missing') return { status: 'missing' }
  if (read.status === 'corrupt') return { status: 'invalid', reason: `${path} is not valid JSON` }
  const info = parseDaemonInfo(read.value)
  return typeof info === 'string' ? { status: 'invalid', reason: `${path}: ${info}` } : { status: 'ok', info }
}

/** Writes `daemon.json` atomically, readable by the user only. */
export function writeDaemonFile(info: DaemonInfo, path = daemonFilePath()): void {
  writeJsonFileSync(path, info, { mode: PRIVATE_FILE_MODE })
}

/**
 * Removes `daemon.json` if it still names `pid`, so a stopping daemon does not remove the
 * file of the daemon that replaced it. Returns whether it removed the file.
 */
export function removeDaemonFile(pid: number, path = daemonFilePath()): boolean {
  const read = readDaemonFile(path)
  if (read.status === 'ok' && read.info.pid !== pid) return false
  if (read.status === 'missing') return false
  rmSync(path, { force: true })
  return true
}
