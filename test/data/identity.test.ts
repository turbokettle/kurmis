// Reading a Claude login's identity from the `.claude.json` its own CLI runs write.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ClaudeIdentityReader, isSameClaudeAccount, parseClaudeIdentity, readClaudeIdentity } from '../../src/data/identity.ts'
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

describe('the same account', () => {
  const key = (email: string | null, organizationUuid: string | null) => ({ email, organizationUuid })

  test('is the same email, without regard to case, in the same organization', () => {
    expect(isSameClaudeAccount(key('work@example.com', 'org-0001'), key(' Work@Example.com', 'ORG-0001'))).toBe(true)
    expect(isSameClaudeAccount(key('work@example.com', 'org-0001'), key('home@example.com', 'org-0001'))).toBe(false)
  })

  test('is not one email in two organizations, such as a personal plan and a Team seat', () => {
    expect(isSameClaudeAccount(key('work@example.com', 'org-0001'), key('work@example.com', 'org-0002'))).toBe(false)
  })

  test('is decided by the email alone when either side has no organization', () => {
    expect(isSameClaudeAccount(key('work@example.com', null), key('work@example.com', 'org-0002'))).toBe(true)
    expect(isSameClaudeAccount(key('work@example.com', 'org-0001'), key('work@example.com', null))).toBe(true)
    expect(isSameClaudeAccount(key('work@example.com', null), key('home@example.com', null))).toBe(false)
  })

  test('needs an email on both sides', () => {
    expect(isSameClaudeAccount(key(null, 'org-0001'), key(null, 'org-0001'))).toBe(false)
    expect(isSameClaudeAccount(key('work@example.com', 'org-0001'), key(null, 'org-0001'))).toBe(false)
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
