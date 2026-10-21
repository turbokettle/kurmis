// The routing rules: reading the rate-limit headers, which logins may serve a session and in
// what order, what a refusal means, and when the pool is back.
import { describe, expect, test } from 'vitest'
import {
  accountsInScope, autoStartLogin, chooseAccount, effectivePin, eligible, explainRouting,
  isDefinitiveQuotaRejection, parseUnifiedHeaders, poolReadyAt, quotaCooldownUntil, replayDecision, routeBlock,
  TOKEN_MARGIN_MS, tokenIsFresh, usageFromUnifiedHeaders, worstUtilisation,
  type HeaderGetter, type ReplayInput, type RouteAccount, type RouteSession
} from '../../src/core/account-router.ts'
import { emptyAccountUsage } from '../../src/core/usage.ts'
import type { AccountUsage } from '../../src/core/claude-usage.ts'

const NOW = 1_789_560_000_000
const RESET = NOW + 60 * 60_000
const LATER = RESET + 60 * 60_000
const iso = (at: number): string => new Date(at).toISOString()
const headers = (values: Record<string, string | undefined> = {}): HeaderGetter =>
  (name) => values[name.replace('anthropic-ratelimit-unified-', '')]

function usage(percent: number, resetsAt: string | null = iso(RESET)): AccountUsage {
  return { ...emptyAccountUsage('claude:home', NOW), fiveHour: { utilization: percent, resetsAt } }
}

/** A snapshot with both plan windows, which is what the ranking rule reads. */
function windows(fiveHour: [number, string | null], sevenDay: [number, string | null]): AccountUsage {
  return {
    ...emptyAccountUsage('claude:home', NOW),
    fiveHour: { utilization: fiveHour[0], resetsAt: fiveHour[1] },
    sevenDay: { utilization: sevenDay[0], resetsAt: sevenDay[1] }
  }
}

function account(id = 'claude:home', patch: Partial<RouteAccount> = {}): RouteAccount {
  return {
    id, loggedIn: true, credentialsReadable: true, tokenExpiresAt: null,
    usage: usage(20), autoRoute: true, fiveHourLimitPercent: 90, weeklyLimitPercent: 90,
    useFirst: false, cooldownUntil: null, ...patch
  }
}

/** Both of a login's routing limits set to one number, which is what these cases mean. */
function limits(percent: number): Pick<RouteAccount, 'fiveHourLimitPercent' | 'weeklyLimitPercent'> {
  return { fiveHourLimitPercent: percent, weeklyLimitPercent: percent }
}

const session: RouteSession = { homeAccountId: 'claude:home', currentAccountId: 'claude:home' }

function reply(patch: Partial<ReplayInput> = {}): ReplayInput {
  return { status: 429, get: headers({ status: 'rejected', reset: String(RESET / 1000) }),
    servedBy: 'claude:other', session, attempted: new Set(['claude:other']), ...patch }
}

describe('unified response headers', () => {
  test('missing headers are unknown and name no windows', () => {
    const observed = parseUnifiedHeaders(() => null, NOW)
    expect(observed).toEqual({ observedAt: NOW, status: null, resetsAt: null,
      representativeClaim: null, windows: {}, overageStatus: null, overageDisabledReason: null })
    expect(usageFromUnifiedHeaders('claude:home', null, observed)).toEqual({
      ...emptyAccountUsage('claude:home', NOW), source: 'session'
    })
  })

  test('reads all four windows and keeps their individual statuses', () => {
    const observed = parseUnifiedHeaders(headers({
      status: 'allowed_warning', reset: String(RESET / 1000), 'representative-claim': '7d_oi',
      '5h-utilization': '0', '5h-reset': String(RESET / 1000), '5h-status': 'allowed',
      '7d-utilization': '0.512', '7d-status': 'allowed_warning',
      '7d_oi-utilization': '1', '7d_oi-status': 'rejected',
      'overage-utilization': '0.25', 'overage-reset': String(LATER / 1000),
      'overage-status': 'rejected', 'overage-disabled-reason': 'out_of_credits'
    }), NOW)
    expect(observed).toEqual({
      observedAt: NOW, status: 'allowed_warning', resetsAt: iso(RESET), representativeClaim: '7d_oi',
      overageStatus: 'rejected', overageDisabledReason: 'out_of_credits',
      windows: {
        '5h': { utilization: 0, resetsAt: iso(RESET), status: 'allowed' },
        '7d': { utilization: 0.512, resetsAt: null, status: 'allowed_warning' },
        '7d_oi': { utilization: 1, resetsAt: null, status: 'rejected' },
        overage: { utilization: 0.25, resetsAt: iso(LATER), status: 'rejected' }
      }
    })
    const folded = usageFromUnifiedHeaders('claude:home', null, observed)
    expect(folded).toMatchObject({ source: 'session', fetchedAt: NOW, rateLimitsAvailable: true,
      fiveHour: { utilization: 0, resetsAt: iso(RESET) },
      sevenDay: { utilization: 51.2, resetsAt: null },
      sevenDayOverage: { utilization: 100, resetsAt: null },
      limited: { window: 'seven_day_overage_included', utilization: 100, threshold: null, resetsAt: iso(RESET) }
    })
    expect(folded.extraUsage).toBeNull()
  })

  test.each(['', ' ', 'NaN', 'Infinity', '-0.1', '1.1', 'nonsense'])('rejects invalid fractions: %j', (value) => {
    expect(parseUnifiedHeaders(headers({ '5h-utilization': value }), NOW).windows['5h']?.utilization).toBeNull()
  })

  test.each(['', '0', '-1', 'Infinity', '1e100', 'nonsense'])('rejects invalid resets: %j', (reset) => {
    expect(parseUnifiedHeaders(headers({ reset, '5h-reset': reset }), NOW)).toMatchObject({
      resetsAt: null, windows: { '5h': { resetsAt: null, utilization: null, status: null } }
    })
  })

  test('unknown statuses and header names do not invent observations', () => {
    expect(parseUnifiedHeaders(headers({ status: 'new_status', '5h-status': 'new_status',
      '30d-utilization': '0.7' }), NOW)).toMatchObject({ status: null,
      windows: { '5h': { status: null, resetsAt: null, utilization: null } } })
    expect(parseUnifiedHeaders(headers({ '30d-utilization': '0.7' }), NOW).windows).toEqual({})
  })

  test('a sparse reply changes only measured windows and keeps probe details', () => {
    const before: AccountUsage = { ...usage(20), sevenDay: { utilization: 70, resetsAt: iso(LATER) },
      sevenDayOpus: { utilization: 99, resetsAt: null }, subscriptionType: 'max',
      extraUsage: { isEnabled: true, monthlyLimit: 10, usedCredits: 2, utilization: 20, currency: 'USD' },
      error: 'probe failed' }
    const observed = parseUnifiedHeaders(headers({ '5h-utilization': '0.333', '7d-reset': String(LATER / 1000) }), NOW)
    const folded = usageFromUnifiedHeaders('claude:home', before, observed)
    expect(folded).toEqual({ ...before, source: 'session', rateLimitsAvailable: true, error: null,
      fiveHour: { utilization: 33.3, resetsAt: null } })
    expect(before.fiveHour?.utilization).toBe(20)
  })

  test.each(['5h', 'five_hour'])('retains a named rejection without a percentage: %s', (claim) => {
    const observed = parseUnifiedHeaders(headers({ status: 'rejected', 'representative-claim': claim,
      '5h-reset': String(RESET / 1000) }), NOW)
    const folded = usageFromUnifiedHeaders('claude:home', null, observed)
    expect(folded.fiveHour).toBeNull()
    expect(folded.limited).toEqual({ window: 'five_hour', utilization: null, threshold: null, resetsAt: iso(RESET) })
  })

  test('an unfamiliar representative claim is preserved', () => {
    const observed = parseUnifiedHeaders(headers({ status: 'rejected', 'representative-claim': 'future_window',
      reset: String(RESET / 1000) }), NOW)
    expect(usageFromUnifiedHeaders('claude:home', null, observed).limited).toEqual({
      window: 'future_window', utilization: null, threshold: null, resetsAt: iso(RESET)
    })
  })

  test('overage has its own limited window and never replaces the seven-day combined window', () => {
    const observed = parseUnifiedHeaders(headers({ 'representative-claim': 'overage',
      'overage-utilization': '0.9', 'overage-reset': String(RESET / 1000) }), NOW)
    const folded = usageFromUnifiedHeaders('claude:home', null, observed)
    expect(folded.sevenDayOverage).toBeNull()
    expect(folded.limited).toEqual({ window: 'overage', utilization: 90, threshold: null, resetsAt: iso(RESET) })
  })
})

describe('Auto eligibility and choice', () => {
  const choose = (accounts: RouteAccount[], route = session, excluded: string[] = []): string | null =>
    chooseAccount(route, accounts, NOW, new Set(excluded))?.id ?? null

  test.each<Partial<RouteAccount>>([
    { autoRoute: false }, { loggedIn: false }, { credentialsReadable: false },
    { cooldownUntil: RESET }, { tokenExpiresAt: NOW + 100 }, { usage: usage(90) },
    { usage: usage(50), ...limits(50) }
  ])('excludes %j from Auto', (patch) => expect(eligible(account('claude:home', patch), NOW)).toBe(false))

  test('readmits immediately below the limit and accepts unknown usage', () => {
    expect(eligible(account('claude:home', { usage: usage(89.9) }), NOW)).toBe(true)
    expect(eligible(account('claude:home', { usage: null }), NOW)).toBe(true)
    expect(eligible(account('claude:home', { cooldownUntil: NOW }), NOW)).toBe(true)
  })

  test('orders by the seven-day reset before any tie-break', () => {
    const sooner = account('claude:sooner', { usage: windows([10, iso(LATER)], [50, iso(RESET)]) })
    const later = account('claude:later', { usage: windows([10, iso(RESET)], [20, iso(LATER)]) })
    // The five-hour resets run the other way round and have no say in the order.
    expect(choose([later, sooner])).toBe('claude:sooner')
    expect(choose([sooner, later])).toBe('claude:sooner')
  })

  test('a login with no known weekly reset is taken last', () => {
    const later = account('claude:later', { usage: windows([80, iso(LATER)], [20, iso(LATER)]) })
    expect(choose([account('claude:unknown', { usage: usage(1, iso(NOW + 1)) }), later])).toBe('claude:later')
    expect(choose([account('claude:unknown', { usage: windows([1, iso(RESET)], [1, null]) }), later])).toBe('claude:later')
    expect(choose([account('claude:unknown', { usage: windows([1, iso(RESET)], [1, 'invalid']) }), later])).toBe('claude:later')
  })

  test('a login marked use first is taken ahead of a sooner weekly reset', () => {
    const sooner = account('claude:sooner', { usage: windows([10, iso(RESET)], [50, iso(RESET)]) })
    const marked = account('claude:marked', { useFirst: true, usage: windows([10, iso(RESET)], [20, iso(LATER)]) })
    expect(choose([sooner, marked])).toBe('claude:marked')
    expect(choose([marked, sooner])).toBe('claude:marked')
    // The mark is not a way past a limit: over one of its own the login is skipped.
    const over = account('claude:marked', { useFirst: true, usage: windows([95, iso(RESET)], [20, iso(LATER)]) })
    expect(eligible(over, NOW)).toBe(false)
    expect(choose([sooner, over])).toBe('claude:sooner')
  })

  test('two logins marked use first go in order of their weekly reset', () => {
    const first = account('claude:first', { useFirst: true, usage: windows([10, iso(RESET)], [20, iso(LATER)]) })
    const second = account('claude:second', { useFirst: true, usage: windows([10, iso(LATER)], [20, iso(RESET)]) })
    expect(choose([first, second])).toBe('claude:second')
    expect(choose([second, first])).toBe('claude:second')
  })

  describe('a session stays on the login that served it', () => {
    // Anthropic keeps the prompt cache per login, so a move costs the whole conversation
    // written to the cache again.
    const sooner = (patch: Partial<RouteAccount> = {}): RouteAccount =>
      account('claude:sooner', { usage: windows([10, iso(RESET)], [50, iso(RESET)]), ...patch })
    const serving = (patch: Partial<RouteAccount> = {}): RouteAccount =>
      account('claude:serving', { usage: windows([10, iso(RESET)], [20, iso(LATER)]), ...patch })
    const onServing: RouteSession = { homeAccountId: 'claude:home', currentAccountId: 'claude:serving' }

    test('while it can serve, though another login resets its week sooner', () => {
      expect(choose([sooner(), serving()], onServing)).toBe('claude:serving')
      expect(choose([serving(), sooner()], onServing)).toBe('claude:serving')
      // A session that has not been served yet is placed by the weekly reset.
      expect(choose([serving(), sooner()], { ...onServing, currentAccountId: null })).toBe('claude:sooner')
    })

    test('when its week has just reset and every other login now resets sooner', () => {
      const reset = serving({ usage: windows([0, iso(LATER + 5 * 3_600_000)], [0, iso(LATER + 7 * 86_400_000)]) })
      expect(choose([sooner(), reset], onServing)).toBe('claude:serving')
    })

    test.each<[string, Partial<RouteAccount>]>([
      ['over its five-hour limit', { usage: windows([95, iso(RESET)], [20, iso(LATER)]) }],
      ['over its weekly limit', { usage: windows([10, iso(RESET)], [95, iso(LATER)]) }],
      ['cooling down after a refusal', { cooldownUntil: RESET }],
      ['signed out', { loggedIn: false }],
      ['unreadable', { credentialsReadable: false }],
      ['taken out of Auto', { autoRoute: false }]
    ])('until it is %s', (_what, patch) => {
      expect(choose([sooner(), serving(patch)], onServing)).toBe('claude:sooner')
    })

    test('until a request is refused on it and replayed', () => {
      expect(choose([sooner(), serving()], onServing, ['claude:serving'])).toBe('claude:sooner')
    })

    test('until a login marked use first can serve', () => {
      expect(choose([sooner({ useFirst: true }), serving()], onServing)).toBe('claude:sooner')
      // Over one of its limits the mark does not count, and the session stays.
      expect(choose([sooner({ useFirst: true, usage: windows([95, iso(RESET)], [50, iso(RESET)]) }), serving()],
        onServing)).toBe('claude:serving')
    })

    test('on a login marked use first, though another marked one resets its week sooner', () => {
      expect(choose([sooner({ useFirst: true }), serving({ useFirst: true })], onServing)).toBe('claude:serving')
    })

    test('and the explanation names it as serving next', () => {
      expect(explainRouting(onServing, [sooner(), serving()], NOW).map((row) => [row.accountId, row.next]))
        .toEqual([['claude:serving', true], ['claude:sooner', false]])
    })
  })

  test('a login over its five-hour limit is skipped though its week resets soonest', () => {
    const busy = account('claude:busy', { usage: windows([95, iso(RESET)], [10, iso(RESET)]) })
    const rest = account('claude:rest', { usage: windows([10, iso(RESET)], [10, iso(LATER)]) })
    expect(routeBlock(busy, NOW)?.kind).toBe('over-limit')
    expect(choose([busy, rest])).toBe('claude:rest')
  })

  test('ties favour the last serving login, then home, then lowest utilisation', () => {
    expect(choose([account('claude:home'), account('claude:other', { usage: usage(80) })], { ...session, currentAccountId: 'claude:other' })).toBe('claude:other')
    expect(choose([account('claude:other', { usage: usage(1) }), account('claude:home')], { ...session, currentAccountId: null })).toBe('claude:home')
    expect(choose([account('claude:a'), account('claude:b', { usage: usage(10) })])).toBe('claude:b')
    expect(choose([account('claude:home'), account('claude:other')], session, ['claude:home'])).toBe('claude:other')
    expect(choose([])).toBeNull()
  })

  test('with no login opted in, Auto runs on the default login as if pinned to it', () => {
    const none = { autoRoute: false }
    const fallback = account('claude:default', { ...none, usage: usage(100), cooldownUntil: Infinity })
    expect(effectivePin(session, [account('claude:home', none), fallback])).toBe('claude:default')
    expect(effectivePin(session, [account('claude:home'), fallback])).toBeNull()
    expect(effectivePin({ ...session, pinnedAccountId: 'claude:home' }, [account('claude:home'), fallback])).toBe('claude:home')
    expect(choose([account('claude:home', none), fallback])).toBe('claude:default')
    expect(choose([account('claude:home', none), { ...fallback, loggedIn: false }])).toBeNull()
    expect(choose([account('claude:home', none)])).toBeNull()
    // The fallback is measured like a pin: the default's own windows at 100%, not its limits.
    expect(poolReadyAt([account('claude:home', none), fallback], NOW)).toBeNull()
    expect(poolReadyAt([account('claude:home', none), account('claude:default', { ...none, usage: usage(100) })], NOW)).toBe(RESET)
    expect(poolReadyAt([account('claude:home', none), account('claude:default', { ...none, usage: usage(95) })], NOW)).toBe(NOW)
  })

  test.each(['claude:home', 'claude:default'])('a pin to %s ignores Auto controls, usage and cooldown', (id) => {
    const pinned = { ...session, pinnedAccountId: id }
    const row = account(id, { autoRoute: false, ...limits(1), usage: usage(100), cooldownUntil: Infinity })
    expect(choose([account('claude:other'), row], pinned)).toBe(id)
    expect(choose([account('claude:other')], pinned)).toBeNull()
    expect(choose([row], pinned, [id])).toBeNull()
  })

  test('only plan windows affect the limit', () => {
    const snapshot: AccountUsage = { ...usage(20), sevenDay: { utilization: 70, resetsAt: null },
      sevenDayOpus: { utilization: 100, resetsAt: null }, sevenDayOverage: { utilization: 95, resetsAt: null } }
    expect(worstUtilisation(snapshot)).toBe(70)
    snapshot.extraUsage = { isEnabled: true, monthlyLimit: null, usedCredits: null, utilization: null, currency: null }
    expect(worstUtilisation(snapshot)).toBe(95)
    expect(eligible(account('claude:home', { usage: snapshot }), NOW)).toBe(false)
  })
})

describe('replay decisions', () => {
  test.each([
    { status: 'rejected' }, { 'representative-claim': 'five_hour' }, { 'overage-status': 'rejected' },
    { 'overage-status': '' }, { 'representative-claim': '' }
  ])('a quota 429 is definitive with %j', (values) => {
    const get = headers(values)
    expect(isDefinitiveQuotaRejection(429, get)).toBe(true)
    expect(replayDecision(reply({ get }))).toEqual({ kind: 'replay', reason: 'quota', cooldownUntil: Infinity })
    expect(isDefinitiveQuotaRejection(503, get)).toBe(false)
  })

  test.each([{}, { status: 'allowed' }, { status: 'allowed_warning' }, { status: 'unknown' },
    { reset: String(RESET / 1000) }, { '5h-utilization': '1' }
  ])('other 429s pass through with %j', (values) => {
    const get = headers(values)
    expect(isDefinitiveQuotaRejection(429, get)).toBe(false)
    expect(replayDecision(reply({ get }))).toEqual({ kind: 'pass' })
  })

  test.each([0, 200, 401, 403, 408, 500, 502, 503])('status %i passes through despite quota headers', (status) => {
    expect(replayDecision(reply({ status }))).toEqual({ kind: 'pass' })
  })

  test('quota cooldown uses the global reset, then the representative window reset', () => {
    expect(replayDecision(reply())).toEqual({ kind: 'replay', reason: 'quota', cooldownUntil: RESET })
    expect(replayDecision(reply({ get: headers({ 'representative-claim': 'five_hour', '5h-reset': String(RESET / 1000) }) })))
      .toEqual({ kind: 'replay', reason: 'quota', cooldownUntil: RESET })
  })

  test('400 pins back only to an untried previous serving account', () => {
    expect(replayDecision(reply({ status: 400 }))).toEqual({ kind: 'pin-back', to: 'claude:home' })
    expect(replayDecision(reply({ status: 400, servedBy: 'claude:home' }))).toEqual({ kind: 'pass' })
    expect(replayDecision(reply({ status: 400, attempted: new Set(['claude:other', 'claude:home']) }))).toEqual({ kind: 'pass' })
    expect(replayDecision(reply({ status: 400, session: { ...session, currentAccountId: null } }))).toEqual({ kind: 'pass' })
  })

  test('falls back to all rejected window resets, including overage', () => {
    const get = headers({ status: 'rejected', '5h-status': 'rejected', '5h-reset': String(RESET / 1000),
      'overage-status': 'rejected', 'overage-reset': String(LATER / 1000) })
    expect(replayDecision(reply({ get }))).toEqual({ kind: 'replay', reason: 'quota', cooldownUntil: LATER })
    expect(replayDecision(reply({ get: headers({ status: 'rejected', '5h-reset': String(RESET / 1000) }) })))
      .toEqual({ kind: 'replay', reason: 'quota', cooldownUntil: Infinity })
  })

  test.each([400, 429])('never replays status %i after streaming starts or the deadline expires', (status) => {
    expect(replayDecision(reply({ status, responseStarted: true }))).toEqual({ kind: 'pass' })
    expect(replayDecision(reply({ status, deadlineExpired: true }))).toEqual({ kind: 'pass' })
  })

  test('a pinned session passes its quota rejection back to the CLI', () => {
    expect(replayDecision(reply({ session: { ...session, pinnedAccountId: 'claude:home' } }))).toEqual({ kind: 'pass' })
  })
})

describe('pool recovery', () => {
  test('returns now if any login is ready, otherwise the earliest cooldown', () => {
    expect(poolReadyAt([account('claude:home', { cooldownUntil: RESET }), account('claude:other')], NOW)).toBe(NOW)
    expect(poolReadyAt([account('claude:home', { cooldownUntil: LATER }), account('claude:other', { cooldownUntil: RESET })], NOW)).toBe(RESET)
  })

  test('waits for every blocking window and cooldown on one login, then takes the earliest login', () => {
    const blocked = account('claude:home', { usage: { ...usage(95), sevenDay: { utilization: 92, resetsAt: iso(LATER) } } })
    expect(poolReadyAt([blocked], NOW)).toBe(LATER)
    expect(poolReadyAt([blocked, account('claude:other', { cooldownUntil: RESET })], NOW)).toBe(RESET)
    expect(poolReadyAt([{ ...blocked, cooldownUntil: LATER + 1 }], NOW)).toBe(LATER + 1)
  })

  test.each<Partial<RouteAccount>>([
    { loggedIn: false, cooldownUntil: RESET }, { credentialsReadable: false, cooldownUntil: RESET },
    { cooldownUntil: Infinity }, { usage: usage(95, null) }, { usage: usage(95, 'invalid') }
  ])('cannot predict readiness with %j', (patch) => {
    expect(poolReadyAt([account('claude:home', patch)], NOW)).toBeNull()
    expect(poolReadyAt([account('claude:home', patch), account('claude:other', { cooldownUntil: RESET })], NOW)).toBe(RESET)
  })

  // Three logins on Auto, all over their limits, with every access token expiring before its
  // login's reset. Counting those logins out would answer null, as if no reset were known.
  test('an access token that expires before the reset does not hide the reset, because the proxy renews it', () => {
    const tokenGone = NOW + 30 * 60_000
    const fiveHourOut = account('claude:work', { usage: usage(95, iso(RESET)), ...limits(95), tokenExpiresAt: tokenGone })
    const weekOut = account('claude:work', {
      usage: windows([0, null], [100, iso(LATER)]), tokenExpiresAt: tokenGone
    })
    expect(poolReadyAt([fiveHourOut, weekOut], NOW)).toBe(RESET)
    expect(poolReadyAt([weekOut], NOW)).toBe(LATER)
    // A login with room is ready now, even with its token minutes from expiry.
    expect(poolReadyAt([account('claude:home', { tokenExpiresAt: NOW + 100 })], NOW)).toBe(NOW)
    expect(poolReadyAt([fiveHourOut], NOW, 'claude:work')).toBe(NOW)
  })

  test('one unknown blocking reset makes that login unknown', () => {
    expect(poolReadyAt([account('claude:home', { usage: { ...usage(95, null), sevenDay: { utilization: 98, resetsAt: iso(LATER) } } })], NOW)).toBeNull()
    expect(poolReadyAt([], NOW)).toBeNull()
  })

  test('uses opted-in logins for Auto and only the pinned login for a pin', () => {
    const disabled = account('claude:home', { autoRoute: false, usage: usage(100) })
    expect(poolReadyAt([disabled], NOW)).toBeNull()
    expect(poolReadyAt([disabled, account('claude:other')], NOW, 'claude:home')).toBe(RESET)
    expect(poolReadyAt([account('claude:home', { autoRoute: false, usage: usage(95) })], NOW, 'claude:home')).toBe(NOW)
    expect(poolReadyAt([account('claude:home', { usage: usage(4), ...limits(4) })], NOW)).toBe(RESET)
  })
})

describe('a request that runs into a usage limit', () => {
  const MUCH_LATER = LATER + 60 * 60_000

  test('goes to another opted-in login that still has room', () => {
    // The login serving the request is refused, which puts it on cooldown until its own
    // reset and sends the same request to the next opted-in login.
    const decision = replayDecision(reply({ servedBy: 'claude:home', attempted: new Set(['claude:home']) }))
    expect(decision).toEqual({ kind: 'replay', reason: 'quota', cooldownUntil: RESET })
    const pool = [account('claude:home', { cooldownUntil: RESET, usage: usage(100) }), account('claude:other')]
    expect(chooseAccount(session, pool, NOW, new Set(['claude:home']))?.id).toBe('claude:other')
    // The pool is ready now.
    expect(poolReadyAt(pool, NOW)).toBe(NOW)
  })

  test('is back at the nearest reset in the pool once every opted-in login is spent', () => {
    // The login that refused the request recovers last; the pool is back when the first of
    // the others is, not at that login's own reset.
    const spent = [
      account('claude:home', { usage: usage(100, iso(MUCH_LATER)) }),
      account('claude:second', { usage: usage(100, iso(LATER)) }),
      account('third', { usage: usage(100, iso(RESET)) })
    ]
    expect(chooseAccount(session, spent, NOW, new Set())).toBeNull()
    expect(poolReadyAt(spent, NOW)).toBe(RESET)
  })

})

describe('a pool where every login is under its limits', () => {
  // Three Claude logins. Nothing here is out of usage: the busiest window is the default
  // login's seven-day at 79%, under the 90% each row allows.
  const threeLogins = (patch: Partial<RouteAccount> = {}): RouteAccount[] => [
    account('claude:default', { ...limits(90), usage: {
      ...emptyAccountUsage('claude:default', NOW), status: 'allowed_warning',
      fiveHour: { utilization: 47, resetsAt: iso(RESET) },
      sevenDay: { utilization: 79, resetsAt: iso(LATER) },
      limited: { window: 'seven_day', utilization: 79, threshold: 75, resetsAt: iso(LATER) }
    }, ...patch }),
    account('claude:personal', { ...limits(90), usage: {
      ...emptyAccountUsage('claude:personal', NOW),
      fiveHour: { utilization: 6, resetsAt: iso(RESET) },
      sevenDay: { utilization: 64, resetsAt: iso(RESET) }
    }, ...patch }),
    account('claude:side', { ...limits(90), usage: {
      ...emptyAccountUsage('claude:side', NOW),
      fiveHour: { utilization: 0, resetsAt: iso(RESET) },
      sevenDay: { utilization: 92, resetsAt: iso(LATER) }
    }, ...patch })
  ]

  const auto: RouteSession = { homeAccountId: 'claude:default', currentAccountId: null, pinnedAccountId: null }

  test('a login over the warning threshold but under its limit is not exhausted', () => {
    // `limited` says the seven-day window passed Anthropic's 75% warning threshold, and
    // `allowed_warning` is what the API said. Neither is a refusal.
    const [fallback] = threeLogins()
    expect(eligible(fallback!, NOW)).toBe(true)
    expect(chooseAccount(auto, threeLogins(), NOW, new Set())?.id).toBe('claude:personal')
    expect(accountsInScope(auto, threeLogins()).map((row) => row.id)).toEqual(['claude:default', 'claude:personal', 'claude:side'])
  })

  test('a login with no usage reading yet is usable, not exhausted', () => {
    // A login added while sessions run has no usage reading until the first probe lands.
    // Nothing known about it means nothing used, not everything used.
    const fresh = account('claude:fresh', { usage: null })
    expect(worstUtilisation(null)).toBeNull()
    expect(eligible(fresh, NOW)).toBe(true)
    expect(poolReadyAt([fresh], NOW)).toBe(NOW)
    expect(chooseAccount(auto, [fresh], NOW, new Set())?.id).toBe('claude:fresh')
  })

  test('with nobody opted in an Auto session runs on the default login', () => {
    const none = threeLogins({ autoRoute: false })
    expect(effectivePin(auto, none)).toBe('claude:default')
    expect(chooseAccount(auto, none, NOW, new Set())?.id).toBe('claude:default')
    expect(accountsInScope(auto, none).map((row) => row.id)).toEqual(['claude:default'])
    expect(poolReadyAt(none, NOW)).toBe(NOW)
  })

  test('a pool whose tokens cannot be read has an empty scope, which is not a usage limit', () => {
    // Nothing in it could have served the request whatever its usage said.
    const unreadable = threeLogins({ credentialsReadable: false })
    expect(chooseAccount(auto, unreadable, NOW, new Set())).toBeNull()
    expect(poolReadyAt(unreadable, NOW)).toBeNull()
    expect(accountsInScope(auto, unreadable)).toEqual([])
    // The same with nobody opted in.
    const pinned = threeLogins({ credentialsReadable: false, autoRoute: false })
    expect(chooseAccount(auto, pinned, NOW, new Set())).toBeNull()
    expect(accountsInScope(auto, pinned)).toEqual([])
    // A session pinned to one login is refused the same way, and for the same reason.
    const held: RouteSession = { homeAccountId: 'claude:personal', currentAccountId: null, pinnedAccountId: 'claude:personal' }
    expect(accountsInScope(held, unreadable)).toEqual([])
    expect(accountsInScope(held, threeLogins())).toHaveLength(1)
  })
})

describe('a window whose reset time has passed', () => {
  // An Auto pool whose own login has its five-hour window full, and two other logins whose
  // last readings were taken more than six hours earlier: a weekly window at 95% and one at
  // 100%, both of which have reset since.
  const at = Date.parse('2030-03-12T21:50:54Z')
  const readAt = Date.parse('2030-03-12T15:09:04Z')
  const pool = (): RouteAccount[] => [
    account('claude:default', { ...limits(100), usage: {
      ...emptyAccountUsage('claude:default', at), status: 'rejected',
      fiveHour: { utilization: 100, resetsAt: '2030-03-12T23:30:00.000+00:00' },
      sevenDay: { utilization: 71, resetsAt: '2030-03-17T18:00:00.000+00:00' },
      limited: { window: 'five_hour', utilization: 100, threshold: null, resetsAt: '2030-03-12T23:30:00.000+00:00' }
    } }),
    account('claude:work', { fiveHourLimitPercent: 100, weeklyLimitPercent: 60, usage: {
      ...emptyAccountUsage('claude:work', readAt),
      fiveHour: { utilization: 2, resetsAt: '2030-03-12T16:59:59.000+00:00' },
      sevenDay: { utilization: 95, resetsAt: '2030-03-12T19:59:59.000+00:00' }
    } }),
    account('claude:team', { ...limits(100), usage: {
      ...emptyAccountUsage('claude:team', readAt), status: 'allowed_warning',
      fiveHour: { utilization: 0, resetsAt: null },
      sevenDay: { utilization: 100, resetsAt: '2030-03-12T20:59:59.000+00:00' },
      limited: { window: 'seven_day', utilization: 100, threshold: null, resetsAt: '2030-03-12T20:59:59.000+00:00' }
    } }),
    account('claude:spare', { ...limits(100), autoRoute: false, usage: null })
  ]
  const auto: RouteSession = { homeAccountId: 'claude:default', currentAccountId: null, pinnedAccountId: null }

  test('counts as empty, so a login whose week has turned over is back in the pool', () => {
    expect(routeBlock(pool()[1]!, at)).toBeNull()
    expect(routeBlock(pool()[2]!, at)).toBeNull()
    expect(routeBlock(pool()[0]!, at)).toMatchObject({ kind: 'over-limit', window: '5 hour' })
    const chosen = chooseAccount(auto, pool(), at, new Set())
    expect(chosen).not.toBeNull()
    expect(['claude:work', 'claude:team']).toContain(chosen!.id)
  })

  test('leaves the pool ready now rather than waiting for the full login to reset', () => {
    expect(poolReadyAt(pool(), at)).toBe(at)
    // With the two other logins gone, the wait is for the one login that is full.
    const own = pool().filter((row) => row.id === 'claude:default')
    expect(poolReadyAt(own, at)).toBe(Date.parse('2030-03-12T23:30:00.000+00:00'))
  })

  test('is reported as able to serve, so the explanation matches the choice', () => {
    const rows = explainRouting(auto, pool(), at)
    expect(rows.find((row) => row.next)?.accountId).toBe(chooseAccount(auto, pool(), at, new Set())?.id)
    expect(rows.filter((row) => row.block === null).map((row) => row.accountId).sort()).toEqual(['claude:team', 'claude:work'])
    expect(rows.find((row) => row.accountId === 'claude:team')?.busiest?.utilization).toBe(0)
  })

  test('a reset exactly now has passed', () => {
    expect(poolReadyAt([account('claude:home', { usage: usage(95, iso(NOW)) })], NOW)).toBe(NOW)
    expect(eligible(account('claude:home', { usage: usage(95, iso(NOW)) }), NOW)).toBe(true)
  })
})

describe('why a login was or was not chosen', () => {
  test.each([
    ['auto-route-off', { autoRoute: false }],
    ['signed-out', { loggedIn: false }],
    ['no-credentials', { credentialsReadable: false }],
    ['token-expiring', { tokenExpiresAt: NOW + 60_000 }],
    ['cooldown', { cooldownUntil: RESET }],
    ['over-limit', { usage: usage(90) }]
  ] as const)('reports %s, and eligible agrees', (kind, patch) => {
    const row = account('claude:home', patch)
    expect(routeBlock(row, NOW)?.kind).toBe(kind)
    expect(eligible(row, NOW)).toBe(false)
  })

  test('reports nothing for a login that can serve', () => {
    expect(routeBlock(account(), NOW)).toBeNull()
  })

  test('a cooldown with no known reset has no time on it', () => {
    expect(routeBlock(account('claude:home', { cooldownUntil: Infinity }), NOW)).toEqual({ kind: 'cooldown', until: null })
  })

  test('an over-limit block names the window that is full and its own limit', () => {
    expect(routeBlock(account('claude:home', { usage: usage(95), ...limits(75) }), NOW)).toEqual({
      kind: 'over-limit', utilization: 95, limitPercent: 75, window: '5 hour', resetsAt: iso(RESET)
    })
  })

  test('explains the pool in the order it would be taken, skipped logins last', () => {
    const rows = [
      account('claude:full', { usage: usage(99) }),
      account('claude:later', { usage: windows([10, iso(RESET)], [20, iso(LATER)]) }),
      account('claude:sooner', { usage: windows([10, iso(LATER)], [30, iso(RESET)]) }),
      account('claude:off', { autoRoute: false })
    ]
    const explained = explainRouting({ homeAccountId: 'claude:later', currentAccountId: null }, rows, NOW)
    expect(explained.map((row) => [row.accountId, row.next, row.block?.kind ?? null])).toEqual([
      ['claude:sooner', true, null],
      ['claude:later', false, null],
      ['claude:full', false, 'over-limit'],
      ['claude:off', false, 'auto-route-off']
    ])
    expect(explained[0]).toMatchObject({
      useFirst: false,
      busiest: { label: '7 day', utilization: 30, resetsAt: iso(RESET) },
      sevenDayResetsAt: iso(RESET)
    })
  })

  test('the explanation says which login is marked use first and when its week is back', () => {
    const rows = [
      account('claude:sooner', { usage: windows([10, iso(RESET)], [30, iso(RESET)]) }),
      account('claude:marked', { useFirst: true, usage: windows([10, iso(RESET)], [20, iso(LATER)]) }),
      account('claude:fresh', { usage: null })
    ]
    const explained = explainRouting({ homeAccountId: 'claude:sooner', currentAccountId: 'claude:sooner' }, rows, NOW)
    expect(explained.map((row) => [row.accountId, row.useFirst, row.sevenDayResetsAt])).toEqual([
      ['claude:marked', true, iso(LATER)],
      ['claude:sooner', false, iso(RESET)],
      ['claude:fresh', false, null]
    ])
  })

  test('each limit is measured only against its own window', () => {
    // A weekly limit of 75. The five-hour window going over 75 must not take the login out of
    // the pool, since that window comes back within hours.
    const split = { fiveHourLimitPercent: 100, weeklyLimitPercent: 75 }
    const busyFiveHour = account('claude:home', {
      ...split,
      usage: { ...usage(80), sevenDay: { utilization: 40, resetsAt: iso(LATER) } }
    })
    expect(routeBlock(busyFiveHour, NOW)).toBeNull()
    expect(eligible(busyFiveHour, NOW)).toBe(true)

    const busyWeek = account('claude:home', {
      ...split,
      usage: { ...usage(40), sevenDay: { utilization: 80, resetsAt: iso(LATER) } }
    })
    expect(eligible(busyWeek, NOW)).toBe(false)
    expect(routeBlock(busyWeek, NOW)).toEqual({
      kind: 'over-limit', utilization: 80, limitPercent: 75, window: '7 day', resetsAt: iso(LATER)
    })
    // The pool waits for the weekly reset, not the five-hour one it is still under.
    expect(poolReadyAt([busyWeek], NOW)).toBe(LATER)
  })

  test('a pinned session has one login and no choice to explain', () => {
    const rows = [account('claude:home'), account('claude:other', { usage: usage(10, iso(RESET)) })]
    const explained = explainRouting({ homeAccountId: 'claude:home', currentAccountId: 'claude:home', pinnedAccountId: 'claude:home' }, rows, NOW)
    expect(explained).toHaveLength(1)
    expect(explained[0]).toMatchObject({ accountId: 'claude:home', next: true, block: null })
  })
})

// A five-login pool where the session is on a login whose week resets later than another
// login that can serve, and two logins are over a limit.
describe('a five-login pool', () => {
  const at = Date.parse('2030-04-02T17:48:00Z')
  const window = (utilization: number, resetsAt: string): { utilization: number; resetsAt: string } =>
    ({ utilization, resetsAt })
  function login(id: string, fiveHour: [number, string], sevenDay: [number, string],
    patch: Partial<RouteAccount> = {}, status: AccountUsage['status'] = null): RouteAccount {
    return account(id, {
      usage: {
        ...emptyAccountUsage(id, at),
        rateLimitsAvailable: true,
        fiveHour: window(...fiveHour),
        sevenDay: window(...sevenDay),
        status
      },
      ...limits(100),
      ...patch
    })
  }
  const pool = [
    login('claude:alpha', [59, '2030-04-02T19:00:00Z'], [80, '2030-04-07T18:00:00Z']),
    login('claude:work', [94, '2030-04-02T19:50:00Z'], [73, '2030-04-02T20:00:00Z'], limits(75)),
    login('claude:team', [83, '2030-04-02T21:20:00Z'], [100, '2030-04-02T21:00:00Z'], {}, 'rejected'),
    login('claude:bravo', [15, '2030-04-02T22:30:00Z'], [84, '2030-04-03T08:00:00Z']),
    login('claude:charlie', [0, '2030-04-02T20:20:00Z'], [62, '2030-04-05T09:00:00Z'], { autoRoute: false })
  ]
  const session: RouteSession = { homeAccountId: 'claude:alpha', currentAccountId: 'claude:bravo' }

  test('serves the login whose week resets soonest of the two that can serve', () => {
    expect(chooseAccount(session, pool, at, new Set())?.id).toBe('claude:bravo')
  })

  test('names a reason for each login that was passed over', () => {
    expect(explainRouting(session, pool, at).map((row) => [row.accountId, row.block?.kind ?? 'can serve'])).toEqual([
      ['claude:bravo', 'can serve'],
      ['claude:alpha', 'can serve'],
      ['claude:work', 'over-limit'],
      ['claude:team', 'over-limit'],
      ['claude:charlie', 'auto-route-off']
    ])
  })
})

describe('the login an Auto CLI is started on', () => {
  const login = (id: string, loggedIn: boolean, autoRoute: boolean): { id: string; loggedIn: boolean; autoRoute: boolean } =>
    ({ id, loggedIn, autoRoute })

  test('the login of the machine itself while it is signed in, or when the list does not hold it', () => {
    expect(autoStartLogin([login('claude:default', true, false), login('claude:pool', true, true)])).toBe('claude:default')
    expect(autoStartLogin([login('claude:pool', true, true)])).toBe('claude:default')
  })

  test('a signed-in pool login when the login of the machine is signed out, the one that served last first', () => {
    const rows = [login('claude:default', false, false), login('claude:off', true, false), login('claude:out', false, true),
      login('claude:pool-a', true, true), login('claude:pool-b', true, true)]
    expect(autoStartLogin(rows)).toBe('claude:pool-a')
    expect(autoStartLogin(rows, 'claude:pool-b')).toBe('claude:pool-b')
    expect(autoStartLogin(rows, 'claude:off')).toBe('claude:pool-a')
  })

  // A pool with nothing signed in is a sign-in problem with a pool login, so the CLI is not
  // started on the machine's own login, which an Auto session with a pool never runs on.
  test('a pool login when the pool has logins but none is signed in, the one that served last first', () => {
    const rows = [login('claude:default', false, false), login('claude:off', true, false), login('claude:out-a', false, true), login('claude:out-b', false, true)]
    expect(effectivePin({ homeAccountId: 'claude:default', currentAccountId: null }, rows.map((row) => account(row.id, {
      loggedIn: row.loggedIn, autoRoute: row.autoRoute })))).toBeNull()
    expect(autoStartLogin(rows)).toBe('claude:out-a')
    expect(autoStartLogin(rows, 'claude:out-b')).toBe('claude:out-b')
    expect(autoStartLogin(rows, 'claude:off')).toBe('claude:out-a')
  })

  test('the login of the machine when there is no pool, since the router then holds the session to it', () => {
    expect(autoStartLogin([login('claude:default', false, false), login('claude:off', true, false)])).toBe('claude:default')
  })
})

describe('the rules kurmis adds', () => {
  test('a usage-limit refusal of a pinned session still names the cooldown of its login', () => {
    const pinned = reply({ session: { ...session, pinnedAccountId: 'claude:home' } })
    expect(replayDecision(pinned)).toEqual({ kind: 'pass' })
    expect(quotaCooldownUntil(pinned.status, pinned.get)).toBe(RESET)
    expect(quotaCooldownUntil(529, pinned.get)).toBeNull()
    expect(quotaCooldownUntil(429, headers())).toBeNull()
  })

  test('a token is fresh while it is good for more than the margin, or has no known expiry', () => {
    expect(tokenIsFresh(null, NOW)).toBe(true)
    expect(tokenIsFresh(NOW + TOKEN_MARGIN_MS + 1, NOW)).toBe(true)
    expect(tokenIsFresh(NOW + TOKEN_MARGIN_MS, NOW)).toBe(false)
  })

  test('a Codex choice with no login opted in falls back to the Codex default login', () => {
    const codex: RouteSession = { homeAccountId: 'codex:default', currentAccountId: null }
    const rows = [account('codex:default', { autoRoute: false }), account('codex:work', { autoRoute: false })]
    expect(effectivePin(codex, rows)).toBe('codex:default')
    expect(chooseAccount(codex, rows, NOW, new Set())?.id).toBe('codex:default')
    expect(poolReadyAt(rows, NOW, null, 'codex:default')).toBe(NOW)
    expect(chooseAccount(codex, [rows[0]!, account('codex:work')], NOW, new Set())?.id).toBe('codex:work')
  })
})
