// Editing the user's Claude Code `settings.json` for `kurmis setup` and `kurmis setup --undo`.
//
// Setup puts the routing variables (`ROUTING_VARIABLES` in `routed-env.ts`) in the file's `env`
// object, so a plain `claude` and the IDE extensions reach the daemon. Undo takes them out again.
// Nothing else in the file is touched.
//
// The file is edited as text. The members of `env` are added, replaced or removed where they
// are, so the order of the keys, the indent, the line endings and everything outside `env` stay
// as they were. A new member copies the indent and the `": "` spacing of the members next to it.
// Claude Code reads the file as plain JSON, so a file `JSON.parse` refuses (comments, trailing
// commas), or one whose top level or `env` is not an object, is refused and never rewritten.
//
// Which values are kurmis':
//
// - `ANTHROPIC_BASE_URL` when it is `http://127.0.0.1:<port>` and either that port is the one in
//   `config.json` or `ANTHROPIC_CUSTOM_HEADERS` in the same `env` carries an `x-kurmis-key` line.
//   So undo still recognises it after the port in `config.json` was changed.
// - The `x-kurmis-*` lines of `ANTHROPIC_CUSTOM_HEADERS`. Any other line is the user's and is
//   kept, by setup and by undo.
// - `ENABLE_TOOL_SEARCH` and `CLAUDE_CODE_MAX_RETRIES` when they hold the value kurmis sets and
//   the backup (the file as it was before kurmis first changed it) does not hold the same value.
//   Setup leaves a different value the user set there, since routing works without them.
//
// Setup refuses an `ANTHROPIC_BASE_URL` that is not kurmis', because replacing it would silently
// cut off whatever the user pointed Claude Code at.
//
// The user's own header lines are kept exactly as written: setup puts kurmis' lines after them,
// and undo gives back the value the backup had when the backup's lines are the ones left, else
// the lines left joined by newlines. An `env` that undo empties is removed only when the backup
// shows the file had none before kurmis.
//
// The backup is the file as it was before kurmis changed it. Setup writes it when it changes a
// file that holds none of kurmis' settings, replacing an older backup (the file may have changed
// a lot since an earlier setup and undo), and leaves it when the file already holds kurmis'
// settings (a setup run again after the port or the key changed).
import { chmodSync, copyFileSync, constants, lstatSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { KURMIS_HEADERS, KEY_HEADER, parseCustomHeaders } from '../core/route-headers.ts'
import { ROUTING_VARIABLES, routedClaudeEnv } from '../core/routed-env.ts'
import { writeFileAtomicSync } from '../data/json-file.ts'
import { kurmisHome } from '../data/paths.ts'
import { PRIVATE_FILE_MODE, replaceFileSync, restrictToUserSync, userOnlyMode } from '../platform/files.ts'
import { notJsonText } from './json-error.ts'
import { claudeUserSettingsPath } from './settings-arg.ts'

const BASE_URL = 'ANTHROPIC_BASE_URL'
const CUSTOM_HEADERS = 'ANTHROPIC_CUSTOM_HEADERS'

/** Variables in `env` that would sign requests with an API key instead of a subscription login. */
const KEY_VARIABLES: readonly string[] = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']

/** A byte order mark some editors put at the start of a file. It is kept as it was. */
const BOM = '\uFEFF'

const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/?$/

/** A settings file kurmis will not edit, with a sentence saying why. Nothing was written. */
export class SettingsFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsFileError'
  }
}

/** What happened to one variable in `env`. */
export interface EnvChange {
  name: string
  /**
   * - `added`: kurmis' value was put in (for the headers: kurmis' lines were added).
   * - `updated`: an older kurmis value was replaced, e.g. after the port or the key changed;
   *   on undo, kurmis' header lines were removed and the user's were kept.
   * - `removed`: the variable was taken out.
   * - `unchanged`: it already held kurmis' value (setup).
   * - `kept`: it holds a value that is not kurmis', and was left as it is.
   */
  action: 'added' | 'updated' | 'removed' | 'unchanged' | 'kept'
  /** A plain sentence with more about the change, e.g. that the user's header lines were kept. */
  note?: string
}

/** The result of `applySetupToText` or `undoSetupInText`. */
export interface SettingsEdit {
  /** The new text of the file. The same string as the input when nothing changed. */
  text: string
  changed: boolean
  changes: EnvChange[]
  /** Setup added an `env` object because the file had none. */
  envCreated: boolean
  /** Undo removed the `env` object because nothing was left in it. */
  envRemoved: boolean
  /** Setup: the file held kurmis' settings already, so it is not a record of the file before kurmis. */
  hadKurmis: boolean
  /** Things the person should know that kurmis does not change, e.g. an API key in `env`. */
  warnings: string[]
}

export interface SetupValues {
  /** The daemon's port, from `config.json`. */
  port: number
  /** The daemon's secret, from the `key` file. */
  key: string
}

export interface UndoValues {
  /** The daemon's port from `config.json`, or null when it cannot be read. */
  port: number | null
  /** The text of the backup, or null when there is none. See the file comment. */
  backupText?: string | null
}

// ---------------------------------------------------------------------------------------------
// Finding the members of the top-level object and of `env` in the text.

interface Member {
  /** The member's key, unescaped. */
  name: string
  /** Where the key's opening quote is. */
  keyStart: number
  /** Just after the key's closing quote. */
  keyEnd: number
  valueStart: number
  /** Just after the value. */
  valueEnd: number
}

interface ObjectNode {
  /** Where `{` is. */
  open: number
  /** Where `}` is. */
  close: number
  members: Member[]
}

function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

/**
 * Finds where the values in a JSON text start and end. The text has already passed `JSON.parse`,
 * so this only has to find boundaries, not check the grammar.
 */
class Scanner {
  constructor(private readonly text: string) {}

  skipWhitespace(pos: number): number {
    while (isWhitespace(this.text[pos])) pos++
    return pos
  }

  /** The end of the string whose opening quote is at `pos`. */
  stringEnd(pos: number): number {
    let i = pos + 1
    while (i < this.text.length) {
      const char = this.text[i]
      if (char === '\\') i += 2
      else if (char === '"') return i + 1
      else i++
    }
    throw new SettingsFileError('the file ends inside a string')
  }

  /** The end of the value that starts at `pos`. */
  valueEnd(pos: number): number {
    const char = this.text[pos]
    if (char === '"') return this.stringEnd(pos)
    if (char === '{' || char === '[') return this.containerEnd(pos)
    let i = pos
    while (i < this.text.length && !isWhitespace(this.text[i]) && !',]}'.includes(this.text[i]!)) i++
    return i
  }

  private containerEnd(pos: number): number {
    let depth = 0
    let i = pos
    while (i < this.text.length) {
      const char = this.text[i]!
      if (char === '"') {
        i = this.stringEnd(i)
        continue
      }
      if (char === '{' || char === '[') depth++
      else if (char === '}' || char === ']') {
        depth--
        if (depth === 0) return i + 1
      }
      i++
    }
    throw new SettingsFileError('the file ends inside an object or a list')
  }

  /** The members of the object whose `{` is at `open`. */
  object(open: number): ObjectNode {
    const members: Member[] = []
    let pos = this.skipWhitespace(open + 1)
    if (this.text[pos] === '}') return { open, close: pos, members }
    for (;;) {
      const keyStart = pos
      const keyEnd = this.stringEnd(keyStart)
      const name = JSON.parse(this.text.slice(keyStart, keyEnd)) as string
      pos = this.skipWhitespace(keyEnd) + 1
      const valueStart = this.skipWhitespace(pos)
      const valueEnd = this.valueEnd(valueStart)
      members.push({ name, keyStart, keyEnd, valueStart, valueEnd })
      pos = this.skipWhitespace(valueEnd)
      if (this.text[pos] === '}') return { open, close: pos, members }
      pos = this.skipWhitespace(pos + 1)
    }
  }
}

/** The parsed file with the positions of its top-level object and its `env` object. */
interface ParsedSettings {
  text: string
  top: ObjectNode
  env: { member: Member; node: ObjectNode; value: Record<string, unknown> } | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSettings(text: string): ParsedSettings {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    // Never `JSON.parse`'s message: it quotes the text, which may hold a secret.
    throw new SettingsFileError(`it is ${notJsonText(text)}`)
  }
  if (!isPlainObject(value)) throw new SettingsFileError('its top level is not a JSON object')
  const scanner = new Scanner(text)
  const top = scanner.object(scanner.skipWhitespace(0))
  const envMembers = top.members.filter((member) => member.name === 'env')
  if (envMembers.length > 1) throw new SettingsFileError('it has more than one "env" key')
  const envMember = envMembers[0]
  if (envMember === undefined) return { text, top, env: null }
  const envValue = value.env
  if (!isPlainObject(envValue)) throw new SettingsFileError('its "env" is not a JSON object')
  const node = scanner.object(envMember.valueStart)
  for (const name of ROUTING_VARIABLES) {
    if (node.members.filter((member) => member.name === name).length > 1) {
      throw new SettingsFileError(`its "env" has more than one "${name}" key`)
    }
  }
  return { text, top, env: { member: envMember, node, value: envValue } }
}

// ---------------------------------------------------------------------------------------------
// Text edits. Each takes the text and returns the edited text; the caller parses again after
// each one, which is cheap for a file this size and keeps every edit simple.

interface Layout {
  eol: string
  /** One level of indent: the indent of the first top-level key, or two spaces. */
  unit: string
  /** What goes between a key and its value at the top level, `": "` when there is no key yet. */
  colon: string
}

function layoutOf(parsed: ParsedSettings): Layout {
  const eol = parsed.text.includes('\r\n') ? '\r\n' : '\n'
  const first = parsed.top.members[0]
  let unit = '  '
  if (first !== undefined) {
    const before = parsed.text.slice(parsed.top.open + 1, first.keyStart)
    const newline = before.lastIndexOf('\n')
    if (newline >= 0 && before.length > newline + 1) unit = before.slice(newline + 1)
  }
  return { eol, unit, colon: colonOf(parsed.text, parsed.top, ': ') }
}

/** The whitespace at the start of the line `pos` is on. */
function lineIndent(text: string, pos: number): string {
  const start = text.lastIndexOf('\n', pos - 1) + 1
  let end = start
  while (text[end] === ' ' || text[end] === '\t') end++
  return text.slice(start, end)
}

/** What goes between a key and its value in this object, or `fallback` when it has no members. */
function colonOf(text: string, node: ObjectNode, fallback: string): string {
  const first = node.members[0]
  return first === undefined ? fallback : text.slice(first.keyEnd, first.valueStart)
}

/** What goes after the comma between two members of this object, as the object writes it. */
function separatorOf(text: string, node: ObjectNode, layout: Layout): string {
  const [first, second] = node.members
  const gap = second === undefined
    ? text.slice(node.open + 1, first!.keyStart)
    : text.slice(first!.valueEnd, second.keyStart).replace(',', '')
  const newline = gap.lastIndexOf('\n')
  return newline >= 0 ? `${layout.eol}${gap.slice(newline + 1)}` : gap
}

/**
 * The text with `"name": <valueJson>` added as the last member of the object. The new member
 * follows the layout of the members already there: on its own line with their indent, or on the
 * same line after `, `. In an empty object it goes on its own line, one level in from the line
 * the object starts on, unless the whole file is on one line.
 */
function addMember(text: string, node: ObjectNode, name: string, valueJson: string, layout: Layout): string {
  const member = `${JSON.stringify(name)}${colonOf(text, node, layout.colon)}${valueJson}`
  const last = node.members.at(-1)
  if (last !== undefined) {
    return `${text.slice(0, last.valueEnd)},${separatorOf(text, node, layout)}${member}${text.slice(last.valueEnd)}`
  }
  if (!text.includes('\n')) {
    return `${text.slice(0, node.open + 1)}${member}${text.slice(node.close)}`
  }
  const outer = lineIndent(text, node.open)
  return `${text.slice(0, node.open + 1)}${layout.eol}${outer}${layout.unit}${member}${layout.eol}${outer}${text.slice(node.close)}`
}

/** The text with one member of the object removed, with its comma and the space before it. */
function removeMember(text: string, node: ObjectNode, index: number): string {
  const member = node.members[index]!
  if (node.members.length === 1) {
    return `${text.slice(0, node.open + 1)}${text.slice(node.close)}`
  }
  if (index > 0) {
    const previous = node.members[index - 1]!
    return `${text.slice(0, previous.valueEnd)}${text.slice(member.valueEnd)}`
  }
  const next = node.members[1]!
  return `${text.slice(0, member.keyStart)}${text.slice(next.keyStart)}`
}

function replaceValue(text: string, member: Member, valueJson: string): string {
  return `${text.slice(0, member.valueStart)}${valueJson}${text.slice(member.valueEnd)}`
}

/** An object's members as text, laid out like a new `env` block one level in. */
function newEnvJson(values: Record<string, string>, outerIndent: string, layout: Layout, oneLine: boolean): string {
  const entries = Object.entries(values).map(([name, value]) => `${JSON.stringify(name)}${layout.colon}${JSON.stringify(value)}`)
  if (oneLine) return `{${entries.join(layout.colon.endsWith(' ') ? ', ' : ',')}}`
  const inner = `${outerIndent}${layout.unit}`
  return `{${layout.eol}${entries.map((entry) => `${inner}${entry}`).join(`,${layout.eol}`)}${layout.eol}${outerIndent}}`
}

// ---------------------------------------------------------------------------------------------
// Which values are kurmis'.

/**
 * The values setup writes: `ROUTING_VARIABLES` from `routedClaudeEnv` on Auto, started on the
 * default login. The user's own lines of `existingHeaders` come first, exactly as written, then
 * kurmis' lines.
 */
export function kurmisEnvValues(values: SetupValues, existingHeaders: string | null): Record<string, string> {
  const routed = routedClaudeEnv({
    port: values.port,
    key: values.key,
    login: null,
    startedOn: null,
    secureStorageDir: null,
    inheritedCustomHeaders: null
  })
  const out: Record<string, string> = {}
  for (const name of ROUTING_VARIABLES) {
    const value = routed.set[name]
    if (value !== undefined) out[name] = value
  }
  const theirs = othersHeaderLines(existingHeaders ?? '')
  if (theirs.length > 0) out[CUSTOM_HEADERS] = [...theirs, out[CUSTOM_HEADERS]!].join('\n')
  return out
}

function hasKurmisHeader(headers: unknown): boolean {
  return typeof headers === 'string' &&
    parseCustomHeaders(headers).some((header) => header.name.toLowerCase() === KEY_HEADER)
}

/** The header lines of a value that are not kurmis', exactly as they were written. */
function othersHeaderLines(headers: string): string[] {
  return headers.split(/\r?\n/).filter((line) => {
    const colon = line.indexOf(':')
    const name = colon < 0 ? '' : line.slice(0, colon).trim().toLowerCase()
    return line.trim().length > 0 && !KURMIS_HEADERS.includes(name)
  })
}

function isKurmisBaseUrl(value: unknown, env: Record<string, unknown>, port: number | null): boolean {
  if (typeof value !== 'string') return false
  const match = LOOPBACK_URL.exec(value)
  if (match === null) return false
  return (port !== null && Number(match[1]) === port) || hasKurmisHeader(env[CUSTOM_HEADERS])
}

function displayValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function keyVariableWarnings(env: Record<string, unknown> | undefined): string[] {
  if (env === undefined) return []
  return KEY_VARIABLES.filter((name) => env[name] !== undefined).map((name) =>
    `The "env" also sets ${name}, so Claude Code signs its requests with that key instead of a subscription login. Kurmis leaves it; remove it if you want your logins used.`)
}

/**
 * What the backup says about the file before kurmis changed it: its `env` (null when it had
 * none). Null for the whole answer when there is no backup that can say: none, one that is not
 * a JSON object, or one that already holds kurmis' settings.
 */
function backupBefore(backupText: string | null | undefined): { env: Record<string, unknown> | null } | null {
  if (backupText === null || backupText === undefined) return null
  let value: unknown
  try {
    value = JSON.parse(withoutBom(backupText))
  } catch {
    return null
  }
  if (!isPlainObject(value)) return null
  if (value.env === undefined) return { env: null }
  if (!isPlainObject(value.env)) return null
  const env = value.env
  // A backup that already holds kurmis' settings is not a record of what the user had.
  if (hasKurmisHeader(env[CUSTOM_HEADERS])) return null
  return { env }
}

function withoutBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text
}

// ---------------------------------------------------------------------------------------------
// Setup and undo on the text.

function emptyEdit(text: string): SettingsEdit {
  return { text, changed: false, changes: [], envCreated: false, envRemoved: false, hadKurmis: false, warnings: [] }
}

/**
 * The file's text with kurmis' routing variables in its `env`. `text` null means the file does
 * not exist, which gives a new file. Text that is only whitespace counts as an empty object.
 * Throws a `SettingsFileError` for a file that cannot be edited safely.
 */
export function applySetupToText(text: string | null, values: SetupValues): SettingsEdit {
  if (text === null || text.trim().length === 0) {
    const env = kurmisEnvValues(values, null)
    const created = `${JSON.stringify({ env }, null, 2)}\n`
    const eol = text?.includes('\r\n') === true ? created.replace(/\n/g, '\r\n') : created
    return {
      text: eol,
      changed: true,
      changes: Object.keys(env).map((name) => ({ name, action: 'added' })),
      envCreated: true,
      envRemoved: false,
      hadKurmis: false,
      warnings: []
    }
  }
  const bom = text.startsWith(BOM) ? BOM : ''
  let body = text.slice(bom.length)
  let parsed = parseSettings(body)
  const layout = layoutOf(parsed)
  const result = emptyEdit(text)
  const env = parsed.env?.value ?? {}
  result.warnings.push(...keyVariableWarnings(parsed.env?.value))

  const baseUrl = env[BASE_URL]
  if (baseUrl !== undefined && !isKurmisBaseUrl(baseUrl, env, values.port)) {
    throw new SettingsFileError(
      `its "env" already sets ${BASE_URL} to ${displayValue(baseUrl)}, which is not kurmis' address. ` +
        'Kurmis does not replace it; remove it from the file first if you want Claude Code routed through kurmis.')
  }
  const headers = env[CUSTOM_HEADERS]
  if (headers !== undefined && typeof headers !== 'string') {
    throw new SettingsFileError(`its "env" sets ${CUSTOM_HEADERS} to something other than a string`)
  }
  const wanted = kurmisEnvValues(values, headers ?? null)
  result.hadKurmis = (baseUrl !== undefined && isKurmisBaseUrl(baseUrl, env, values.port)) || hasKurmisHeader(headers)

  if (parsed.env === null) {
    const outer = parsed.top.members.length > 0
      ? lineIndent(body, parsed.top.members[0]!.keyStart)
      : `${lineIndent(body, parsed.top.open)}${layout.unit}`
    const json = newEnvJson(wanted, outer, layout, !body.includes('\n'))
    body = addMember(body, parsed.top, 'env', json, layout)
    result.changes.push(...Object.keys(wanted).map((name): EnvChange => ({ name, action: 'added' })))
    result.envCreated = true
  } else {
    for (const [name, value] of Object.entries(wanted)) {
      const envNode: ObjectNode = parsed.env!.node
      const member = envNode.members.find((candidate) => candidate.name === name)
      const current = parsed.env!.value[name]
      if (member === undefined) {
        body = addMember(body, envNode, name, JSON.stringify(value), layout)
        result.changes.push({ name, action: 'added' })
      } else if (current === value) {
        result.changes.push({ name, action: 'unchanged' })
      } else if (name === BASE_URL) {
        body = replaceValue(body, member, JSON.stringify(value))
        result.changes.push({ name, action: 'updated' })
      } else if (name === CUSTOM_HEADERS) {
        const theirs = othersHeaderLines(current as string).length > 0
        body = replaceValue(body, member, JSON.stringify(value))
        result.changes.push({
          name,
          action: hasKurmisHeader(current) ? 'updated' : 'added',
          ...(theirs ? { note: 'your own header lines were kept' } : {})
        })
      } else {
        result.changes.push({ name, action: 'kept', note: `it holds your own value (${displayValue(current)}), which kurmis leaves` })
      }
      parsed = parseSettings(body)
    }
  }
  result.text = `${bom}${body}`
  result.changed = result.text !== text
  return result
}

/**
 * The file's text with kurmis' routing variables taken out of its `env` again. Only values that
 * are still kurmis' are removed; any other is left and reported as `kept`. An `env` left empty
 * is removed. Throws a `SettingsFileError` for a file that cannot be edited safely.
 */
export function undoSetupInText(text: string, values: UndoValues): SettingsEdit {
  if (text.trim().length === 0) return emptyEdit(text)
  const bom = text.startsWith(BOM) ? BOM : ''
  let body = text.slice(bom.length)
  let parsed = parseSettings(body)
  const result = emptyEdit(text)
  if (parsed.env === null) return result
  const env = parsed.env.value
  const backup = backupBefore(values.backupText)
  const before = backup?.env ?? null
  // The plain values kurmis sets; the port and key do not matter for these.
  const plain = kurmisEnvValues({ port: values.port ?? 1, key: 'unused' }, null)
  const baseUrlIsKurmis = isKurmisBaseUrl(env[BASE_URL], env, values.port)

  for (const name of ROUTING_VARIABLES) {
    const current = parsed.env!.value[name]
    if (current === undefined) continue
    const index = parsed.env!.node.members.findIndex((member) => member.name === name)
    const member = parsed.env!.node.members[index]!
    if (name === BASE_URL) {
      if (!baseUrlIsKurmis) {
        result.changes.push({ name, action: 'kept', note: `it points at ${displayValue(current)}, not at kurmis` })
        continue
      }
      body = removeMember(body, parsed.env!.node, index)
      result.changes.push({ name, action: 'removed' })
    } else if (name === CUSTOM_HEADERS) {
      if (typeof current !== 'string' || !parseCustomHeaders(current).some((header) => KURMIS_HEADERS.includes(header.name.toLowerCase()))) {
        continue
      }
      const theirs = othersHeaderLines(current)
      if (theirs.length === 0) {
        body = removeMember(body, parsed.env!.node, index)
        result.changes.push({ name, action: 'removed' })
      } else {
        // The value as the backup had it, when its lines are the ones left: setup may have
        // dropped blank lines or line endings from it.
        const original = before?.[name]
        const restored = typeof original === 'string' && sameLines(othersHeaderLines(original), theirs) ? original : theirs.join('\n')
        body = replaceValue(body, member, JSON.stringify(restored))
        result.changes.push({ name, action: 'updated', note: 'kurmis\' header lines were removed and yours were kept' })
      }
    } else if (current !== plain[name]) {
      result.changes.push({ name, action: 'kept', note: `its value (${displayValue(current)}) is not the one kurmis sets` })
      continue
    } else if (before !== null && before[name] === current) {
      result.changes.push({ name, action: 'kept', note: 'the file already had this value before kurmis changed it' })
      continue
    } else {
      body = removeMember(body, parsed.env!.node, index)
      result.changes.push({ name, action: 'removed' })
    }
    parsed = parseSettings(body)
  }
  // An `env` the file had before kurmis stays, even empty.
  const envWasThere = backup !== null && backup.env !== null
  if (parsed.env !== null && parsed.env.node.members.length === 0 && !envWasThere &&
    result.changes.some((change) => change.action === 'removed')) {
    const index = parsed.top.members.findIndex((member) => member.name === 'env')
    body = removeMember(body, parsed.top, index)
    result.envRemoved = true
  }
  result.text = `${bom}${body}`
  result.changed = result.text !== text
  return result
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index])
}

// ---------------------------------------------------------------------------------------------
// The file.

/**
 * The user settings file Claude Code reads: `$CLAUDE_CONFIG_DIR/settings.json` when
 * `CLAUDE_CONFIG_DIR` is set and not empty, as the CLI itself does, otherwise
 * `~/.claude/settings.json`. Throws a `SettingsFileError` when `CLAUDE_CONFIG_DIR` points into
 * kurmis' data folder: that is a login's or a probe's folder, never the user's own settings.
 */
export function claudeSettingsPath(env: NodeJS.ProcessEnv): string {
  const configDir = env.CLAUDE_CONFIG_DIR
  if (configDir === undefined || configDir === '') return claudeUserSettingsPath(env)
  const dir = resolve(configDir)
  const inside = relative(kurmisHome(), dir)
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
    throw new SettingsFileError(
      `CLAUDE_CONFIG_DIR is ${dir}, which is inside kurmis' data folder. Run kurmis setup from a shell without it.`)
  }
  return join(dir, 'settings.json')
}

/** Where setup keeps the file as it was before its first change. */
export function backupPathFor(settingsPath: string): string {
  return `${settingsPath}.kurmis-backup`
}

/** What `setupSettingsFile` or `undoSettingsFile` did to the file. */
export interface SettingsFileResult extends SettingsEdit {
  path: string
  /** Whether the file existed before. */
  existed: boolean
  /** The backup written now, or null when none was written (one already existed, or no change). */
  backupWritten: string | null
  /** The file a symbolic link at `path` points to, which is the file that was read and written; null when `path` is no link. */
  linkTarget: string | null
  /**
   * Setup only: the settings file's mode before setup cleared its group and other bits, because
   * the file holds kurmis' key. Null when the mode had none of those bits, or on Windows.
   */
  modeBefore: number | null
  /** Setup only: the same for the backup file. */
  backupModeBefore: number | null
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * The file a write must go to: the target of a symbolic link, so a linked file stays linked.
 * For a link whose target does not exist yet, the place it points to, so the link is not
 * replaced by a plain file.
 */
function writeTarget(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let current = path
  // A chain of links, as the system follows it; 40 is the limit macOS and Linux use too.
  for (let hop = 0; hop < 40; hop++) {
    let stats
    try {
      stats = lstatSync(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return current
      throw error
    }
    if (!stats.isSymbolicLink()) return current
    current = resolve(dirname(current), readlinkSync(current))
  }
  throw new SettingsFileError(`${path} is a chain of more than 40 symbolic links`)
}

/** Where a symbolic link at `path` points (as `writeTarget` follows it), or null when `path` is not a link. */
function linkTargetOf(path: string): string | null {
  try {
    if (!lstatSync(path).isSymbolicLink()) return null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  return writeTarget(path)
}

/** `restrictToUserSync` for a file that may not exist; null when it does not. */
function restrictIfPresent(path: string): number | null {
  try {
    return restrictToUserSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * Copies the file to its backup. With `replace` an older backup is replaced (the file holds none
 * of kurmis' settings, so it is the file before kurmis now); without it an existing backup is
 * kept. Returns the backup's path when one was written, or null.
 */
function backUp(path: string, replace: boolean, platform: NodeJS.Platform): string | null {
  const backup = backupPathFor(path)
  if (!replace) {
    try {
      copyFileSync(path, backup, constants.COPYFILE_EXCL)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null
      throw error
    }
    if (platform !== 'win32') chmodSync(backup, PRIVATE_FILE_MODE)
    return backup
  }
  // Through a temporary file, so a backup is never half written.
  const temp = `${backup}.${String(process.pid)}.tmp`
  try {
    copyFileSync(path, temp)
    if (platform !== 'win32') chmodSync(temp, PRIVATE_FILE_MODE)
    replaceFileSync(temp, backup)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
  return backup
}

/** Whether a file mode has no write bit for its owner: on Windows, the read-only attribute. */
function isReadOnly(mode: number): boolean {
  return (mode & 0o200) === 0
}

/**
 * Writes the edit, when it changed anything, and backs the file up before. With `userOnly` (setup,
 * whose file holds the key) the file ends up readable by the user only: a new file gets mode
 * 0600 and an existing one loses its group and other bits, also when the edit changed nothing.
 * Without it (undo) an existing file keeps its mode. Answers the backup written and the mode
 * the file had before its group and other bits were cleared.
 */
function writeEdit(
  path: string,
  edit: SettingsEdit,
  existed: boolean,
  userOnly: boolean,
  platform: NodeJS.Platform
): { backup: string | null; modeBefore: number | null } {
  const target = writeTarget(path)
  if (!edit.changed) return { backup: null, modeBefore: userOnly && existed ? restrictToUserSync(target, platform) : null }
  const before = existed ? statSync(target).mode & 0o777 : PRIVATE_FILE_MODE
  if (platform === 'win32' && existed && isReadOnly(before)) {
    // Windows cannot rename a file over a read-only one, and the new file would be read-only too.
    throw new SettingsFileError(`it is read-only. Clear that with "attrib -R ${target}" and run the command again`)
  }
  const backup = existed ? backUp(path, userOnly && !edit.hadKurmis, platform) : null
  const mode = userOnly ? userOnlyMode(before) : before
  try {
    // The mode given to the write is reduced by the umask, so it is set again afterwards.
    writeFileAtomicSync(target, edit.text, { mode })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
      throw new SettingsFileError(`it could not be written (${code}): another program may hold it open, or the file or its folder ` +
        'may not be writable by you')
    }
    throw error
  }
  if (platform === 'win32') return { backup, modeBefore: null }
  chmodSync(target, mode)
  return { backup, modeBefore: existed && mode !== before ? before : null }
}

function failWith(path: string, error: unknown): never {
  if (error instanceof SettingsFileError) {
    throw new SettingsFileError(`${path} was not changed: ${error.message}`)
  }
  throw error
}

/** Puts kurmis' routing variables in the settings file. Backs it up before the change (see the top of this file). */
export function setupSettingsFile(path: string, values: SetupValues, platform: NodeJS.Platform = process.platform): SettingsFileResult {
  const text = readText(path)
  let edit: SettingsEdit
  let written: { backup: string | null; modeBefore: number | null }
  try {
    edit = applySetupToText(text, values)
    written = writeEdit(path, edit, text !== null, true, platform)
  } catch (error) {
    failWith(path, error)
  }
  // The backup of a file from before kurmis may hold other secrets of the user's; a backup an
  // older kurmis wrote, or one copied by hand, may not be user-only yet.
  const backupModeBefore = written.backup === null ? restrictIfPresent(backupPathFor(path)) : null
  return {
    ...edit,
    path,
    existed: text !== null,
    backupWritten: written.backup,
    linkTarget: linkTargetOf(path),
    modeBefore: written.modeBefore,
    backupModeBefore
  }
}

/**
 * Throws the `SettingsFileError` `setupSettingsFile` would throw for the file as it is now, and
 * writes nothing. Setup asks this before it starts the daemon.
 */
export function checkSetupSettingsFile(path: string, values: SetupValues, platform: NodeJS.Platform = process.platform): void {
  try {
    const text = readText(path)
    applySetupToText(text, values)
    if (platform === 'win32' && text !== null && isReadOnly(statSync(writeTarget(path)).mode)) {
      throw new SettingsFileError(`it is read-only. Clear that with "attrib -R ${writeTarget(path)}" and run the command again`)
    }
  } catch (error) {
    failWith(path, error)
  }
}

/** Takes kurmis' routing variables out of the settings file again. A missing file is left missing. */
export function undoSettingsFile(path: string, values: Omit<UndoValues, 'backupText'>,
  platform: NodeJS.Platform = process.platform): SettingsFileResult {
  const text = readText(path)
  if (text === null) {
    return { ...emptyEdit(''), path, existed: false, backupWritten: null, linkTarget: null, modeBefore: null, backupModeBefore: null }
  }
  let edit: SettingsEdit
  let written: { backup: string | null; modeBefore: number | null }
  try {
    edit = undoSetupInText(text, { ...values, backupText: readText(backupPathFor(path)) })
    written = writeEdit(path, edit, true, false, platform)
  } catch (error) {
    failWith(path, error)
  }
  return { ...edit, path, existed: true, backupWritten: written.backup, linkTarget: linkTargetOf(path), modeBefore: null, backupModeBefore: null }
}
