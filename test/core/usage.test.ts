// The two conversions into a usage snapshot: a `get_usage` control response, and a rate-limit
// report in the shape of the CLI's `rate_limit_event`. The payloads below are the shapes the
// real CLI produced (2.1.261 for the probe).
import { describe, expect, test } from 'vitest'
import {
  emptyAccountUsage,
  usageFromGetUsage,
  usageFromRateLimitEvent
} from '../../src/core/usage.ts'
import type { AccountUsage } from '../../src/core/claude-usage.ts'
import { OVERAGE_WARNING } from './usage-fixtures.ts'

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

/** The `rate_limit_info` of a `rate_limit_event`, copied from a recorded session. */
function rateLimitInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'allowed',
    resetsAt: 1_788_306_600,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    overageDisabledReason: 'out_of_credits',
    isUsingOverage: false,
    unifiedWindows: {
      five_hour: { utilization: 0.22, resetsAt: 1_788_306_600 },
      seven_day: { utilization: 0.04, resetsAt: 1_788_379_200 }
    },
    ...overrides
  }
}

describe('the get_usage answer', () => {
  test('every window comes back as a percentage with an ISO reset time', () => {
    const usage = usageFromGetUsage('claude:work', getUsageAnswer(), NOW)

    expect(usage).toMatchObject({
      accountId: 'claude:work',
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
    const usage = usageFromGetUsage('claude:default', {
      subscription_type: null,
      rate_limits_available: false,
      rate_limits: null
    }, NOW)

    expect(usage).toEqual({
      ...emptyAccountUsage('claude:default', NOW),
      subscriptionType: null,
      rateLimitsAvailable: false
    })
  })

  test('an answer that is not an object at all still gives a usable snapshot', () => {
    expect(usageFromGetUsage('claude:default', 'nonsense', NOW)).toEqual(emptyAccountUsage('claude:default', NOW))
  })
})

describe('a rate-limit report', () => {
  test('fractions become percentages and unix seconds become ISO', () => {
    const usage = usageFromRateLimitEvent('claude:work', null, rateLimitInfo(), NOW)

    expect(usage).toMatchObject({
      accountId: 'claude:work',
      fetchedAt: NOW,
      source: 'session',
      rateLimitsAvailable: true,
      fiveHour: { utilization: 22, resetsAt: '2026-09-01T23:50:00.000Z' },
      sevenDay: { utilization: 4, resetsAt: '2026-09-02T20:00:00.000Z' },
      status: 'allowed',
      error: null
    })
  })

  test('only the windows the event carries are replaced', () => {
    const probed = usageFromGetUsage('claude:work', getUsageAnswer(), NOW)
    const folded = usageFromRateLimitEvent('claude:work', probed, rateLimitInfo({ status: 'rejected' }), NOW + 1000)

    // The five-hour window is the event's; everything the event says nothing
    // about is still the probe's.
    expect(folded.fiveHour).toEqual({ utilization: 22, resetsAt: '2026-09-01T23:50:00.000Z' })
    expect(folded.sevenDayOpus).toEqual(probed.sevenDayOpus)
    expect(folded.modelScoped).toEqual(probed.modelScoped)
    expect(folded.extraUsage).toEqual(probed.extraUsage)
    expect(folded.subscriptionType).toBe('max')
    expect(folded.status).toBe('rejected')
    expect(folded.fetchedAt).toBe(NOW + 1000)
  })

  test('an event without unifiedWindows still updates the window it names', () => {
    const info = {
      status: 'allowed_warning',
      rateLimitType: 'seven_day',
      utilization: 0.815,
      resetsAt: 1_788_379_200
    }
    const usage = usageFromRateLimitEvent('claude:work', null, info, NOW)

    expect(usage.sevenDay).toEqual({ utilization: 81.5, resetsAt: '2026-09-02T20:00:00.000Z' })
    expect(usage.fiveHour).toBeNull()
    expect(usage.status).toBe('allowed_warning')
  })

  test('a failed probe stops being reported once live numbers arrive', () => {
    const failed: AccountUsage = { ...emptyAccountUsage('claude:work', NOW), error: 'usage probe timed out' }
    expect(usageFromRateLimitEvent('claude:work', failed, rateLimitInfo(), NOW).error).toBeNull()
  })
})

describe('the window a rate-limit report was about', () => {
  test('it is the one the event named, with the figures beside it', () => {
    expect(usageFromRateLimitEvent('claude:work', null, rateLimitInfo(), NOW)).toMatchObject({
      fiveHour: { utilization: 22, resetsAt: '2026-09-01T23:50:00.000Z' },
      sevenDay: { utilization: 4, resetsAt: '2026-09-02T20:00:00.000Z' },
      sevenDayOverage: null,
      status: 'allowed',
      // The event named five_hour, and its figures come from that unified window.
      limited: {
        window: 'five_hour',
        utilization: 22,
        threshold: null,
        resetsAt: '2026-09-01T23:50:00.000Z'
      }
    })
  })

  test('an event with nothing readable in it leaves every field empty', () => {
    expect(usageFromRateLimitEvent('claude:work', null, { status: 'made up' }, NOW))
      .toEqual({ ...emptyAccountUsage('claude:work', NOW), source: 'session' })
  })

  // The warning that made this necessary: it was about the seven-day window that
  // counts extra usage, at 96%, while the five-hour window sat at 2%.
  test('it keeps the window the warning named, and the window itself', () => {
    const usage = usageFromRateLimitEvent('claude:work', null, OVERAGE_WARNING, NOW)

    expect(usage.limited).toEqual({
      window: 'seven_day_overage_included',
      utilization: 96,
      threshold: 75,
      resetsAt: '2026-09-14T18:00:00.000Z'
    })
    expect(usage.fiveHour).toEqual({ utilization: 2, resetsAt: '2026-09-13T02:40:00.000Z' })
    expect(usage.sevenDay).toEqual({ utilization: 73, resetsAt: '2026-09-14T18:00:00.000Z' })
    expect(usage.sevenDayOverage).toEqual({ utilization: 96, resetsAt: '2026-09-14T18:00:00.000Z' })
    expect(usage.status).toBe('allowed_warning')
  })

  test('a window this build has never heard of is still the one it reports', () => {
    const usage = usageFromRateLimitEvent('claude:work', null, {
      status: 'rejected',
      rateLimitType: 'thirty_day_something',
      utilization: 1.02
    }, NOW)

    expect(usage.limited).toEqual({
      window: 'thirty_day_something',
      utilization: 102,
      threshold: null,
      resetsAt: null
    })
  })

  test('a rejection that names a window without a percentage still says when it resets', () => {
    const usage = usageFromRateLimitEvent('claude:work', null, {
      status: 'rejected',
      rateLimitType: 'five_hour',
      resetsAt: 1_788_306_600
    }, NOW)

    expect(usage.limited)
      .toEqual({ window: 'five_hour', utilization: null, threshold: null, resetsAt: '2026-09-01T23:50:00.000Z' })
  })
})

describe('the status a probe carries over', () => {
  /** The account as the overage warning above left it. */
  function warned(): AccountUsage {
    return usageFromRateLimitEvent('claude:work', null, OVERAGE_WARNING, NOW)
  }

  /** A `get_usage` answer whose windows are given as percentages. */
  function probe(windows: Record<string, unknown>): Record<string, unknown> {
    return { subscription_type: 'max', rate_limits_available: true, rate_limits: windows }
  }

  test('the warning stands while the window it was about is still over the threshold', () => {
    const usage = usageFromGetUsage('claude:work', probe({
      five_hour: { utilization: 2, resets_at: '2026-09-13T02:40:00.000Z' },
      seven_day_overage_included: { utilization: 97, resets_at: '2026-09-14T18:00:00.000Z' }
    }), NOW, warned())

    expect(usage.status).toBe('allowed_warning')
    expect(usage.limited)
      .toEqual({ window: 'seven_day_overage_included', utilization: 97, threshold: 75, resetsAt: '2026-09-14T18:00:00.000Z' })
  })

  test('it goes once the probe measures that window under the threshold', () => {
    const usage = usageFromGetUsage('claude:work', probe({
      seven_day_overage_included: { utilization: 12, resets_at: '2026-09-21T18:00:00.000Z' }
    }), NOW, warned())

    expect(usage.status).toBeNull()
    expect(usage.limited).toBeNull()
  })

  test('it goes once that window has reset, whatever the probe measured', () => {
    const after = Date.parse('2026-09-14T18:00:01.000Z')
    const usage = usageFromGetUsage('claude:work', probe({}), after, warned())

    expect(usage.status).toBeNull()
    expect(usage.limited).toBeNull()
  })

  test('a window the probe did not measure leaves the status where it was', () => {
    const rejected = usageFromRateLimitEvent('claude:work', null, {
      status: 'rejected',
      rateLimitType: 'thirty_day_something',
      utilization: 1.02
    }, NOW)
    const usage = usageFromGetUsage('claude:work', probe({ five_hour: { utilization: 3 } }), NOW, rejected)

    expect(usage.status).toBe('rejected')
    expect(usage.limited?.window).toBe('thirty_day_something')
  })

  test('an account nothing has reported for gets no status at all', () => {
    expect(usageFromGetUsage('claude:work', probe({ five_hour: { utilization: 3 } }), NOW).status).toBeNull()
  })
})
