import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applySetupToText,
  backupPathFor,
  claudeSettingsPath,
  kurmisEnvValues,
  SettingsFileError,
  setupSettingsFile,
  undoSetupInText,
  undoSettingsFile
} from '../../src/cli/global-settings.ts'

const KEY = '0123456789abcdef'.repeat(4)
const OTHER_KEY = 'fedcba9876543210'.repeat(4)
const PORT = 28411
const VALUES = { port: PORT, key: KEY }
const URL = `http://127.0.0.1:${String(PORT)}`
const HEADERS = `x-kurmis-key: ${KEY}`

function envOf(text: string): Record<string, unknown> | undefined {
  return (JSON.parse(text) as { env?: Record<string, unknown> }).env
}

const KURMIS_ENV = {
  ANTHROPIC_BASE_URL: URL,
  ANTHROPIC_CUSTOM_HEADERS: HEADERS,
  ENABLE_TOOL_SEARCH: 'true',
  CLAUDE_CODE_MAX_RETRIES: '15'
}

describe('kurmisEnvValues', () => {
  it('is the four routing variables on Auto, with no login or started-on header', () => {
    expect(kurmisEnvValues(VALUES, null)).toEqual(KURMIS_ENV)
  })

  it('keeps the user\'s own header lines ahead of kurmis\'', () => {
    expect(kurmisEnvValues(VALUES, 'X-Team: blue').ANTHROPIC_CUSTOM_HEADERS).toBe(`X-Team: blue\n${HEADERS}`)
  })

  it('for a CLAUDE_CONFIG_DIR with credentials of its own, adds started-on none after the user\'s lines as written', () => {
    expect(kurmisEnvValues({ ...VALUES, credentialsOfItsOwn: true }, 'X-Team:  blue').ANTHROPIC_CUSTOM_HEADERS)
      .toBe(`X-Team:  blue\n${HEADERS}\nx-kurmis-started-on: none`)
  })
})

describe('applySetupToText', () => {
  it('makes a new file when there is none', () => {
    const edit = applySetupToText(null, VALUES)
    expect(edit.changed).toBe(true)
    expect(edit.envCreated).toBe(true)
    expect(edit.text).toBe(`${JSON.stringify({ env: KURMIS_ENV }, null, 2)}\n`)
    expect(edit.changes.map((change) => change.action)).toEqual(['added', 'added', 'added', 'added'])
  })

  it('treats a file of only whitespace as empty', () => {
    expect(envOf(applySetupToText('  \n', VALUES).text)).toEqual(KURMIS_ENV)
  })

  it('adds an env block at the end, keeping the rest of the file as it was (2 spaces)', () => {
    const text = '{\n  "model": "opus",\n  "permissions": {\n    "allow": ["Bash(ls)"]\n  }\n}\n'
    const edit = applySetupToText(text, VALUES)
    expect(edit.envCreated).toBe(true)
    expect(edit.text).toBe(
      '{\n  "model": "opus",\n  "permissions": {\n    "allow": ["Bash(ls)"]\n  },\n  "env": {\n' +
        `    "ANTHROPIC_BASE_URL": "${URL}",\n` +
        `    "ANTHROPIC_CUSTOM_HEADERS": "${HEADERS}",\n` +
        '    "ENABLE_TOOL_SEARCH": "true",\n' +
        '    "CLAUDE_CODE_MAX_RETRIES": "15"\n  }\n}\n')
  })

  it('follows an indent of 4 spaces', () => {
    const text = '{\n    "model": "opus"\n}'
    const out = applySetupToText(text, VALUES).text
    expect(out.startsWith('{\n    "model": "opus",\n    "env": {\n        "ANTHROPIC_BASE_URL"')).toBe(true)
    expect(out.endsWith('"15"\n    }\n}')).toBe(true)
  })

  it('follows an indent of tabs', () => {
    const text = '{\n\t"model": "opus"\n}\n'
    const out = applySetupToText(text, VALUES).text
    expect(out).toContain('\t"env": {\n\t\t"ANTHROPIC_BASE_URL"')
    expect(out).toContain('\n\t}\n}\n')
    expect(out).not.toContain('  ')
  })

  it('keeps CRLF line endings', () => {
    const text = '{\r\n  "model": "opus",\r\n  "env": {\r\n    "FOO": "1"\r\n  }\r\n}\r\n'
    const out = applySetupToText(text, VALUES).text
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
    expect(out.startsWith('{\r\n  "model": "opus",\r\n  "env": {\r\n    "FOO": "1",\r\n    "ANTHROPIC_BASE_URL"')).toBe(true)
    expect(envOf(out)).toEqual({ FOO: '1', ...KURMIS_ENV })
  })

  it('keeps a file written on one line on one line', () => {
    const out = applySetupToText('{"model":"opus"}', VALUES).text
    expect(out).not.toContain('\n')
    expect(out.startsWith('{"model":"opus","env":{"ANTHROPIC_BASE_URL":')).toBe(true)
    expect(envOf(out)).toEqual(KURMIS_ENV)
  })

  it('adds to an existing env after the user\'s keys, keeping their order and values', () => {
    const text = '{\n  "env": {\n    "ZED": "1",\n    "ALPHA": "2"\n  },\n  "model": "opus"\n}\n'
    const out = applySetupToText(text, VALUES).text
    const env = envOf(out)!
    expect(Object.keys(env)).toEqual(['ZED', 'ALPHA', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'ENABLE_TOOL_SEARCH', 'CLAUDE_CODE_MAX_RETRIES'])
    expect(env.ZED).toBe('1')
    expect(out.endsWith('"CLAUDE_CODE_MAX_RETRIES": "15"\n  },\n  "model": "opus"\n}\n')).toBe(true)
  })

  it('fills an empty env block', () => {
    const out = applySetupToText('{\n  "env": {},\n  "model": "opus"\n}\n', VALUES).text
    expect(out.startsWith('{\n  "env": {\n    "ANTHROPIC_BASE_URL"')).toBe(true)
    expect(out).toContain('"15"\n  },\n  "model": "opus"\n}\n')
  })

  it('keeps the user\'s own custom headers and adds kurmis\' line', () => {
    const text = JSON.stringify({ env: { ANTHROPIC_CUSTOM_HEADERS: 'X-Team: blue\nX-Trace: on' } }, null, 2)
    const edit = applySetupToText(text, VALUES)
    expect(envOf(edit.text)!.ANTHROPIC_CUSTOM_HEADERS).toBe(`X-Team: blue\nX-Trace: on\n${HEADERS}`)
    expect(edit.changes.find((change) => change.name === 'ANTHROPIC_CUSTOM_HEADERS')).toEqual({
      name: 'ANTHROPIC_CUSTOM_HEADERS', action: 'added', note: 'your own header lines were kept'
    })
  })

  it('updates kurmis\' own values after the port or key changed', () => {
    const old = applySetupToText(null, { port: 30001, key: OTHER_KEY }).text
    const edit = applySetupToText(old, VALUES)
    expect(envOf(edit.text)).toEqual(KURMIS_ENV)
    expect(edit.changes.filter((change) => change.action === 'updated').map((change) => change.name))
      .toEqual(['ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS'])
  })

  it('leaves the user\'s own value of the two plain variables and says so', () => {
    const text = JSON.stringify({ env: { ENABLE_TOOL_SEARCH: 'false', CLAUDE_CODE_MAX_RETRIES: '3' } }, null, 2)
    const edit = applySetupToText(text, VALUES)
    expect(envOf(edit.text)).toMatchObject({ ENABLE_TOOL_SEARCH: 'false', CLAUDE_CODE_MAX_RETRIES: '3' })
    expect(edit.changes.filter((change) => change.action === 'kept').map((change) => change.name))
      .toEqual(['ENABLE_TOOL_SEARCH', 'CLAUDE_CODE_MAX_RETRIES'])
  })

  it('is idempotent', () => {
    const once = applySetupToText('{\n  "model": "opus"\n}\n', VALUES).text
    const twice = applySetupToText(once, VALUES)
    expect(twice.changed).toBe(false)
    expect(twice.text).toBe(once)
    expect(twice.changes.every((change) => change.action === 'unchanged')).toBe(true)
  })

  it('refuses another base URL', () => {
    const text = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' } })
    expect(() => applySetupToText(text, VALUES)).toThrow(SettingsFileError)
    expect(() => applySetupToText(text, VALUES)).toThrow(/proxy\.example\.com/)
  })

  it('refuses a loopback base URL on another port without kurmis\' key header', () => {
    const text = JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000' } })
    expect(() => applySetupToText(text, VALUES)).toThrow(SettingsFileError)
  })

  it.each([
    ['comments', '{\n  // a comment\n  "model": "opus"\n}'],
    ['a trailing comma', '{ "model": "opus", }'],
    ['broken text', '{ "model": '],
    ['a list at the top level', '[1, 2]'],
    ['a string at the top level', '"text"'],
    ['an env that is not an object', '{ "env": ["A"] }'],
    ['an env that is null', '{ "env": null }'],
    ['two env keys', '{ "env": {}, "env": {} }'],
    ['custom headers that are not a string', '{ "env": { "ANTHROPIC_CUSTOM_HEADERS": 5 } }']
  ])('refuses a file with %s', (_name, text) => {
    expect(() => applySetupToText(text, VALUES)).toThrow(SettingsFileError)
  })

  it('warns about an API key in env and leaves it', () => {
    const text = JSON.stringify({ env: { ANTHROPIC_API_KEY: 'sk-example' } })
    const edit = applySetupToText(text, VALUES)
    expect(edit.warnings.join(' ')).toContain('ANTHROPIC_API_KEY')
    expect(envOf(edit.text)!.ANTHROPIC_API_KEY).toBe('sk-example')
  })

  it('handles strings with escapes, nested objects and a byte order mark', () => {
    const bom = String.fromCharCode(0xfeff)
    const text = `${bom}{\n  "a": "quote \\" and brace }",\n  "b": { "env": { "x": [1, {"y": "}"}] } }\n}\n`
    const out = applySetupToText(text, VALUES).text
    expect(out.startsWith(`${bom}{\n  "a": "quote \\" and brace }",`)).toBe(true)
    const parsed = JSON.parse(out.slice(1)) as Record<string, unknown>
    expect(parsed.b).toEqual({ env: { x: [1, { y: '}' }] } })
    expect(parsed.env).toEqual(KURMIS_ENV)
  })

  it('handles an empty top-level object', () => {
    expect(envOf(applySetupToText('{}', VALUES).text)).toEqual(KURMIS_ENV)
    const multi = applySetupToText('{\n}\n', VALUES).text
    expect(multi.startsWith('{\n  "env": {\n    "ANTHROPIC_BASE_URL"')).toBe(true)
  })
})

describe('undoSetupInText', () => {
  const original = '{\n    "env": {\n        "FOO": "1"\n    },\n    "model": "opus"\n}\n'

  it('gives back the file as it was before setup', () => {
    const set = applySetupToText(original, VALUES).text
    const undone = undoSetupInText(set, { port: PORT })
    expect(undone.text).toBe(original)
    expect(undone.changes.map((change) => change.action)).toEqual(['removed', 'removed', 'removed', 'removed'])
    expect(undone.envRemoved).toBe(false)
  })

  it('removes an env block that is empty afterwards', () => {
    const before = '{\n  "model": "opus"\n}\n'
    const undone = undoSetupInText(applySetupToText(before, VALUES).text, { port: PORT })
    expect(undone.text).toBe(before)
    expect(undone.envRemoved).toBe(true)
  })

  it('takes a one-line file back too', () => {
    const before = '{"model":"opus"}'
    expect(undoSetupInText(applySetupToText(before, VALUES).text, { port: PORT }).text).toBe(before)
  })

  it('takes a CRLF tab file back too', () => {
    const before = '{\r\n\t"env": {\r\n\t\t"FOO": "1"\r\n\t}\r\n}\r\n'
    expect(undoSetupInText(applySetupToText(before, VALUES).text, { port: PORT }).text).toBe(before)
  })

  it('removes a first member of env cleanly', () => {
    const text = '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "' + URL + '",\n    "FOO": "1"\n  }\n}\n'
    expect(undoSetupInText(text, { port: PORT }).text).toBe('{\n  "env": {\n    "FOO": "1"\n  }\n}\n')
  })

  it('is idempotent', () => {
    const undone = undoSetupInText(original, { port: PORT })
    expect(undone.changed).toBe(false)
    expect(undone.text).toBe(original)
    expect(undone.changes).toEqual([])
  })

  it('leaves a base URL the user changed and reports it', () => {
    const set = applySetupToText(original, VALUES).text.replace(URL, 'https://proxy.example.com')
    const undone = undoSetupInText(set, { port: PORT })
    expect(envOf(undone.text)).toEqual({ FOO: '1', ANTHROPIC_BASE_URL: 'https://proxy.example.com' })
    expect(undone.changes[0]).toMatchObject({ name: 'ANTHROPIC_BASE_URL', action: 'kept' })
  })

  it('leaves a plain variable whose value the user changed', () => {
    const set = applySetupToText(original, VALUES).text.replace('"CLAUDE_CODE_MAX_RETRIES": "15"', '"CLAUDE_CODE_MAX_RETRIES": "4"')
    const undone = undoSetupInText(set, { port: PORT })
    expect(envOf(undone.text)).toEqual({ FOO: '1', CLAUDE_CODE_MAX_RETRIES: '4' })
    expect(undone.changes.find((change) => change.name === 'CLAUDE_CODE_MAX_RETRIES')?.action).toBe('kept')
  })

  it('recognises kurmis\' base URL on an old port by the key header next to it', () => {
    const set = applySetupToText(original, { port: 30001, key: KEY }).text
    expect(undoSetupInText(set, { port: PORT }).text).toBe(original)
    expect(undoSetupInText(set, { port: null }).text).toBe(original)
  })

  it('removes only kurmis\' header lines and keeps the user\'s as they wrote them', () => {
    const theirs = JSON.stringify({ env: { ANTHROPIC_CUSTOM_HEADERS: 'X-Team:blue\nX-Trace: on' } }, null, 2)
    const set = applySetupToText(theirs, VALUES).text
    expect(envOf(set)?.ANTHROPIC_CUSTOM_HEADERS).toBe(`X-Team:blue\nX-Trace: on\n${HEADERS}`)
    const undone = undoSetupInText(set, { port: PORT })
    expect(envOf(undone.text)).toEqual({ ANTHROPIC_CUSTOM_HEADERS: 'X-Team:blue\nX-Trace: on' })
    expect(undone.changes.find((change) => change.name === 'ANTHROPIC_CUSTOM_HEADERS')?.action).toBe('updated')
  })

  it('keeps the user\'s header lines exactly as written', () => {
    const text = JSON.stringify({ env: { ANTHROPIC_CUSTOM_HEADERS: `X-Team:blue\n${HEADERS}\nx-kurmis-login: claude:work` } })
    expect(envOf(undoSetupInText(text, { port: PORT }).text)).toEqual({ ANTHROPIC_CUSTOM_HEADERS: 'X-Team:blue' })
  })

  it('keeps a plain variable the backup shows the user had before setup', () => {
    const before = JSON.stringify({ env: { ENABLE_TOOL_SEARCH: 'true' } }, null, 2)
    const set = applySetupToText(before, VALUES).text
    const undone = undoSetupInText(set, { port: PORT, backupText: before })
    expect(undone.text).toBe(before)
    expect(undone.changes.find((change) => change.name === 'ENABLE_TOOL_SEARCH')?.action).toBe('kept')
  })

  it('ignores a backup that already holds kurmis\' settings', () => {
    const set = applySetupToText(original, VALUES).text
    expect(undoSetupInText(set, { port: PORT, backupText: set }).text).toBe(original)
  })

  it('leaves a file without env, or with only the user\'s env, alone', () => {
    expect(undoSetupInText('{ "model": "opus" }', { port: PORT }).changed).toBe(false)
    expect(undoSetupInText('{ "env": {} }', { port: PORT }).text).toBe('{ "env": {} }')
    expect(undoSetupInText('', { port: PORT }).changed).toBe(false)
  })

  it('refuses a file that is not valid JSON', () => {
    expect(() => undoSetupInText('{ "env": { ', { port: PORT })).toThrow(SettingsFileError)
  })

  it('says where a file stops being JSON without quoting it, since it may hold a secret', () => {
    const text = '{\n  "env": {\n    "ANTHROPIC_AUTH_TOKEN": sk-ant-fake-secret\n  }\n}\n'
    expect(() => applySetupToText(text, { port: PORT, key: 'k' })).toThrow('it is not valid JSON (line 3, column 29)')
    try {
      undoSetupInText(text, { port: PORT })
    } catch (error) {
      expect((error as Error).message).not.toContain('sk-ant')
    }
  })
})

let counter = 0
function freshDir(): string {
  const dir = join(process.env.HOME as string, `settings-${String(counter++)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('claudeSettingsPath', () => {
  it('is ~/.claude/settings.json by default', () => {
    expect(claudeSettingsPath({})).toBe(join(process.env.HOME as string, '.claude', 'settings.json'))
    expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: '' })).toBe(join(process.env.HOME as string, '.claude', 'settings.json'))
  })

  it('follows CLAUDE_CONFIG_DIR, as Claude Code does', () => {
    const dir = freshDir()
    expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: dir })).toBe(join(dir, 'settings.json'))
  })

  it('refuses a CLAUDE_CONFIG_DIR inside the kurmis data folder', () => {
    const home = process.env.KURMIS_HOME as string
    expect(() => claudeSettingsPath({ CLAUDE_CONFIG_DIR: join(home, 'claude', 'work') })).toThrow(SettingsFileError)
    expect(() => claudeSettingsPath({ CLAUDE_CONFIG_DIR: home })).toThrow(SettingsFileError)
  })
})

describe('the settings file', () => {
  const posix = process.platform !== 'win32'

  it('creates a missing file readable only by the user, with no backup', () => {
    const path = join(freshDir(), 'new', 'settings.json')
    const result = setupSettingsFile(path, VALUES)
    expect(result.existed).toBe(false)
    expect(result.backupWritten).toBeNull()
    expect(existsSync(backupPathFor(path))).toBe(false)
    expect(envOf(readFileSync(path, 'utf8'))).toEqual(KURMIS_ENV)
    if (posix) expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('backs the file up once, and makes the file and the backup readable only by the user', () => {
    const path = join(freshDir(), 'settings.json')
    const original = '{\n  "model": "opus"\n}\n'
    writeFileSync(path, original)
    chmodSync(path, 0o644)
    const first = setupSettingsFile(path, VALUES)
    expect(first.backupWritten).toBe(backupPathFor(path))
    expect(readFileSync(backupPathFor(path), 'utf8')).toBe(original)
    if (posix) {
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(first.modeBefore).toBe(0o644)
      expect(statSync(backupPathFor(path)).mode & 0o777).toBe(0o600)
    }
    const again = setupSettingsFile(path, { port: 30002, key: KEY })
    expect(again.changed).toBe(true)
    expect(again.backupWritten).toBeNull()
    expect(readFileSync(backupPathFor(path), 'utf8')).toBe(original)
  })

  it.skipIf(!posix)('clears only the group and other bits, and keeps the user\'s own', () => {
    const path = join(freshDir(), 'settings.json')
    writeFileSync(path, '{}\n')
    chmodSync(path, 0o751)
    expect(setupSettingsFile(path, VALUES).modeBefore).toBe(0o751)
    expect(statSync(path).mode & 0o777).toBe(0o700)
  })

  it.skipIf(!posix)('makes a file that already has kurmis\' settings readable only by the user, without rewriting it', () => {
    const path = join(freshDir(), 'settings.json')
    setupSettingsFile(path, VALUES)
    chmodSync(path, 0o644)
    const before = statSync(path).mtimeMs
    const result = setupSettingsFile(path, VALUES)
    expect(result.changed).toBe(false)
    expect(result.modeBefore).toBe(0o644)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(path).mtimeMs).toBe(before)
    expect(setupSettingsFile(path, VALUES).modeBefore).toBeNull()
  })

  it.skipIf(!posix)('makes a backup from earlier readable only by the user', () => {
    const path = join(freshDir(), 'settings.json')
    writeFileSync(path, '{\n  "model": "opus"\n}\n')
    setupSettingsFile(path, VALUES)
    chmodSync(backupPathFor(path), 0o644)
    const changed = setupSettingsFile(path, { port: 30002, key: KEY })
    expect(changed.backupWritten).toBeNull()
    expect(changed.backupModeBefore).toBe(0o644)
    expect(statSync(backupPathFor(path)).mode & 0o777).toBe(0o600)
    chmodSync(backupPathFor(path), 0o640)
    const unchanged = setupSettingsFile(path, { port: 30002, key: KEY })
    expect(unchanged.changed).toBe(false)
    expect(unchanged.backupModeBefore).toBe(0o640)
    expect(statSync(backupPathFor(path)).mode & 0o777).toBe(0o600)
  })

  it.skipIf(!posix)('undo keeps the file\'s mode', () => {
    const path = join(freshDir(), 'settings.json')
    setupSettingsFile(path, VALUES)
    chmodSync(path, 0o640)
    const undone = undoSettingsFile(path, { port: PORT })
    expect(undone.changed).toBe(true)
    expect(undone.modeBefore).toBeNull()
    expect(statSync(path).mode & 0o777).toBe(0o640)
  })

  it('writes nothing when nothing changes', () => {
    const path = join(freshDir(), 'settings.json')
    setupSettingsFile(path, VALUES)
    const before = statSync(path).mtimeMs
    const result = setupSettingsFile(path, VALUES)
    expect(result.changed).toBe(false)
    expect(existsSync(backupPathFor(path))).toBe(false)
    expect(statSync(path).mtimeMs).toBe(before)
  })

  it('does not rewrite a file it refuses', () => {
    const path = join(freshDir(), 'settings.json')
    writeFileSync(path, '{ // comment\n}')
    expect(() => setupSettingsFile(path, VALUES)).toThrow(/was not changed: it is not valid JSON/)
    expect(readFileSync(path, 'utf8')).toBe('{ // comment\n}')
    expect(existsSync(backupPathFor(path))).toBe(false)
  })

  it('undoes through the file, using the backup', () => {
    const path = join(freshDir(), 'settings.json')
    const original = JSON.stringify({ env: { ENABLE_TOOL_SEARCH: 'true' }, model: 'opus' }, null, 2)
    writeFileSync(path, original)
    setupSettingsFile(path, VALUES)
    const undone = undoSettingsFile(path, { port: PORT })
    expect(undone.changed).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(original)
    expect(undoSettingsFile(path, { port: PORT }).changed).toBe(false)
  })

  it('leaves a missing file missing on undo', () => {
    const path = join(freshDir(), 'settings.json')
    expect(undoSettingsFile(path, { port: PORT }).existed).toBe(false)
    expect(existsSync(path)).toBe(false)
  })

  it.skipIf(!posix)('writes through a symbolic link and keeps the link', () => {
    const dir = freshDir()
    const target = join(dir, 'dotfiles-settings.json')
    const link = join(dir, 'settings.json')
    writeFileSync(target, '{\n  "model": "opus"\n}\n')
    symlinkSync(target, link)
    chmodSync(target, 0o644)
    const result = setupSettingsFile(link, VALUES)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(envOf(readFileSync(target, 'utf8'))).toEqual(KURMIS_ENV)
    expect(readFileSync(backupPathFor(link), 'utf8')).toBe('{\n  "model": "opus"\n}\n')
    expect(result.linkTarget).toBe(realpathSync(target))
    expect(result.modeBefore).toBe(0o644)
    expect(statSync(target).mode & 0o777).toBe(0o600)
  })

  it('undo reads a backup that starts with a byte order mark, and keeps the values it had', () => {
    const path = join(freshDir(), 'settings.json')
    const original = '\uFEFF{\n  "env": {\n    "ENABLE_TOOL_SEARCH": "true",\n    "CLAUDE_CODE_MAX_RETRIES": "15"\n  }\n}\n'
    writeFileSync(path, original)
    setupSettingsFile(path, VALUES)
    expect(readFileSync(backupPathFor(path), 'utf8')).toBe(original)
    undoSettingsFile(path, { port: PORT })
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('undo keeps an empty env the file had before setup, and removes one setup added', () => {
    const path = join(freshDir(), 'settings.json')
    const original = '{\n  "model": "opus",\n  "env": {}\n}\n'
    writeFileSync(path, original)
    setupSettingsFile(path, VALUES)
    const undone = undoSettingsFile(path, { port: PORT })
    expect(undone.envRemoved).toBe(false)
    expect(envOf(readFileSync(path, 'utf8'))).toEqual({})

    const other = join(freshDir(), 'settings.json')
    writeFileSync(other, '{\n  "model": "opus"\n}\n')
    setupSettingsFile(other, VALUES)
    expect(undoSettingsFile(other, { port: PORT }).envRemoved).toBe(true)
    expect(readFileSync(other, 'utf8')).toBe('{\n  "model": "opus"\n}\n')
  })

  it('setup keeps the user\'s own header lines as written, and undo gives back their value', () => {
    const path = join(freshDir(), 'settings.json')
    const theirs = 'X-Team:blue\r\n\r\nX-Trace:  on'
    const original = `${JSON.stringify({ env: { ANTHROPIC_CUSTOM_HEADERS: theirs } }, null, 2)}\n`
    writeFileSync(path, original)
    setupSettingsFile(path, VALUES)
    expect(envOf(readFileSync(path, 'utf8'))?.ANTHROPIC_CUSTOM_HEADERS).toBe(`X-Team:blue\nX-Trace:  on\n${HEADERS}`)
    undoSettingsFile(path, { port: PORT })
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('a setup after an undo backs up the file as it is then, not as it was at the first setup', () => {
    const path = join(freshDir(), 'settings.json')
    writeFileSync(path, '{\n  "model": "opus"\n}\n')
    setupSettingsFile(path, VALUES)
    undoSettingsFile(path, { port: PORT })
    const later = '{\n  "model": "sonnet",\n  "env": {\n    "ENABLE_TOOL_SEARCH": "true"\n  }\n}\n'
    writeFileSync(path, later)
    const result = setupSettingsFile(path, VALUES)
    expect(result.backupWritten).toBe(backupPathFor(path))
    expect(readFileSync(backupPathFor(path), 'utf8')).toBe(later)
    if (posix) expect(statSync(backupPathFor(path)).mode & 0o777).toBe(0o600)
    undoSettingsFile(path, { port: PORT })
    expect(readFileSync(path, 'utf8')).toBe(later)
  })

  it.skipIf(!posix)('writes through a link whose target does not exist yet, and keeps the link', () => {
    const dir = freshDir()
    mkdirSync(join(dir, 'dotfiles'))
    const link = join(dir, 'settings.json')
    symlinkSync('dotfiles/claude-settings.json', link)
    const result = setupSettingsFile(link, VALUES)
    expect(result.existed).toBe(false)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(envOf(readFileSync(join(dir, 'dotfiles', 'claude-settings.json'), 'utf8'))).toEqual(KURMIS_ENV)
    expect(result.linkTarget).toBe(realpathSync(join(dir, 'dotfiles', 'claude-settings.json')))
  })

  it('on Windows a read-only file is refused with what to do, and not changed', () => {
    const path = join(freshDir(), 'settings.json')
    writeFileSync(path, '{}\n')
    chmodSync(path, 0o444)
    try {
      expect(() => setupSettingsFile(path, VALUES, 'win32')).toThrow(/was not changed: it is read-only\. Clear that with "attrib -R /)
      expect(readFileSync(path, 'utf8')).toBe('{}\n')
      expect(existsSync(backupPathFor(path))).toBe(false)
    } finally {
      chmodSync(path, 0o644)
    }
  })

  it('names no link target for a plain file', () => {
    const path = join(freshDir(), 'settings.json')
    writeFileSync(path, '{}\n')
    expect(setupSettingsFile(path, VALUES).linkTarget).toBeNull()
  })
})
