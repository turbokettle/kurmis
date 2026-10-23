// The environment kurmis runs a CLI with on one login for itself.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, test } from 'vitest'
import { configDirHasOwnCredentials, claudeLoginEnv, claudeProbeEnv, namesDefaultClaudeFolder,
  sharesDefaultSettingsFile } from '../../src/data/login-env.ts'
import { kurmisHome, ownClaudeProbeFolder } from '../../src/data/paths.ts'
import { canCreateSymlinks, linkFolder } from '../host.ts'
import { claudeRef, OWN_CLAUDE_REF } from '../logins.ts'

const ROUTED = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']

describe('claude', () => {
  test('an extra login runs with its folder as the config folder', () => {
    const env = claudeLoginEnv(claudeRef('workclaude'))
    expect(env['CLAUDE_CONFIG_DIR']).toBe(join(kurmisHome(), 'claude', 'workclaude'))
    expect('CLAUDE_SECURESTORAGE_CONFIG_DIR' in env && env['CLAUDE_SECURESTORAGE_CONFIG_DIR'] === undefined).toBe(true)
    for (const name of ROUTED) expect(name in env && env[name] === undefined).toBe(true)
    expect(claudeProbeEnv(claudeRef('workclaude'))).toEqual(env)
  })

  test("the login plain claude uses signs in on ~/.claude, with both folder variables removed", () => {
    const env = claudeLoginEnv(OWN_CLAUDE_REF)
    expect(Object.entries(env).filter(([, value]) => value !== undefined)).toEqual([])
    expect(Object.keys(env)).toEqual(expect.arrayContaining(['CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR']))
  })

  test('forceCredentialManager adds CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1', () => {
    const work = claudeRef('workclaude')
    expect(claudeLoginEnv(work, true)).toEqual({ ...claudeLoginEnv(work), CLAUDE_CODE_FORCE_WINDOWS_CREDMAN: '1' })
    expect(claudeLoginEnv(OWN_CLAUDE_REF, true)['CLAUDE_CODE_FORCE_WINDOWS_CREDMAN']).toBe('1')
    expect('CLAUDE_CODE_FORCE_WINDOWS_CREDMAN' in claudeLoginEnv(claudeRef('workclaude'))).toBe(false)
  })

  test("the login plain claude uses is probed in the probe folder with the default credentials", () => {
    const env = claudeProbeEnv(OWN_CLAUDE_REF)
    expect(env['CLAUDE_CONFIG_DIR']).toBe(ownClaudeProbeFolder())
    expect(env['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe('')
  })
})

describe('whether CLAUDE_CONFIG_DIR gives a CLI credentials of its own', () => {
  test('unset or empty: no, the CLI reads the default ones', () => {
    expect(configDirHasOwnCredentials({}, 'darwin', '/Users/example')).toBe(false)
    expect(configDirHasOwnCredentials({ CLAUDE_CONFIG_DIR: '' }, 'linux', '/home/example')).toBe(false)
  })

  test('on macOS and Windows any value names another Keychain or Credential Manager item, ~/.claude included', () => {
    expect(configDirHasOwnCredentials({ CLAUDE_CONFIG_DIR: '/Users/example/.claude' }, 'darwin', '/Users/example')).toBe(true)
    expect(configDirHasOwnCredentials({ CLAUDE_CONFIG_DIR: 'C:\\Users\\example\\work' }, 'win32', 'C:\\Users\\example')).toBe(true)
  })

  test('on Linux only a folder other than ~/.claude does', () => {
    expect(configDirHasOwnCredentials({ CLAUDE_CONFIG_DIR: '/home/example/.claude/' }, 'linux', '/home/example')).toBe(false)
    expect(configDirHasOwnCredentials({ CLAUDE_CONFIG_DIR: '/home/example/work' }, 'linux', '/home/example')).toBe(true)
  })
})

describe('whether CLAUDE_CONFIG_DIR names ~/.claude itself', () => {
  test('compares the paths made absolute, with links resolved, and without regard to case on macOS and Windows', () => {
    const home = mkdtempSync(join(tmpdir(), 'kurmis-login-env-'))
    try {
      const folder = join(home, '.claude')
      mkdirSync(folder)
      linkFolder(folder, join(home, 'link'))
      expect(namesDefaultClaudeFolder(folder, 'darwin', home)).toBe(true)
      expect(namesDefaultClaudeFolder(`${folder}${sep}`, 'darwin', home)).toBe(true)
      expect(namesDefaultClaudeFolder(join(home, 'link'), 'darwin', home)).toBe(true)
      expect(namesDefaultClaudeFolder(join(home, 'x', '..', '.claude'), 'linux', home)).toBe(true)
      expect(namesDefaultClaudeFolder(join(home, '.CLAUDE'), 'darwin', home)).toBe(true)
      expect(namesDefaultClaudeFolder(join(home, '.CLAUDE'), 'win32', home)).toBe(true)
      expect(namesDefaultClaudeFolder(join(home, 'work'), 'darwin', home)).toBe(false)
      expect(namesDefaultClaudeFolder('', 'darwin', home)).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true, maxRetries: 10 })
    }
  })

  test('on Linux case counts', () => {
    expect(namesDefaultClaudeFolder('/home/example/.CLAUDE', 'linux', '/home/example')).toBe(false)
  })
})

describe.runIf(canCreateSymlinks())('whether $CLAUDE_CONFIG_DIR/settings.json is ~/.claude/settings.json through a link', () => {
  test('a link, a chain of links and a link whose target does not exist yet count; a file of its own does not', () => {
    const home = mkdtempSync(join(tmpdir(), 'kurmis-shares-'))
    try {
      mkdirSync(join(home, '.claude'))
      const work = join(home, '.claude-work')
      mkdirSync(work)
      // The default file does not exist yet.
      symlinkSync(join(home, '.claude', 'settings.json'), join(work, 'settings.json'))
      expect(sharesDefaultSettingsFile(work, 'darwin', home)).toBe(true)
      writeFileSync(join(home, '.claude', 'settings.json'), '{}')
      expect(sharesDefaultSettingsFile(work, 'linux', home)).toBe(true)
      // Through a second link, and with the case changed where case is ignored.
      const chained = join(home, '.claude-chained')
      mkdirSync(chained)
      symlinkSync(join('..', '.claude-work', 'settings.json'), join(chained, 'settings.json'))
      expect(sharesDefaultSettingsFile(chained, 'linux', home)).toBe(true)
      expect(sharesDefaultSettingsFile(join(home, '.CLAUDE-WORK'), 'darwin', home)).toBe(true)
      const own = join(home, '.claude-own')
      mkdirSync(own)
      writeFileSync(join(own, 'settings.json'), '{}')
      expect(sharesDefaultSettingsFile(own, 'darwin', home)).toBe(false)
      expect(sharesDefaultSettingsFile(join(home, '.claude-missing'), 'darwin', home)).toBe(false)
      expect(sharesDefaultSettingsFile('', 'darwin', home)).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true, maxRetries: 10 })
    }
  })
})
