import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { routedClaudeEnv } from '../../src/core/routed-env.ts'
import {
  claudeArgsWithSettings,
  claudeUserSettingsPath,
  inheritedCustomHeaders,
  mergeRoutingSettings,
  readUserSettingsArg,
  readUserSettingsEnv,
  routingVariables,
  settingsEnv,
  SETTINGS_FILE_MAX_AGE_MS,
  storeSettings,
  storeSettingsFile,
  userOwnedRoutingVariables,
  type UserSettingsArg
} from '../../src/cli/settings-arg.ts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kurmis-settings-arg-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
})

const read = (args: string[]): UserSettingsArg | { error: string } => readUserSettingsArg(args, { cwd: dir })
const ok = (args: string[]): UserSettingsArg => {
  const result = read(args)
  if ('error' in result) throw new Error(result.error)
  return result
}
const error = (args: string[]): string => {
  const result = read(args)
  if (!('error' in result)) throw new Error('expected an error')
  return result.error
}

const ROUTING = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:40123', ANTHROPIC_CUSTOM_HEADERS: 'x-kurmis-key: k',
  ENABLE_TOOL_SEARCH: 'true', CLAUDE_CODE_MAX_RETRIES: '15' }

describe('readUserSettingsArg', () => {
  test('no --settings: the arguments are kept as they are', () => {
    expect(ok(['-p', 'hi', '--model', 'opus'])).toEqual({ settings: null, source: null, rest: ['-p', 'hi', '--model', 'opus'] })
  })

  test('inline JSON as a separate value or after =, and taken out of the arguments', () => {
    expect(ok(['-p', '--settings', '{"model":"opus"}', 'hi'])).toEqual({ settings: { model: 'opus' }, source: 'inline', rest: ['-p', 'hi'] })
    expect(ok(['--settings={"env":{"A":"1"}}', 'mcp', 'list'])).toEqual({ settings: { env: { A: '1' } }, source: 'inline', rest: ['mcp', 'list'] })
    expect(ok(['--settings', '  {"a":1}  '])).toMatchObject({ settings: { a: 1 }, source: 'inline' })
  })

  test('the last --settings is the one read, as claude reads only the last; every one is taken out', () => {
    expect(ok(['--settings', '{"a":1}', '-p', '--settings={"b":2}', 'hi'])).toEqual({ settings: { b: 2 }, source: 'inline', rest: ['-p', 'hi'] })
  })

  test('a --settings after claude\'s own -- is an argument, not an option', () => {
    expect(ok(['-p', '--', '--settings', '{"a":1}'])).toEqual({ settings: null, source: null, rest: ['-p', '--', '--settings', '{"a":1}'] })
    expect(ok(['--settings', '{"a":1}', '--', '--settings', 'x'])).toEqual({ settings: { a: 1 }, source: 'inline', rest: ['--', '--settings', 'x'] })
  })

  test('a file path is read relative to the folder claude starts in, and the file is not changed', () => {
    const text = '{\n  "model": "opus",\n  "env": { "MINE": "yes" }\n}\n'
    mkdirSync(join(dir, 'conf'))
    writeFileSync(join(dir, 'conf', 'mine.json'), text)
    expect(ok(['--settings', 'conf/mine.json'])).toEqual({ settings: { model: 'opus', env: { MINE: 'yes' } }, source: join(dir, 'conf', 'mine.json'), rest: [] })
    expect(ok([`--settings=${join(dir, 'conf', 'mine.json')}`])).toMatchObject({ source: join(dir, 'conf', 'mine.json') })
    expect(readFileSync(join(dir, 'conf', 'mine.json'), 'utf8')).toBe(text)
  })

  test('a file with a byte order mark is read', () => {
    writeFileSync(join(dir, 'bom.json'), '﻿{"a":1}')
    expect(ok(['--settings', 'bom.json']).settings).toEqual({ a: 1 })
  })

  test('a value that does not end in } is a path, as claude reads it', () => {
    expect(error(['--settings', '{"a":1'])).toContain(`cannot read the settings file ${join(dir, '{"a":1')}: it does not exist`)
  })

  test('refuses what it cannot read rather than guess', () => {
    expect(error(['--settings'])).toBe('--settings needs a value: a settings file or a JSON object')
    expect(error(['--settings='])).toBe('--settings needs a value: a settings file or a JSON object')
    expect(error(['--settings', '{not json}'])).toMatch(/^--settings: the JSON given to --settings is not valid JSON \(/)
    expect(error(['--settings', 'missing.json'])).toBe(`--settings: cannot read the settings file ${join(dir, 'missing.json')}: it does not exist`)
    writeFileSync(join(dir, 'list.json'), '[1, 2]')
    expect(error(['--settings', 'list.json'])).toBe(`--settings: the settings file ${join(dir, 'list.json')} is not a JSON object`)
    writeFileSync(join(dir, 'comments.json'), '{ // a comment\n "a": 1 }')
    expect(error(['--settings', 'comments.json'])).toContain('is not valid JSON')
    expect(error(['--settings', '{"env":"A=1"}'])).toBe('--settings: the "env" in the JSON given to --settings is not an object')
    expect(error(['--settings', '{"env":["A"]}'])).toContain('is not an object')
    expect(error(['--settings', dir])).toContain(`cannot read the settings file ${dir}`)
  })

  test('uses the file reader it is given', () => {
    const result = readUserSettingsArg(['--settings', 'x.json'], { cwd: '/work', readFile: (path) => JSON.stringify({ path }) })
    expect(result).toMatchObject({ settings: { path: resolve('/work', 'x.json') } })
  })
})

describe('merging', () => {
  test('kurmis\' variables are added to the person\'s env, beating theirs only for the routing variables', () => {
    const user = { model: 'opus', permissions: { allow: ['Bash'] }, env: { MINE: 'yes', ANTHROPIC_BASE_URL: 'http://example.com' } }
    const before = structuredClone(user)
    expect(mergeRoutingSettings(user, ROUTING)).toEqual({
      model: 'opus',
      permissions: { allow: ['Bash'] },
      env: { MINE: 'yes', ...ROUTING }
    })
    expect(user).toEqual(before)
  })

  test('no settings of the person\'s: only the env', () => {
    expect(mergeRoutingSettings(null, ROUTING)).toEqual({ env: ROUTING })
    expect(mergeRoutingSettings({ model: 'opus' }, ROUTING)).toEqual({ model: 'opus', env: ROUTING })
  })

  test('the arguments start with the one --settings, naming the stored file, ahead of the person\'s arguments', () => {
    const stored: Array<[string, boolean]> = []
    const removed: string[] = []
    const store = (text: string, holdsUserSettings: boolean) => {
      stored.push([text, holdsUserSettings])
      return { path: '/data/settings/x.json', remove: () => void removed.push(text) }
    }
    const withTheirs = claudeArgsWithSettings(ok(['mcp', '--settings', '{"model":"opus"}', 'list']), ROUTING, store)
    expect(withTheirs.args).toEqual(['--settings', '/data/settings/x.json', 'mcp', 'list'])
    expect(claudeArgsWithSettings(ok([]), ROUTING, store).args).toEqual(['--settings', '/data/settings/x.json'])
    expect(stored).toEqual([[JSON.stringify({ model: 'opus', env: ROUTING }), true], [JSON.stringify({ env: ROUTING }), false]])
    withTheirs.remove()
    expect(removed).toEqual([JSON.stringify({ model: 'opus', env: ROUTING })])
  })

  test('a copy of the person\'s settings is the wrapper\'s own file, private, and removed when it is done', () => {
    const folder = mkdtempSync(join(tmpdir(), 'kurmis-settings-run-'))
    try {
      const first = storeSettings('{"env":{"SECRET":"x"}}', true, folder)
      const second = storeSettings('{"env":{"SECRET":"x"}}', true, folder)
      // Two wrappers with the same settings each have their own file.
      expect(second.path).not.toBe(first.path)
      expect(basename(first.path)).toMatch(new RegExp(`^run-${String(process.pid)}-[0-9a-f]{16}\\.json$`))
      expect(readFileSync(first.path, 'utf8')).toBe('{"env":{"SECRET":"x"}}')
      if (process.platform !== 'win32') expect(statSync(first.path).mode & 0o777).toBe(0o600)
      first.remove()
      first.remove()
      expect(existsSync(first.path)).toBe(false)
      expect(existsSync(second.path)).toBe(true)
      // The shared file of kurmis' own variables is kept.
      const shared = storeSettings('{"env":{"A":"1"}}', false, folder)
      shared.remove()
      expect(existsSync(shared.path)).toBe(true)
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 10 })
    }
  })

  test('a file left by a killed wrapper is removed by the next start; a running wrapper\'s file is kept', () => {
    const folder = mkdtempSync(join(tmpdir(), 'kurmis-settings-left-'))
    try {
      const now = Date.now()
      const dead = join(folder, `run-${String(2 ** 30)}-${'a'.repeat(16)}.json`)
      const running = join(folder, `run-${String(process.ppid)}-${'b'.repeat(16)}.json`)
      const reused = join(folder, `run-${String(process.ppid)}-${'c'.repeat(16)}.json`)
      for (const file of [dead, running, reused]) writeFileSync(file, '{}')
      const longAgo = (now - SETTINGS_FILE_MAX_AGE_MS - 60_000) / 1000
      utimesSync(reused, longAgo, longAgo)
      storeSettings('{"env":{"A":"1"}}', false, folder, now)
      expect(existsSync(dead)).toBe(false)
      expect(existsSync(reused)).toBe(false)
      expect(existsSync(running)).toBe(true)
      writeFileSync(dead, '{}')
      storeSettings('{"env":{"B":"1"}}', true, folder, now).remove()
      expect(existsSync(dead)).toBe(false)
      expect(existsSync(running)).toBe(true)
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 10 })
    }
  })

  test('the person\'s own ENABLE_TOOL_SEARCH and CLAUDE_CODE_MAX_RETRIES, from any layer, are theirs', () => {
    const layers = (flagEnv: Record<string, unknown> | null, userSettingsEnv: Record<string, unknown> | null,
      processEnv: Record<string, string>, windows = false) => ({ flagEnv, userSettingsEnv, processEnv, windows })
    expect(userOwnedRoutingVariables(layers(null, null, {}))).toEqual([])
    expect(userOwnedRoutingVariables(layers({ ENABLE_TOOL_SEARCH: 'false' }, null, {}))).toEqual(['ENABLE_TOOL_SEARCH'])
    expect(userOwnedRoutingVariables(layers(null, { CLAUDE_CODE_MAX_RETRIES: 3 }, {}))).toEqual(['CLAUDE_CODE_MAX_RETRIES'])
    expect(userOwnedRoutingVariables(layers(null, null, { ENABLE_TOOL_SEARCH: 'auto', CLAUDE_CODE_MAX_RETRIES: '' })))
      .toEqual(['ENABLE_TOOL_SEARCH'])
    expect(userOwnedRoutingVariables(layers(null, null, { enable_tool_search: 'false' }, true))).toEqual(['ENABLE_TOOL_SEARCH'])
    expect(userOwnedRoutingVariables(layers(null, null, { enable_tool_search: 'false' }, false))).toEqual([])
  })

  test('storeSettingsFile writes one private file per content and removes files unused for 30 days', () => {
    const folder = mkdtempSync(join(tmpdir(), 'kurmis-settings-store-'))
    try {
      const now = Date.now()
      const first = storeSettingsFile('{"env":{"A":"1"}}', folder, now)
      expect(readFileSync(first, 'utf8')).toBe('{"env":{"A":"1"}}')
      if (process.platform !== 'win32') expect(statSync(first).mode & 0o777).toBe(0o600)
      expect(storeSettingsFile('{"env":{"A":"1"}}', folder, now)).toBe(first)
      const old = join(folder, `${'0'.repeat(32)}.json`)
      writeFileSync(old, '{}')
      const longAgo = (now - SETTINGS_FILE_MAX_AGE_MS - 60_000) / 1000
      utimesSync(old, longAgo, longAgo)
      writeFileSync(join(folder, 'other.txt'), 'kept')
      utimesSync(join(folder, 'other.txt'), longAgo, longAgo)
      const second = storeSettingsFile('{"env":{"A":"2"}}', folder, now)
      expect(second).not.toBe(first)
      expect(readdirSync(folder).sort()).toEqual([basename(first), basename(second), 'other.txt'].sort())
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 10 })
    }
  })

  test('settingsEnv adds the subscription token variables, set to the empty string', () => {
    const routed = routedClaudeEnv({ port: 40123, key: 'k', login: null, secureStorageDir: null })
    expect(settingsEnv(routed)).toEqual({ ...routingVariables(routed), CLAUDE_CODE_OAUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '' })
    // Merged over the person's own, the empty values win.
    expect(mergeRoutingSettings({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'fake' } }, settingsEnv(routed)).env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: '' })
  })

  test('routingVariables keeps the four routing variables and leaves out the credentials folder', () => {
    const routed = routedClaudeEnv({ port: 40123, key: 'k', login: 'claude:work', startedOn: 'claude:work', secureStorageDir: '/x/claude/work' })
    expect(routed['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe('/x/claude/work')
    expect(Object.keys(routingVariables(routed)).sort()).toEqual(['ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_MAX_RETRIES', 'ENABLE_TOOL_SEARCH'])
  })
})

describe('the user settings file and custom headers', () => {
  test('the path follows CLAUDE_CONFIG_DIR, else ~/.claude', () => {
    expect(claudeUserSettingsPath({}, '/home/someone')).toBe(join('/home/someone', '.claude', 'settings.json'))
    expect(claudeUserSettingsPath({ CLAUDE_CONFIG_DIR: '' }, '/home/someone')).toBe(join('/home/someone', '.claude', 'settings.json'))
    expect(claudeUserSettingsPath({ CLAUDE_CONFIG_DIR: '/conf' }, '/home/someone')).toBe(join('/conf', 'settings.json'))
  })

  test('a broken settings file or --settings value is reported by line and column, never quoting its text', () => {
    const secret = 'sk-ant-oat01-fake-secret-value'
    const file = join(dir, 'secret.json')
    writeFileSync(file, `{\n  "env": {\n    "TOKEN": ${secret}\n  }\n}`)
    expect(readUserSettingsEnv(file).warning).toBe(`${file} is not valid JSON (line 3, column 14), so custom headers set there are not kept`)
    const read = readUserSettingsArg(['--settings', file], { cwd: dir })
    expect(read).toEqual({ error: `--settings: the settings file ${file} is not valid JSON (line 3, column 14)` })
    const inline = readUserSettingsArg(['--settings', `{"env": {"TOKEN": ${secret}}}`], { cwd: dir })
    expect('error' in inline && inline.error).toBe('--settings: the JSON given to --settings is not valid JSON (line 1, column 19)')
    expect(JSON.stringify([read, inline])).not.toContain('sk-ant')
  })

  test('reads the env block; a missing file or one without env is no env; a broken file is a warning', () => {
    const file = join(dir, 'settings.json')
    expect(readUserSettingsEnv(file)).toEqual({ env: null, warning: null })
    writeFileSync(file, '{"model":"opus"}')
    expect(readUserSettingsEnv(file)).toEqual({ env: null, warning: null })
    writeFileSync(file, '{"env":{"ANTHROPIC_CUSTOM_HEADERS":"x-team: a"}}')
    expect(readUserSettingsEnv(file)).toEqual({ env: { ANTHROPIC_CUSTOM_HEADERS: 'x-team: a' }, warning: null })
    writeFileSync(file, '{"env":')
    expect(readUserSettingsEnv(file)).toEqual({ env: null, warning: `${file} is not valid JSON (line 1, column 8), so custom headers set there are not kept` })
    expect(readUserSettingsEnv(dir).warning).toContain(`could not read ${dir}`)
  })

  test('the highest layer that sets ANTHROPIC_CUSTOM_HEADERS wins', () => {
    const processEnv = { ANTHROPIC_CUSTOM_HEADERS: 'x-from: process' }
    const userSettingsEnv = { ANTHROPIC_CUSTOM_HEADERS: 'x-from: settings-json' }
    const flagEnv = { ANTHROPIC_CUSTOM_HEADERS: 'x-from: flag' }
    expect(inheritedCustomHeaders({ flagEnv, userSettingsEnv, processEnv })).toBe('x-from: flag')
    expect(inheritedCustomHeaders({ flagEnv: { OTHER: '1' }, userSettingsEnv, processEnv })).toBe('x-from: settings-json')
    expect(inheritedCustomHeaders({ flagEnv: null, userSettingsEnv: null, processEnv })).toBe('x-from: process')
    expect(inheritedCustomHeaders({ flagEnv: null, userSettingsEnv: null, processEnv: {} })).toBeNull()
    // An empty value set on a higher layer still beats a lower one, as it does in claude.
    expect(inheritedCustomHeaders({ flagEnv: { ANTHROPIC_CUSTOM_HEADERS: '' }, userSettingsEnv, processEnv })).toBe('')
  })

  test('on Windows the process environment\'s name is matched without regard to case', () => {
    const processEnv = { Anthropic_Custom_Headers: 'x-from: process' }
    expect(inheritedCustomHeaders({ flagEnv: null, userSettingsEnv: null, processEnv, windows: true })).toBe('x-from: process')
    expect(inheritedCustomHeaders({ flagEnv: null, userSettingsEnv: null, processEnv })).toBeNull()
  })
})
