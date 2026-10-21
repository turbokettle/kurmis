// The environment kurmis runs a CLI with on one login for itself.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, test } from 'vitest'
import { applyEnvPatch, configDirHasOwnCredentials, claudeLoginEnv, claudeProbeEnv, codexLoginEnv, namesDefaultClaudeFolder } from '../../src/data/login-env.ts'
import { claudeDefaultProbeFolder, kurmisHome } from '../../src/data/paths.ts'
import { linkFolder } from '../host.ts'

const ROUTED = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']

describe('claude', () => {
  test('an extra login runs with its folder as the config folder', () => {
    const env = claudeLoginEnv('claude:work')
    expect(env['CLAUDE_CONFIG_DIR']).toBe(join(kurmisHome(), 'claude', 'work'))
    expect('CLAUDE_SECURESTORAGE_CONFIG_DIR' in env && env['CLAUDE_SECURESTORAGE_CONFIG_DIR'] === undefined).toBe(true)
    for (const name of ROUTED) expect(name in env && env[name] === undefined).toBe(true)
    expect(claudeProbeEnv('claude:work')).toEqual(env)
  })

  test('the default login signs in on ~/.claude, with both folder variables removed', () => {
    const env = claudeLoginEnv('claude:default')
    expect(Object.entries(env).filter(([, value]) => value !== undefined)).toEqual([])
    expect(Object.keys(env)).toEqual(expect.arrayContaining(['CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR']))
  })

  test('forceCredentialManager adds CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1', () => {
    expect(claudeLoginEnv('claude:work', true)).toEqual({ ...claudeLoginEnv('claude:work'), CLAUDE_CODE_FORCE_WINDOWS_CREDMAN: '1' })
    expect(claudeLoginEnv('claude:default', true)['CLAUDE_CODE_FORCE_WINDOWS_CREDMAN']).toBe('1')
    expect('CLAUDE_CODE_FORCE_WINDOWS_CREDMAN' in claudeLoginEnv('claude:work')).toBe(false)
  })

  test('the default login is probed in the probe folder with the default credentials', () => {
    const env = claudeProbeEnv('claude:default')
    expect(env['CLAUDE_CONFIG_DIR']).toBe(claudeDefaultProbeFolder())
    expect(env['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe('')
  })
})

describe('codex', () => {
  test('an extra login gets its CODEX_HOME, the default keeps the inherited one', () => {
    expect(codexLoginEnv('codex:work')['CODEX_HOME']).toBe(join(kurmisHome(), 'codex', 'work'))
    expect('CODEX_HOME' in codexLoginEnv('codex:default')).toBe(false)
    expect('CODEX_HOME' in codexLoginEnv('codex:default', { CODEX_HOME: '/somewhere/else' })).toBe(false)
  })

  test('the default drops an inherited CODEX_HOME that is an extra login\'s home', () => {
    const env = codexLoginEnv('codex:default', { CODEX_HOME: join(kurmisHome(), 'codex', 'work') })
    expect('CODEX_HOME' in env && env['CODEX_HOME'] === undefined).toBe(true)
  })
})

describe('applying a patch', () => {
  test('sets, removes and keeps', () => {
    const out = applyEnvPatch({ A: '1', B: '2', C: undefined }, { A: undefined, D: '4' }, false)
    expect(out).toEqual({ B: '2', D: '4' })
  })

  test('matches names without case on Windows', () => {
    expect(applyEnvPatch({ Anthropic_Api_Key: 'x', Path: 'p' }, { ANTHROPIC_API_KEY: undefined, PATH: 'q' }, true))
      .toEqual({ PATH: 'q' })
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
