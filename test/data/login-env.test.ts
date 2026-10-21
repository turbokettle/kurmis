// The environment kurmis runs a CLI with on one login for itself.
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { applyEnvPatch, claudeLoginEnv, claudeProbeEnv, codexLoginEnv } from '../../src/data/login-env.ts'
import { claudeDefaultProbeFolder, kurmisHome } from '../../src/data/paths.ts'

const ROUTED = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']

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
