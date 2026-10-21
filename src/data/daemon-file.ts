// Two files tell the CLI how to reach the daemon:
//
// - `daemon.json` says which daemon is running: its pid, port and version. The daemon writes
//   it when it has its port and removes it when it stops.
// - `key` holds the secret every control request and every proxied request must carry. It is
//   created once and kept, because a running Claude CLI and, in global mode,
//   `~/.claude/settings.json` hold a copy of it, and both must keep working after the daemon
//   restarts.
//
// Only the user may read them. On macOS and Linux the files are created with mode 0600 inside
// a 0700 folder. On Windows the mode does nothing; the files are protected by the access list
// they inherit from `%USERPROFILE%`, which grants the user, SYSTEM and Administrators only. A
// `KURMIS_HOME` outside the profile gets that folder's access list instead.
import { randomBytes } from 'node:crypto'
import { linkSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { makePrivateDirSync, PRIVATE_FILE_MODE } from '../platform/files.ts'
import { readJsonFileSync, writeFileAtomicSync, writeJsonFileSync } from './json-file.ts'
import { daemonFilePath, keyPath } from './paths.ts'
import { isPlainObject } from './validate.ts'

export interface DaemonInfo {
  pid: number
  port: number
  /** The kurmis version the daemon runs, so a newer CLI can replace an older daemon. */
  version: string
  /** Milliseconds since epoch. */
  startedAt: number
}

/** 32 random bytes as hex. */
export function generateDaemonSecret(): string {
  return randomBytes(32).toString('hex')
}

const SECRET_PATTERN = /^[0-9a-f]{64}$/

/** The key in the `key` file, or null when there is none or it is not 64 hex characters. */
export function readKey(path = keyPath()): string | null {
  let text
  try {
    text = readFileSync(path, 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  return SECRET_PATTERN.test(text) ? text : null
}

/**
 * The key, created first when there is none. Two processes that start at the same moment get
 * the same key: the new key is written to a temporary file and hard-linked to `key`, which
 * fails when another process got there first, and that process's key is read instead. A
 * damaged file is replaced.
 */
export function readOrCreateKey(path = keyPath()): string {
  const existing = readKey(path)
  if (existing !== null) return existing
  makePrivateDirSync(dirname(path))
  const key = generateDaemonSecret()
  const temporary = join(dirname(path), `.key-${process.pid}-${randomBytes(4).toString('hex')}`)
  writeFileAtomicSync(temporary, `${key}\n`, { mode: PRIVATE_FILE_MODE })
  try {
    linkSync(temporary, path)
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const theirs = readKey(path)
    if (theirs !== null) return theirs
    // The file there is damaged, so it is replaced with this process's key.
    writeFileAtomicSync(path, `${key}\n`, { mode: PRIVATE_FILE_MODE })
    return key
  } finally {
    rmSync(temporary, { force: true })
  }
}

export type DaemonFileRead =
  | { status: 'missing' }
  | { status: 'ok'; info: DaemonInfo }
  /** The file exists but does not hold a usable record. */
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
  if (typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt)) return 'startedAt must be a number'
  return { pid: value.pid, port: value.port, version: value.version, startedAt: value.startedAt }
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
