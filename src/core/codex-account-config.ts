/**
 * The `config.toml` an extra Codex login's home gets: the default home's settings without
 * its secrets, merged into the login's own file. Started from the original router's
 * `src/tools/claude/core/codex-account-config.ts`; the merge and the trust rules below differ
 * from the original router's.
 *
 * An extra Codex login runs with its own `CODEX_HOME` (`codex/<name>/` in the data folder).
 * Before every start its `config.toml` is merged again from `~/.codex/config.toml` with
 * `mergeAccountConfig` (`codex-home.ts` says when). Layout, comments and TOML types (integer
 * or float, the kind of date) of the login's file are kept. A value copied from the default
 * home keeps the way it was written there (a multi-line string stays multi-line), except inside
 * an array of tables and inside an inline table of the login's file that changes, which are
 * written anew in one plain form. Comments of the default home are not copied.
 *
 * **Three-way merge.** Codex writes to the `config.toml` of the home it runs with: a `/model`
 * choice, a notice the user has seen (`[notice]`), a plugin switched on, trust. So the merge
 * needs to know which settings of the login's file came from the default home. Kurmis keeps
 * the default home's settings as they were last merged in (`merged` in the answer, stored by
 * the caller outside the Codex home) and merges three ways, one setting (a value, or a whole
 * array) at a time:
 *
 * - a setting the default home has is taken from it, unless the default home's value is the
 *   one last merged in and the login's file has another value or lacks the setting: then the
 *   login changed or deleted it, and that stays until the default home's value changes;
 * - a setting the login's file has and the default home no longer has is removed when it was
 *   in the last merged copy, and kept when it never was (the login's own). When the default
 *   home still has it with a value that holds a secret, the login's stays (`heldBack`);
 * - a table that loses its last setting that is not a secret goes as a whole, the login's
 *   own secrets in it included. Codex refuses a file with an MCP server that has only an `env`
 *   table left, for example, so such a server in the login's file goes even when it was so
 *   before the merge (an earlier kurmis left it);
 * - an MCP server and a model provider are each one unit (`UNIT_TABLES`): one the default home
 *   dropped goes whole, and one the login's file lacks as a whole stays out until the default
 *   home changes any of it, then comes in whole.
 *
 * A login file that sets nothing (only comments and blank lines) is merged as a missing one:
 * it gets every setting of the default home.
 *
 * With no last merged copy (the first merge after kurmis was updated to keep one), every
 * setting of the login's file that is not a secret or trust counts as merged in before, as
 * the earlier two-way merge treated it: what the default home lacks is removed once, and
 * from then on the login's own settings are told apart.
 *
 * **Secrets.** A secret is never copied from the default home, and a secret in the login's
 * file is never changed or removed by the merge, except with its whole table (`secretKeyName`
 * and `secretValue` say what counts; the name of an MCP server, a model provider, a profile,
 * a folder or a hook is not read as one, `nameIndex`). Where the login's secret stands in the
 * way of a setting of the default home, or the default home has a secret setting that
 * differs from the login's in more than its secrets, the login's stays and `heldBack` names
 * the setting.
 *
 * **Trust.** Codex keeps trust in `hooks.state."<hook key>"` for a hook (`trusted_hash`,
 * `trusted_content_hash`, `enabled`) and `projects."<folder>"` for a folder (`trust_level`).
 * A trust field the login has a value of its own for (one that is not the last merged one)
 * is combined with the default home's (`mergedTrust`):
 *
 * - `enabled`: `false` wins, so a hook switched off in either home stays off;
 * - `trust_level`: `"untrusted"` wins over any other value;
 * - `trusted_hash` and `trusted_content_hash`: the login's own hash stays. A hash trusts one
 *   version of a hook, the one that hashes to it, so neither hash trusts more than the other.
 *   The login's hash is the one a session on that login asked for. Taking the default home's
 *   would undo that on every refresh.
 *
 * A trust field whose value came from the default home follows the default home, so trusting
 * a folder again in `~/.codex` reaches the login. A login's own trust field stays when the
 * default home drops it, and on the first merge without a last merged copy every trust field
 * of the login counts as its own.
 *
 * the original router drops the trust a login's own file gave, because a model in a session could have
 * written it there. Kurmis keeps it: kurmis has no window in which a person gives trust, and
 * a model that can write the login's file can as well write `~/.codex/config.toml`, whose
 * trust reaches every login. Because the login's own restrictive values win, a folder the
 * login marked `"untrusted"` or a hook it switched off stays so until it is trusted again in
 * a session on that login, or the line is removed from the login's file.
 */
import { parseTOML, type AST } from 'toml-eslint-parser'

/** One key of a path: a table's key, or the index of an element of an array of tables. */
type PathKey = string | number

type Dict = Record<string, unknown>

// ---- what counts as a secret

/**
 * Tables whose values are secrets whatever they are called: an MCP server's environment
 * (`env`), the environment `shell_environment_policy` sets (`set`), HTTP headers and a model
 * provider's query parameters, which Codex sends as they are written.
 */
const SECRET_TABLES = new Set(['env', 'set', 'http_headers', 'headers', 'query_params'])

/** Last words of a key name that say its value is a secret: `bearer_token`, `client_secret`, `db_password`. */
const SECRET_LAST_WORDS = new Set(['token', 'secret', 'secrets', 'password', 'passwd', 'passphrase', 'authorization', 'cookie', 'apikey'])

/** Words before a last word `key` that make it not a secret: `env_key` names a variable, `public_key` is public. */
const PUBLIC_KEY_WORDS = new Set(['env', 'public'])

/** Key names Codex uses for something that is not a secret although the rule below would say so: a path to a key file. */
const PUBLIC_NAMES = new Set(['client-private-key'])

/** The words of a key name, split at `_`, `-`, `.`, spaces and lower-to-upper case changes, in lower case. */
function keyWords(key: string): string[] {
  return key.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z\d]+/).filter((word) => word.length > 0)
}

/**
 * Whether a key's name says that the strings under it are secrets.
 *
 * The rule reads the last word of the name, because in Codex's settings the last word says
 * what the value is: `experimental_bearer_token`, `bearer_token`, `access_token` and
 * `client_secret` are secrets, while `bearer_token_env_var` and `env_key` name an environment
 * variable, `cli_auth_credentials_store` and `mcp_oauth_credentials_store` name a kind of
 * store, `mcp_oauth_callback_port` is a port, and `model_auto_compact_token_limit` and
 * `max_tokens` are counts. A last word `key` is a secret (`api_key`, `private_key`,
 * `x-api-key`) except in `env_key` and `public_key`. A few table names hold secrets whatever
 * their values are called (`SECRET_TABLES`), and a few names Codex uses for paths are not
 * secrets (`PUBLIC_NAMES`).
 *
 * The name alone never makes a boolean, a number or a date a secret (`secretValue`), so a
 * switch such as `features.secret_auth_storage` is copied.
 */
export function secretKeyName(key: string): boolean {
  const lower = key.toLowerCase()
  if (SECRET_TABLES.has(lower)) return true
  if (PUBLIC_NAMES.has(lower)) return false
  const words = keyWords(key)
  const last = words.at(-1)
  if (last === undefined) return false
  if (SECRET_LAST_WORDS.has(last)) return true
  return last === 'key' && !PUBLIC_KEY_WORDS.has(words.at(-2) ?? '')
}

const SECRET_TEXT = /(?:\bBearer\s+\S+|\b(?:sk|ghp|github_pat|xox[baprs])[-_][a-z\d_-]{8,}|-----BEGIN [\w ]*PRIVATE KEY-----|https?:\/\/[^\s/@:]*:[^\s/@]+@|[?&](?:token|key|secret|signature|password)=[^&#\s]+|(?:api[_-]?key|secret|password|authorization|access[_-]?token)\s*[=:]\s*["']?[^\s,"'}]+)/i

/**
 * Whether a text looks like it holds a secret: a bearer token, a known key format, a private
 * key, a password in a URL and the like.
 */
function secretLooking(text: string): boolean {
  return SECRET_TEXT.test(text) || /--(?:token|api-key|password|secret)(?:[=\s]+)\S+/i.test(text)
}

/** An argument list that passes a header, a token or an environment value on the command line. */
function secretArguments(value: readonly unknown[]): boolean {
  return value.some((arg) => typeof arg === 'string' && /^(?:-H|--(?:env|header|headers|token|api-key|password|secret|authorization))(?:=|$)/i.test(arg))
}

/** The tables Codex keeps trust in, one per folder or hook, and the fields of each that hold trust. */
const TRUST_TABLES: ReadonlyArray<{ parent: readonly string[]; fields: readonly PathKey[] }> = [
  { parent: ['projects'], fields: ['trust_level'] },
  { parent: ['hooks', 'state'], fields: ['trusted_hash', 'trusted_content_hash', 'enabled'] }
]

/**
 * Where a folder or hook key sits in a path that goes into its trust table, or -1. A value
 * placed straight under `[projects]` or `[hooks.state]` has no such key: its last key is its
 * own name.
 */
function trustNameIndex(path: readonly PathKey[]): number {
  for (const { parent } of TRUST_TABLES) {
    if (path.length >= parent.length + 2 && parent.every((key, index) => path[index] === key)) return parent.length
  }
  return -1
}

/** Whether a path is one trust field of one trust table. */
function trustValue(path: readonly PathKey[]): boolean {
  for (const { parent, fields } of TRUST_TABLES) {
    if (path.length === parent.length + 2 && parent.every((key, index) => path[index] === key) && fields.includes(path.at(-1)!)) return true
  }
  return false
}

/** Tables whose keys are names the person chose: MCP servers, model providers and profiles. */
const NAMED_TABLES = new Set(['mcp_servers', 'model_providers', 'profiles'])

/**
 * Where a name the person chose sits in a path, or -1: a folder or hook key of a trust table
 * (`trustNameIndex`), or the name of an MCP server, model provider or profile. As in a trust
 * table, a value placed straight under `[mcp_servers]` has no such name.
 */
function nameIndex(path: readonly PathKey[]): number {
  const trust = trustNameIndex(path)
  if (trust !== -1) return trust
  return path.length >= 3 && typeof path[0] === 'string' && NAMED_TABLES.has(path[0]) ? 1 : -1
}

/**
 * Whether a key on a path says the strings below it are secrets. A name the person chose is
 * not read as one (`nameIndex`), so a repository called `deploy-token` or an MCP server
 * called `aws-secrets` is not a secret; the keys below it still are read.
 */
function secretPath(path: readonly PathKey[]): boolean {
  const name = nameIndex(path)
  return path.some((key, index) => index !== name && typeof key === 'string' && secretKeyName(key))
}

/**
 * Whether a value holds a secret. `named` says a key above it has a secret name, which makes
 * every string below it a secret. A string is also a secret when its text looks like one
 * (read as the file means it, escapes decoded), and an argument list when it passes a header
 * or a token. A boolean, a number or a date is never a secret.
 */
function secretValue(value: unknown, named: boolean): boolean {
  if (typeof value === 'string') return named || secretLooking(value)
  if (Array.isArray(value)) return secretArguments(value) || value.some((item) => secretValue(item, named))
  if (isTable(value)) return Object.entries(value as Dict).some(([key, child]) => secretValue(child, named || secretKeyName(key)))
  return false
}

/** Whether the setting at a path, with this value, is a secret. */
function secretSetting(path: readonly PathKey[], value: unknown): boolean {
  return secretValue(value, secretPath(path))
}

/** Stands in for a secret when two values are compared apart from their secrets. */
const MASK = Symbol('secret')

/** A value with every secret in it replaced by `MASK`, for comparing two values apart from their secrets. */
function masked(value: unknown, named: boolean): unknown {
  if (typeof value === 'string') return named || secretLooking(value) ? MASK : value
  if (Array.isArray(value)) return secretArguments(value) ? MASK : value.map((item) => masked(item, named))
  if (!isTable(value)) return value
  const out = dict()
  for (const [key, child] of Object.entries(value as Dict)) out[key] = masked(child, named || secretKeyName(key))
  return out
}

// ---- values

/**
 * A TOML value that JavaScript has no exact type for: an integer, which may be too large
 * for a number; a float, which must stay a float; or one of the four kinds of date and
 * time. `text` writes the value one fixed way, so two equal values have equal text, and it
 * is valid TOML as it stands.
 */
class TomlScalar {
  readonly kind: 'integer' | 'float' | AST.TOMLDateTimeValue['kind']
  readonly text: string
  constructor(kind: 'integer' | 'float' | AST.TOMLDateTimeValue['kind'], text: string) {
    this.kind = kind
    this.text = text
  }
}

/** A float as TOML, with a point or an exponent so that it reads back as a float. */
function floatText(value: number): string {
  if (Number.isNaN(value)) return 'nan'
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf'
  if (Object.is(value, -0)) return '-0.0'
  const text = String(value)
  return /[.e]/.test(text) ? text : `${text}.0`
}

function scalar(node: AST.TOMLValue): unknown {
  switch (node.kind) {
    case 'string':
    case 'boolean':
      return node.value
    case 'integer':
      return new TomlScalar('integer', node.bigint.toString())
    case 'float':
      return new TomlScalar('float', floatText(node.value))
    default:
      // TOML allows a space or a lower-case t between date and time, and a lower-case z.
      return new TomlScalar(node.kind, node.datetime.replace(/^(\d{4}-\d{2}-\d{2})[ t]/i, '$1T').toUpperCase())
  }
}

/** Whether a value is a table, as opposed to a string, boolean, `TomlScalar` or array. */
function isTable(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof TomlScalar)
}

/**
 * A table with no prototype. A file may use any key, `constructor`, `__proto__` and
 * `toString` included, and on a table like this each is an ordinary key of its own.
 */
function dict(): Dict {
  return Object.create(null) as Dict
}

/** A table's own value for a key, never one it inherits. */
function own(value: unknown, key: string): unknown {
  return isTable(value) && Object.hasOwn(value as object, key) ? (value as Dict)[key] : undefined
}

function record(value: unknown): Dict {
  return isTable(value) ? value as Dict : dict()
}

/** The value at a path, or undefined. A number in the path is an index into an array. */
function at(root: unknown, path: readonly PathKey[]): unknown {
  return path.reduce<unknown>((value, key) => (typeof key === 'number' ? (Array.isArray(value) ? value[key] : undefined) : own(value, key)), root)
}

/** Sets the value at a path of string keys, making a table of whatever is on the way. */
function setAt(root: Dict, path: readonly string[], value: unknown): void {
  let table = root
  for (const key of path.slice(0, -1)) {
    if (!isTable(own(table, key))) table[key] = dict()
    table = table[key] as Dict
  }
  table[path.at(-1)!] = value
}

/** Removes the value at a path of string keys, when it is there. */
function removeAt(root: Dict, path: readonly string[]): void {
  const parent = at(root, path.slice(0, -1))
  if (isTable(parent) && Object.hasOwn(parent as object, path.at(-1)!)) delete (parent as Dict)[path.at(-1)!]
}

/** A copy of a value with its tables copied, so changing a table of the copy leaves the original alone. */
function copyTables(value: unknown): unknown {
  if (!isTable(value)) return value
  const out = dict()
  for (const [key, child] of Object.entries(value as Dict)) out[key] = copyTables(child)
  return out
}

/**
 * JSON with the keys sorted, so two equal values compare equal as text. A `TomlScalar` is
 * written with its kind, so an integer never equals a float, nor a date a string. Keys are
 * sorted by code unit, not by locale: a locale sort ranks "é" and "é" equal, and
 * their order would then depend on the file.
 */
function stableJson(value: unknown): string {
  if (value === MASK) return '"<secret>"'
  if (value instanceof TomlScalar) return `${value.kind}:${JSON.stringify(value.text)}`
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function same(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b)
}

/** One setting: a value that is not a table (an array, an array of tables included) and its path. */
interface Setting {
  path: string[]
  value: unknown
}

/** Every setting in a table, in the order of its keys. An empty table holds none. */
function settingsOf(value: unknown, base: string[] = []): Setting[] {
  return Object.entries(record(value)).flatMap(([key, child]) =>
    isTable(child) ? settingsOf(child, [...base, key]) : [{ path: [...base, key], value: child }])
}

/** The path of every table below a table, not counting the table itself and not going into arrays. */
function tablePaths(value: unknown, base: string[] = []): string[][] {
  return Object.entries(record(value)).flatMap(([key, child]) =>
    isTable(child) ? [[...base, key], ...tablePaths(child, [...base, key])] : [])
}

/** Whether a table holds any setting that is not a secret. */
function holdsOrdinarySetting(value: unknown, path: string[]): boolean {
  return settingsOf(value, path).some((setting) => !secretSetting(setting.path, setting.value))
}

/** A value with its empty tables left out: an empty table sets nothing. */
function withoutEmptyTables(value: unknown): unknown {
  if (!isTable(value)) return value
  const out = dict()
  for (const [key, child] of Object.entries(value as Dict)) {
    const kept = withoutEmptyTables(child)
    if (!isTable(kept) || Object.keys(kept as Dict).length > 0) out[key] = kept
  }
  return out
}

// ---- reading a file

/** The text without a UTF-8 byte order mark at its start, which the TOML parser refuses. */
function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Parses a text that has no byte order mark. Callers strip one first, so offsets match the text they edit. */
function parseToml(text: string): AST.TOMLProgram {
  try {
    return parseTOML(text, { tomlVersion: '1.0' })
  } catch {
    throw new Error('config.toml is not valid TOML')
  }
}

function keyParts(key: AST.TOMLKey): string[] {
  return key.keys.map((part) => (part.type === 'TOMLBare' ? part.name : part.value))
}

/**
 * The file as nested values. Every table is a `dict()`, and each key is looked up and set
 * as the table's own, so no key in the file can reach a shared prototype. `convert` gives
 * the value of one string, number, boolean or date.
 */
function tableValue(ast: AST.TOMLProgram, convert: (node: AST.TOMLValue) => unknown): Dict {
  const child = (table: Dict, key: string): Dict => {
    if (!Object.hasOwn(table, key)) table[key] = dict()
    return table[key] as Dict
  }
  const put = (table: Dict, keys: readonly string[], value: unknown): void => {
    let into = table
    for (const key of keys.slice(0, -1)) into = child(into, key)
    into[keys.at(-1)!] = value
  }
  const content = (node: AST.TOMLContentNode): unknown => {
    if (node.type === 'TOMLArray') return node.elements.map(content)
    if (node.type !== 'TOMLInlineTable') return convert(node)
    const table = dict()
    for (const entry of node.body) put(table, keyParts(entry.key), content(entry.value))
    return table
  }
  const root = dict()
  for (const node of ast.body[0].body) {
    if (node.type === 'TOMLKeyValue') {
      put(root, keyParts(node.key), content(node.value))
      continue
    }
    // A number in the resolved key is an element of an array of tables (`[[name]]`).
    let table: Dict | unknown[] = root
    node.resolvedKey.forEach((key, index) => {
      if (typeof key === 'number') {
        const list = table as unknown[]
        table = (list[key] ??= dict()) as Dict
        return
      }
      const parent = table as Dict
      if (!Object.hasOwn(parent, key)) parent[key] = typeof node.resolvedKey[index + 1] === 'number' ? [] : dict()
      table = parent[key] as Dict | unknown[]
    })
    for (const entry of node.body) put(table as Dict, keyParts(entry.key), content(entry.value))
  }
  return root
}

/**
 * The file as a plain value, for reading settings. Integers and floats both come out as
 * numbers and dates as `Date`s, so do not compare or write back what this returns. Its
 * tables have no prototype, like `dict()`.
 */
export function tomlValue(text: string): Record<string, unknown> {
  return tableValue(parseToml(withoutBom(text)), (node) => node.value)
}

/**
 * The file as values that keep their TOML type: a table is a `dict()`, a string or a
 * boolean is itself, an array is an array, and every other value is a `TomlScalar`.
 * `tomlValue` loses the difference between 1 and 1.0 and between two kinds of date, and
 * rounds an integer past 2^53. Comparing and writing back use this instead.
 */
function typedValue(ast: AST.TOMLProgram): Dict {
  return tableValue(ast, scalar)
}

function typedToml(text: string): Dict {
  return typedValue(parseToml(text))
}

/**
 * How each plain value of a file is written there, by path, with the value it stands for.
 * A value copied from the default home is written the same way where it fits, so a
 * multi-line string stays multi-line and `0x10` stays hexadecimal. Arrays and inline tables
 * are left out, since comments can sit inside them.
 */
type ValueTexts = Map<string, { text: string; value: unknown }>

function valueTexts(text: string, ast: AST.TOMLProgram): ValueTexts {
  const out: ValueTexts = new Map()
  const visit = (node: AST.TOMLKeyValue, base: string[]): void => {
    const path = [...base, ...keyParts(node.key)]
    if (node.value.type === 'TOMLInlineTable') {
      for (const child of node.value.body) visit(child, path)
    } else if (node.value.type === 'TOMLValue') {
      out.set(JSON.stringify(path), { text: text.slice(node.value.range[0], node.value.range[1]), value: scalar(node.value) })
    }
  }
  for (const node of ast.body[0].body) {
    if (node.type === 'TOMLKeyValue') visit(node, [])
    else if (!node.resolvedKey.some((key) => typeof key === 'number')) {
      for (const child of node.body) visit(child, node.resolvedKey as string[])
    }
  }
  return out
}

// ---- writing values

function tomlLiteral(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value).replace(/\u007f/g, '\\u007f')
  if (typeof value === 'boolean') return String(value)
  if (value instanceof TomlScalar) return value.text
  if (Array.isArray(value)) return `[${value.map(tomlLiteral).join(', ')}]`
  if (value !== null && typeof value === 'object') return `{ ${Object.entries(value).map(([k, v]) => `${tomlKey(k)} = ${tomlLiteral(v)}`).join(', ')} }`
  throw new Error('config.toml holds a value that cannot be written back')
}

/** One key as TOML: bare where TOML allows it, quoted otherwise. */
function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlLiteral(key)
}

function dottedKey(path: readonly PathKey[]): string {
  return path.map((key) => tomlKey(String(key))).join('.')
}

/** A value as TOML, written as the default home wrote it when `texts` has it for this path. */
function literalFor(path: readonly string[], value: unknown, texts: ValueTexts): string {
  const known = texts.get(JSON.stringify(path))
  return known !== undefined && same(known.value, value) ? known.text : tomlLiteral(value)
}

function samePath(a: readonly PathKey[], b: readonly PathKey[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function newline(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** The offset just past the end of the line that `offset` is on. */
function lineEnd(text: string, offset: number): number {
  const end = text.indexOf('\n', offset)
  return end < 0 ? text.length : end + 1
}

/** The offset where the line that `offset` is on starts. */
function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1
}

/**
 * The range to cut to take a node out: its whole line when nothing but space and a comment
 * shares the line with it, else the node alone.
 */
function cutRange(text: string, [start, end]: readonly [number, number]): [number, number] {
  const from = lineStart(text, start)
  const to = lineEnd(text, end)
  return text.slice(from, start).trim() === '' && /^[ \t]*(?:#[^\r\n]*)?\r?\n?$/.test(text.slice(end, to)) ? [from, to] : [start, end]
}

/** The text with `lines` put in at `offset`, which starts a line or ends the file. */
function insertLines(text: string, offset: number, lines: string, nl: string): string {
  const before = text.slice(0, offset)
  return `${before}${before.length === 0 || before.endsWith('\n') ? '' : nl}${lines}${text.slice(offset)}`
}

/** A list of tables written as `[[name]]` tables, one for each element. */
function arrayTables(path: readonly PathKey[], value: readonly unknown[], nl: string): string {
  const header = `[[${dottedKey(path)}]]${nl}`
  return value.map((table) => header + Object.entries(record(table)).map(([key, child]) => `${tomlKey(key)} = ${tomlLiteral(child)}${nl}`).join('')).join('')
}

function isArrayOfTables(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0 && value.every(isTable)
}

// ---- rewriting a file in one pass

interface Edit {
  start: number
  end: number
  text: string
}

/**
 * The file changed to hold `desired`, in one pass over one parse: a key whose value changed
 * gets the new value where it stands, a key `desired` lacks is cut out with its line, a
 * `[table]` `desired` lacks is cut out whole, and a new key goes into the section that already
 * defines its table (its `[header]`, or the section whose dotted keys define it), else under a
 * new `[header]` at the end. An inline table that changed is written anew. An array of tables
 * that changed is left for `settle`. The answer is not checked here; `rewrite` checks it.
 */
function rewriteInOnePass(text: string, desired: Dict, texts: ValueTexts): string {
  const ast = parseToml(text)
  const current = typedValue(ast)
  const nl = newline(text)
  const edits: Edit[] = []
  /** Paths whose value the text holds once the edits are made, as JSON. Everything below one is held too. */
  const held = new Set<string>()
  /** The kept `[header]` of each table, by path as JSON. */
  const headers = new Map<string, AST.TOMLTable>()
  /** For each table defined by kept dotted keys, the section those keys are in. */
  const dotted = new Map<string, readonly string[]>()
  /** Where the lines of each section end, by the section's path as JSON. */
  const sectionEnds = new Map<string, number>([[JSON.stringify([]), 0]])

  const cut = (range: readonly [number, number]): void => {
    const [start, end] = cutRange(text, range)
    edits.push({ start, end, text: '' })
  }
  const visitKeyValue = (node: AST.TOMLKeyValue, section: string[]): void => {
    const keys = keyParts(node.key)
    const path = [...section, ...keys]
    const want = at(desired, path)
    const inline = node.value.type === 'TOMLInlineTable'
    if (want === undefined || (isTable(want) && !inline)) {
      cut(node.range)
      return
    }
    for (let depth = 1; depth < keys.length; depth++) dotted.set(JSON.stringify(path.slice(0, section.length + depth)), section)
    sectionEnds.set(JSON.stringify(section), lineEnd(text, node.range[1]))
    held.add(JSON.stringify(path))
    if (same(want, at(current, path))) return
    edits.push({ start: node.value.range[0], end: node.value.range[1], text: inline ? tomlLiteral(want) : literalFor(path, want, texts) })
  }

  const arrays = new Map<string, { path: string[]; tables: AST.TOMLTable[] }>()
  for (const node of ast.body[0].body) {
    if (node.type === 'TOMLKeyValue') {
      visitKeyValue(node, [])
      continue
    }
    const index = node.resolvedKey.findIndex((key) => typeof key === 'number')
    if (index >= 0) {
      const path = node.resolvedKey.slice(0, index) as string[]
      const id = JSON.stringify(path)
      const array = arrays.get(id) ?? { path, tables: [] }
      array.tables.push(node)
      arrays.set(id, array)
      continue
    }
    const path = node.resolvedKey as string[]
    if (!isTable(at(desired, path))) {
      cut(node.range)
      continue
    }
    headers.set(JSON.stringify(path), node)
    sectionEnds.set(JSON.stringify(path), lineEnd(text, node.range[1]))
    for (const child of node.body) visitKeyValue(child, path)
  }
  for (const [id, { path, tables }] of arrays) {
    const want = at(desired, path)
    if (want === undefined) {
      for (const table of tables) cut(table.range)
      continue
    }
    // Held either way: an array that changed is settled one element at a time afterwards.
    held.add(id)
  }

  const isHeld = (path: readonly string[]): boolean => path.some((_, index) => held.has(JSON.stringify(path.slice(0, index + 1))))
  const inserts = new Map<number, string>()
  const insertAt = (offset: number, lines: string): void => {
    inserts.set(offset, (inserts.get(offset) ?? '') + lines)
  }
  const newTables = new Map<string, { path: readonly string[]; lines: string }>()
  const appendToNewTable = (path: readonly string[], line: string): void => {
    const id = JSON.stringify(path)
    const table = newTables.get(id) ?? { path, lines: '' }
    table.lines += line
    newTables.set(id, table)
  }
  let newArrays = ''

  for (const { path, value } of settingsOf(desired)) {
    if (isHeld(path)) continue
    if (isArrayOfTables(value)) {
      newArrays += arrayTables(path, value, nl)
      continue
    }
    const literal = literalFor(path, value, texts)
    const parent = path.slice(0, -1)
    let placed = false
    for (let depth = parent.length; depth >= 1 && !placed; depth--) {
      const table = parent.slice(0, depth)
      const id = JSON.stringify(table)
      const section = headers.has(id) ? table : dotted.get(id)
      if (section === undefined) continue
      if (headers.has(id) && depth < parent.length) appendToNewTable(parent, `${tomlKey(path.at(-1)!)} = ${literal}${nl}`)
      else insertAt(sectionEnds.get(JSON.stringify(section))!, `${dottedKey(path.slice(section.length))} = ${literal}${nl}`)
      placed = true
    }
    if (placed) continue
    if (parent.length === 0) insertAt(sectionEnds.get(JSON.stringify([]))!, `${tomlKey(path[0]!)} = ${literal}${nl}`)
    else appendToNewTable(parent, `${tomlKey(path.at(-1)!)} = ${literal}${nl}`)
  }
  const atEnd = [...newTables.values()].map(({ path, lines }) => `[${dottedKey(path)}]${nl}${lines}`).join('') + newArrays
  if (atEnd !== '') insertAt(text.length, atEnd)
  for (const [offset, lines] of inserts) {
    const lead = offset > 0 && text[offset - 1] !== '\n' ? nl : ''
    edits.push({ start: offset, end: offset, text: lead + lines })
  }

  // The last edit in the file first, so the offsets of the others stay right. At one offset a
  // cut goes before an insertion, so the insertion is not cut.
  edits.sort((a, b) => b.start - a.start || b.end - a.end)
  let out = text
  for (const { start, end, text: replacement } of edits) out = out.slice(0, start) + replacement + out.slice(end)
  return out
}

/**
 * One key and value in the file, or one array of tables, with its full path. For a key and
 * value, `node` is it and `holder` the inline table it sits in, if any. An array of tables
 * (`[[name]]`) is one setting as a whole, like any other array: `node` is null and `tables`
 * holds every table that belongs to it, its `[[name]]` tables and any `[name.child]` below
 * one. The keys inside its elements are entries too, with the element's index in the path.
 */
interface TomlEntry {
  path: PathKey[]
  node: AST.TOMLKeyValue | null
  holder: AST.TOMLInlineTable | null
  tables: AST.TOMLTable[]
}

/** Whether a path goes into an element of an array of tables. */
function inArray(path: readonly PathKey[]): boolean {
  return path.some((key) => typeof key === 'number')
}

/** Every entry in the file, inline tables and the elements of arrays of tables opened up. */
function tomlEntries(ast: AST.TOMLProgram): TomlEntry[] {
  const entries: TomlEntry[] = []
  const visit = (node: AST.TOMLKeyValue, base: PathKey[], holder: AST.TOMLInlineTable | null): void => {
    const path = [...base, ...keyParts(node.key)]
    entries.push({ path, node, holder, tables: [] })
    if (node.value.type === 'TOMLInlineTable') for (const child of node.value.body) visit(child, path, node.value)
  }
  for (const node of ast.body[0].body) {
    if (node.type === 'TOMLKeyValue') {
      visit(node, [], null)
      continue
    }
    const index = node.resolvedKey.findIndex((key) => typeof key === 'number')
    if (index >= 0) {
      const path = node.resolvedKey.slice(0, index)
      const array = entries.find((entry) => entry.node === null && samePath(entry.path, path))
      if (array === undefined) entries.push({ path, node: null, holder: null, tables: [node] })
      else array.tables.push(node)
    }
    for (const child of node.body) visit(child, [...node.resolvedKey], null)
  }
  return entries
}

/** The file's settings: every entry except those inside an element of an array of tables. */
function topEntries(ast: AST.TOMLProgram): TomlEntry[] {
  return tomlEntries(ast).filter((entry) => !inArray(entry.path))
}

function inlineEntry(entry: TomlEntry): boolean {
  return entry.node?.value.type === 'TOMLInlineTable'
}

function entryStart(entry: TomlEntry): number {
  return entry.node?.range[0] ?? entry.tables[0]!.range[0]
}

/**
 * Where a key that is not in the file yet could go, best first. TOML lets a table be
 * written as a `[header]`, as dotted keys (`a.b = 1`) or inline (`a = { b = 1 }`), and a
 * table written one way cannot be continued another way: a table that dotted keys defined
 * cannot get a `[header]`, and an inline table cannot gain a key from outside its braces.
 * So the places tried are, in order: the key's own table, a new `[header]` at the end,
 * then each table further up with the rest of the path as dotted keys, the file's top
 * level last. A list of tables is tried as `[[name]]` tables at the end before all of
 * those. A key inside an element of an array of tables goes only into that element.
 */
function insertions(text: string, ast: AST.TOMLProgram, entries: TomlEntry[], path: PathKey[], value: unknown): string[] {
  const nl = newline(text)
  const literal = tomlLiteral(value)
  const tables = ast.body[0].body.filter((node): node is AST.TOMLTable => node.type === 'TOMLTable')
  const inTable = (depth: number): string | null => {
    const rest = path.slice(depth)
    if (inArray(rest)) return null
    const line = `${dottedKey(rest)} = ${literal}`
    const prefix = path.slice(0, depth)
    const inline = entries.find((row) => inlineEntry(row) && samePath(row.path, prefix))?.node?.value
    if (inline?.type === 'TOMLInlineTable') {
      const last = inline.body.at(-1)
      if (last !== undefined) return `${text.slice(0, last.range[1])}, ${line}${text.slice(last.range[1])}`
      const close = inline.range[1] - 1
      return `${text.slice(0, close)} ${line} ${text.slice(close)}`
    }
    if (depth === 0) return `${line}${nl}${text}`
    const table = tables.find((node) => samePath(node.resolvedKey, prefix))
    if (table === undefined) return null
    return insertLines(text, lineEnd(text, table.range[1]), `${line}${nl}`, nl)
  }
  const parents = path.slice(0, -1)
  const candidates: Array<string | null> = []
  if (!inArray(path) && isArrayOfTables(value)) candidates.push(insertLines(text, text.length, arrayTables(path, value, nl), nl))
  candidates.push(inTable(parents.length))
  if (parents.length > 0 && !inArray(path)) {
    const header = `[${dottedKey(parents)}]${nl}${tomlKey(String(path.at(-1)))} = ${literal}${nl}`
    candidates.push(insertLines(text, text.length, header, nl))
  }
  for (let depth = parents.length - 1; depth >= 0; depth--) candidates.push(inTable(depth))
  return candidates.filter((candidate): candidate is string => candidate !== null)
}

/** The path to every value inside a table that is not itself a table with keys. */
function leaves(value: unknown, base: string[] = []): string[][] {
  return Object.entries(record(value)).flatMap(([key, child]) =>
    isTable(child) && Object.keys(child as object).length > 0 ? leaves(child, [...base, key]) : [[...base, key]])
}

/**
 * An array of tables given new elements where it stands, so its comments, its place in the
 * file and its line endings stay. An element in both lists keeps its tables and has its
 * values removed and set one at a time. Elements past the end of the new list are taken
 * out, and new ones go right after the array's last table. Null when the new value is not
 * a list of tables, or a change does not fit in place.
 */
function replaceArrayOfTables(text: string, path: readonly PathKey[], old: unknown, value: unknown): string | null {
  if (!Array.isArray(old) || !isArrayOfTables(value)) return null
  const nl = newline(text)
  const array = (current: string): TomlEntry | undefined =>
    tomlEntries(parseToml(current)).find((entry) => entry.node === null && samePath(entry.path, path))
  let out = text
  try {
    for (let index = 0; index < Math.min(old.length, value.length); index++) {
      for (const leaf of leaves(old[index])) {
        if (at(value[index], leaf) !== undefined) continue
        const row = tomlEntries(parseToml(out)).find((entry) => samePath(entry.path, [...path, index, ...leaf]))
        if (row === undefined) return null
        out = removeEntry(out, row)
      }
      for (const leaf of leaves(value[index])) out = patchToml(out, [...path, index, ...leaf], at(value[index], leaf))
    }
    const extra = array(out)?.tables.filter((table) => (table.resolvedKey[path.length] as number) >= value.length) ?? []
    if (extra.length > 0) out = removeEntry(out, { path: [...path], node: null, holder: null, tables: extra })
    if (value.length > old.length) {
      const tables = array(out)?.tables ?? []
      if (tables.length === 0) return null
      const end = lineEnd(out, Math.max(...tables.map((table) => table.range[1])))
      out = insertLines(out, end, arrayTables(path, value.slice(old.length), nl), nl)
    }
    return out
  } catch {
    return null
  }
}

/**
 * The file with one value set, the rest byte for byte. A key already there has its value
 * replaced. An array of tables already there keeps its place and comments where it can,
 * and is otherwise taken out and written anew. A key that is not there yet goes into the
 * table that holds it, however that table is written, and a table that is not there yet
 * goes at the end. The first place that gives valid TOML with only that one value changed
 * is taken. Values are compared with their TOML types. This parses the file again for each
 * place it tries, so `settle` uses it only for what the one-pass rewrite left.
 */
function patchToml(text: string, path: PathKey[], value: unknown): string {
  if (path.length === 0 || secretSetting(path, value)) throw new Error('a secret cannot be copied')
  const ast = parseToml(text)
  const literal = tomlLiteral(value)
  const current = typedValue(ast)
  const entries = tomlEntries(ast)
  const entry = entries.find((row) => samePath(row.path, path))
  if (entry && same(at(current, path), value)) return text
  const wanted = stableJson(withValue(current, path, value))
  const fits = (candidate: string): boolean => {
    try {
      return stableJson(typedValue(parseTOML(candidate, { tomlVersion: '1.0' }))) === wanted
    } catch {
      return false
    }
  }
  let candidates: string[]
  if (entry?.node) candidates = [text.slice(0, entry.node.value.range[0]) + literal + text.slice(entry.node.value.range[1])]
  else if (entry) {
    const inPlace = replaceArrayOfTables(text, path, at(current, path), value)
    const rest = removeEntry(text, entry)
    const restAst = parseToml(rest)
    candidates = [...(inPlace === null ? [] : [inPlace]), ...insertions(rest, restAst, tomlEntries(restAst), path, value)]
  } else candidates = insertions(text, ast, entries, path, value)
  const found = candidates.find(fits)
  if (found === undefined) throw new Error('config.toml has no place for a setting that keeps it valid TOML')
  return found
}

/** A copy of a value with one path set. The tables and arrays along the path are copied, the rest shared. */
function withValue(root: unknown, path: readonly PathKey[], value: unknown): unknown {
  if (path.length === 0) return value
  const [key, ...rest] = path
  if (typeof key === 'number') {
    const list = Array.isArray(root) ? [...root] : []
    list[key] = withValue(list[key], rest, value)
    return list
  }
  const table = Object.assign(dict(), record(root))
  table[key!] = withValue(own(root, key!), rest, value)
  return table
}

/**
 * The file with one entry taken out, the rest byte for byte. Inside an inline table the
 * comma that separated it goes too. An array of tables loses every table that belongs to it.
 */
function removeEntry(text: string, { node, holder, tables }: TomlEntry): string {
  if (node === null) {
    return tables.map((table) => table.range).sort((a, b) => b[0] - a[0])
      .reduce((out, [start, end]) => out.slice(0, start) + out.slice(end), text)
  }
  let [start, end] = node.range
  if (holder !== null) {
    const index = holder.body.indexOf(node)
    if (index > 0) start = holder.body[index - 1]!.range[1]
    else if (holder.body.length > 1) end = holder.body[1]!.range[0]
  }
  return text.slice(0, start) + text.slice(end)
}

/**
 * The file brought the rest of the way to `desired` one setting at a time: each setting that
 * differs is set with `patchToml`, each one `desired` lacks is taken out, and then each
 * `[table]` `desired` lacks. Slow on a large file, so it runs only for what the one-pass
 * rewrite left (a changed array of tables) or when that rewrite did not give valid TOML.
 */
function settle(text: string, desired: Dict): string {
  let out = text
  const now = typedToml(out)
  for (const { path, value } of settingsOf(desired).filter((setting) => !same(at(now, setting.path), setting.value))) {
    out = patchToml(out, path, value)
  }
  // One at a time, the last in the file first, because taking a key out of an inline
  // table moves the text of the keys after it.
  for (;;) {
    const remove = topEntries(parseToml(out)).filter((entry) => !inlineEntry(entry) && at(desired, entry.path) === undefined)
    const last = remove.sort((a, b) => entryStart(b) - entryStart(a))[0]
    if (last === undefined) break
    out = removeEntry(out, last)
  }
  for (;;) {
    const table = parseToml(out).body[0].body.find((node): node is AST.TOMLTable =>
      node.type === 'TOMLTable' && !inArray(node.resolvedKey) && !isTable(at(desired, node.resolvedKey)))
    if (table === undefined) break
    out = out.slice(0, table.range[0]) + out.slice(table.range[1])
  }
  return out
}

/** Whether a text holds `desired`, empty tables aside. */
function holds(text: string, desired: Dict): boolean {
  try {
    return same(withoutEmptyTables(typedToml(text)), withoutEmptyTables(desired))
  } catch {
    return false
  }
}

/**
 * The file changed to hold `desired`, its layout and comments kept where they can be. The
 * one-pass rewrite does nearly all of it; `settle` finishes what it left, and starts again
 * from the file itself when the one-pass result is not valid TOML. Throws when neither gives
 * a file that holds `desired`.
 */
function rewrite(text: string, desired: Dict, texts: ValueTexts): string {
  if (same(typedToml(text), desired)) return text
  for (const start of [() => rewriteInOnePass(text, desired, texts), () => text]) {
    try {
      const out = settle(start(), desired)
      if (holds(out, desired)) return out
    } catch {
      // Try the next way.
    }
  }
  throw new Error('config.toml could not be written so that it holds the merged settings')
}

// ---- the merge

/** The settings of a typed file that are not secrets, as a table. */
function publicSettings(values: Dict): Dict {
  const out = dict()
  for (const setting of settingsOf(values)) {
    if (!secretSetting(setting.path, setting.value)) setAt(out, setting.path, setting.value)
  }
  return out
}

/**
 * The value one trust field ends up with, given the login's own value and the default
 * home's. `path` is one trust field, as `trustValue` accepts it. The header comment explains
 * the rules.
 */
function mergedTrust(path: readonly PathKey[], own: unknown, fromDefault: unknown): unknown {
  const field = path.at(-1)
  if (field === 'enabled') return own === false || fromDefault === false ? false : own
  if (field === 'trust_level') return fromDefault === 'untrusted' ? fromDefault : own
  return own
}

/** The default home's settings with every secret left out, as TOML. */
export function publicAccountConfig(text: string): string {
  const source = withoutBom(text)
  const ast = parseToml(source)
  return rewrite('', publicSettings(typedValue(ast)), valueTexts(source, ast))
}

/** What `mergeAccountConfig` answers. */
export interface AccountConfigMerge {
  /** The login's new `config.toml`. */
  content: string
  /**
   * The default home's settings that were merged in, secrets left out, as TOML: what the
   * caller keeps as the last merged copy for the next merge.
   */
  merged: string
  /** The default home has a secret the login lacks, such as an MCP server's `env` table. */
  missingSecrets: boolean
  /**
   * Settings, as dotted paths, where the default home's value was not applied because a
   * secret stands in the way: the login's value holds a secret, or the default home's does
   * and it differs from the login's in more than its secrets. Never holds a value.
   */
  heldBack: string[]
}

/**
 * The login's `config.toml` merged three ways with the default home's: `source` is the
 * default home's file, `target` the login's ('' when it has none) and `lastMerged` the
 * `merged` text of the last merge, or null when there is none. The header comment explains
 * the rules.
 *
 * Throws when `source` or `target` is not valid TOML, or the result cannot be written. No
 * message names a value from either file. A `lastMerged` that is not valid TOML counts as
 * none.
 */
export function mergeAccountConfig(source: string, target: string, lastMerged: string | null): AccountConfigMerge {
  const sourceText = withoutBom(source)
  const targetText = withoutBom(target)
  const sourceAst = parseToml(sourceText)
  const sourceValues = typedValue(sourceAst)
  const targetValues = typedToml(targetText)
  const fromSource = publicSettings(sourceValues)
  // A login file with no settings in it (none, or only comments and blank lines) gets every
  // setting of the default home, as a missing file does.
  let base: Dict | null = null
  if (lastMerged !== null && settingsOf(targetValues).length > 0) {
    try {
      base = typedToml(withoutBom(lastMerged))
    } catch {
      base = null
    }
  }

  const desired = copyTables(targetValues) as Dict
  const heldBack: string[] = []
  // The login's settings the default home no longer has. Where the default home still has a
  // value that holds a secret, the login's stays, and the last loop names it.
  for (const { path, value } of settingsOf(targetValues)) {
    if (secretSetting(path, value) || at(sourceValues, path) !== undefined) continue
    const trust = trustValue(path)
    if (base === null) {
      if (!trust) removeAt(desired, path)
      continue
    }
    const last = at(base, path)
    if (last === undefined || (trust && !same(value, last))) continue
    removeAt(desired, path)
  }
  // The default home's settings.
  for (const { path, value } of settingsOf(fromSource)) {
    const prefixSecret = path.some((_, index) => {
      const above = at(targetValues, path.slice(0, index + 1))
      return above !== undefined && !isTable(above) && secretSetting(path.slice(0, index + 1), above)
    })
    const belowSecret = isTable(at(targetValues, path)) && !holdsOnlyOrdinary(at(targetValues, path), path)
    if (prefixSecret || belowSecret) {
      if (!same(masked(value, secretPath(path)), masked(at(targetValues, path), secretPath(path)))) heldBack.push(dottedKey(path))
      continue
    }
    const own = at(targetValues, path)
    if (base !== null && (own === undefined || isTable(own))) {
      // The login's file lacks the setting, or has a table there: when the default home's
      // value is the one last merged in, the login (or Codex in a session on it) deleted or
      // changed it, and that stands. A unit (`unitOf`) the login lacks as a whole counts as
      // deleted until the default home changes anything in it.
      const unit = unitOf(path)
      const whole = unit !== null && at(targetValues, unit) === undefined ? unit : path
      const lastWhole = at(base, whole)
      if (lastWhole !== undefined && same(at(fromSource, whole), lastWhole)) continue
    }
    const ownValue = own !== undefined && !isTable(own) ? own : undefined
    const last = base === null ? undefined : at(base, path)
    let next = value
    if (trustValue(path)) {
      if (ownValue !== undefined && (last === undefined || !same(ownValue, last))) next = mergedTrust(path, ownValue, value)
    } else if (ownValue !== undefined && last !== undefined && same(value, last) && !same(ownValue, last)) {
      next = ownValue
    }
    setAt(desired, path, next)
  }
  // A unit the default home dropped since the last merge goes as a whole, the login's own
  // keys and secrets in it included.
  if (base !== null) {
    for (const unit of unitPaths(targetValues)) {
      if (at(base, unit) !== undefined && at(sourceValues, unit) === undefined) removeAt(desired, unit)
    }
  }
  // A table that lost its last setting that is not a secret goes as a whole.
  for (const path of tablePaths(targetValues)) {
    if (!holdsOrdinarySetting(at(targetValues, path), path)) continue
    const now = at(desired, path)
    if (isTable(now) && !holdsOrdinarySetting(now, path)) removeAt(desired, path)
  }
  // A unit with only secrets left and without the key Codex needs goes too, even when the
  // login's file had it so already: an earlier kurmis removed an MCP server's `command` and
  // left its `env` table, and Codex refuses to load such a file.
  for (const unit of unitPaths(desired)) {
    const value = at(desired, unit)
    if (!holdsOrdinarySetting(value, unit) && !UNIT_KEYS[unit[0]!]!.some((key) => own(value, key) !== undefined)) removeAt(desired, unit)
  }
  // The default home's secrets: missing from the login, or kept apart from a change. A secret
  // of a unit the login does not have although the default home's has more than secrets (the
  // login deleted the MCP server) is not missing.
  let missingSecrets = false
  for (const { path, value } of settingsOf(sourceValues)) {
    if (!secretSetting(path, value)) continue
    const unit = unitOf(path)
    if (unit !== null && at(desired, unit) === undefined && at(fromSource, unit) !== undefined) continue
    const kept = at(desired, path)
    if (kept === undefined) missingSecrets = true
    else if (!same(masked(value, secretPath(path)), masked(kept, secretPath(path)))) heldBack.push(dottedKey(path))
  }

  const texts = valueTexts(sourceText, sourceAst)
  return {
    content: rewrite(targetText, desired, texts),
    merged: rewrite('', fromSource, texts),
    missingSecrets,
    heldBack: [...new Set(heldBack)]
  }
}

/**
 * Tables Codex reads as one thing each, every key below them a part of it: an MCP server
 * (`mcp_servers.<name>`), which Codex refuses without its `command` or `url`, and a model
 * provider (`model_providers.<name>`), which it refuses without its `name`.
 */
const UNIT_TABLES = new Set(['mcp_servers', 'model_providers'])

/** For each of `UNIT_TABLES`, the keys of which a unit needs one for Codex to load it. */
const UNIT_KEYS: Readonly<Record<string, readonly string[]>> = { mcp_servers: ['command', 'url'], model_providers: ['name'] }

/** The path of the unit a setting is part of, or null when it is part of none. */
function unitOf(path: readonly string[]): string[] | null {
  return path.length >= 3 && UNIT_TABLES.has(path[0]!) ? path.slice(0, 2) : null
}

/** The path of every unit in a file. */
function unitPaths(values: Dict): string[][] {
  return [...UNIT_TABLES].flatMap((key) => Object.entries(record(own(values, key)))
    .filter(([, child]) => isTable(child))
    .map(([name]) => [key, name]))
}

/** Whether every setting in a table is not a secret. */
function holdsOnlyOrdinary(value: unknown, path: string[]): boolean {
  return settingsOf(value, path).every((setting) => !secretSetting(setting.path, setting.value))
}

/** Whether two `config.toml` texts hold the same settings, whatever their layout. Throws when either is not valid TOML. */
export function sameTomlSettings(a: string, b: string): boolean {
  return same(typedToml(withoutBom(a)), typedToml(withoutBom(b)))
}

/** Whether a text is valid TOML. */
export function validToml(text: string): boolean {
  try {
    parseToml(withoutBom(text))
    return true
  } catch {
    return false
  }
}
