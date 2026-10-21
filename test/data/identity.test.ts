// Reading a Claude login's identity from the `.claude.json` its own CLI runs write.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ClaudeIdentityReader, parseClaudeIdentity, readClaudeIdentity } from '../../src/data/identity.ts'
import { loginFolder, ownClaudeProbeFolder } from '../../src/data/paths.ts'
import { claudeRef, OWN_CLAUDE_REF } from '../logins.ts'

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

const WORK = claudeRef('workclaude')

describe('reading', () => {
  test('an extra login reads only its own folder', () => {
    writeFileSync(join(homedir(), '.claude.json'), profile('uuid-shared', 'shared@example.com'))
    expect(readClaudeIdentity(WORK)).toBeNull()
    mkdirSync(loginFolder(WORK), { recursive: true })
    writeFileSync(join(loginFolder(WORK), '.claude.json'), profile('uuid-work', 'work@example.com'))
    expect(readClaudeIdentity(WORK)?.accountUuid).toBe('uuid-work')
  })

  test("the login plain claude uses prefers the probe folder and falls back to ~/.claude.json", () => {
    writeFileSync(join(homedir(), '.claude.json'), profile('uuid-shared', 'shared@example.com'))
    const reader = new ClaudeIdentityReader()
    expect(reader.read(OWN_CLAUDE_REF)?.accountUuid).toBe('uuid-shared')
    mkdirSync(ownClaudeProbeFolder(), { recursive: true })
    writeFileSync(join(ownClaudeProbeFolder(), '.claude.json'), profile('uuid-probe', 'own@example.com'))
    expect(reader.read(OWN_CLAUDE_REF)?.accountUuid).toBe('uuid-probe')
  })
})
