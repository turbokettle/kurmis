// Whether global routing (`kurmis setup`) is on, paused or off, read from the files alone, so
// that a command can answer it without the daemon.
//
// - **on:** the Claude Code settings file that setup edits (`claudeSettingsPath`) points
//   `ANTHROPIC_BASE_URL` at kurmis (`routesThroughKurmis`).
// - **paused:** it does not, and `paused.json` is in the data folder. `kurmis setup --pause`
//   writes that file when it takes kurmis' settings out, and `kurmis setup` deletes it once
//   they are back in.
// - **off:** neither.
//
// The start at login is not part of the answer: Linux has none, and a pause leaves it in place.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { loadConfig } from '../data/config.ts'
import { writeJsonFileSync } from '../data/json-file.ts'
import { pausedFilePath } from '../data/paths.ts'
import { PRIVATE_FILE_MODE } from '../platform/files.ts'
import { claudeSettingsPath, routesThroughKurmis } from './global-settings.ts'
import { claudeUserSettingsPath } from './settings-arg.ts'

export type GlobalRoutingState = 'on' | 'paused' | 'off'

/**
 * Whether global routing is on, paused or off (see the top of this file). `env` decides which
 * settings file is read, as it does for `kurmis setup`: `CLAUDE_CONFIG_DIR` moves it. Never
 * throws: a file that cannot be read counts as not routing through kurmis.
 */
export function globalRoutingState(env: NodeJS.ProcessEnv): GlobalRoutingState {
  if (routesThroughKurmis(readOrNull(settingsPathFor(env)), configuredPort())) return 'on'
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

/** The port in `config.json`, or null when it cannot be read; kurmis' address is then known by its key header. */
function configuredPort(): number | null {
  try {
    return loadConfig().port
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
