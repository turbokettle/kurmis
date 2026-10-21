// The environment a routed Claude CLI is started with.
import { describe, expect, test } from 'vitest'
import { applyRoutedEnv, inheritedOAuthTokenVariables, ROUTED_CLI_MAX_RETRIES, routedClaudeEnv } from '../../src/core/routed-env.ts'
import { OWN_CLAUDE } from '../logins.ts'

const FOLDER = '/Users/example/.kurmis/claude/workclaude'

describe('the routed environment', () => {
  test('on Auto: the loopback URL, the key, the tool-search opt-in and the retry budget', () => {
    expect(routedClaudeEnv({ port: 12345, key: 'secret', login: null, secureStorageDir: null })).toEqual({
      set: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:12345',
        ANTHROPIC_CUSTOM_HEADERS: 'x-kurmis-key: secret',
        // Without this the CLI sees a base URL whose host is not api.anthropic.com and stops
        // deferring MCP tools, putting every schema in every turn's prompt.
        ENABLE_TOOL_SEARCH: 'true',
        CLAUDE_CODE_MAX_RETRIES: '15',
        // The default credentials, also when CLAUDE_CONFIG_DIR names another folder.
        CLAUDE_SECURESTORAGE_CONFIG_DIR: ''
      },
      unset: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR']
    })
    expect(ROUTED_CLI_MAX_RETRIES).toBe(15)
  })

  test('on a named login: the login header and its folder, passed as given', () => {
    const env = routedClaudeEnv({ port: 1, key: 'k', login: 'workclaude', secureStorageDir: `${FOLDER}/` })
    expect(env.set['ANTHROPIC_CUSTOM_HEADERS']).toBe('x-kurmis-key: k\nx-kurmis-login: workclaude')
    expect(env.set['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe(`${FOLDER}/`)
    expect(env.unset).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'])
  })

  test('on the login plain claude uses: pinned, with the folder variable empty, which means the default credentials', () => {
    const env = routedClaudeEnv({ port: 1, key: 'k', login: OWN_CLAUDE, secureStorageDir: null })
    expect(env.set['ANTHROPIC_CUSTOM_HEADERS']).toBe(`x-kurmis-key: k\nx-kurmis-login: ${OWN_CLAUDE}`)
    expect(env.set['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe('')
    expect(env.unset).not.toContain('CLAUDE_SECURESTORAGE_CONFIG_DIR')
    // An inherited folder, from a session on another login, is replaced.
    expect(applyRoutedEnv({ CLAUDE_SECURESTORAGE_CONFIG_DIR: FOLDER, CLAUDE_CONFIG_DIR: '/x' }, env)).toMatchObject({
      CLAUDE_SECURESTORAGE_CONFIG_DIR: '', CLAUDE_CONFIG_DIR: '/x'
    })
  })

  test('keeps the person\'s own custom headers', () => {
    const env = routedClaudeEnv({ port: 1, key: 'k', login: null, secureStorageDir: null,
      inheritedCustomHeaders: 'X-Team: blue\nx-kurmis-key: stale' })
    expect(env.set['ANTHROPIC_CUSTOM_HEADERS']).toBe('X-Team: blue\nx-kurmis-key: k')
  })

  test('on Auto, started on another login: its folder and the started-on header, no pin', () => {
    const env = routedClaudeEnv({ port: 1, key: 'k', login: null, startedOn: 'workclaude', secureStorageDir: FOLDER })
    expect(env.set['ANTHROPIC_CUSTOM_HEADERS']).toBe('x-kurmis-key: k\nx-kurmis-started-on: workclaude')
    expect(env.set['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe(FOLDER)
  })

  test('pinned: the started-on login is the pinned one', () => {
    const env = routedClaudeEnv({ port: 1, key: 'k', login: 'workclaude', startedOn: 'workclaude', secureStorageDir: FOLDER })
    expect(env.set['ANTHROPIC_CUSTOM_HEADERS']).toBe('x-kurmis-key: k\nx-kurmis-login: workclaude\nx-kurmis-started-on: workclaude')
    expect(() => routedClaudeEnv({ port: 1, key: 'k', login: 'workclaude', startedOn: 'otherclaude', secureStorageDir: FOLDER }))
      .toThrow()
  })

  test('an extra login\'s folder cannot be the empty string, which would mean the default credentials', () => {
    expect(() => routedClaudeEnv({ port: 1, key: 'k', login: 'workclaude', secureStorageDir: '' })).toThrow(/cannot be the empty string/)
  })
})

describe('applying it', () => {
  const routed = routedClaudeEnv({ port: 2, key: 'k', login: null, secureStorageDir: null })

  test('removes the key variables and sets the routing ones, leaving the rest', () => {
    expect(applyRoutedEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-example', ANTHROPIC_BASE_URL: 'http://old', EMPTY: undefined }, routed))
      .toEqual({ PATH: '/bin', ...routed.set })
  })

  test('matches names without regard to case on Windows only', () => {
    const env = { Path: 'C:\\bin', Anthropic_Api_Key: 'sk-example' }
    expect(applyRoutedEnv(env, routed, true)).toEqual({ Path: 'C:\\bin', ...routed.set })
    expect(applyRoutedEnv(env, routed, false)).toEqual({ ...env, ...routed.set })
  })
})

describe('the subscription token variables', () => {
  test('are removed from a routed CLI, and named as they are spelled', () => {
    const routed = routedClaudeEnv({ port: 2, key: 'k', login: null, secureStorageDir: null })
    const env = { PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'fake-token', CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3' }
    expect(applyRoutedEnv(env, routed)).toEqual({ PATH: '/bin', ...routed.set })
    expect(inheritedOAuthTokenVariables(env)).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR'])
    expect(inheritedOAuthTokenVariables({ PATH: '/bin' })).toEqual([])
    expect(inheritedOAuthTokenVariables({ CLAUDE_CODE_OAUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '' })).toEqual([])
    expect(inheritedOAuthTokenVariables({ Claude_Code_OAuth_Token: 'x' }, true)).toEqual(['Claude_Code_OAuth_Token'])
    expect(inheritedOAuthTokenVariables({ Claude_Code_OAuth_Token: 'x' }, false)).toEqual([])
  })
})
