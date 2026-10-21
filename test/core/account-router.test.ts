// The routing rules: reading the rate-limit headers, which logins may serve a session and in
// what order, what a refusal means, and when the pool is back.
import { describe, expect, test } from 'vitest'
import {
  accountsInScope, autoStartLogin, chooseAccount, effectivePin, eligible, explainRouting,
  isDefinitiveQuotaRejection, parseUnifiedHeaders, poolReadyAt, quotaCooldownUntil, replayDecision, routeBlock,
  TOKEN_MARGIN_MS, tokenIsFresh, usageFromUnifiedHeaders, worstUtilisation,
  type HeaderGetter, type ReplayInput, type RouteAccount, type RouteSession, type StartableLogin
} from '../../src/core/account-router.ts'
import { emptyAccountUsage } from '../../src/core/usage.ts'
import type { AccountUsage } from '../../src/core/claude-usage.ts'
import { OWN_CLAUDE, OWN_CODEX } from '../logins.ts'

const NOW = 1_789_560_000_000
const RESET = NOW + 60 * 60_000
const LATER = RESET + 60 * 60_000
const iso = (at: number): string => new Date(at).toISOString()
const headers = (values: Record<string, string | undefined> = {}): HeaderGetter =>
  (name) => values[name.replace('anthropic-ratelimit-unified-', '')]

function usage(percent: number, resetsAt: string | null = iso(RESET)): AccountUsage {
  return { ...emptyAccountUsage('homeclaude', NOW), fiveHour: { utilization: percent, resetsAt } }
}

/** A snapshot with both plan windows, which is what the ranking rule reads. */
function windows(fiveHour: [number, string | null], sevenDay: [number, string | null]): AccountUsage {
  return {
    ...emptyAccountUsage('homeclaude', NOW),
    fiveHour: { utilization: fiveHour[0], resetsAt: fiveHour[1] },
    sevenDay: { utilization: sevenDay[0], resetsAt: sevenDay[1] }
  }
}

function account(id = 'homeclaude', patch: Partial<RouteAccount> = {}): RouteAccount {
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

const session: RouteSession = { homeAccountId: 'homeclaude', currentAccountId: 'homeclaude' }

function reply(patch: Partial<ReplayInput> = {}): ReplayInput {
  return { status: 429, get: headers({ status: 'rejected', reset: String(RESET / 1000) }),
    servedBy: 'otherclaude', session, attempted: new Set(['otherclaude']), ...patch }
}

describe('unified response headers', () => {
  test('missing headers are unknown and name no windows', () => {
    const observed = parseUnifiedHeaders(() => null, NOW)
    expect(observed).toEqual({ observedAt: NOW, status: null, resetsAt: null,
      representativeClaim: null, windows: {}, overageStatus: null, overageDisabledReason: null })
    expect(usageFromUnifiedHeaders('homeclaude', null, observed)).toEqual({
      ...emptyAccountUsage('homeclaude', NOW), source: 'session'
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
    const folded = usageFromUnifiedHeaders('homeclaude', null, observed)
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
    const folded = usageFromUnifiedHeaders('homeclaude', before, observed)
    expect(folded).toEqual({ ...before, source: 'session', rateLimitsAvailable: true, error: null,
      fiveHour: { utilization: 33.3, resetsAt: null } })
    expect(before.fiveHour?.utilization).toBe(20)
  })

  test.each(['5h', 'five_hour'])('retains a named rejection without a percentage: %s', (claim) => {
    const observed = parseUnifiedHeaders(headers({ status: 'rejected', 'representative-claim': claim,
      '5h-reset': String(RESET / 1000) }), NOW)
    const folded = usageFromUnifiedHeaders('homeclaude', null, observed)
    expect(folded.fiveHour).toBeNull()
    expect(folded.limited).toEqual({ window: 'five_hour', utilization: null, threshold: null, resetsAt: iso(RESET) })
  })

  test('an unfamiliar representative claim is preserved', () => {
    const observed = parseUnifiedHeaders(headers({ status: 'rejected', 'representative-claim': 'future_window',
      reset: String(RESET / 1000) }), NOW)
    expect(usageFromUnifiedHeaders('homeclaude', null, observed).limited).toEqual({
      window: 'future_window', utilization: null, threshold: null, resetsAt: iso(RESET)
    })
  })

  test('overage has its own limited window and never replaces the seven-day combined window', () => {
    const observed = parseUnifiedHeaders(headers({ 'representative-claim': 'overage',
      'overage-utilization': '0.9', 'overage-reset': String(RESET / 1000) }), NOW)
    const folded = usageFromUnifiedHeaders('homeclaude', null, observed)
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
  ])('excludes %j from Auto', (patch) => expect(eligible(account('homeclaude', patch), NOW)).toBe(false))

  test('readmits immediately below the limit and accepts unknown usage', () => {
    expect(eligible(account('homeclaude', { usage: usage(89.9) }), NOW)).toBe(true)
    expect(eligible(account('homeclaude', { usage: null }), NOW)).toBe(true)
    expect(eligible(account('homeclaude', { cooldownUntil: NOW }), NOW)).toBe(true)
  })

  test('orders by the seven-day reset before any tie-break', () => {
    const sooner = account('soonerclaude', { usage: windows([10, iso(LATER)], [50, iso(RESET)]) })
    const later = account('laterclaude', { usage: windows([10, iso(RESET)], [20, iso(LATER)]) })
    // The five-hour resets run the other way round and have no say in the order.
    expect(choose([later, sooner])).toBe('soonerclaude')
    expect(choose([sooner, later])).toBe('soonerclaude')
  })

  test('a login with no known weekly reset is taken last', () => {
    const later = account('laterclaude', { usage: windows([80, iso(LATER)], [20, iso(LATER)]) })
    expect(choose([account('unknownclaude', { usage: usage(1, iso(NOW + 1)) }), later])).toBe('laterclaude')
    expect(choose([account('unknownclaude', { usage: windows([1, iso(RESET)], [1, null]) }), later])).toBe('laterclaude')
    expect(choose([account('unknownclaude', { usage: windows([1, iso(RESET)], [1, 'invalid']) }), later])).toBe('laterclaude')
  })

  test('a login marked use first is taken ahead of a sooner weekly reset', () => {
    const sooner = account('soonerclaude', { usage: windows([10, iso(RESET)], [50, iso(RESET)]) })
    const marked = account('markedclaude', { useFirst: true, usage: windows([10, iso(RESET)], [20, iso(LATER)]) })
    expect(choose([sooner, marked])).toBe('markedclaude')
    expect(choose([marked, sooner])).toBe('markedclaude')
    // The mark is not a way past a limit: over one of its own the login is skipped.
    const over = account('markedclaude', { useFirst: true, usage: windows([95, iso(RESET)], [20, iso(LATER)]) })
    expect(eligible(over, NOW)).toBe(false)
    expect(choose([sooner, over])).toBe('soonerclaude')
  })

  test('two logins marked use first go in order of their weekly reset', () => {
    const first = account('firstclaude', { useFirst: true, usage: windows([10, iso(RESET)], [20, iso(LATER)]) })
    const second = account('secondclaude', { useFirst: true, usage: windows([10, iso(LATER)], [20, iso(RESET)]) })
    expect(choose([first, second])).toBe('secondclaude')
    expect(choose([second, first])).toBe('secondclaude')
  })

  describe('a session stays on the login that served it', () => {
    // Anthropic keeps the prompt cache per login, so a move costs the whole conversation
    // written to the cache again.
    const sooner = (patch: Partial<RouteAccount> = {}): RouteAccount =>
      account('soonerclaude', { usage: windows([10, iso(RESET)], [50, iso(RESET)]), ...patch })
    const serving = (patch: Partial<RouteAccount> = {}): RouteAccount =>
      account('servingclaude', { usage: windows([10, iso(RESET)], [20, iso(LATER)]), ...patch })
    const onServing: RouteSession = { homeAccountId: 'homeclaude', currentAccountId: 'servingclaude' }

    test('while it can serve, though another login resets its week sooner', () => {
      expect(choose([sooner(), serving()], onServing)).toBe('servingclaude')
      expect(choose([serving(), sooner()], onServing)).toBe('servingclaude')
      // A session that has not been served yet is placed by the weekly reset.
      expect(choose([serving(), sooner()], { ...onServing, currentAccountId: null })).toBe('soonerclaude')
    })

    test('when its week has just reset and every other login now resets sooner', () => {
      const reset = serving({ usage: windows([0, iso(LATER + 5 * 3_600_000)], [0, iso(LATER + 7 * 86_400_000)]) })
      expect(choose([sooner(), reset], onServing)).toBe('servingclaude')
    })

    test.each<[string, Partial<RouteAccount>]>([
      ['over its five-hour limit', { usage: windows([95, iso(RESET)], [20, iso(LATER)]) }],
      ['over its weekly limit', { usage: windows([10, iso(RESET)], [95, iso(LATER)]) }],
      ['cooling down after a refusal', { cooldownUntil: RESET }],
      ['signed out', { loggedIn: false }],
      ['unreadable', { credentialsReadable: false }],
      ['taken out of Auto', { autoRoute: false }]
    ])('until it is %s', (_what, patch) => {
      expect(choose([sooner(), serving(patch)], onServing)).toBe('soonerclaude')
    })

    test('until a request is refused on it and replayed', () => {
      expect(choose([sooner(), serving()], onServing, ['servingclaude'])).toBe('soonerclaude')
    })

    test('until a login marked use first can serve', () => {
      expect(choose([sooner({ useFirst: true }), serving()], onServing)).toBe('soonerclaude')
      // Over one of its limits the mark does not count, and the session stays.
      expect(choose([sooner({ useFirst: true, usage: windows([95, iso(RESET)], [50, iso(RESET)]) }), serving()],
        onServing)).toBe('servingclaude')
    })

    test('on a login marked use first, though another marked one resets its week sooner', () => {
      expect(choose([sooner({ useFirst: true }), serving({ useFirst: true })], onServing)).toBe('servingclaude')
    })

    test('and the explanation names it as serving next', () => {
      expect(explainRouting(onServing, [sooner(), serving()], NOW).map((row) => [row.accountId, row.next]))
        .toEqual([['servingclaude', true], ['soonerclaude', false]])
    })
  })

  test('a login over its five-hour limit is skipped though its week resets soonest', () => {
    const busy = account('busyclaude', { usage: windows([95, iso(RESET)], [10, iso(RESET)]) })
    const rest = account('restclaude', { usage: windows([10, iso(RESET)], [10, iso(LATER)]) })
    expect(routeBlock(busy, NOW)?.kind).toBe('over-limit')
    expect(choose([busy, rest])).toBe('restclaude')
  })

  test('ties favour the last serving login, then home, then lowest utilisation', () => {
    expect(choose([account('homeclaude'), account('otherclaude', { usage: usage(80) })], { ...session, currentAccountId: 'otherclaude' })).toBe('otherclaude')
    expect(choose([account('otherclaude', { usage: usage(1) }), account('homeclaude')], { ...session, currentAccountId: null })).toBe('homeclaude')
    expect(choose([account('aclaude'), account('bclaude', { usage: usage(10) })])).toBe('bclaude')
    expect(choose([account('homeclaude'), account('otherclaude')], session, ['homeclaude'])).toBe('otherclaude')
    expect(choose([])).toBeNull()
  })

  test("with no login opted in, Auto runs on the login plain claude uses, its home, as if pinned to it", () => {
    const none = { autoRoute: false }
    const auto: RouteSession = { homeAccountId: OWN_CLAUDE, currentAccountId: 'homeclaude' }
    const fallback = account(OWN_CLAUDE, { ...none, usage: usage(100), cooldownUntil: Infinity })
    expect(effectivePin(auto, [account('homeclaude', none), fallback])).toBe(OWN_CLAUDE)
    expect(effectivePin(auto, [account('homeclaude'), fallback])).toBeNull()
    expect(effectivePin({ ...auto, pinnedAccountId: 'homeclaude' }, [account('homeclaude'), fallback])).toBe('homeclaude')
    // The fallback is the session's home, whatever that is.
    expect(effectivePin(session, [account('homeclaude', none), fallback])).toBe('homeclaude')
    expect(choose([account('homeclaude', none), fallback], auto)).toBe(OWN_CLAUDE)
    expect(choose([account('homeclaude', none), { ...fallback, loggedIn: false }], auto)).toBeNull()
    expect(choose([account('homeclaude', none)], auto)).toBeNull()
    // The fallback is measured like a pin: the own login's windows at 100%, not its limits.
    expect(poolReadyAt([account('homeclaude', none), fallback], NOW, null, OWN_CLAUDE)).toBeNull()
    expect(poolReadyAt([account('homeclaude', none), account(OWN_CLAUDE, { ...none, usage: usage(100) })], NOW, null, OWN_CLAUDE)).toBe(RESET)
    expect(poolReadyAt([account('homeclaude', none), account(OWN_CLAUDE, { ...none, usage: usage(95) })], NOW, null, OWN_CLAUDE)).toBe(NOW)
  })

  test.each(['homeclaude', OWN_CLAUDE])('a pin to %s ignores Auto controls, usage and cooldown', (id) => {
    const pinned = { ...session, pinnedAccountId: id }
    const row = account(id, { autoRoute: false, ...limits(1), usage: usage(100), cooldownUntil: Infinity })
    expect(choose([account('otherclaude'), row], pinned)).toBe(id)
    expect(choose([account('otherclaude')], pinned)).toBeNull()
    expect(choose([row], pinned, [id])).toBeNull()
  })

  test('only plan windows affect the limit', () => {
    const snapshot: AccountUsage = { ...usage(20), sevenDay: { utilization: 70, resetsAt: null },
      sevenDayOpus: { utilization: 100, resetsAt: null }, sevenDayOverage: { utilization: 95, resetsAt: null } }
    expect(worstUtilisation(snapshot)).toBe(70)
    snapshot.extraUsage = { isEnabled: true, monthlyLimit: null, usedCredits: null, utilization: null, currency: null }
    expect(worstUtilisation(snapshot)).toBe(95)
    expect(eligible(account('homeclaude', { usage: snapshot }), NOW)).toBe(false)
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
    expect(replayDecision(reply({ status: 400 }))).toEqual({ kind: 'pin-back', to: 'homeclaude' })
    expect(replayDecision(reply({ status: 400, servedBy: 'homeclaude' }))).toEqual({ kind: 'pass' })
    expect(replayDecision(reply({ status: 400, attempted: new Set(['otherclaude', 'homeclaude']) }))).toEqual({ kind: 'pass' })
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
    expect(replayDecision(reply({ session: { ...session, pinnedAccountId: 'homeclaude' } }))).toEqual({ kind: 'pass' })
  })
})

describe('pool recovery', () => {
  test('returns now if any login is ready, otherwise the earliest cooldown', () => {
    expect(poolReadyAt([account('homeclaude', { cooldownUntil: RESET }), account('otherclaude')], NOW, null, OWN_CLAUDE)).toBe(NOW)
    expect(poolReadyAt([account('homeclaude', { cooldownUntil: LATER }), account('otherclaude', { cooldownUntil: RESET })], NOW, null, OWN_CLAUDE)).toBe(RESET)
  })

  test('waits for every blocking window and cooldown on one login, then takes the earliest login', () => {
    const blocked = account('homeclaude', { usage: { ...usage(95), sevenDay: { utilization: 92, resetsAt: iso(LATER) } } })
    expect(poolReadyAt([blocked], NOW, null, OWN_CLAUDE)).toBe(LATER)
    expect(poolReadyAt([blocked, account('otherclaude', { cooldownUntil: RESET })], NOW, null, OWN_CLAUDE)).toBe(RESET)
    expect(poolReadyAt([{ ...blocked, cooldownUntil: LATER + 1 }], NOW, null, OWN_CLAUDE)).toBe(LATER + 1)
  })

  test.each<Partial<RouteAccount>>([
    { loggedIn: false, cooldownUntil: RESET }, { credentialsReadable: false, cooldownUntil: RESET },
    { cooldownUntil: Infinity }, { usage: usage(95, null) }, { usage: usage(95, 'invalid') }
  ])('cannot predict readiness with %j', (patch) => {
    expect(poolReadyAt([account('homeclaude', patch)], NOW, null, OWN_CLAUDE)).toBeNull()
    expect(poolReadyAt([account('homeclaude', patch), account('otherclaude', { cooldownUntil: RESET })], NOW, null, OWN_CLAUDE)).toBe(RESET)
  })

  // Three logins on Auto, all over their limits, with every access token expiring before its
  // login's reset. Counting those logins out would answer null, as if no reset were known.
  test('an access token that expires before the reset does not hide the reset, because the proxy renews it', () => {
    const tokenGone = NOW + 30 * 60_000
    const fiveHourOut = account('workclaude', { usage: usage(95, iso(RESET)), ...limits(95), tokenExpiresAt: tokenGone })
    const weekOut = account('workclaude', {
      usage: windows([0, null], [100, iso(LATER)]), tokenExpiresAt: tokenGone
    })
    expect(poolReadyAt([fiveHourOut, weekOut], NOW, null, OWN_CLAUDE)).toBe(RESET)
    expect(poolReadyAt([weekOut], NOW, null, OWN_CLAUDE)).toBe(LATER)
    // A login with room is ready now, even with its token minutes from expiry.
    expect(poolReadyAt([account('homeclaude', { tokenExpiresAt: NOW + 100 })], NOW, null, OWN_CLAUDE)).toBe(NOW)
    expect(poolReadyAt([fiveHourOut], NOW, 'workclaude', OWN_CLAUDE)).toBe(NOW)
  })

  test('one unknown blocking reset makes that login unknown', () => {
    expect(poolReadyAt([account('homeclaude', { usage: { ...usage(95, null), sevenDay: { utilization: 98, resetsAt: iso(LATER) } } })], NOW, null, OWN_CLAUDE)).toBeNull()
    expect(poolReadyAt([], NOW, null, OWN_CLAUDE)).toBeNull()
  })

  test('uses opted-in logins for Auto and only the pinned login for a pin', () => {
    const disabled = account('homeclaude', { autoRoute: false, usage: usage(100) })
    expect(poolReadyAt([disabled], NOW, null, OWN_CLAUDE)).toBeNull()
    expect(poolReadyAt([disabled, account('otherclaude')], NOW, 'homeclaude', OWN_CLAUDE)).toBe(RESET)
    expect(poolReadyAt([account('homeclaude', { autoRoute: false, usage: usage(95) })], NOW, 'homeclaude', OWN_CLAUDE)).toBe(NOW)
    expect(poolReadyAt([account('homeclaude', { usage: usage(4), ...limits(4) })], NOW, null, OWN_CLAUDE)).toBe(RESET)
  })
})

describe('a request that runs into a usage limit', () => {
  const MUCH_LATER = LATER + 60 * 60_000

  test('goes to another opted-in login that still has room', () => {
    // The login serving the request is refused, which puts it on cooldown until its own
    // reset and sends the same request to the next opted-in login.
    const decision = replayDecision(reply({ servedBy: 'homeclaude', attempted: new Set(['homeclaude']) }))
    expect(decision).toEqual({ kind: 'replay', reason: 'quota', cooldownUntil: RESET })
    const pool = [account('homeclaude', { cooldownUntil: RESET, usage: usage(100) }), account('otherclaude')]
    expect(chooseAccount(session, pool, NOW, new Set(['homeclaude']))?.id).toBe('otherclaude')
    // The pool is ready now.
    expect(poolReadyAt(pool, NOW, null, OWN_CLAUDE)).toBe(NOW)
  })

  test('is back at the nearest reset in the pool once every opted-in login is spent', () => {
    // The login that refused the request recovers last; the pool is back when the first of
    // the others is, not at that login's own reset.
    const spent = [
      account('homeclaude', { usage: usage(100, iso(MUCH_LATER)) }),
      account('secondclaude', { usage: usage(100, iso(LATER)) }),
      account('third', { usage: usage(100, iso(RESET)) })
    ]
    expect(chooseAccount(session, spent, NOW, new Set())).toBeNull()
    expect(poolReadyAt(spent, NOW, null, OWN_CLAUDE)).toBe(RESET)
  })

})

describe('a pool where every login is under its limits', () => {
  // Three Claude logins. Nothing here is out of usage: the busiest window is the seven-day
  // window of the login plain claude uses, at 79%, under the 90% each row allows.
  const threeLogins = (patch: Partial<RouteAccount> = {}): RouteAccount[] => [
    account(OWN_CLAUDE, { ...limits(90), usage: {
      ...emptyAccountUsage(OWN_CLAUDE, NOW), status: 'allowed_warning',
      fiveHour: { utilization: 47, resetsAt: iso(RESET) },
      sevenDay: { utilization: 79, resetsAt: iso(LATER) },
      limited: { window: 'seven_day', utilization: 79, threshold: 75, resetsAt: iso(LATER) }
    }, ...patch }),
    account('personalclaude', { ...limits(90), usage: {
      ...emptyAccountUsage('personalclaude', NOW),
      fiveHour: { utilization: 6, resetsAt: iso(RESET) },
      sevenDay: { utilization: 64, resetsAt: iso(RESET) }
    }, ...patch }),
    account('sideclaude', { ...limits(90), usage: {
      ...emptyAccountUsage('sideclaude', NOW),
      fiveHour: { utilization: 0, resetsAt: iso(RESET) },
      sevenDay: { utilization: 92, resetsAt: iso(LATER) }
    }, ...patch })
  ]

  const auto: RouteSession = { homeAccountId: OWN_CLAUDE, currentAccountId: null, pinnedAccountId: null }

  test('a login over the warning threshold but under its limit is not exhausted', () => {
    // `limited` says the seven-day window passed Anthropic's 75% warning threshold, and
    // `allowed_warning` is what the API said. Neither is a refusal.
    const [fallback] = threeLogins()
    expect(eligible(fallback!, NOW)).toBe(true)
    expect(chooseAccount(auto, threeLogins(), NOW, new Set())?.id).toBe('personalclaude')
    expect(accountsInScope(auto, threeLogins()).map((row) => row.id)).toEqual([OWN_CLAUDE, 'personalclaude', 'sideclaude'])
  })

  test('a login with no usage reading yet is usable, not exhausted', () => {
    // A login added while sessions run has no usage reading until the first probe lands.
    // Nothing known about it means nothing used, not everything used.
    const fresh = account('freshclaude', { usage: null })
    expect(worstUtilisation(null)).toBeNull()
    expect(eligible(fresh, NOW)).toBe(true)
    expect(poolReadyAt([fresh], NOW, null, OWN_CLAUDE)).toBe(NOW)
    expect(chooseAccount(auto, [fresh], NOW, new Set())?.id).toBe('freshclaude')
  })

  test("with nobody opted in an Auto session runs on the login plain claude uses", () => {
    const none = threeLogins({ autoRoute: false })
    expect(effectivePin(auto, none)).toBe(OWN_CLAUDE)
    expect(chooseAccount(auto, none, NOW, new Set())?.id).toBe(OWN_CLAUDE)
    expect(accountsInScope(auto, none).map((row) => row.id)).toEqual([OWN_CLAUDE])
    expect(poolReadyAt(none, NOW, null, OWN_CLAUDE)).toBe(NOW)
  })

  test('a pool whose tokens cannot be read has an empty scope, which is not a usage limit', () => {
    // Nothing in it could have served the request whatever its usage said.
    const unreadable = threeLogins({ credentialsReadable: false })
    expect(chooseAccount(auto, unreadable, NOW, new Set())).toBeNull()
    expect(poolReadyAt(unreadable, NOW, null, OWN_CLAUDE)).toBeNull()
    expect(accountsInScope(auto, unreadable)).toEqual([])
    // The same with nobody opted in.
    const pinned = threeLogins({ credentialsReadable: false, autoRoute: false })
    expect(chooseAccount(auto, pinned, NOW, new Set())).toBeNull()
    expect(accountsInScope(auto, pinned)).toEqual([])
    // A session pinned to one login is refused the same way, and for the same reason.
    const held: RouteSession = { homeAccountId: 'personalclaude', currentAccountId: null, pinnedAccountId: 'personalclaude' }
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
    account(OWN_CLAUDE, { ...limits(100), usage: {
      ...emptyAccountUsage(OWN_CLAUDE, at), status: 'rejected',
      fiveHour: { utilization: 100, resetsAt: '2030-03-12T23:30:00.000+00:00' },
      sevenDay: { utilization: 71, resetsAt: '2030-03-17T18:00:00.000+00:00' },
      limited: { window: 'five_hour', utilization: 100, threshold: null, resetsAt: '2030-03-12T23:30:00.000+00:00' }
    } }),
    account('workclaude', { fiveHourLimitPercent: 100, weeklyLimitPercent: 60, usage: {
      ...emptyAccountUsage('workclaude', readAt),
      fiveHour: { utilization: 2, resetsAt: '2030-03-12T16:59:59.000+00:00' },
      sevenDay: { utilization: 95, resetsAt: '2030-03-12T19:59:59.000+00:00' }
    } }),
    account('teamclaude', { ...limits(100), usage: {
      ...emptyAccountUsage('teamclaude', readAt), status: 'allowed_warning',
      fiveHour: { utilization: 0, resetsAt: null },
      sevenDay: { utilization: 100, resetsAt: '2030-03-12T20:59:59.000+00:00' },
      limited: { window: 'seven_day', utilization: 100, threshold: null, resetsAt: '2030-03-12T20:59:59.000+00:00' }
    } }),
    account('spareclaude', { ...limits(100), autoRoute: false, usage: null })
  ]
  const auto: RouteSession = { homeAccountId: OWN_CLAUDE, currentAccountId: null, pinnedAccountId: null }

  test('counts as empty, so a login whose week has turned over is back in the pool', () => {
    expect(routeBlock(pool()[1]!, at)).toBeNull()
    expect(routeBlock(pool()[2]!, at)).toBeNull()
    expect(routeBlock(pool()[0]!, at)).toMatchObject({ kind: 'over-limit', window: '5 hour' })
    const chosen = chooseAccount(auto, pool(), at, new Set())
    expect(chosen).not.toBeNull()
    expect(['workclaude', 'teamclaude']).toContain(chosen!.id)
  })

  test('leaves the pool ready now rather than waiting for the full login to reset', () => {
    expect(poolReadyAt(pool(), at, null, OWN_CLAUDE)).toBe(at)
    // With the two other logins gone, the wait is for the one login that is full.
    const own = pool().filter((row) => row.id === OWN_CLAUDE)
    expect(poolReadyAt(own, at, null, OWN_CLAUDE)).toBe(Date.parse('2030-03-12T23:30:00.000+00:00'))
  })

  test('is reported as able to serve, so the explanation matches the choice', () => {
    const rows = explainRouting(auto, pool(), at)
    expect(rows.find((row) => row.next)?.accountId).toBe(chooseAccount(auto, pool(), at, new Set())?.id)
    expect(rows.filter((row) => row.block === null).map((row) => row.accountId).sort()).toEqual(['teamclaude', 'workclaude'])
    expect(rows.find((row) => row.accountId === 'teamclaude')?.busiest?.utilization).toBe(0)
  })

  test('a reset exactly now has passed', () => {
    expect(poolReadyAt([account('homeclaude', { usage: usage(95, iso(NOW)) })], NOW, null, OWN_CLAUDE)).toBe(NOW)
    expect(eligible(account('homeclaude', { usage: usage(95, iso(NOW)) }), NOW)).toBe(true)
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
    const row = account('homeclaude', patch)
    expect(routeBlock(row, NOW)?.kind).toBe(kind)
    expect(eligible(row, NOW)).toBe(false)
  })

  test('reports nothing for a login that can serve', () => {
    expect(routeBlock(account(), NOW)).toBeNull()
  })

  test('a cooldown with no known reset has no time on it', () => {
    expect(routeBlock(account('homeclaude', { cooldownUntil: Infinity }), NOW)).toEqual({ kind: 'cooldown', until: null })
  })

  test('an over-limit block names the window that is full and its own limit', () => {
    expect(routeBlock(account('homeclaude', { usage: usage(95), ...limits(75) }), NOW)).toEqual({
      kind: 'over-limit', utilization: 95, limitPercent: 75, window: '5 hour', resetsAt: iso(RESET)
    })
  })

  test('explains the pool in the order it would be taken, skipped logins last', () => {
    const rows = [
      account('fullclaude', { usage: usage(99) }),
      account('laterclaude', { usage: windows([10, iso(RESET)], [20, iso(LATER)]) }),
      account('soonerclaude', { usage: windows([10, iso(LATER)], [30, iso(RESET)]) }),
      account('offclaude', { autoRoute: false })
    ]
    const explained = explainRouting({ homeAccountId: 'laterclaude', currentAccountId: null }, rows, NOW)
    expect(explained.map((row) => [row.accountId, row.next, row.block?.kind ?? null])).toEqual([
      ['soonerclaude', true, null],
      ['laterclaude', false, null],
      ['fullclaude', false, 'over-limit'],
      ['offclaude', false, 'auto-route-off']
    ])
    expect(explained[0]).toMatchObject({
      useFirst: false,
      busiest: { label: '7 day', utilization: 30, resetsAt: iso(RESET) },
      sevenDayResetsAt: iso(RESET)
    })
  })

  test('the explanation says which login is marked use first and when its week is back', () => {
    const rows = [
      account('soonerclaude', { usage: windows([10, iso(RESET)], [30, iso(RESET)]) }),
      account('markedclaude', { useFirst: true, usage: windows([10, iso(RESET)], [20, iso(LATER)]) }),
      account('freshclaude', { usage: null })
    ]
    const explained = explainRouting({ homeAccountId: 'soonerclaude', currentAccountId: 'soonerclaude' }, rows, NOW)
    expect(explained.map((row) => [row.accountId, row.useFirst, row.sevenDayResetsAt])).toEqual([
      ['markedclaude', true, iso(LATER)],
      ['soonerclaude', false, iso(RESET)],
      ['freshclaude', false, null]
    ])
  })

  test('each limit is measured only against its own window', () => {
    // A weekly limit of 75. The five-hour window going over 75 must not take the login out of
    // the pool, since that window comes back within hours.
    const split = { fiveHourLimitPercent: 100, weeklyLimitPercent: 75 }
    const busyFiveHour = account('homeclaude', {
      ...split,
      usage: { ...usage(80), sevenDay: { utilization: 40, resetsAt: iso(LATER) } }
    })
    expect(routeBlock(busyFiveHour, NOW)).toBeNull()
    expect(eligible(busyFiveHour, NOW)).toBe(true)

    const busyWeek = account('homeclaude', {
      ...split,
      usage: { ...usage(40), sevenDay: { utilization: 80, resetsAt: iso(LATER) } }
    })
    expect(eligible(busyWeek, NOW)).toBe(false)
    expect(routeBlock(busyWeek, NOW)).toEqual({
      kind: 'over-limit', utilization: 80, limitPercent: 75, window: '7 day', resetsAt: iso(LATER)
    })
    // The pool waits for the weekly reset, not the five-hour one it is still under.
    expect(poolReadyAt([busyWeek], NOW, null, OWN_CLAUDE)).toBe(LATER)
  })

  test('a pinned session has one login and no choice to explain', () => {
    const rows = [account('homeclaude'), account('otherclaude', { usage: usage(10, iso(RESET)) })]
    const explained = explainRouting({ homeAccountId: 'homeclaude', currentAccountId: 'homeclaude', pinnedAccountId: 'homeclaude' }, rows, NOW)
    expect(explained).toHaveLength(1)
    expect(explained[0]).toMatchObject({ accountId: 'homeclaude', next: true, block: null })
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
    login('alphaclaude', [59, '2030-04-02T19:00:00Z'], [80, '2030-04-07T18:00:00Z']),
    login('workclaude', [94, '2030-04-02T19:50:00Z'], [73, '2030-04-02T20:00:00Z'], limits(75)),
    login('teamclaude', [83, '2030-04-02T21:20:00Z'], [100, '2030-04-02T21:00:00Z'], {}, 'rejected'),
    login('bravoclaude', [15, '2030-04-02T22:30:00Z'], [84, '2030-04-03T08:00:00Z']),
    login('charlieclaude', [0, '2030-04-02T20:20:00Z'], [62, '2030-04-05T09:00:00Z'], { autoRoute: false })
  ]
  const session: RouteSession = { homeAccountId: 'alphaclaude', currentAccountId: 'bravoclaude' }

  test('serves the login whose week resets soonest of the two that can serve', () => {
    expect(chooseAccount(session, pool, at, new Set())?.id).toBe('bravoclaude')
  })

  test('names a reason for each login that was passed over', () => {
    expect(explainRouting(session, pool, at).map((row) => [row.accountId, row.block?.kind ?? 'can serve'])).toEqual([
      ['bravoclaude', 'can serve'],
      ['alphaclaude', 'can serve'],
      ['workclaude', 'over-limit'],
      ['teamclaude', 'over-limit'],
      ['charlieclaude', 'auto-route-off']
    ])
  })
})

describe('the login an Auto CLI is started on', () => {
  const login = (id: string, loggedIn: boolean, autoRoute: boolean): StartableLogin =>
    ({ id, machineOwn: id === OWN_CLAUDE, loggedIn, autoRoute })

  test('the login of the machine itself while it is signed in', () => {
    expect(autoStartLogin([login('poolclaude', true, true), login(OWN_CLAUDE, true, false)])).toBe(OWN_CLAUDE)
    expect(autoStartLogin([login(OWN_CLAUDE, true, true), login('poolclaude', true, true)], 'poolclaude')).toBe(OWN_CLAUDE)
  })

  test("a list without the login plain claude uses is a mistake of the caller", () => {
    expect(() => autoStartLogin([login('poolclaude', true, true)])).toThrow(/no login that plain claude uses/)
  })

  test('a signed-in pool login when the login of the machine is signed out, the one that served last first', () => {
    const rows = [login(OWN_CLAUDE, false, false), login('offclaude', true, false), login('outclaude', false, true),
      login('poolaclaude', true, true), login('poolbclaude', true, true)]
    expect(autoStartLogin(rows)).toBe('poolaclaude')
    expect(autoStartLogin(rows, 'poolbclaude')).toBe('poolbclaude')
    expect(autoStartLogin(rows, 'offclaude')).toBe('poolaclaude')
  })

  // A pool with nothing signed in is a sign-in problem with a pool login, so the CLI is not
  // started on the login plain claude uses, which an Auto session with a pool never runs on.
  test('a pool login when the pool has logins but none is signed in, the one that served last first', () => {
    const rows = [login(OWN_CLAUDE, false, false), login('offclaude', true, false), login('outaclaude', false, true), login('outbclaude', false, true)]
    expect(effectivePin({ homeAccountId: OWN_CLAUDE, currentAccountId: null }, rows.map((row) => account(row.id, {
      loggedIn: row.loggedIn, autoRoute: row.autoRoute })))).toBeNull()
    expect(autoStartLogin(rows)).toBe('outaclaude')
    expect(autoStartLogin(rows, 'outbclaude')).toBe('outbclaude')
    expect(autoStartLogin(rows, 'offclaude')).toBe('outaclaude')
  })

  test('the login of the machine when there is no pool, since the router then holds the session to it', () => {
    expect(autoStartLogin([login(OWN_CLAUDE, false, false), login('offclaude', true, false)])).toBe(OWN_CLAUDE)
  })
})

describe('the rules kurmis adds', () => {
  test('a usage-limit refusal of a pinned session still names the cooldown of its login', () => {
    const pinned = reply({ session: { ...session, pinnedAccountId: 'homeclaude' } })
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

  test("a Codex choice with no login opted in falls back to the login plain codex uses, its home", () => {
    const codex: RouteSession = { homeAccountId: OWN_CODEX, currentAccountId: null }
    const rows = [account(OWN_CODEX, { autoRoute: false }), account('workcodex', { autoRoute: false })]
    expect(effectivePin(codex, rows)).toBe(OWN_CODEX)
    expect(chooseAccount(codex, rows, NOW, new Set())?.id).toBe(OWN_CODEX)
    expect(poolReadyAt(rows, NOW, null, OWN_CODEX)).toBe(NOW)
    expect(chooseAccount(codex, [rows[0]!, account('workcodex')], NOW, new Set())?.id).toBe('workcodex')
  })
})
