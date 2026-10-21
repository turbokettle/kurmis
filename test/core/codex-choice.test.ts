import { describe, expect, test } from 'vitest'
import {
  chooseCodexLogin,
  CODEX_USAGE_MAX_AGE_MS,
  codexLoginsToProbe,
  codexRouteAccounts,
  codexRouteBlock,
  codexUsageStale,
  isKurmisCodexHome,
  ownCodexLogin
} from '../../src/core/codex-choice.ts'
import type { LoginStatus, StatusAnswer } from '../../src/core/control-api.ts'
import { OWN_CLAUDE, OWN_CODEX } from '../logins.ts'
import { codexUsage } from './codex-usage-fixture.ts'

const NOW = Date.parse('2026-09-13T01:10:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const at = (ms: number): string => new Date(NOW + ms).toISOString()

/**
 * A login as the daemon's status lists it: a Codex login unless it is `OWN_CLAUDE`, the machine's own
 * when it is `OWN_CLAUDE` or `OWN_CODEX`, and with its id as its alias.
 */
function loginStatus(id: string, patch: Partial<LoginStatus> = {}): LoginStatus {
  return {
    id, provider: id === OWN_CLAUDE ? 'claude' : 'codex', alias: id, machineOwn: id === OWN_CLAUDE || id === OWN_CODEX,
    routing: true, fiveHourLimit: 100, weeklyLimit: 100, useFirst: false, signedIn: true, usage: null, cooldownUntil: null,
    block: null, sessions: 0, email: null, probing: false, ...patch
  }
}

function statusAnswer(logins: LoginStatus[]): Pick<StatusAnswer, 'logins'> {
  return { logins }
}

describe('the Codex rows', () => {
  test('carry the Codex logins only, with the settings of each and no token or cooldown', () => {
    const usage = codexUsage('workcodex1', { fetchedAt: NOW })
    const rows = codexRouteAccounts(statusAnswer([
      loginStatus(OWN_CLAUDE),
      loginStatus(OWN_CODEX, { signedIn: false }),
      loginStatus('workcodex1', { routing: false, fiveHourLimit: 80, weeklyLimit: 90, useFirst: true, usage })
    ]))
    expect(rows).toEqual([
      {
        id: OWN_CODEX, loggedIn: false, credentialsReadable: false, tokenExpiresAt: null, usage: null,
        autoRoute: true, fiveHourLimitPercent: 100, weeklyLimitPercent: 100, useFirst: false, cooldownUntil: null
      },
      {
        id: 'workcodex1', loggedIn: true, credentialsReadable: true, tokenExpiresAt: null, usage,
        autoRoute: false, fiveHourLimitPercent: 80, weeklyLimitPercent: 90, useFirst: true, cooldownUntil: null
      }
    ])
  })

  test('pass over a login the server refused, below 100%, until the window it named resets', () => {
    const refused = (resetsAt: string | null) => ({
      ...codexUsage('workcodex1', { fetchedAt: NOW, fiveHour: 40, fiveHourResetsAt: at(HOUR) }),
      status: 'rejected' as const,
      limited: resetsAt === null ? null : { window: 'codex:primary', utilization: 40, threshold: null, resetsAt }
    })
    const status = (usage: ReturnType<typeof refused>) => statusAnswer([
      loginStatus(OWN_CODEX, { usage: codexUsage(OWN_CODEX, { fetchedAt: NOW, weekly: 90 }) }),
      loginStatus('workcodex1', { usage })
    ])
    expect(codexRouteAccounts(status(refused(at(HOUR))))[1]?.cooldownUntil).toBe(NOW + HOUR)
    expect(codexRouteBlock(status(refused(at(HOUR))), 'workcodex1', NOW)).toEqual({ kind: 'cooldown', until: NOW + HOUR })
    expect(chooseCodexLogin(status(refused(at(HOUR))), NOW).login).toBe(OWN_CODEX)
    expect(chooseCodexLogin(status(refused(at(HOUR))), NOW + 2 * HOUR).kind).toBe('ranked')
  })

  test('count a login the daemon has not checked yet as signed in', () => {
    const [row] = codexRouteAccounts(statusAnswer([loginStatus(OWN_CODEX, { signedIn: null })]))
    expect(row?.loggedIn).toBe(true)
    expect(row?.credentialsReadable).toBe(true)
  })
})

describe("the machine's own Codex login", () => {
  test('is the Codex login the status marks as the machine\'s own', () => {
    const status = statusAnswer([loginStatus(OWN_CLAUDE), loginStatus('workcodex1'), loginStatus(OWN_CODEX)])
    expect(ownCodexLogin(status).id).toBe(OWN_CODEX)
  })

  test('is an error when the status has none, as only a broken daemon would answer', () => {
    expect(() => ownCodexLogin(statusAnswer([loginStatus(OWN_CLAUDE), loginStatus('workcodex1')]))).toThrow(/machine's own Codex/)
    expect(() => chooseCodexLogin(statusAnswer([loginStatus('workcodex1')]), NOW)).toThrow(/machine's own Codex/)
  })
})

describe('the Codex login to start on', () => {
  test('is the one whose week resets first, as Claude Auto ranks', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus(OWN_CODEX, { usage: codexUsage(OWN_CODEX, { weekly: 10, weeklyResetsAt: at(72 * HOUR), fetchedAt: NOW }) }),
      loginStatus('workcodex1', { usage: codexUsage('workcodex1', { weekly: 50, weeklyResetsAt: at(24 * HOUR), fetchedAt: NOW }) })
    ]), NOW)
    expect(choice).toEqual({ login: 'workcodex1', kind: 'ranked', note: null })
  })

  test('takes a use-first login ahead of the others', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus(OWN_CODEX, { usage: codexUsage(OWN_CODEX, { weeklyResetsAt: at(HOUR), fetchedAt: NOW }) }),
      loginStatus('sparecodex', { useFirst: true, usage: codexUsage('sparecodex', { weeklyResetsAt: at(90 * HOUR), fetchedAt: NOW }) })
    ]), NOW)
    expect(choice.login).toBe('sparecodex')
  })

  test('passes over a login at its own limit, and one that is signed out', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus(OWN_CODEX, { fiveHourLimit: 80, usage: codexUsage(OWN_CODEX, { fiveHour: 85, fiveHourResetsAt: at(HOUR), weeklyResetsAt: at(HOUR), fetchedAt: NOW }) }),
      loginStatus('gonecodex', { signedIn: false, usage: codexUsage('gonecodex', { weeklyResetsAt: at(2 * HOUR), fetchedAt: NOW }) }),
      loginStatus('workcodex1', { usage: codexUsage('workcodex1', { weeklyResetsAt: at(90 * HOUR), fetchedAt: NOW }) })
    ]), NOW)
    expect(choice).toEqual({ login: 'workcodex1', kind: 'ranked', note: null })
  })

  test('with no usage read anywhere, is the machine\'s own login', () => {
    const choice = chooseCodexLogin(statusAnswer([loginStatus(OWN_CODEX), loginStatus('workcodex1')]), NOW)
    expect(choice.login).toBe(OWN_CODEX)
    // The machine's own login is the one marked so, wherever the status lists it.
    expect(chooseCodexLogin(statusAnswer([loginStatus('workcodex1'), loginStatus(OWN_CODEX)]), NOW).login).toBe(OWN_CODEX)
  })

  test('with no Codex login opted in to routing, is the machine\'s own login whatever its usage', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus(OWN_CODEX, { routing: false, usage: codexUsage(OWN_CODEX, { fiveHour: 100, fetchedAt: NOW }) }),
      loginStatus('workcodex1', { routing: false })
    ]), NOW)
    expect(choice).toEqual({ login: OWN_CODEX, kind: 'machine-own', note: null })
  })

  test("with no login opted in and the machine's own login signed out, is still that login, with a note naming its alias", () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus(OWN_CODEX, { alias: 'me-example', routing: false, signedIn: false })
    ]), NOW)
    expect(choice.login).toBe(OWN_CODEX)
    expect(choice.kind).toBe('none-signed-in')
    expect(choice.note).toBe('me-example does not look signed in; starting Codex on it anyway.')
  })

  test('when every login is out, is the one that comes back first, with a note that says when', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus(OWN_CODEX, { usage: codexUsage(OWN_CODEX, { weekly: 100, weeklyResetsAt: at(50 * HOUR), fetchedAt: NOW }) }),
      loginStatus('workcodex1', {
        alias: 'work-example',
        weeklyLimit: 90,
        usage: codexUsage('workcodex1', { fiveHour: 100, fiveHourResetsAt: at(2 * HOUR + 10 * MINUTE), weekly: 40, weeklyResetsAt: at(30 * HOUR), fetchedAt: NOW })
      })
    ]), NOW)
    expect(choice).toEqual({
      login: 'workcodex1',
      kind: 'all-out',
      note: 'Every Codex login is at its limit; starting on work-example, whose usage comes back first (in 2h 10m).'
    })
  })

  test('a login that is out in two windows comes back when the later of them resets', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus(OWN_CODEX, { usage: codexUsage(OWN_CODEX, { fiveHour: 100, fiveHourResetsAt: at(HOUR), weekly: 100, weeklyResetsAt: at(40 * HOUR), fetchedAt: NOW }) }),
      loginStatus('workcodex1', { usage: codexUsage('workcodex1', { weekly: 100, weeklyResetsAt: at(20 * HOUR), fetchedAt: NOW }) })
    ]), NOW)
    expect(choice.login).toBe('workcodex1')
  })

  test('when every login is out and none says when it resets, is the first of them', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus(OWN_CODEX, { routing: false }),
      loginStatus('workcodex1', { alias: 'work-example', usage: codexUsage('workcodex1', { weekly: 100, fetchedAt: NOW }) }),
      loginStatus('sparecodex', { usage: codexUsage('sparecodex', { weekly: 100, fetchedAt: NOW }) })
    ]), NOW)
    expect(choice.login).toBe('workcodex1')
    expect(choice.kind).toBe('all-out')
    expect(choice.note).toBe('Every Codex login is at its limit and none says when it resets; starting on work-example.')
  })

  test("when no login routing may use is signed in, is the machine's own login, with a note", () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus(OWN_CODEX, { alias: 'me-example', routing: false }),
      loginStatus('workcodex1', { signedIn: false })
    ]), NOW)
    expect(choice.login).toBe(OWN_CODEX)
    expect(choice.kind).toBe('none-signed-in')
    expect(choice.note).toBe("No Codex login that routing may use is signed in; starting on me-example, this machine's own Codex sign-in.")
  })

  test('a window whose reset has passed counts as empty again', () => {
    const choice = chooseCodexLogin(statusAnswer([
      loginStatus(OWN_CODEX, { routing: false }),
      loginStatus('workcodex1', { usage: codexUsage('workcodex1', { weekly: 100, weeklyResetsAt: at(-MINUTE), fetchedAt: NOW - HOUR }) })
    ]), NOW)
    expect(choice).toEqual({ login: 'workcodex1', kind: 'ranked', note: null })
  })
})

describe('why a Codex login would be passed over', () => {
  test('is the same rule the choice applies', () => {
    const status = statusAnswer([
      loginStatus(OWN_CODEX, { routing: false }),
      loginStatus('workcodex1', { weeklyLimit: 50, usage: codexUsage('workcodex1', { weekly: 60, weeklyResetsAt: at(HOUR), fetchedAt: NOW }) }),
      loginStatus('sparecodex')
    ])
    expect(codexRouteBlock(status, OWN_CODEX, NOW)).toEqual({ kind: 'auto-route-off' })
    expect(codexRouteBlock(status, 'workcodex1', NOW)).toEqual({
      kind: 'over-limit', utilization: 60, limitPercent: 50, window: 'Codex 7d', resetsAt: at(HOUR)
    })
    expect(codexRouteBlock(status, 'sparecodex', NOW)).toBeNull()
    expect(codexRouteBlock(status, 'othercodex', NOW)).toBeNull()
  })
})

describe('whether Codex usage needs a probe first', () => {
  test('a snapshot is old after the probe interval and its slack', () => {
    expect(codexUsageStale({ usage: null }, NOW)).toBe(true)
    expect(codexUsageStale({ usage: codexUsage('workcodex1', { fetchedAt: NOW - CODEX_USAGE_MAX_AGE_MS }) }, NOW)).toBe(false)
    expect(codexUsageStale({ usage: codexUsage('workcodex1', { fetchedAt: NOW - CODEX_USAGE_MAX_AGE_MS - 1 }) }, NOW)).toBe(true)
    expect(codexUsageStale({ usage: codexUsage('workcodex1', { fetchedAt: NOW + HOUR }) }, NOW)).toBe(false)
  })

  test('only logins in the running with missing or old usage are probed', () => {
    const status = statusAnswer([
      loginStatus(OWN_CLAUDE),
      loginStatus(OWN_CODEX, { usage: codexUsage(OWN_CODEX, { fetchedAt: NOW - MINUTE }) }),
      loginStatus('workcodex1'),
      loginStatus('oldcodex', { usage: codexUsage('oldcodex', { fetchedAt: NOW - HOUR }) }),
      loginStatus('offcodex', { routing: false }),
      loginStatus('gonecodex', { signedIn: false }),
      loginStatus('uncheckedcodex', { signedIn: null })
    ])
    expect(codexLoginsToProbe(status, NOW)).toEqual(['workcodex1', 'oldcodex', 'uncheckedcodex'])
  })

  test('nothing is probed when one login or none is in the running, since usage cannot change the choice', () => {
    expect(codexLoginsToProbe(statusAnswer([loginStatus(OWN_CODEX)]), NOW)).toEqual([])
    expect(codexLoginsToProbe(statusAnswer([
      loginStatus(OWN_CODEX),
      loginStatus('workcodex1', { routing: false })
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
