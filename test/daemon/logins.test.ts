import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ClaudeCredentials } from '../../src/core/credentials.ts'
import { configPath, statePath } from '../../src/data/paths.ts'
import { LoginTable, NO_SESSION_KEY } from '../../src/daemon/logins.ts'
import type { TokenSource } from '../../src/daemon/tokens.ts'
import { emptyAccountUsage } from '../../src/core/usage.ts'
import { freshHome, writeLogins } from './harness.ts'

let home = ''
const tokens = new Map<string, ClaudeCredentials>()
const source: TokenSource = {
  keychain: false,
  read: (id) => tokens.get(id) ?? null,
  prime: () => Promise.resolve(),
  invalidate: () => undefined,
  clear: () => undefined
}
const events: string[] = []
let clock = 1_000_000

function table(): LoginTable {
  const created = new LoginTable({ tokens: source, log: { write: (event) => { events.push(event) } }, now: () => clock,
    configCheckMs: 2_000, stateWriteMs: 0 })
  created.load()
  return created
}

beforeEach(() => {
  home = freshHome()
  tokens.clear()
  events.length = 0
  clock = 1_000_000
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('the routing rows', () => {
  test('are built from the settings, the tokens, the usage and the cooldowns of the Claude logins', () => {
    writeLogins({ logins: { 'claude:work': { fiveHourLimit: 80, useFirst: true }, 'codex:work': {} } })
    tokens.set('claude:work', { accessToken: 't', expiresAt: 5_000_000, hasRefreshToken: true })
    const logins = table()
    logins.setCooldown('claude:work', 2_000_000)
    logins.setUsage('claude:work', emptyAccountUsage('claude:work', clock))
    const rows = logins.routeRows('claude:default', false)
    expect(rows.map((row) => row.id)).toEqual(['claude:default', 'claude:work'])
    expect(rows[0]).toMatchObject({ loggedIn: false, credentialsReadable: false, tokenExpiresAt: null, usage: null })
    expect(rows[1]).toMatchObject({ loggedIn: true, credentialsReadable: true, tokenExpiresAt: 5_000_000,
      fiveHourLimitPercent: 80, weeklyLimitPercent: 100, useFirst: true, autoRoute: true, cooldownUntil: 2_000_000 })
    expect(rows[1]?.usage?.accountId).toBe('claude:work')
  })

  test('count the started-on login as signable only when the request carries its own authorization header', () => {
    writeLogins({ logins: { 'claude:work': {} } })
    const logins = table()
    expect(logins.routeRows('claude:work', true).map((row) => row.credentialsReadable)).toEqual([false, true])
    expect(logins.routeRows('claude:work', false).map((row) => row.credentialsReadable)).toEqual([false, false])
    expect(logins.routeRows('claude:default', true).map((row) => row.credentialsReadable)).toEqual([true, false])
  })

  test('count a login a probe found signed in as logged in, but not as signable', () => {
    writeLogins({})
    const logins = table()
    logins.setSignedIn('claude:default', true)
    expect(logins.routeRows('claude:default', false)[0]).toMatchObject({ loggedIn: true, credentialsReadable: false })
  })

  test('drop a cooldown that has run out', () => {
    writeLogins({})
    const logins = table()
    logins.setCooldown('claude:default', clock + 10)
    expect(logins.cooldown('claude:default')).toBe(clock + 10)
    clock += 10
    expect(logins.cooldown('claude:default')).toBeNull()
    logins.setCooldown('claude:default', Infinity)
    expect(logins.routeRows('claude:default', false)[0]?.cooldownUntil).toBe(Infinity)
  })
})

describe('sessions', () => {
  test('a placement says whether the session is new, stayed or moved, and is saved', async () => {
    writeLogins({ logins: { 'claude:work': {} } })
    const logins = table()
    expect(logins.placeSession('s-1', 'claude:default')).toEqual({ kind: 'placed' })
    expect(logins.placeSession('s-1', 'claude:default')).toEqual({ kind: 'same' })
    expect(logins.placeSession('s-1', 'claude:work')).toEqual({ kind: 'moved', from: 'claude:default' })
    expect(logins.placeSession(NO_SESSION_KEY, 'claude:work')).toEqual({ kind: 'placed' })
    expect(logins.sessionCount('claude:work')).toBe(2)
    await logins.flush()
    const saved = JSON.parse(readFileSync(statePath(), 'utf8')) as { sessions: Record<string, unknown> }
    expect(Object.keys(saved.sessions)).toEqual(['s-1', NO_SESSION_KEY])
    expect(table().sessionLogin('s-1')).toBe('claude:work')
  })
})

describe('the config', () => {
  test('is reloaded when its contents change, at most every configCheckMs', () => {
    writeLogins({})
    const logins = table()
    writeLogins({ logins: { 'claude:work': {} } })
    logins.checkConfig()
    expect(logins.find('claude:work')).toBeUndefined()
    clock += 2_000
    logins.checkConfig()
    expect(logins.find('claude:work')).toBeDefined()
  })

  test('that does not read keeps the config the daemon has, and reload says why', () => {
    writeLogins({ logins: { 'claude:work': {} } })
    const logins = table()
    writeFileSync(configPath(), '{"version": 1, "logins": [{"id": "Bad Id"}]}')
    const result = logins.reloadConfig()
    expect(result.ok).toBe(false)
    expect(logins.find('claude:work')).toBeDefined()
    expect(events).toContain('config_invalid')
  })

  test('tells listeners about a change', () => {
    writeLogins({})
    const logins = table()
    let calls = 0
    const stop = logins.onChange(() => { calls++ })
    logins.setCooldown('claude:default', clock + 100)
    stop()
    logins.setCooldown('claude:default', null)
    expect(calls).toBe(1)
  })

  test('a removed login takes its usage and cooldown with it', () => {
    writeLogins({ logins: { 'claude:work': {} } })
    const logins = table()
    logins.setCooldown('claude:work', clock + 100)
    writeLogins({})
    logins.reloadConfig()
    expect(logins.cooldown('claude:work')).toBeNull()
  })
})
