// `config.json`: the daemon's port and the logins with their routing settings. The CLI
// writes it; the daemon reads it and reloads it when `configStamp` changes.
//
// The machine's own logins, `claude:default` and `codex:default`, are always in a loaded
// config, first and in that order, whether or not the file names them. The file may hold
// settings for them.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readJsonFileSync, writeJsonFileSync } from './json-file.ts'
import {
  DEFAULT_LOGIN_IDS,
  isDefaultLoginId,
  nameOfLoginId,
  parseLoginId,
  providerOfLoginId,
  toLoginId,
  type LoginId,
  type LoginProvider
} from './login-id.ts'
import { configPath } from './paths.ts'
import {
  child,
  DataFileError,
  expectArray,
  expectBoolean,
  expectInteger,
  expectObject,
  expectString,
  fail,
  topOf,
  type Where
} from './validate.ts'

/** The `version` this build writes. A file with a higher one is refused. */
export const CONFIG_VERSION = 1

/**
 * The daemon's port on 127.0.0.1 when `config.json` sets none. It is below every OS's range
 * for automatically assigned ports (32768 and up on Linux, 49152 and up on macOS and
 * Windows, where Hyper-V also reserves its blocks), so no outgoing connection is given it,
 * and no common tool or dev server defaults to it.
 */
export const DEFAULT_PORT = 28411

/** The lowest and highest port `config.json` may set. Below 1024 needs admin rights. */
export const MIN_PORT = 1024
export const MAX_PORT = 65535

/** TODO(merge): use the core constants for the default limits and the default opt-in. */
export const DEFAULT_FIVE_HOUR_LIMIT = 100
export const DEFAULT_WEEKLY_LIMIT = 100
export const DEFAULT_ROUTING = true

/** A login's settings. Everything kurmis keeps about a login is here; its secret is not. */
export interface LoginSettings {
  id: LoginId
  /** Always the provider in the id. Written to the file so it reads on its own. */
  provider: LoginProvider
  /** The name shown in lists. Defaults to the name half of the id. */
  label: string
  /** Whether Auto routing may use this login. */
  routing: boolean
  /** Auto routing stops using the login once its five-hour window is at this percentage, 1-100. */
  fiveHourLimit: number
  /** The same for the weekly windows, 1-100. */
  weeklyLimit: number
  /** Whether Auto routing takes this login before every other one that has room. */
  useFirst: boolean
}

export interface KurmisConfig {
  version: typeof CONFIG_VERSION
  port: number
  /** The default logins first, then the extra ones in the order they were added. */
  logins: LoginSettings[]
}

/** The changes `updateLogin` may make. The id and provider never change. */
export type LoginSettingsPatch = Partial<Omit<LoginSettings, 'id' | 'provider'>>

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** A login with every setting at its default. */
export function newLoginSettings(id: LoginId, patch: LoginSettingsPatch = {}): LoginSettings {
  const login: LoginSettings = {
    id,
    provider: providerOfLoginId(id),
    label: nameOfLoginId(id),
    routing: DEFAULT_ROUTING,
    fiveHourLimit: DEFAULT_FIVE_HOUR_LIMIT,
    weeklyLimit: DEFAULT_WEEKLY_LIMIT,
    useFirst: false
  }
  return withConfigErrors(() => applyPatch(login, patch, topOf(`settings of ${id}`)))
}

/** Runs `check` and turns any error from it into a `ConfigError` with the same message. */
function withPlainErrors<T>(check: () => T): T {
  try {
    return check()
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error))
  }
}

/** Runs `check` and turns a `DataFileError` from it into a `ConfigError`. */
function withConfigErrors<T>(check: () => T): T {
  try {
    return check()
  } catch (error) {
    if (error instanceof DataFileError) throw new ConfigError(error.message)
    throw error
  }
}

/** The config of a machine with no `config.json`. */
export function defaultConfig(): KurmisConfig {
  return {
    version: CONFIG_VERSION,
    port: DEFAULT_PORT,
    logins: DEFAULT_LOGIN_IDS.map((id) => newLoginSettings(id))
  }
}

function checkLimit(value: unknown, where: Where): number {
  return expectInteger(value, where, 1, 100)
}

function checkLabel(value: unknown, where: Where): string {
  const label = expectString(value, where).trim()
  if (label === '' || label.length > 64) fail(where, 'must be 1 to 64 characters')
  return label
}

/** Checks each set field of a patch and returns the login with it applied. */
function applyPatch(login: LoginSettings, patch: LoginSettingsPatch, where: Where): LoginSettings {
  const next = { ...login }
  if (patch.label !== undefined) next.label = checkLabel(patch.label, child(where, 'label'))
  if (patch.routing !== undefined) next.routing = expectBoolean(patch.routing, child(where, 'routing'))
  if (patch.fiveHourLimit !== undefined) next.fiveHourLimit = checkLimit(patch.fiveHourLimit, child(where, 'fiveHourLimit'))
  if (patch.weeklyLimit !== undefined) next.weeklyLimit = checkLimit(patch.weeklyLimit, child(where, 'weeklyLimit'))
  if (patch.useFirst !== undefined) next.useFirst = expectBoolean(patch.useFirst, child(where, 'useFirst'))
  return next
}

function parseLogin(value: unknown, where: Where): LoginSettings {
  const raw = expectObject(value, where)
  const idText = expectString(raw.id, child(where, 'id'))
  const parsed = parseLoginId(idText)
  if (parsed === null) {
    fail(child(where, 'id'), 'must be claude:<name> or codex:<name>, with a name of 1 to 32 lowercase letters, digits, "-" or "_"')
  }
  if (raw.provider !== undefined && raw.provider !== parsed.provider) {
    fail(child(where, 'provider'), `must be "${parsed.provider}", the provider in the id`)
  }
  const patch: LoginSettingsPatch = {}
  for (const key of ['label', 'routing', 'fiveHourLimit', 'weeklyLimit', 'useFirst'] as const) {
    if (raw[key] !== undefined) (patch as Record<string, unknown>)[key] = raw[key]
  }
  return applyPatch(newLoginSettings(parsed.id), patch, where)
}

/**
 * Brings an older file up to `CONFIG_VERSION`. Version 1 is the only one so far, so this only
 * checks the number; a later version adds a step per version here.
 */
function migrate(raw: Record<string, unknown>, file: string): Record<string, unknown> {
  const version = raw.version
  if (version === undefined) fail(topOf(file), 'has no "version" field')
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    fail(child(topOf(file), 'version'), 'must be a whole number of 1 or more')
  }
  if (version > CONFIG_VERSION) {
    fail(
      topOf(file),
      `was written by a newer kurmis (config version ${String(version)}); this kurmis reads ` +
        `version ${String(CONFIG_VERSION)}. Update kurmis.`
    )
  }
  return raw
}

/**
 * Checks a parsed `config.json` and fills in what it leaves out. Throws a `DataFileError`
 * naming the file and the field for anything wrong. Unknown fields are ignored.
 */
export function parseConfig(value: unknown, file: string): KurmisConfig {
  const raw = migrate(expectObject(value, topOf(file)), file)
  const where = topOf(file)
  const port = raw.port === undefined ? DEFAULT_PORT : expectInteger(raw.port, child(where, 'port'), MIN_PORT, MAX_PORT)
  const listed = raw.logins === undefined ? [] : expectArray(raw.logins, child(where, 'logins'))
  const byId = new Map<LoginId, LoginSettings>()
  listed.forEach((entry, index) => {
    const login = parseLogin(entry, child(child(where, 'logins'), index))
    if (byId.has(login.id)) fail(child(child(child(where, 'logins'), index), 'id'), `repeats "${login.id}"`)
    byId.set(login.id, login)
  })
  const defaults = DEFAULT_LOGIN_IDS.map((id) => byId.get(id) ?? newLoginSettings(id))
  const extras = [...byId.values()].filter((login) => !isDefaultLoginId(login.id))
  return { version: CONFIG_VERSION, port, logins: [...defaults, ...extras] }
}

/**
 * Reads `config.json`. A missing file gives `defaultConfig()`. A file that is not JSON, or
 * has a wrong field, is a `ConfigError` whose message names the file and the field.
 */
export function loadConfig(path = configPath()): KurmisConfig {
  const read = readJsonFileSync(path)
  if (read.status === 'missing') return defaultConfig()
  if (read.status === 'corrupt') throw new ConfigError(`${path} is not valid JSON: ${read.reason}`)
  return withConfigErrors(() => parseConfig(read.value, path))
}

/** Writes `config.json` atomically. Every login is written, the default ones included. */
export function saveConfig(config: KurmisConfig, path = configPath()): void {
  writeJsonFileSync(path, { version: CONFIG_VERSION, port: config.port, logins: config.logins })
}

export function findLogin(config: KurmisConfig, id: string): LoginSettings | undefined {
  return config.logins.find((login) => login.id === id)
}

/** The config with a new login added at the end. Throws when the id is taken or invalid. */
export function addLogin(config: KurmisConfig, id: string, patch: LoginSettingsPatch = {}): KurmisConfig {
  const checked = withPlainErrors(() => toLoginId(id))
  if (findLogin(config, checked) !== undefined) throw new ConfigError(`There is already a login ${checked}.`)
  return { ...config, logins: [...config.logins, newLoginSettings(checked, patch)] }
}

/** The config without a login. The default logins cannot be removed. */
export function removeLogin(config: KurmisConfig, id: string): KurmisConfig {
  if (isDefaultLoginId(id)) throw new ConfigError(`${id} is the machine's own login and cannot be removed.`)
  if (findLogin(config, id) === undefined) throw new ConfigError(`There is no login ${id}.`)
  return { ...config, logins: config.logins.filter((login) => login.id !== id) }
}

/** The config with one login's settings changed. Each changed field is checked. */
export function updateLogin(config: KurmisConfig, id: string, patch: LoginSettingsPatch): KurmisConfig {
  const current = findLogin(config, id)
  if (current === undefined) throw new ConfigError(`There is no login ${id}.`)
  const next = withConfigErrors(() => applyPatch(current, patch, topOf(`settings of ${id}`)))
  return { ...config, logins: config.logins.map((login) => (login.id === id ? next : login)) }
}

/**
 * Loads the config, applies `change`, and saves the result. This is what `login`, `logout`
 * and any settings command use. Two kurmis processes changing the config at the same moment
 * are not coordinated; the later save wins.
 */
export function changeConfig(change: (config: KurmisConfig) => KurmisConfig, path = configPath()): KurmisConfig {
  const next = change(loadConfig(path))
  saveConfig(next, path)
  return next
}

/**
 * A value that changes whenever `config.json`'s contents change: a SHA-256 of the file, or
 * `missing`. The file is small, so the daemon can compare this every few seconds and reload
 * on a change. Unlike a modification time it cannot miss two writes in the same instant.
 */
export function configStamp(path = configPath()): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}
