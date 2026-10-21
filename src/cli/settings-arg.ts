// The `--settings` argument `kurmis claude` starts claude with (decision 9 in docs/architecture.md,
// "How a Claude CLI reaches the daemon").
//
// Claude Code reads its environment from three layers, each beating the one before: the process
// environment, the `env` block of the user's `settings.json`, and the `env` block of
// `--settings`. In global mode `settings.json` names the daemon too, so a routing variable the
// wrapper put only in the process environment would be ignored. The wrapper therefore passes the
// routing variables (`ROUTING_VARIABLES`) in the `env` of a `--settings` file as well.
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
// The file is in the data folder (`wrapperSettingsFolder`), mode 0600, and named after a hash of
// its contents, so every start with the same settings uses the same file. It is not deleted when
// claude exits: claude passes its `--settings` value on to processes it starts itself (such as
// sessions it runs in the background), which may run longer than the wrapper. Files that no start
// has used for `SETTINGS_FILE_MAX_AGE_MS` are removed.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { ROUTING_VARIABLES, type RoutedEnv } from '../core/routed-env.ts'
import { writeFileAtomicSync } from '../data/json-file.ts'
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

/** The routing variables of a routed environment: the entries of `routed.set` named in `ROUTING_VARIABLES`. */
export function routingVariables(routed: RoutedEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of ROUTING_VARIABLES) {
    const value = routed.set[name]
    if (value !== undefined) out[name] = value
  }
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

/**
 * The arguments to start claude with: one `--settings` naming the file with the merged settings,
 * first, then the person's arguments without their own `--settings`. `user` is what
 * `readUserSettingsArg` answered; `store` writes the settings and answers the file's path.
 */
export function claudeArgsWithSettings(user: UserSettingsArg, routing: Record<string, string>,
  store: (text: string) => string = storeSettingsFile): string[] {
  return [FLAG, store(JSON.stringify(mergeRoutingSettings(user.settings, routing))), ...user.rest]
}

/** How long a settings file that no start has used is kept: longer than any session runs. */
export const SETTINGS_FILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

const SETTINGS_FILE_NAME = /^[0-9a-f]{32}\.json$/

/**
 * Writes `text` to a file in `folder` named after its SHA-256, readable by the user only, and
 * answers the file's path. A file of that name that already holds the text is only marked as
 * used now. Files in the folder unused for `SETTINGS_FILE_MAX_AGE_MS` are removed.
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

function pruneSettingsFiles(folder: string, now: number, keep: string): void {
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return
  }
  for (const name of names) {
    const file = join(folder, name)
    if (!SETTINGS_FILE_NAME.test(name) || file === keep) continue
    try {
      if (now - statSync(file).mtimeMs > SETTINGS_FILE_MAX_AGE_MS) rmSync(file, { force: true })
    } catch {
      // Removed by another start at the same moment.
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
 * The `ANTHROPIC_CUSTOM_HEADERS` claude would see without kurmis: the value of the highest layer
 * that sets it (`--settings` beats the user settings file, which beats the process environment).
 * Kurmis keeps the person's own headers from it and adds its own. Null when no layer sets it.
 */
export function inheritedCustomHeaders(layers: CustomHeaderLayers): string | null {
  for (const env of [layers.flagEnv, layers.userSettingsEnv]) {
    if (env === null || !(CUSTOM_HEADERS in env)) continue
    const value = env[CUSTOM_HEADERS]
    if (typeof value === 'string') return value
  }
  for (const [name, value] of Object.entries(layers.processEnv)) {
    const same = layers.windows === true ? name.toUpperCase() === CUSTOM_HEADERS : name === CUSTOM_HEADERS
    if (same && value !== undefined) return value
  }
  return null
}
