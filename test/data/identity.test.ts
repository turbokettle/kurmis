// Reading a Claude login's identity from the `.claude.json` its own CLI runs write.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ClaudeIdentityReader, parseClaudeIdentity, readClaudeIdentity } from '../../src/data/identity.ts'
import { claudeDefaultProbeFolder, loginFolder } from '../../src/data/paths.ts'

function profile(uuid: string, email: string): string {
  return JSON.stringify({ numStartups: 3, oauthAccount: { accountUuid: uuid, emailAddress: email,
    organizationUuid: 'org-0001', organizationName: 'Example Org' } })
}

describe('parsing', () => {
  test('reads the oauthAccount block', () => {
    expect(parseClaudeIdentity(profile('uuid-1', 'one@example.com'))).toEqual({
      accountUuid: 'uuid-1', email: 'one@example.com', organizationUuid: 'org-0001', organizationName: 'Example Org'
    })
  })

  test.each(['', 'not json', '{}', '{"oauthAccount":null}', '{"oauthAccount":{"accountUuid":""}}'])('%j names nobody', (text) => {
    expect(parseClaudeIdentity(text)).toBeNull()
  })
})

describe('reading', () => {
  test('an extra login reads only its own folder', () => {
    writeFileSync(join(homedir(), '.claude.json'), profile('uuid-shared', 'shared@example.com'))
    expect(readClaudeIdentity('claude:work')).toBeNull()
    mkdirSync(loginFolder('claude:work'), { recursive: true })
    writeFileSync(join(loginFolder('claude:work'), '.claude.json'), profile('uuid-work', 'work@example.com'))
    expect(readClaudeIdentity('claude:work')?.accountUuid).toBe('uuid-work')
  })

  test('the default login prefers the probe folder and falls back to ~/.claude.json', () => {
    writeFileSync(join(homedir(), '.claude.json'), profile('uuid-shared', 'shared@example.com'))
    const reader = new ClaudeIdentityReader()
    expect(reader.read('claude:default')?.accountUuid).toBe('uuid-shared')
    mkdirSync(claudeDefaultProbeFolder(), { recursive: true })
    writeFileSync(join(claudeDefaultProbeFolder(), '.claude.json'), profile('uuid-probe', 'own@example.com'))
    expect(reader.read('claude:default')?.accountUuid).toBe('uuid-probe')
  })
})
