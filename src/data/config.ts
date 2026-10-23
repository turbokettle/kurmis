// `config.json`: the daemon's port and the logins with their routing settings. The CLI writes
// it, and the daemon writes a login's automatic alias when the login's email changes; the daemon
// reloads it when `configStamp` changes.
//
// The login plain claude uses is always in a loaded config, first. `loadConfig` adds it with a
// new id when the file has none, and saves the file then, so that every reader sees the same id.
// `readConfig` reads the file without writing it, for the readers that must change nothing, and
// so may answer a config without it.
//
// No email is stored here. An automatic alias is made from one (`automaticAlias`), and the
// email itself is read when it is needed from the profile the claude CLI keeps.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DEFAULT_AUTO_ROUTE, DEFAULT_FIVE_HOUR_LIMIT_PERCENT, DEFAULT_WEEKLY_LIMIT_PERCENT } from '../core/accounts.ts'
import { ALIAS_RULE, automaticAlias, isAliasText } from '../core/login-alias.ts'
import { readJsonFileSync, writeJsonFileSync } from './json-file.ts'
import { isLoginId, newLoginId, type LoginId, type LoginRef } from './login-id.ts'
import { LockTimeoutError, withFileLockSync, type FileLockOptions } from './lock.ts'
import { configLockPath, configPath } from './paths.ts'
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

/** The `version` this build writes and reads. A file with another one is refused. */
export const CONFIG_VERSION = 3

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

/** A login's settings. Everything kurmis keeps about a login is here; its secret and email are not. */
export interface LoginSettings extends LoginRef {
  /** The name the person sees and types for the login. Unique among the logins. */
  alias: string
  /**
   * Whether the person chose the alias. Kurmis never changes an alias the person chose; any
   * other follows the login's email (`followEmail`).
   */
  aliasSetByUser: boolean
  /** Whether Auto routing may use this login. */
  routing: boolean
  /** Auto routing stops using the login while its five-hour window is at or above this percentage, 1-100. */
  fiveHourLimit: number
  /** The same for the weekly windows, 1-100. */
  weeklyLimit: number
  /** Whether Auto routing takes this login before every other one that has room. */
  useFirst: boolean
}

export interface KurmisConfig {
  version: typeof CONFIG_VERSION
  port: number
  /** The login plain claude uses first, then the extra ones in the order they were added. */
  logins: LoginSettings[]
}

/**
 * The changes `updateLogin` may make. The id and `usedByPlainClaude` never change. An alias
 * given here is the person's choice (`aliasSetByUser`).
 */
export type LoginSettingsPatch = Partial<Pick<LoginSettings, 'alias' | 'routing' | 'fiveHourLimit' | 'weeklyLimit' | 'useFirst'>>

export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConfigError'
  }
}

/** Whether a login is the one plain claude uses, which kurmis never signs out. */
export function isUsedByPlainClaude(login: LoginRef): boolean {
  return login.usedByPlainClaude
}

/** The login plain claude uses. Every loaded config has one. */
export function plainClaudeLogin(config: KurmisConfig): LoginSettings {
  const own = config.logins.find((login) => login.usedByPlainClaude)
  if (own === undefined) throw new ConfigError('The config has no login that plain claude uses.')
  return own
}

/** The logins kurmis added with `kurmis login`. */
export function extraLogins(config: KurmisConfig): LoginSettings[] {
  return config.logins.filter((login) => !login.usedByPlainClaude)
}

/** A login with every setting at its default, and its id as its alias. */
export function newLoginSettings(ref: LoginRef, patch: LoginSettingsPatch = {}): LoginSettings {
  const login: LoginSettings = {
    id: ref.id,
    usedByPlainClaude: ref.usedByPlainClaude,
    alias: ref.id,
    aliasSetByUser: false,
    routing: DEFAULT_AUTO_ROUTE,
    fiveHourLimit: DEFAULT_FIVE_HOUR_LIMIT_PERCENT,
    weeklyLimit: DEFAULT_WEEKLY_LIMIT_PERCENT,
    useFirst: false
  }
  return withConfigErrors(() => applyPatch(login, patch, topOf(`settings of ${ref.id}`)))
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

/** A config with no logins at all, which `ensurePlainClaudeLogin` completes. */
function emptyConfig(): KurmisConfig {
  return { version: CONFIG_VERSION, port: DEFAULT_PORT, logins: [] }
}

/** The config of a machine with no `config.json`: the login of plain claude, with a new id. */
export function defaultConfig(): KurmisConfig {
  return ensurePlainClaudeLogin(emptyConfig())
}

/**
 * The config with a login for plain claude, added with a new id when the config has none. The
 * same object when it has one.
 */
export function ensurePlainClaudeLogin(config: KurmisConfig): KurmisConfig {
  if (config.logins.some((login) => login.usedByPlainClaude)) return config
  // A new id must not be another login's alias either, or the file would be refused on the next load.
  const id = newLoginId([...loginIds(config), ...config.logins.map((login) => login.alias)])
  return { ...config, logins: ordered([...config.logins, newLoginSettings({ id, usedByPlainClaude: true })]) }
}

/** The login of plain claude first, then the others in the order given. */
function ordered(logins: readonly LoginSettings[]): LoginSettings[] {
  return [...logins.filter((login) => login.usedByPlainClaude), ...logins.filter((login) => !login.usedByPlainClaude)]
}

function checkLimit(value: unknown, where: Where): number {
  return expectInteger(value, where, 1, 100)
}

function checkAlias(value: unknown, where: Where): string {
  const alias = expectString(value, where)
  if (!isAliasText(alias)) fail(where, `must be ${ALIAS_RULE}`)
  return alias
}

/** Checks each set field of a patch and returns the login with it applied. */
function applyPatch(login: LoginSettings, patch: LoginSettingsPatch, where: Where): LoginSettings {
  const next = { ...login }
  if (patch.alias !== undefined) {
    next.alias = checkAlias(patch.alias, child(where, 'alias'))
    next.aliasSetByUser = true
  }
  if (patch.routing !== undefined) next.routing = expectBoolean(patch.routing, child(where, 'routing'))
  if (patch.fiveHourLimit !== undefined) next.fiveHourLimit = checkLimit(patch.fiveHourLimit, child(where, 'fiveHourLimit'))
  if (patch.weeklyLimit !== undefined) next.weeklyLimit = checkLimit(patch.weeklyLimit, child(where, 'weeklyLimit'))
  if (patch.useFirst !== undefined) next.useFirst = expectBoolean(patch.useFirst, child(where, 'useFirst'))
  return next
}

function parseLogin(value: unknown, where: Where): LoginSettings {
  const raw = expectObject(value, where)
  const id = expectString(raw.id, child(where, 'id'))
  if (!isLoginId(id)) fail(child(where, 'id'), 'must be 1 to 32 lowercase letters and digits')
  const usedByPlainClaude = raw.usedByPlainClaude === undefined ? false : expectBoolean(raw.usedByPlainClaude, child(where, 'usedByPlainClaude'))
  const patch: LoginSettingsPatch = {}
  for (const key of ['routing', 'fiveHourLimit', 'weeklyLimit', 'useFirst'] as const) {
    if (raw[key] !== undefined) (patch as Record<string, unknown>)[key] = raw[key]
  }
  const login = applyPatch(newLoginSettings({ id, usedByPlainClaude }), patch, where)
  if (raw.alias !== undefined) login.alias = checkAlias(raw.alias, child(where, 'alias'))
  if (raw.aliasSetByUser !== undefined) login.aliasSetByUser = expectBoolean(raw.aliasSetByUser, child(where, 'aliasSetByUser'))
  return login
}

/** Refuses a file of another version than `CONFIG_VERSION`. */
function checkVersion(raw: Record<string, unknown>, file: string): void {
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
  if (version < CONFIG_VERSION) {
    fail(
      topOf(file),
      `was written by an older kurmis (config version ${String(version)}), and this kurmis reads only ` +
        `version ${String(CONFIG_VERSION)}. Delete the file, then add the extra logins again with ` +
        '"kurmis login"'
    )
  }
}

/**
 * Checks a parsed `config.json` and fills in what it leaves out, apart from the login of plain
 * claude (`ensurePlainClaudeLogin`). Throws a `DataFileError` naming the file
 * and the field for anything wrong. Unknown fields are ignored.
 */
export function parseConfig(value: unknown, file: string): KurmisConfig {
  const raw = expectObject(value, topOf(file))
  checkVersion(raw, file)
  const where = topOf(file)
  const port = raw.port === undefined ? DEFAULT_PORT : expectInteger(raw.port, child(where, 'port'), MIN_PORT, MAX_PORT)
  const listed = raw.logins === undefined ? [] : expectArray(raw.logins, child(where, 'logins'))
  const logins: LoginSettings[] = []
  listed.forEach((entry, index) => {
    const at = child(child(where, 'logins'), index)
    const login = parseLogin(entry, at)
    if (logins.some((other) => other.id === login.id)) fail(child(at, 'id'), `repeats "${login.id}"`)
    if (login.usedByPlainClaude && logins.some((other) => other.usedByPlainClaude)) {
      fail(child(at, 'usedByPlainClaude'), 'is true for a second login; only one login can be the one plain claude uses')
    }
    const clash = logins.find((other) => other.id === login.alias || other.alias === login.id || other.alias === login.alias)
    if (clash !== undefined) {
      fail(child(at, 'alias'), clash.alias === login.alias
        ? `repeats "${login.alias}" of another login`
        : `"${login.alias}" and the id "${login.id}" must not be the id or alias of another login`)
    }
    logins.push(login)
  })
  return { version: CONFIG_VERSION, port, logins: ordered(logins) }
}

/** Reads `config.json` as it is: a config with no logins when there is no file. */
function readConfigFile(path: string): KurmisConfig {
  const read = readJsonFileSync(path)
  if (read.status === 'missing') return emptyConfig()
  if (read.status === 'corrupt') throw new ConfigError(`${path} is not valid JSON: ${read.reason}`)
  return withConfigErrors(() => parseConfig(read.value, path))
}

/**
 * Reads `config.json` without writing anything, for a reader that must not change the data
 * folder (`findDaemon`, and `kurmis setup` before it removes anything). The login of plain
 * claude is in the result only when the file has it. A missing file reads as a config with
 * no logins and the default port. A file that is not JSON, or has a wrong field, is a
 * `ConfigError`, as for `loadConfig`.
 */
export function readConfig(path = configPath()): KurmisConfig {
  return readConfigFile(path)
}

/**
 * Reads `config.json`. A file that is not JSON, or has a wrong field, is a `ConfigError` whose
 * message names the file and the field. When the file is missing or has no login for
 * plain claude, that login is added with a new id and the file is saved
 * under the lock (`changeConfig`), so the id stays the same from then on.
 */
export function loadConfig(path = configPath(), lockOptions: FileLockOptions = {}): KurmisConfig {
  const config = readConfigFile(path)
  if (ensurePlainClaudeLogin(config) === config) return config
  return changeConfig((current) => current, path, lockOptions)
}

/** Writes `config.json` atomically. Every login is written, the one of plain claude included. */
export function saveConfig(config: KurmisConfig, path = configPath()): void {
  writeJsonFileSync(path, { version: CONFIG_VERSION, port: config.port, logins: config.logins })
}

export function findLogin(config: KurmisConfig, id: string): LoginSettings | undefined {
  return config.logins.find((login) => login.id === id)
}

/** The ids of every login. */
export function loginIds(config: KurmisConfig): LoginId[] {
  return config.logins.map((login) => login.id)
}

/**
 * A new random id for a login added to `config`: none of its logins' ids or aliases, which
 * `addLogin` and `parseConfig` require.
 */
export function newLoginIdFor(config: KurmisConfig): LoginId {
  return newLoginId([...loginIds(config), ...config.logins.map((login) => login.alias)])
}

/** What `resolveLogin` found. */
export type ResolvedLogin<L = LoginSettings> = { login: L } | { error: string }

/** What `resolveLogin` needs of a login. */
export interface NamedLogin {
  id: string
  alias: string
}

/**
 * The login a person named, by its alias or its id, without regard to case. The error is a
 * sentence without the command's name.
 */
export function resolveLogin<L extends NamedLogin = LoginSettings>(config: { readonly logins: readonly L[] }, text: string): ResolvedLogin<L> {
  const name = text.trim().toLowerCase()
  const found = config.logins.find((login) => login.id === name) ?? config.logins.find((login) => login.alias === name)
  if (found !== undefined) return { login: found }
  return { error: `there is no login called "${name}"` }
}

/** Why `alias` cannot be the alias of `login` in `config`, or null when it can. */
export function aliasProblem(config: KurmisConfig, login: LoginRef, alias: string): string | null {
  if (!isAliasText(alias)) return `"${alias}" is not an alias; an alias is ${ALIAS_RULE}`
  for (const other of config.logins) {
    if (other.id === login.id) continue
    if (other.id === alias) return `"${alias}" is the id of another login`
    if (other.alias === alias) return `another login is already called "${alias}"`
  }
  return null
}

/**
 * The config with a new extra login added at the end. `patch.alias`, when given, is the
 * person's choice; otherwise the alias is the id until `followEmail` gives it one. Throws when
 * the id is taken or the alias is not free.
 */
export function addLogin(config: KurmisConfig, id: string, patch: LoginSettingsPatch = {}): KurmisConfig {
  if (!isLoginId(id)) throw new ConfigError(`"${id}" is not a login id.`)
  if (findLogin(config, id) !== undefined) throw new ConfigError(`There is already a login ${id}.`)
  if (config.logins.some((other) => other.alias === id)) throw new ConfigError(`"${id}" is the alias of another login.`)
  const login = newLoginSettings({ id, usedByPlainClaude: false }, patch)
  const problem = aliasProblem(config, login, login.alias)
  if (problem !== null) throw new ConfigError(`${capitalized(problem)}.`)
  return { ...config, logins: [...config.logins, login] }
}

/** The config without a login. The login of plain claude cannot be removed. */
export function removeLogin(config: KurmisConfig, id: string): KurmisConfig {
  const login = findLogin(config, id)
  if (login === undefined) throw new ConfigError(`There is no login ${id}.`)
  if (login.usedByPlainClaude) throw new ConfigError(`${login.alias} is the login plain claude uses and cannot be removed.`)
  return { ...config, logins: config.logins.filter((other) => other.id !== id) }
}

/** The config with one login's settings changed. Each changed field is checked. */
export function updateLogin(config: KurmisConfig, id: string, patch: LoginSettingsPatch): KurmisConfig {
  const current = findLogin(config, id)
  if (current === undefined) throw new ConfigError(`There is no login ${id}.`)
  const next = withConfigErrors(() => applyPatch(current, patch, topOf(`settings of ${current.alias}`)))
  if (patch.alias !== undefined) {
    const problem = aliasProblem(config, current, next.alias)
    if (problem !== null) throw new ConfigError(`${capitalized(problem)}.`)
  }
  return { ...config, logins: config.logins.map((login) => (login.id === id ? next : login)) }
}

/**
 * The config with the automatic alias of login `id` made from `email` (`automaticAlias`). The
 * same object when nothing changes: no email is known (null), the login is not there, its alias
 * was set by the person, or its alias already fits the email. A login keeps its last alias while
 * its email cannot be read.
 */
export function followEmail(config: KurmisConfig, id: string, email: string | null): KurmisConfig {
  const login = findLogin(config, id)
  if (email === null || login === undefined || login.aliasSetByUser) return config
  const others = config.logins.filter((other) => other.id !== id)
  const alias = automaticAlias(email, login.id, login.alias, {
    aliases: others.map((other) => other.alias),
    ids: others.map((other) => other.id)
  })
  if (alias === login.alias) return config
  return { ...config, logins: config.logins.map((other) => (other.id === id ? { ...login, alias } : other)) }
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Loads the config, applies `change`, and saves the result, holding the lock file
 * (`configLockPath()`, or `<path>.lock` for another path) from before the read until after the
 * write, so two kurmis processes changing the config at the same moment both keep their change.
 * `change` gets the config with the login of plain claude in it and must not
 * call `changeConfig` itself. A lock that cannot be taken in time is a `ConfigError` saying who holds it.
 */
export function changeConfig(
  change: (config: KurmisConfig) => KurmisConfig,
  path = configPath(),
  lockOptions: FileLockOptions = {}
): KurmisConfig {
  const lockPath = path === configPath() ? configLockPath() : `${path}.lock`
  try {
    return withFileLockSync(lockPath, () => {
      const next = change(ensurePlainClaudeLogin(readConfigFile(path)))
      saveConfig(next, path)
      return next
    }, lockOptions)
  } catch (error) {
    if (error instanceof LockTimeoutError) throw new ConfigError(error.message, { cause: error })
    throw error
  }
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
