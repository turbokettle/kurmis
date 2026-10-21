import { describe, expect, test } from 'vitest'
import {
  chooseCodexLogin,
  CODEX_USAGE_MAX_AGE_MS,
  codexLoginsToProbe,
  codexRouteAccounts,
  codexRouteBlock,
  codexUsageStale,
  isKurmisCodexHome
} from '../../src/core/codex-choice.ts'
import { loginStatus, statusAnswer } from '../cli/helpers.ts'
import { codexUsage } from './codex-usage-fixture.ts'

const NOW = Date.parse('2026-09-13T01:10:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const at = (ms: number): string => new Date(NOW + ms).toISOString()

describe('the Codex rows', () => {
  test('carry the Codex logins only, with the settings of each and no token or cooldown', () => {
    const usage = codexUsage('codex:work', { fetchedAt: NOW })
    const rows = codexRouteAccounts(statusAnswer([
      loginStatus('claude:default'),
      loginStatus('codex:default', { signedIn: false }),
      loginStatus('codex:work', { routing: false, fiveHourLimit: 80, weeklyLimit: 90, useFirst: true, usage })
    ]))
    expect(rows).toEqual([
      {
        id: 'codex:default', loggedIn: false, credentialsReadable: false, tokenExpiresAt: null, usage: null,
        autoRoute: true, fiveHourLimitPercent: 100, weeklyLimitPercent: 100, useFirst: false, cooldownUntil: null
      },
      {
        id: 'codex:work', loggedIn: true, credentialsReadable: true, tokenExpiresAt: null, usage,
        autoRoute: false, fiveHourLimitPercent: 80, weeklyLimitPercent: 90, useFirst: true, cooldownUntil: null
      }
    ])
  })

  test('count a login the daemon has not checked yet as signed in', () => {
    const [row] = codexRouteAccounts(statusAnswer([loginStatus('codex:default', { signedIn: null })]))
    expect(row?.loggedIn).toBe(true)
    expect(row?.credentialsReadable).toBe(true)
  })
})

describe('the Codex login to start on', () => {
  test('is the one whose week resets first, as Claude Auto ranks', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus('codex:default', { usage: codexUsage('codex:default', { weekly: 10, weeklyResetsAt: at(72 * HOUR), fetchedAt: NOW }) }),
      loginStatus('codex:work', { usage: codexUsage('codex:work', { weekly: 50, weeklyResetsAt: at(24 * HOUR), fetchedAt: NOW }) })
    ]), NOW)
    expect(choice).toEqual({ login: 'codex:work', kind: 'ranked', note: null })
  })

  test('takes a use-first login ahead of the others', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus('codex:default', { usage: codexUsage('codex:default', { weeklyResetsAt: at(HOUR), fetchedAt: NOW }) }),
      loginStatus('codex:spare', { useFirst: true, usage: codexUsage('codex:spare', { weeklyResetsAt: at(90 * HOUR), fetchedAt: NOW }) })
    ]), NOW)
    expect(choice.login).toBe('codex:spare')
  })

  test('passes over a login at its own limit, and one that is signed out', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus('codex:default', { fiveHourLimit: 80, usage: codexUsage('codex:default', { fiveHour: 85, fiveHourResetsAt: at(HOUR), weeklyResetsAt: at(HOUR), fetchedAt: NOW }) }),
      loginStatus('codex:gone', { signedIn: false, usage: codexUsage('codex:gone', { weeklyResetsAt: at(2 * HOUR), fetchedAt: NOW }) }),
      loginStatus('codex:work', { usage: codexUsage('codex:work', { weeklyResetsAt: at(90 * HOUR), fetchedAt: NOW }) })
    ]), NOW)
    expect(choice).toEqual({ login: 'codex:work', kind: 'ranked', note: null })
  })

  test('with no usage read anywhere, is the machine\'s own login', () => {
    const choice = chooseCodexLogin(statusAnswer([loginStatus('codex:default'), loginStatus('codex:work')]), NOW)
    expect(choice.login).toBe('codex:default')
  })

  test('with no Codex login opted in to routing, is the machine\'s own login whatever its usage', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus('codex:default', { routing: false, usage: codexUsage('codex:default', { fiveHour: 100, fetchedAt: NOW }) }),
      loginStatus('codex:work', { routing: false })
    ]), NOW)
    expect(choice).toEqual({ login: 'codex:default', kind: 'default', note: null })
  })

  test('with no login opted in and codex:default signed out, is still codex:default, with a note', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus('codex:default', { routing: false, signedIn: false })
    ]), NOW)
    expect(choice.login).toBe('codex:default')
    expect(choice.kind).toBe('none-signed-in')
    expect(choice.note).toMatch(/codex:default does not look signed in/)
  })

  test('when every login is out, is the one that comes back first, with a note that says when', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus('codex:default', { usage: codexUsage('codex:default', { weekly: 100, weeklyResetsAt: at(50 * HOUR), fetchedAt: NOW }) }),
      loginStatus('codex:work', {
        weeklyLimit: 90,
        usage: codexUsage('codex:work', { fiveHour: 100, fiveHourResetsAt: at(2 * HOUR + 10 * MINUTE), weekly: 40, weeklyResetsAt: at(30 * HOUR), fetchedAt: NOW })
      })
    ]), NOW)
    expect(choice).toEqual({
      login: 'codex:work',
      kind: 'all-out',
      note: 'Every Codex login is at its limit; starting on codex:work, whose usage comes back first (in 2h 10m).'
    })
  })

  test('a login that is out in two windows comes back when the later of them resets', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus('codex:default', { usage: codexUsage('codex:default', { fiveHour: 100, fiveHourResetsAt: at(HOUR), weekly: 100, weeklyResetsAt: at(40 * HOUR), fetchedAt: NOW }) }),
      loginStatus('codex:work', { usage: codexUsage('codex:work', { weekly: 100, weeklyResetsAt: at(20 * HOUR), fetchedAt: NOW }) })
    ]), NOW)
    expect(choice.login).toBe('codex:work')
  })

  test('when every login is out and none says when it resets, is the first of them', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus('codex:default', { routing: false }),
      loginStatus('codex:work', { usage: codexUsage('codex:work', { weekly: 100, fetchedAt: NOW }) }),
      loginStatus('codex:spare', { usage: codexUsage('codex:spare', { weekly: 100, fetchedAt: NOW }) })
    ]), NOW)
    expect(choice.login).toBe('codex:work')
    expect(choice.kind).toBe('all-out')
    expect(choice.note).toMatch(/none says when it resets/)
  })

  test('when no login routing may use is signed in, is codex:default, with a note', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus('codex:default', { routing: false }),
      loginStatus('codex:work', { signedIn: false })
    ]), NOW)
    expect(choice.login).toBe('codex:default')
    expect(choice.kind).toBe('none-signed-in')
    expect(choice.note).toMatch(/No Codex login that routing may use is signed in/)
  })

  test('a window whose reset has passed counts as empty again', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus('codex:default', { routing: false }),
      loginStatus('codex:work', { usage: codexUsage('codex:work', { weekly: 100, weeklyResetsAt: at(-MINUTE), fetchedAt: NOW - HOUR }) })
    ]), NOW)
    expect(choice).toEqual({ login: 'codex:work', kind: 'ranked', note: null })
  })
})

describe('why a Codex login would be passed over', () => {
  test('is the same rule the choice applies', () => {
    const status = statusAnswer([
      loginStatus('codex:default', { routing: false }),
      loginStatus('codex:work', { weeklyLimit: 50, usage: codexUsage('codex:work', { weekly: 60, weeklyResetsAt: at(HOUR), fetchedAt: NOW }) }),
      loginStatus('codex:spare')
    ])
    expect(codexRouteBlock(status, 'codex:default', NOW)).toEqual({ kind: 'auto-route-off' })
    expect(codexRouteBlock(status, 'codex:work', NOW)).toEqual({
      kind: 'over-limit', utilization: 60, limitPercent: 50, window: 'Codex 7d', resetsAt: at(HOUR)
    })
    expect(codexRouteBlock(status, 'codex:spare', NOW)).toBeNull()
    expect(codexRouteBlock(status, 'codex:other', NOW)).toBeNull()
  })
})

describe('whether Codex usage needs a probe first', () => {
  test('a snapshot is old after the probe interval and its slack', () => {
    expect(codexUsageStale({ usage: null }, NOW)).toBe(true)
    expect(codexUsageStale({ usage: codexUsage('codex:work', { fetchedAt: NOW - CODEX_USAGE_MAX_AGE_MS }) }, NOW)).toBe(false)
    expect(codexUsageStale({ usage: codexUsage('codex:work', { fetchedAt: NOW - CODEX_USAGE_MAX_AGE_MS - 1 }) }, NOW)).toBe(true)
    expect(codexUsageStale({ usage: codexUsage('codex:work', { fetchedAt: NOW + HOUR }) }, NOW)).toBe(false)
  })

  test('only logins in the running with missing or old usage are probed', () => {
    const status = statusAnswer([
      loginStatus('claude:default'),
      loginStatus('codex:default', { usage: codexUsage('codex:default', { fetchedAt: NOW - MINUTE }) }),
      loginStatus('codex:work'),
      loginStatus('codex:old', { usage: codexUsage('codex:old', { fetchedAt: NOW - HOUR }) }),
      loginStatus('codex:off', { routing: false }),
      loginStatus('codex:gone', { signedIn: false }),
      loginStatus('codex:unchecked', { signedIn: null })
    ])
    expect(codexLoginsToProbe(status, NOW)).toEqual(['codex:work', 'codex:old', 'codex:unchecked'])
  })

  test('nothing is probed when one login or none is in the running, since usage cannot change the choice', () => {
    expect(codexLoginsToProbe(statusAnswer([loginStatus('codex:default')]), NOW)).toEqual([])
    expect(codexLoginsToProbe(statusAnswer([
      loginStatus('codex:default'),
      loginStatus('codex:work', { routing: false })
    ]), NOW)).toEqual([])
  })
})

describe('an inherited CODEX_HOME that kurmis set', () => {
  test('is a folder inside the data folder\'s codex folder', () => {
    expect(isKurmisCodexHome('/home/u/.kurmis/codex/work', '/home/u/.kurmis/codex', false)).toBe(true)
    expect(isKurmisCodexHome('/home/u/.kurmis/codex/work/', '/home/u/.kurmis/codex/', false)).toBe(true)
    expect(isKurmisCodexHome('/home/u/.kurmis/codex', '/home/u/.kurmis/codex', false)).toBe(false)
    expect(isKurmisCodexHome('/home/u/.kurmis/codexes/work', '/home/u/.kurmis/codex', false)).toBe(false)
    expect(isKurmisCodexHome('/home/u/.codex', '/home/u/.kurmis/codex', false)).toBe(false)
    expect(isKurmisCodexHome('', '/home/u/.kurmis/codex', false)).toBe(false)
    expect(isKurmisCodexHome(undefined, '/home/u/.kurmis/codex', false)).toBe(false)
  })

  test('on Windows is compared without regard to case or slash direction', () => {
    expect(isKurmisCodexHome('c:/Users/U/.kurmis/codex/work', 'C:\\Users\\u\\.kurmis\\codex', true)).toBe(true)
    expect(isKurmisCodexHome('C:\\Users\\u\\.codex', 'C:\\Users\\u\\.kurmis\\codex', true)).toBe(false)
    expect(isKurmisCodexHome('/home/u/.KURMIS/codex/work', '/home/u/.kurmis/codex', false)).toBe(false)
  })
})
