// Whether global routing (`kurmis setup`) is on, paused or off, read from the files alone, so
// that a command can answer it without the daemon. Nothing here writes a file except
// `markPaused`, `clearPaused` and `recordSettingsFile`.
//
// - **on:** one of the Claude Code settings files below points `ANTHROPIC_BASE_URL` at kurmis
//   (`routesThroughKurmis`).
// - **paused:** none does, and `paused.json` is in the data folder. `kurmis setup --pause`
//   writes that file when it takes kurmis' settings out, and `kurmis setup` deletes it once
//   they are back in.
// - **off:** neither.
//
// The settings files are the one the current environment names (`claudeSettingsPath`:
// `CLAUDE_CONFIG_DIR` moves it) and every file `kurmis setup` recorded in
// `settings-files.json` when it put kurmis' settings into it. So a setup run with
// `CLAUDE_CONFIG_DIR` set is still seen from a shell without it, and the other way round.
//
// The start at login is not part of the answer: Linux has none, and a pause leaves it in place.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { readConfig } from '../data/config.ts'
import { readJsonFileSync, writeJsonFileSync } from '../data/json-file.ts'
import { withFileLockSync } from '../data/lock.ts'
import { pausedFilePath, setupSettingsRecordPath } from '../data/paths.ts'
import { PRIVATE_FILE_MODE } from '../platform/files.ts'
import { claudeSettingsPath, routesThroughKurmis } from './global-settings.ts'
import { claudeUserSettingsPath } from './settings-arg.ts'

export type GlobalRoutingState = 'on' | 'paused' | 'off'

/**
 * Whether global routing is on, paused or off (see the top of this file). `env` decides which
 * settings file is read besides the recorded ones, as it does for `kurmis setup`. Never throws:
 * a file that cannot be read counts as not routing through kurmis. Writes nothing.
 */
export function globalRoutingState(env: NodeJS.ProcessEnv): GlobalRoutingState {
  const port = configuredPort()
  for (const path of settingsFilesWith(settingsPathFor(env)).files) {
    if (routesThroughKurmis(readOrNull(path), port)) return 'on'
  }
  return isPaused() ? 'paused' : 'off'
}

/** Whether `paused.json` is in the data folder. */
export function isPaused(): boolean {
  return existsSync(pausedFilePath())
}

/** Writes `paused.json`, which holds the time of the pause for a person who reads it. */
export function markPaused(now: Date = new Date()): void {
  writeJsonFileSync(pausedFilePath(), { pausedAt: now.toISOString() }, { mode: PRIVATE_FILE_MODE })
}

/** Deletes `paused.json`. Answers whether it was there. */
export function clearPaused(): boolean {
  const path = pausedFilePath()
  if (!existsSync(path)) return false
  rmSync(path, { force: true })
  return true
}

/** The settings files `settings-files.json` names, and why it could not be read, if it could not. */
export interface SettingsFiles {
  files: string[]
  /** A sentence saying that the record is damaged or cannot be read; null when it read. */
  problem: string | null
}

/**
 * The settings files `kurmis setup` recorded. A missing record names none. A record that is not
 * JSON or not in the shape `recordSettingsFile` writes names none and says so in `problem`.
 */
export function recordedSettingsFiles(): SettingsFiles {
  const path = setupSettingsRecordPath()
  let read
  try {
    read = readJsonFileSync(path)
  } catch (error) {
    return { files: [], problem: `${path} could not be read (${errorCode(error)})` }
  }
  if (read.status === 'missing') return { files: [], problem: null }
  if (read.status === 'corrupt') return { files: [], problem: `${path} is not valid JSON` }
  const files = (read.value as { files?: unknown } | null)?.files
  if (!Array.isArray(files) || !files.every((file) => typeof file === 'string' && file !== '')) {
    return { files: [], problem: `${path} has no list of files in "files"` }
  }
  return { files: files as string[], problem: null }
}

/**
 * `current` first, then each recorded settings file that is not the same path. Paths are
 * compared without regard to case on Windows.
 */
export function settingsFilesWith(current: string, platform: NodeJS.Platform = process.platform): SettingsFiles {
  const recorded = recordedSettingsFiles()
  const files = [current]
  for (const file of recorded.files) {
    if (!files.some((known) => samePath(known, file, platform))) files.push(file)
  }
  return { files, problem: recorded.problem }
}

/**
 * Adds `path` to `settings-files.json`, under its lock, unless it is there already. Setup calls
 * it before it writes kurmis' settings into that file. A damaged record is replaced by one that
 * names only `path`; the answer then says so. Throws when the record cannot be written or its
 * lock cannot be taken.
 */
export function recordSettingsFile(path: string, platform: NodeJS.Platform = process.platform): { damaged: string | null } {
  const record = setupSettingsRecordPath()
  const file = resolve(path)
  return withFileLockSync(`${record}.lock`, () => {
    const current = recordedSettingsFiles()
    if (current.files.some((known) => samePath(known, file, platform))) return { damaged: null }
    writeJsonFileSync(record, { version: 1, files: [...current.files, file] }, { mode: PRIVATE_FILE_MODE })
    return { damaged: current.problem }
  })
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * The settings file setup edits. A `CLAUDE_CONFIG_DIR` inside the data folder (a probe's or a
 * login's folder) is never the user's own, so the default file is read instead.
 */
function settingsPathFor(env: NodeJS.ProcessEnv): string {
  try {
    return claudeSettingsPath(env)
  } catch {
    return claudeUserSettingsPath({ ...env, CLAUDE_CONFIG_DIR: '' })
  }
}

/**
 * The port in `config.json`, read without writing the file, or null when it cannot be read;
 * kurmis' address is then known by its key header.
 */
function configuredPort(): number | null {
  try {
    return readConfig().port
  } catch {
    return null
  }
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException | null)?.code ?? String(error)
}
