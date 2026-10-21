/**
 * The `config.toml` an extra Codex login's home gets: the default home's settings without
 * anything that looks like a secret, with the secrets that login's own copy already has
 * kept in place. Copied from the original router's `src/tools/claude/core/codex-account-config.ts`; the
 * trust rules below differ from the original router's.
 *
 * An extra Codex login runs with its own `CODEX_HOME` (`codex/<name>/` in the data folder).
 * Before every start its `config.toml` is made again from `~/.codex/config.toml` with
 * `mergeAccountConfig` (`codex-home.ts` says when). A secret, such as an MCP server's `env`
 * table or a bearer header, is never copied; a login that needs one keeps its own. Layout,
 * comments and TOML types (integer or float, the kind of date) are kept.
 *
 * Codex keeps trust in the `config.toml` of the home it runs with: `hooks.state."<hook key>"`
 * for a hook (`trusted_hash`, `enabled`) and `projects."<folder>"` for a folder
 * (`trust_level`). A session asks for this trust and writes it into the login's own file, so
 * those values are kept across refreshes, and the default home's values fill in the trust
 * fields the login's file does not have. Where both files have a value for the same field of
 * the same hook or folder (`mergedTrust`):
 *
 * - `enabled`: `false` wins, so a hook switched off in either home stays off;
 * - `trust_level`: `"untrusted"` wins over any other value;
 * - `trusted_hash`: the login's own hash stays. A hash trusts one version of a hook, the one
 *   that hashes to it, so neither hash trusts more than the other. The login's hash is the
 *   one a session on that login asked for. Taking the default home's would undo that on
 *   every refresh, and dropping both would only last until the next refresh filled the
 *   default home's hash in.
 *
 * the original router drops the trust a login's own file gave, because a model in a session could have
 * written it there. Kurmis keeps it: kurmis has no window in which a person gives trust, and
 * a model that can write the login's file can as well write `~/.codex/config.toml`, whose
 * trust reaches every login.
 *
 * Because the login's own values are kept, the restrictive values ratchet: once a folder is
 * `"untrusted"` or a hook `enabled = false` in the login's file, trusting it again in the
 * default home does not reach the login. It has to be trusted again in a session on that
 * login, or the line removed from the login's file.
 */
import { parseTOML, type AST } from 'toml-eslint-parser'

/** Keys whose values are never copied: environment tables, headers and credentials. */
const OPAQUE_KEY = /^(env|environment|set|http_headers|headers|env_http_headers|bearer_token_env_var|auth|authentication)$/i
const SECRET_KEY = /(?:api.?key|secret|password|credential|access.?token|refresh.?token|authorization|oauth|private.?key)/i
const SECRET_TEXT = /(?:\bBearer\s+\S+|\b(?:sk|ghp|github_pat|xox[baprs])[-_][a-z\d_-]{8,}|-----BEGIN [\w ]*PRIVATE KEY-----|https?:\/\/[^\s/@:]*:[^\s/@]+@|[?&](?:token|key|secret|signature|password)=[^&#\s]+|(?:api[_-]?key|secret|password|authorization|access[_-]?token)\s*[=:]\s*["']?[^\s,"'}]+)/i

/**
 * Whether a text looks like it holds a secret: a bearer token, a known key format, a private
 * key, a password in a URL and the like.
 */
function secretLooking(text: string): boolean {
  return SECRET_TEXT.test(text) || /--(?:token|api-key|password|secret)(?:[=\s]+)\S+/i.test(text)
}

function opaqueKey(key: string): boolean {
  return OPAQUE_KEY.test(key) || SECRET_KEY.test(key)
}

/** One key of a path: a table's key, or the index of an element of an array of tables. */
type PathKey = string | number

/** The tables Codex keeps trust in, one per folder or hook, and the fields of each that hold trust. */
const TRUST_TABLES: ReadonlyArray<{ parent: readonly string[]; fields: readonly PathKey[] }> = [
  { parent: ['projects'], fields: ['trust_level'] },
  { parent: ['hooks', 'state'], fields: ['trusted_hash', 'enabled'] }
]

/**
 * Where the folder or hook key sits in a path, or -1. That is only for a path naming a trust
 * table itself (`table` true) or one trust field of it (`table` false). A plain value right
 * under `[projects]` or `[hooks.state]`, or a field that holds no trust, gets -1.
 */
function trustNameIndex(path: readonly PathKey[], table: boolean): number {
  for (const { parent, fields } of TRUST_TABLES) {
    if (!parent.every((key, index) => path[index] === key)) continue
    const name = parent.length
    if (table ? path.length === name + 1 : path.length === name + 2 && fields.includes(path[name + 1]!)) return name
  }
  return -1
}

/**
 * Whether any key of a path marks a secret. `table` says whether the path names a table.
 * The name of a trust table is a hook key or a folder, so it is not read as one: a
 * repository called `secrets-tool` is not a secret. Every other key is.
 */
function opaquePath(path: readonly PathKey[], table: boolean): boolean {
  const name = trustNameIndex(path, table)
  return path.some((key, index) => index !== name && typeof key === 'string' && opaqueKey(key))
}

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

/** Whether a path is one trust field of one trust table. */
function trustValue(path: readonly PathKey[]): boolean {
  return trustNameIndex(path, false) >= 0
}

/**
 * The value one trust field ends up with, given the login's own value and the default
 * home's (`undefined` when the default home has none). `path` is one trust field, as
 * `trustValue` accepts it. The header comment explains the rules.
 */
function mergedTrust(path: readonly PathKey[], own: unknown, fromDefault: unknown): unknown {
  if (fromDefault === undefined) return own
  const field = path.at(-1)
  if (field === 'enabled') return own === false || fromDefault === false ? false : own
  if (field === 'trust_level') return fromDefault === 'untrusted' ? fromDefault : own
  return own
}

/** An argument list that passes a header, a token or an environment value on the command line. */
function opaqueArguments(value: unknown): boolean {
  return Array.isArray(value) && value.some((arg) => typeof arg === 'string' && /^(?:-H|--(?:env|header|headers|token|api-key|password|secret|authorization))(?:=|$)/i.test(arg))
}

type Dict = Record<string, unknown>

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

/**
 * JSON with the keys sorted, so two equal values compare equal as text. A `TomlScalar` is
 * written with its kind, so an integer never equals a float, nor a date a string. Keys are
 * sorted by code unit, not by locale: a locale sort ranks "é" and "é" equal, and
 * their order would then depend on the file.
 */
function stableJson(value: unknown): string {
  if (value instanceof TomlScalar) return `${value.kind}:${JSON.stringify(value.text)}`
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

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
  return tableValue(parseToml(text), (node) => node.value)
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
function settings(ast: AST.TOMLProgram): TomlEntry[] {
  return tomlEntries(ast).filter((entry) => !inArray(entry.path))
}

function inlineEntry(entry: TomlEntry): boolean {
  return entry.node?.value.type === 'TOMLInlineTable'
}

function entryStart(entry: TomlEntry): number {
  return entry.node?.range[0] ?? entry.tables[0]!.range[0]
}

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

function samePath(a: readonly PathKey[], b: readonly PathKey[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
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

function newline(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

/** The offset just past the end of the line that `offset` is on. */
function lineEnd(text: string, offset: number): number {
  const end = text.indexOf('\n', offset)
  return end < 0 ? text.length : end + 1
}

/** The text with `lines` put in at `offset`, which starts a line or ends the file. */
function insertLines(text: string, offset: number, lines: string, nl: string): string {
  const before = text.slice(0, offset)
  return `${before}${before.length === 0 || before.endsWith('\n') ? '' : nl}${lines}${text.slice(offset)}`
}

/** A list of tables written as `[[name]]` tables, one for each element. */
function arrayTables(path: readonly PathKey[], value: readonly unknown[], nl: string): string {
  const header = `[[${path.map((key) => tomlKey(String(key))).join('.')}]]${nl}`
  return value.map((table) => header + Object.entries(record(table)).map(([key, child]) => `${tomlKey(key)} = ${tomlLiteral(child)}${nl}`).join('')).join('')
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
    const line = `${rest.map((key) => tomlKey(String(key))).join('.')} = ${literal}`
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
  if (!inArray(path) && Array.isArray(value) && value.length > 0 && value.every(isTable)) {
    candidates.push(insertLines(text, text.length, arrayTables(path, value, nl), nl))
  }
  candidates.push(inTable(parents.length))
  if (parents.length > 0 && !inArray(path)) {
    const header = `[${parents.map((key) => tomlKey(String(key))).join('.')}]${nl}${tomlKey(String(path.at(-1)))} = ${literal}${nl}`
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
  if (!Array.isArray(old) || !Array.isArray(value) || value.length === 0 || !value.every(isTable)) return null
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
 * is taken. Values are compared with their TOML types.
 */
function patchToml(text: string, path: PathKey[], value: unknown): string {
  if (path.length === 0 || opaquePath(path, false)) throw new Error('a secret key cannot be copied')
  const ast = parseToml(text)
  const literal = tomlLiteral(value)
  if (secretLooking(literal) || opaqueTree(value)) throw new Error('a secret value cannot be copied')
  const current = typedValue(ast)
  const entries = tomlEntries(ast)
  const entry = entries.find((row) => samePath(row.path, path))
  if (entry && stableJson(at(current, path)) === stableJson(value)) return text
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

/**
 * Whether a value that is not a table looks like a secret. A string is read as the file
 * means it, with its escapes decoded: a tab written `\t` is a tab here.
 */
function protectedValue(value: unknown): boolean {
  if (Array.isArray(value)) return opaqueArguments(value) || value.some(opaqueTree)
  if (typeof value === 'string') return secretLooking(value)
  if (value instanceof TomlScalar) return secretLooking(value.text)
  return false
}

function opaqueTree(value: unknown): boolean {
  return protectedValue(value) || ((isTable(value) || Array.isArray(value)) && Object.entries(value as object).some(([key, child]) => opaqueKey(key) || opaqueTree(child)))
}

/** The default home's settings with every secret-looking key and value left out. */
export function publicAccountConfig(text: string): string {
  let result = ''
  const visit = (value: unknown, path: string[]): void => {
    if (opaquePath(path, isTable(value)) || protectedValue(value)) return
    if (isTable(value)) {
      for (const [key, child] of Object.entries(value as Dict)) visit(child, [...path, key])
    } else result = patchToml(result, path, value)
  }
  visit(typedToml(text), [])
  if (secretLooking(result)) throw new Error('config.toml could not be copied without its secrets')
  return result
}

/**
 * The login's `config.toml` made to hold the default home's settings: every public value
 * set, every public value the default no longer has removed, and every secret the login
 * already had kept. The login's own trust values are kept as well, merged with the default
 * home's by `mergedTrust`.
 * `missingSecrets` says the default home has a secret the login lacks, such as an MCP
 * server's `env` table.
 *
 * `source` is the default home's file and `target` the login's ('' when it has none).
 * Throws when either is not valid TOML, or when the login's own secrets and trust cannot be
 * kept in place. No message names a value from either file.
 */
export function mergeAccountConfig(source: string, target: string): { content: string; missingSecrets: boolean } {
  const targetValues = typedToml(target)
  const kept = (entry: TomlEntry): boolean => opaquePath(entry.path, inlineEntry(entry)) || protectedValue(at(targetValues, entry.path))
  const targetEntries = settings(parseToml(target))
  const opaque = targetEntries.filter(kept)
  let publicSource = publicAccountConfig(source)
  const publicValues = typedToml(publicSource)
  for (const entry of targetEntries) {
    if (inlineEntry(entry) || !trustValue(entry.path) || kept(entry)) continue
    const merged = mergedTrust(entry.path, at(targetValues, entry.path), at(publicValues, entry.path))
    publicSource = patchToml(publicSource, entry.path, merged)
  }
  const values = typedToml(publicSource)
  const preserve = (current: unknown, incoming: unknown, path: string[]): unknown => {
    const next = Object.assign(dict(), record(incoming))
    for (const [key, value] of Object.entries(record(current))) {
      if (opaquePath([...path, key], isTable(value)) || protectedValue(value)) next[key] = value
      else if (isTable(value)) {
        const child = preserve(value, next[key], [...path, key])
        if (Object.keys(record(child)).length > 0) next[key] = child
      }
    }
    return next
  }
  const desired = preserve(targetValues, values, [])
  let content = target
  const incoming = settings(parseToml(publicSource)).filter((entry) => !inlineEntry(entry))
  for (const { path } of incoming) {
    if (opaque.some((entry) => samePath(entry.path, path))) continue
    content = patchToml(content, path, at(values, path))
  }
  // One at a time, the last in the file first, because taking a key out of an inline
  // table moves the text of the keys after it.
  for (;;) {
    const remove = settings(parseToml(content)).filter((entry) =>
      !inlineEntry(entry) && !opaquePath(entry.path, false) && !protectedValue(at(targetValues, entry.path)) && at(values, entry.path) === undefined)
    const last = remove.sort((a, b) => entryStart(b) - entryStart(a))[0]
    if (last === undefined) break
    content = removeEntry(content, last)
  }
  if (stableJson(withoutEmptyTables(typedToml(content))) !== stableJson(withoutEmptyTables(desired))) {
    throw new Error("the login's own secrets and trust in config.toml could not be kept in place")
  }
  const sourceValues = typedToml(source)
  const sourceOpaque = settings(parseToml(source))
    .filter((entry) => opaquePath(entry.path, inlineEntry(entry)) || protectedValue(at(sourceValues, entry.path)))
  const missingSecrets = sourceOpaque.some(({ path }) => !opaque.some((row) => samePath(row.path, path)))
  return { content, missingSecrets }
}

/** Whether two `config.toml` texts hold the same settings, whatever their layout. Throws when either is not valid TOML. */
export function sameTomlSettings(a: string, b: string): boolean {
  return stableJson(typedToml(a)) === stableJson(typedToml(b))
}

/** Whether a text is valid TOML. */
export function validToml(text: string): boolean {
  try {
    parseToml(text)
    return true
  } catch {
    return false
  }
}
