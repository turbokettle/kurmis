// The two conversions into a usage snapshot: a `get_usage` control response, and the rate-limit
// headers of a forwarded answer. The payloads below are the shapes the real CLI and API produced
// (2.1.261 for the probe).
import { describe, expect, test } from 'vitest'
import { parseUnifiedHeaders, usageFromUnifiedHeaders } from '../../src/core/account-router.ts'
import { emptyAccountUsage, usageFromGetUsage } from '../../src/core/usage.ts'
import type { AccountUsage } from '../../src/core/claude-usage.ts'

const NOW = 1_788_300_000_000

/** A full `get_usage` answer, including keys this build does not read. */
function getUsageAnswer(): Record<string, unknown> {
  return {
    session: { total_cost_usd: 0.12, total_lines_added: 3 },
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 42, resets_at: '2026-09-01T23:50:00.000Z', status: 'allowed' },
      seven_day: { utilization: 13.25, resets_at: '2026-09-02T20:00:00.000Z' },
      seven_day_opus: { utilization: 4, resets_at: '2026-09-02T20:00:00.000Z' },
      seven_day_sonnet: null,
      seven_day_oauth_apps: { utilization: 1, resets_at: null },
      something_this_build_never_heard_of: { utilization: 99 },
      extra_usage: {
        is_enabled: true,
        monthly_limit: 100,
        used_credits: 25,
        utilization: 25,
        currency: 'USD',
        disabled_reason: null
      },
      limits: [],
      model_scoped: [
        { display_name: 'Opus', utilization: 4, resets_at: '2026-09-02T20:00:00.000Z' },
        { utilization: 7, resets_at: null }
      ]
    },
    behaviors: { some: 'block' }
  }
}

/** The usage an answer with these `anthropic-ratelimit-unified-*` headers leaves. */
function folded(previous: AccountUsage | null, values: Record<string, string>, at = NOW): AccountUsage {
  const get = (name: string): string | undefined => values[name.replace('anthropic-ratelimit-unified-', '')]
  return usageFromUnifiedHeaders('workclaude', previous, parseUnifiedHeaders(get, at))
}

/** The rate-limit headers of an ordinary answer: five-hour and seven-day windows, status allowed. */
const ALLOWED = {
  status: 'allowed',
  reset: '1788306600',
  'representative-claim': 'five_hour',
  '5h-utilization': '0.22',
  '5h-reset': '1788306600',
  '7d-utilization': '0.04',
  '7d-reset': '1788379200'
}

/**
 * The headers of a warning about the seven-day window that counts extra usage: that window at
 * 96% while the five-hour and plain seven-day windows were nowhere near their limits.
 */
const OVERAGE_WARNING = {
  status: 'allowed_warning',
  reset: '1789408800',
  'representative-claim': 'seven_day_overage_included',
  '5h-utilization': '0.02',
  '5h-reset': '1789267200',
  '7d-utilization': '0.73',
  '7d-reset': '1789408800',
  '7d_oi-utilization': '0.96',
  '7d_oi-reset': '1789408800'
}

describe('the get_usage answer', () => {
  test('every window comes back as a percentage with an ISO reset time', () => {
    const usage = usageFromGetUsage('workclaude', getUsageAnswer(), NOW)

    expect(usage).toMatchObject({
      accountId: 'workclaude',
      fetchedAt: NOW,
      source: 'probe',
      subscriptionType: 'max',
      rateLimitsAvailable: true,
      fiveHour: { utilization: 42, resetsAt: '2026-09-01T23:50:00.000Z' },
      sevenDay: { utilization: 13.3, resetsAt: '2026-09-02T20:00:00.000Z' },
      sevenDayOpus: { utilization: 4, resetsAt: '2026-09-02T20:00:00.000Z' },
      sevenDaySonnet: null,
      status: null,
      error: null
    })
    // The per-model list drops an entry with no display name to show.
    expect(usage.modelScoped).toEqual([
      { displayName: 'Opus', utilization: 4, resetsAt: '2026-09-02T20:00:00.000Z' }
    ])
    expect(usage.extraUsage).toEqual({
      isEnabled: true,
      monthlyLimit: 100,
      usedCredits: 25,
      utilization: 25,
      currency: 'USD'
    })
  })

  test('a logged-out CLI answers with no windows at all', () => {
    const usage = usageFromGetUsage('ownclaude1', {
      subscription_type: null,
      rate_limits_available: false,
      rate_limits: null
    }, NOW)

    expect(usage).toEqual({
      ...emptyAccountUsage('ownclaude1', NOW),
      subscriptionType: null,
      rateLimitsAvailable: false
    })
  })

  test('an answer that is not an object at all still gives a usable snapshot', () => {
    expect(usageFromGetUsage('ownclaude1', 'nonsense', NOW)).toEqual(emptyAccountUsage('ownclaude1', NOW))
  })
})

describe('the rate-limit headers', () => {
  test('fractions become percentages and unix seconds become ISO', () => {
    expect(folded(null, ALLOWED)).toMatchObject({
      accountId: 'workclaude',
      fetchedAt: NOW,
      source: 'session',
      rateLimitsAvailable: true,
      fiveHour: { utilization: 22, resetsAt: '2026-09-01T23:50:00.000Z' },
      sevenDay: { utilization: 4, resetsAt: '2026-09-02T20:00:00.000Z' },
      sevenDayOverage: null,
      status: 'allowed',
      // The headers named five_hour, and its figures come from that window.
      limited: { window: 'five_hour', utilization: 22, resetsAt: '2026-09-01T23:50:00.000Z' },
      error: null
    })
  })

  test('only the windows the headers carry are replaced', () => {
    const probed = usageFromGetUsage('workclaude', getUsageAnswer(), NOW)
    const usage = folded(probed, { ...ALLOWED, status: 'rejected' }, NOW + 1000)

    // The five-hour window is the headers'; everything they say nothing about is still the probe's.
    expect(usage.fiveHour).toEqual({ utilization: 22, resetsAt: '2026-09-01T23:50:00.000Z' })
    expect(usage.sevenDayOpus).toEqual(probed.sevenDayOpus)
    expect(usage.modelScoped).toEqual(probed.modelScoped)
    expect(usage.extraUsage).toEqual(probed.extraUsage)
    expect(usage.subscriptionType).toBe('max')
    expect(usage.status).toBe('rejected')
    expect(usage.fetchedAt).toBe(NOW + 1000)
  })

  test('a failed probe stops being reported once live numbers arrive', () => {
    const failed: AccountUsage = { ...emptyAccountUsage('workclaude', NOW), error: 'usage probe timed out' }
    expect(folded(failed, ALLOWED).error).toBeNull()
  })

  test('headers with nothing readable in them leave every field empty', () => {
    expect(folded(null, { status: 'made up' })).toEqual({ ...emptyAccountUsage('workclaude', NOW), source: 'session' })
  })

  // The warning that made `limited` necessary: it was about the seven-day window that counts
  // extra usage, at 96%, while the five-hour window sat at 2%.
  test('keep the window the warning named, and the window itself', () => {
    const usage = folded(null, OVERAGE_WARNING)

    expect(usage.limited).toEqual({
      window: 'seven_day_overage_included',
      utilization: 96,
      resetsAt: '2026-09-14T18:00:00.000Z'
    })
    expect(usage.fiveHour).toEqual({ utilization: 2, resetsAt: '2026-09-13T02:40:00.000Z' })
    expect(usage.sevenDay).toEqual({ utilization: 73, resetsAt: '2026-09-14T18:00:00.000Z' })
    expect(usage.sevenDayOverage).toEqual({ utilization: 96, resetsAt: '2026-09-14T18:00:00.000Z' })
    expect(usage.status).toBe('allowed_warning')
  })
})

describe('the status a probe carries over', () => {
  /** The account as the overage warning above left it. */
  function warned(): AccountUsage {
    return folded(null, OVERAGE_WARNING)
  }

  /** A `get_usage` answer whose windows are given as percentages. */
  function probe(windows: Record<string, unknown>): Record<string, unknown> {
    return { subscription_type: 'max', rate_limits_available: true, rate_limits: windows }
  }

  test('the status stands while the probe still measures the window it was about full', () => {
    const usage = usageFromGetUsage('workclaude', probe({
      five_hour: { utilization: 2, resets_at: '2026-09-13T02:40:00.000Z' },
      seven_day_overage_included: { utilization: 100, resets_at: '2026-09-14T18:00:00.000Z' }
    }), NOW, warned())

    expect(usage.status).toBe('allowed_warning')
    expect(usage.limited)
      .toEqual({ window: 'seven_day_overage_included', utilization: 100, resetsAt: '2026-09-14T18:00:00.000Z' })
  })

  test('it goes once the probe measures that window under 100%', () => {
    const usage = usageFromGetUsage('workclaude', probe({
      seven_day_overage_included: { utilization: 97, resets_at: '2026-09-14T18:00:00.000Z' }
    }), NOW, warned())

    expect(usage.status).toBeNull()
    expect(usage.limited).toBeNull()
  })

  test('it goes once that window has reset, whatever the probe measured', () => {
    const after = Date.parse('2026-09-14T18:00:01.000Z')
    const usage = usageFromGetUsage('workclaude', probe({}), after, warned())

    expect(usage.status).toBeNull()
    expect(usage.limited).toBeNull()
  })

  test('a window the probe did not measure leaves the status where it was', () => {
    const rejected = folded(null, { status: 'rejected', 'representative-claim': 'thirty_day_something' })
    const usage = usageFromGetUsage('workclaude', probe({ five_hour: { utilization: 3 } }), NOW, rejected)

    expect(usage.status).toBe('rejected')
    expect(usage.limited?.window).toBe('thirty_day_something')
  })

  test('an account nothing has reported for gets no status at all', () => {
    expect(usageFromGetUsage('workclaude', probe({ five_hour: { utilization: 3 } }), NOW).status).toBeNull()
  })
})
