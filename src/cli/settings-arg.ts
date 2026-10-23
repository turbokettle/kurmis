// The `--settings` argument `kurmis claude` starts claude with (docs/architecture.md, "How a
// Claude CLI reaches the daemon").
//
// Claude Code reads its environment from three layers, each beating the one before: the process
// environment, the `env` block of the user's `settings.json`, and the `env` block of
// `--settings`. In global mode `settings.json` names the daemon too, so a routing variable the
// wrapper put only in the process environment would be ignored. The wrapper therefore passes the
// routing variables (`ROUTING_VARIABLES`) in the `env` of a `--settings` file as well, and sets
// the variables that hand claude a token of its own (`OAUTH_TOKEN_VARIABLES`) to the empty string
// there, which Claude Code reads as unset, so a value in a settings file does not apply either.
//
// How Claude Code 2.1.301 reads `--settings`, from its bundled source:
//
// - Before the command-line parser runs, it scans the whole argument list up to the first `--`
//   for `--settings <value>` and `--settings=<value>`, and loads the last one it finds. Earlier
//   ones are ignored.
// - Its command-line parser has positional options turned on, so `--settings` as an option of
//   the root command must come before a subcommand: `claude --settings X mcp list` parses, while
//   `claude mcp list --settings X` is refused for most subcommands.
// - A value whose trimmed text starts with `{` and ends with `}` is inline JSON. Anything else is
//   a file path, relative to the folder claude was started in. `~` is not expanded.
//
// So kurmis passes exactly one `--settings`, first, ahead of every argument of the person's.
// When the person's arguments carry their own `--settings`, the last one (the one claude would
// have used) is read, kurmis' variables are merged into its `env`, and the merged settings are
// passed in kurmis' place; every `--settings` of theirs is taken out. Their file is never changed.
//
// The merged settings go to claude as a file path, not as inline JSON, because they hold the
// daemon's key and a command line is visible to every user of the machine in the process list.
// The file is in the data folder (`wrapperSettingsFolder`), mode 0600. There are two kinds:
//
// - Without a `--settings` of the person's, the file holds only kurmis' variables. It is named
//   after a hash of its contents (`<hash>.json`), so every start with the same settings uses
//   the same file, and it is kept: claude passes its `--settings` value on to processes it
//   starts itself (such as sessions it runs in the background), which may run longer than the
//   wrapper. Files that no start has used for `SETTINGS_FILE_MAX_AGE_MS` are removed.
// - With one, the file is a copy of the person's settings, which may hold secrets of theirs, so
//   it is the wrapper's own (`run-<pid>-<random>.json`) and deleted when the wrapper ends. A
//   process claude starts with it after that cannot start: Claude Code stops with "Settings file
//   not found". A file whose wrapper was killed is removed by the next start, which tells it
//   apart from the file of a wrapper still running by the pid in its name: a pid that no longer
//   runs, or a file older than `SETTINGS_FILE_MAX_AGE_MS` (the pid may have been reused).
import { createHash, randomBytes } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { OAUTH_TOKEN_VARIABLES, ROUTING_VARIABLES, USER_OWNED_ROUTING_VARIABLES, type EnvPatch } from '../core/routed-env.ts'
import { writeFileAtomicSync } from '../data/json-file.ts'
import { isProcessAlive } from '../data/lock.ts'
import { wrapperSettingsFolder } from '../data/paths.ts'
import { PRIVATE_FILE_MODE } from '../platform/files.ts'
import { notJsonText } from './json-error.ts'

const FLAG = '--settings'

/** The person's own `--settings`, read, and their arguments without it. */
export interface UserSettingsArg {
  /** The settings object of the last `--settings` before claude's `--`, or null when there was none. */
  settings: Record<string, unknown> | null
  /** `inline`, or the absolute path of the file it came from; null when there was none. */
  source: string | null
  /** The arguments with every `--settings` and its value before claude's `--` taken out. */
  rest: string[]
}

export interface SettingsArgOptions {
  /** The folder claude is started in, for a relative settings path. */
  cwd: string
  /** Reads a settings file as UTF-8. Defaults to `fs.readFileSync`. */
  readFile?: (path: string) => string
}

/**
 * Finds the person's `--settings` among the arguments for claude and reads it. Returns an error
 * sentence when its value is missing or empty, is not a JSON object, has an `env` that is not an
 * object, or names a file that cannot be read; kurmis refuses to start claude then rather than
 * guess what was meant.
 */
export function readUserSettingsArg(args: readonly string[], options: SettingsArgOptions): UserSettingsArg | { error: string } {
  const rest: string[] = []
  let value: string | null = null
  let index = 0
  for (; index < args.length; index++) {
    const arg = args[index] as string
    if (arg === '--') break
    if (arg === FLAG) {
      const next = args[index + 1]
      if (next === undefined) return { error: `${FLAG} needs a value: a settings file or a JSON object` }
      value = next
      index++
      continue
    }
    if (arg.startsWith(`${FLAG}=`)) {
      value = arg.slice(FLAG.length + 1)
      continue
    }
    rest.push(arg)
  }
  rest.push(...args.slice(index))
  if (value === null) return { settings: null, source: null, rest }
  if (value.trim() === '') return { error: `${FLAG} needs a value: a settings file or a JSON object` }

  const text = value.trim()
  if (text.startsWith('{') && text.endsWith('}')) {
    const settings = parseSettings(text, `the JSON given to ${FLAG}`)
    return 'error' in settings ? settings : { settings: settings.value, source: 'inline', rest }
  }
  const path = isAbsolute(value) ? value : resolve(options.cwd, value)
  let fileText: string
  try {
    fileText = (options.readFile ?? ((file: string) => readFileSync(file, 'utf8')))(path)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    const why = code === 'ENOENT' ? 'it does not exist' : error instanceof Error ? error.message : String(error)
    return { error: `${FLAG}: cannot read the settings file ${path}: ${why}` }
  }
  const settings = parseSettings(fileText, `the settings file ${path}`)
  return 'error' in settings ? settings : { settings: settings.value, source: path, rest }
}

function parseSettings(text: string, what: string): { value: Record<string, unknown> } | { error: string } {
  let value: unknown
  try {
    value = JSON.parse(withoutBom(text))
  } catch {
    // Never `JSON.parse`'s message: it quotes the text, which may hold a secret.
    return { error: `${FLAG}: ${what} is ${notJsonText(withoutBom(text))}` }
  }
  if (!isPlainObject(value)) return { error: `${FLAG}: ${what} is not a JSON object` }
  if (value.env !== undefined && !isPlainObject(value.env)) {
    return { error: `${FLAG}: the "env" in ${what} is not an object` }
  }
  return { value }
}

/** The text without a leading byte order mark, which some Windows editors write. */
function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The routing variables of a routed environment: the values `routed` sets for `ROUTING_VARIABLES`. */
export function routingVariables(routed: EnvPatch): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of ROUTING_VARIABLES) {
    const value = routed[name]
    if (value !== undefined) out[name] = value
  }
  return out
}

/**
 * The `env` the wrapper's `--settings` gives claude: the routing variables of `routed`, and every
 * one of `OAUTH_TOKEN_VARIABLES` set to the empty string. The routed environment has those
 * removed, but a value in the person's `--settings` or in the user settings file would beat that.
 * Claude Code 2.1.306 reads an empty value as unset (read from its bundled source): it tests
 * `CLAUDE_CODE_OAUTH_TOKEN` for a value that is not empty wherever it reads it, and takes the
 * same path for an empty `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` as for an unset one.
 */
export function settingsEnv(routed: EnvPatch): Record<string, string> {
  const out = routingVariables(routed)
  for (const name of OAUTH_TOKEN_VARIABLES) out[name] = ''
  return out
}

/**
 * The settings object with kurmis' variables in its `env`. Every other key of the person's
 * settings, and every other variable of their `env`, is kept; for the routing variables kurmis'
 * values win. The input is not changed.
 */
export function mergeRoutingSettings(user: Record<string, unknown> | null, routing: Record<string, string>): Record<string, unknown> {
  const userEnv = user !== null && isPlainObject(user.env) ? user.env : {}
  return { ...(user ?? {}), env: { ...userEnv, ...routing } }
}

/** A settings file written for one start, and how to remove it when the wrapper is done. */
export interface StoredSettings {
  path: string
  /** Deletes the file if it is the wrapper's own; does nothing for a shared one. Never throws. */
  remove(): void
}

/** Writes the merged settings; `holdsUserSettings` says whether they hold a copy of the person's own. */
export type SettingsStore = (text: string, holdsUserSettings: boolean) => StoredSettings

/**
 * The arguments to start claude with: one `--settings` naming the file with the merged settings,
 * first, then the person's arguments without their own `--settings`. `user` is what
 * `readUserSettingsArg` answered; `store` writes the settings. `remove` deletes the file again
 * when it holds a copy of the person's settings, and is to be called once claude has ended.
 */
export function claudeArgsWithSettings(user: UserSettingsArg, routing: Record<string, string>,
  store: SettingsStore = storeSettings): { args: string[]; remove: () => void } {
  const stored = store(JSON.stringify(mergeRoutingSettings(user.settings, routing)), user.settings !== null)
  return { args: [FLAG, stored.path, ...user.rest], remove: () => stored.remove() }
}

/** How long a settings file that no start has used is kept: longer than any session runs. */
export const SETTINGS_FILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const SETTINGS_FILE_NAME = /^[0-9a-f]{32}\.json$/
const RUN_SETTINGS_FILE_NAME = /^run-(\d+)-[0-9a-f]{16}\.json$/

/**
 * Writes the settings for one start (see the top of this file): to the shared file named after
 * their hash, or, when they hold a copy of the person's settings, to a file of this wrapper's
 * own that `remove` deletes. Either way, files that are no longer used are removed first.
 */
export function storeSettings(text: string, holdsUserSettings: boolean, folder: string = wrapperSettingsFolder(),
  now: number = Date.now(), pid: number = process.pid): StoredSettings {
  if (!holdsUserSettings) return { path: storeSettingsFile(text, folder, now), remove: () => undefined }
  pruneSettingsFiles(folder, now, null)
  const path = join(folder, `run-${String(pid)}-${randomBytes(8).toString('hex')}.json`)
  writeFileAtomicSync(path, text, { mode: PRIVATE_FILE_MODE })
  return {
    path,
    remove: () => {
      try {
        rmSync(path, { force: true })
      } catch {
        // Held open on Windows; the next start removes it once this pid has ended.
      }
    }
  }
}

/**
 * Writes `text` to a file in `folder` named after its SHA-256, readable by the user only, and
 * answers the file's path. A file of that name that already holds the text is only marked as
 * used now. Files in the folder that are no longer used are removed (`pruneSettingsFiles`).
 */
export function storeSettingsFile(text: string, folder: string = wrapperSettingsFolder(), now: number = Date.now()): string {
  const path = join(folder, `${createHash('sha256').update(text).digest('hex').slice(0, 32)}.json`)
  let current = false
  try {
    current = readFileSync(path, 'utf8') === text
  } catch {
    // Not written yet.
  }
  if (current) {
    try {
      utimesSync(path, now / 1000, now / 1000)
    } catch {
      // Only the pruning reads the time.
    }
  } else {
    writeFileAtomicSync(path, text, { mode: PRIVATE_FILE_MODE })
  }
  pruneSettingsFiles(folder, now, path)
  return path
}

/**
 * Removes the shared files no start has used for `SETTINGS_FILE_MAX_AGE_MS`, except `keep`, and
 * the files of wrappers that have ended: their pid no longer runs, or the file is older than
 * `SETTINGS_FILE_MAX_AGE_MS` (a reused pid).
 */
function pruneSettingsFiles(folder: string, now: number, keep: string | null): void {
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return
  }
  for (const name of names) {
    const file = join(folder, name)
    const run = RUN_SETTINGS_FILE_NAME.exec(name)
    if ((!SETTINGS_FILE_NAME.test(name) && run === null) || file === keep) continue
    try {
      const old = now - statSync(file).mtimeMs > SETTINGS_FILE_MAX_AGE_MS
      if (old || (run !== null && !isProcessAlive(Number(run[1])))) rmSync(file, { force: true })
    } catch {
      // Removed by another start at the same moment, or held open on Windows.
    }
  }
}

/**
 * The user settings file Claude Code reads: `$CLAUDE_CONFIG_DIR/settings.json` when
 * `CLAUDE_CONFIG_DIR` is set and not empty, otherwise `settings.json` in `.claude` in the home
 * folder.
 */
export function claudeUserSettingsPath(env: NodeJS.ProcessEnv, home: string = homedir()): string {
  const configDir = env.CLAUDE_CONFIG_DIR
  return configDir !== undefined && configDir !== '' ? join(configDir, 'settings.json') : join(home, '.claude', 'settings.json')
}

/** The `env` block of the user settings file, and a warning when the file is there but cannot be read. */
export interface UserSettingsEnv {
  env: Record<string, unknown> | null
  warning: string | null
}

/**
 * Reads the `env` block of the user settings file. A missing file, or one without `env`, is no
 * `env`. A file that cannot be read or is not JSON is no `env` with a warning: claude reports
 * such a file itself, and kurmis only reads it for the person's own custom headers.
 */
export function readUserSettingsEnv(path: string, readFile: (path: string) => string = (file) => readFileSync(file, 'utf8')): UserSettingsEnv {
  let text: string
  try {
    text = readFile(path)
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT' || code === 'ENOTDIR') return { env: null, warning: null }
    return { env: null, warning: `could not read ${path} (${error instanceof Error ? error.message : String(error)})` }
  }
  let value: unknown
  try {
    value = JSON.parse(withoutBom(text))
  } catch {
    return { env: null, warning: `${path} is ${notJsonText(withoutBom(text))}, so custom headers set there are not kept` }
  }
  if (!isPlainObject(value) || !isPlainObject(value.env)) return { env: null, warning: null }
  return { env: value.env, warning: null }
}

/** The layers that may set `ANTHROPIC_CUSTOM_HEADERS`, lowest first in effect. */
export interface CustomHeaderLayers {
  /** The `env` of the person's `--settings`, if any. */
  flagEnv: Record<string, unknown> | null
  /** The `env` of the user settings file, if any. */
  userSettingsEnv: Record<string, unknown> | null
  /** The process environment claude inherits. */
  processEnv: Readonly<Record<string, string | undefined>>
  /** Match the process environment's names without regard to case, as Windows does. */
  windows?: boolean
}

const CUSTOM_HEADERS = 'ANTHROPIC_CUSTOM_HEADERS'

/**
 * The value of `variable` claude would see without kurmis: the value of the highest layer that
 * sets it to a string (`--settings` beats the user settings file, which beats the process
 * environment). Null when no layer sets it.
 */
export function inheritedVariable(layers: CustomHeaderLayers, variable: string): string | null {
  for (const env of [layers.flagEnv, layers.userSettingsEnv]) {
    if (env === null || !(variable in env)) continue
    const value = env[variable]
    if (typeof value === 'string') return value
  }
  for (const [name, value] of Object.entries(layers.processEnv)) {
    const same = layers.windows === true ? name.toUpperCase() === variable.toUpperCase() : name === variable
    if (same && value !== undefined) return value
  }
  return null
}

/**
 * The `ANTHROPIC_CUSTOM_HEADERS` claude would see without kurmis (`inheritedVariable`). Kurmis
 * keeps the person's own headers from it and adds its own.
 */
export function inheritedCustomHeaders(layers: CustomHeaderLayers): string | null {
  return inheritedVariable(layers, CUSTOM_HEADERS)
}

/**
 * The routing variables of `USER_OWNED_ROUTING_VARIABLES` that a layer sets to a value that is
 * not empty, so the wrapper leaves them as the person has them.
 */
export function userOwnedRoutingVariables(layers: CustomHeaderLayers): string[] {
  return USER_OWNED_ROUTING_VARIABLES.filter((name) => {
    for (const env of [layers.flagEnv, layers.userSettingsEnv]) {
      if (env !== null && env[name] !== undefined && env[name] !== null && env[name] !== '') return true
    }
    const value = inheritedVariable({ flagEnv: null, userSettingsEnv: null, processEnv: layers.processEnv, windows: layers.windows }, name)
    return value !== null && value !== ''
  })
}
