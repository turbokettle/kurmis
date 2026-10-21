// The shared rules over a usage snapshot: which windows are shown, which are the plan's own,
// whether the login is out, and when it comes back.
// The Codex fixture is a `prolite` plan: a general `codex` bucket with one weekly window, and a
// Spark bucket metered on its own.
import { describe, expect, test } from 'vitest'
import type * as v2 from '../../src/core/codex-protocol.ts'
import { usageFromCodexRateLimits } from '../../src/core/codex-usage.ts'
import { emptyAccountUsage } from '../../src/core/usage.ts'
import {
  allUsageWindows,
  busiestPlanWindow,
  isSevenDayWindow,
  planUsageWindows,
  resetsAtFromUsage,
  shownUsageWindows,
  usageExhausted
} from '../../src/core/usage-rules.ts'
import type { AccountUsage } from '../../src/core/claude-usage.ts'

const NOW = Date.parse('2026-09-05T12:00:00.000Z')
const RESET_SECONDS = Date.parse('2026-09-06T12:00:00.000Z') / 1000

function bucket(overrides: Partial<v2.RateLimitSnapshot> = {}): v2.RateLimitSnapshot {
  return {
    limitId: 'codex',
    limitName: null,
    primary: { usedPercent: 24, windowDurationMins: 10080, resetsAt: RESET_SECONDS },
    secondary: null,
    credits: { balance: '0' },
    spendControlReached: false,
    planType: 'prolite',
    rateLimitReachedType: null,
    ...overrides
  }
}

const SPARK = bucket({
  limitId: 'codex_bengalfox',
  limitName: 'GPT-5.3-Codex-Spark',
  primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: RESET_SECONDS },
  secondary: { usedPercent: 45, windowDurationMins: 10080, resetsAt: RESET_SECONDS },
  credits: null,
  spendControlReached: null
})

/** The whole prolite answer, general bucket and Spark together. */
function codexUsage(general: v2.RateLimitSnapshot = bucket()): AccountUsage {
  return usageFromCodexRateLimits(
    'codex:abc',
    { rateLimits: general, rateLimitsByLimitId: { codex: general, codex_bengalfox: SPARK } },
    NOW
  )
}

function claudeUsage(overrides: Partial<AccountUsage> = {}): AccountUsage {
  return { ...emptyAccountUsage('claude:default', NOW), rateLimitsAvailable: true, ...overrides }
}

describe('the windows worth showing', () => {
  test('drops the Spark bucket of a Codex plan and keeps the rest', () => {
    const usage = codexUsage()

    expect(shownUsageWindows('codex', usage.windows ?? []).map((window) => window.label))
      .toEqual(['Codex 7d'])
    // The snapshot itself still carries every window.
    expect(usage.windows?.map((window) => window.label)).toEqual([
      'GPT-5.3-Codex-Spark 5h',
      'Codex 7d',
      'GPT-5.3-Codex-Spark 7d'
    ])
  })

  test('shows a limit the server starts metering for some new model', () => {
    const windows = [
      { key: 'codex:primary' },
      { key: 'codex_something_new:primary' },
      { key: 'codex_bengalfox:primary' },
      { key: 'codex:secondary' }
    ]

    expect(shownUsageWindows('codex', windows).map((window) => window.key))
      .toEqual(['codex:primary', 'codex_something_new:primary', 'codex:secondary'])
  })

  test('drops Spark even when no bucket is the general one', () => {
    const windows = [{ key: 'codex_bengalfox:primary' }, { key: 'other:primary' }]

    expect(shownUsageWindows('codex', windows).map((window) => window.key)).toEqual(['other:primary'])
  })

  test('leaves a Claude login alone', () => {
    const windows = [{ key: '5 hour' }, { key: '7 day Opus' }]

    expect(shownUsageWindows('claude', windows)).toEqual(windows)
    expect(shownUsageWindows(undefined, windows)).toEqual(windows)
  })
})

describe('whether the plan is used up', () => {
  const spent = bucket({ primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: RESET_SECONDS } })
  const withCredits = { balance: '5' }

  test('is false while the plan still has room, whatever the balance is', () => {
    expect(usageExhausted(codexUsage(bucket({ credits: withCredits })))).toBe(false)
  })

  test('is true once the general bucket is used up', () => {
    expect(usageExhausted(codexUsage(bucket({ ...spent, credits: withCredits })))).toBe(true)
    expect(usageExhausted(codexUsage(spent))).toBe(true)
  })

  test('ignores a per-model window that is full, because it is not what runs out', () => {
    const full = { ...SPARK, primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: RESET_SECONDS } }
    const general = bucket({ credits: withCredits })
    const usage = usageFromCodexRateLimits(
      'codex:abc',
      { rateLimits: general, rateLimitsByLimitId: { codex: general, codex_bengalfox: full } },
      NOW
    )

    expect(usageExhausted(usage)).toBe(false)
  })

  test('ignores a full per-model window that is shown, because it is still not the plan', () => {
    const model = {
      ...SPARK,
      limitId: 'codex_something_new',
      limitName: 'Some new model',
      primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: RESET_SECONDS }
    }
    const general = bucket({ credits: withCredits })
    const usage = usageFromCodexRateLimits(
      'codex:abc',
      { rateLimits: general, rateLimitsByLimitId: { codex: general, codex_something_new: model } },
      NOW
    )

    expect(shownUsageWindows('codex', usage.windows ?? []).length).toBe(3)
    expect(usageExhausted(usage)).toBe(false)
  })

  test('reads a plan whose general limit goes under another id off the windows it shows', () => {
    const model = bucket({
      limitId: 'codex_other',
      limitName: 'Other',
      credits: withCredits,
      primary: spent.primary
    })
    const usage = usageFromCodexRateLimits(
      'codex:abc',
      { rateLimits: model, rateLimitsByLimitId: { codex_other: model } },
      NOW
    )

    expect(usageExhausted(usage)).toBe(true)
  })

  test('takes a refused login as used up whatever the windows say', () => {
    const usage = codexUsage(bucket({ credits: withCredits, rateLimitReachedType: 'rate_limit_reached' }))

    expect(usage.status).toBe('rejected')
    expect(usageExhausted(usage)).toBe(true)
  })

  test('reads a Claude login from its five-hour and seven-day windows', () => {
    expect(usageExhausted(claudeUsage({ fiveHour: { utilization: 100, resetsAt: null } }))).toBe(true)
    expect(usageExhausted(claudeUsage({ sevenDay: { utilization: 99, resetsAt: null } }))).toBe(false)
  })

  test('is false for a login nothing has been measured for', () => {
    expect(usageExhausted(undefined)).toBe(false)
  })
})

describe('every window a snapshot carries', () => {
  test('a Claude plan is the table in order, then the windows it meters per model', () => {
    const usage = claudeUsage({
      fiveHour: { utilization: 4, resetsAt: null },
      sevenDay: { utilization: 74, resetsAt: null },
      extraUsage: { isEnabled: true, monthlyLimit: 100, usedCredits: 5, utilization: 5, currency: null },
      sevenDayOverage: { utilization: 97, resetsAt: null },
      sevenDaySonnet: { utilization: 12, resetsAt: null },
      modelScoped: [{ displayName: 'Fable', utilization: 60, resetsAt: null }]
    })

    expect(allUsageWindows(usage).map((window) => [window.key, window.label, window.name])).toEqual([
      ['five_hour', '5 hour', '5 hour'],
      ['seven_day', '7 day', '7 day'],
      ['seven_day_overage_included', '7 day (extra usage)', '7 day (extra usage)'],
      ['seven_day_sonnet', '7 day Sonnet', '7 day Sonnet'],
      ['Fable', 'Fable', 'Fable 7 day']
    ])
  })

  test('a Codex plan is the windows the server named, less the hidden one', () => {
    expect(allUsageWindows(codexUsage()).map((window) => window.key))
      .toEqual(['codex:primary'])
  })

  test('a login nothing has been measured for has none', () => {
    expect(allUsageWindows(null)).toEqual([])
    expect(allUsageWindows(claudeUsage())).toEqual([])
  })
})

describe("the windows that are the plan's own", () => {
  test('a Claude plan runs out of its five-hour and its two seven-day windows', () => {
    const usage = claudeUsage({
      fiveHour: { utilization: 4, resetsAt: null },
      sevenDay: { utilization: 74, resetsAt: null },
      extraUsage: { isEnabled: true, monthlyLimit: 100, usedCredits: 5, utilization: 5, currency: null },
      sevenDayOverage: { utilization: 97, resetsAt: null },
      sevenDayOpus: { utilization: 100, resetsAt: null },
      modelScoped: [{ displayName: 'Fable', utilization: 100, resetsAt: null }]
    })

    expect(planUsageWindows(usage).map((window) => window.key))
      .toEqual(['five_hour', 'seven_day', 'seven_day_overage_included'])
  })

  test('a window that meters one model does not use the plan up', () => {
    expect(busiestPlanWindow(claudeUsage({ sevenDayOpus: { utilization: 100, resetsAt: null },
      fiveHour: { utilization: 20, resetsAt: null } }))?.key).toBe('five_hour')
    const usage = claudeUsage({ sevenDayOpus: { utilization: 100, resetsAt: null } })

    expect(usageExhausted(usage)).toBe(false)
    expect(usageExhausted(claudeUsage({
      extraUsage: { isEnabled: true, monthlyLimit: 100, usedCredits: 5, utilization: 5, currency: null },
      sevenDayOverage: { utilization: 100, resetsAt: null }
    }))).toBe(true)
  })
})

describe('when the plan comes back', () => {
  const EARLY = '2026-09-05T18:00:00.000Z'
  const LATE = '2026-09-08T12:00:00.000Z'

  test('the latest reset among the windows that are at or over their limit', () => {
    const usage = claudeUsage({
      fiveHour: { utilization: 100, resetsAt: EARLY },
      sevenDay: { utilization: 100, resetsAt: LATE },
      sevenDayOpus: { utilization: 12, resetsAt: '2026-09-20T12:00:00.000Z' }
    })

    expect(resetsAtFromUsage(usage)).toBe(LATE)
  })

  test('a login with room answers with nothing', () => {
    expect(resetsAtFromUsage(claudeUsage({ fiveHour: { utilization: 42, resetsAt: EARLY } }))).toBeNull()
    expect(resetsAtFromUsage(null)).toBeNull()
  })

  // A refusal on a window the plan reports no percentage for would otherwise have no time to
  // name.
  test('a refusal falls back to the window it named', () => {
    const usage = claudeUsage({
      status: 'rejected',
      fiveHour: { utilization: 3, resetsAt: EARLY },
      limited: { window: 'seven_day_opus', utilization: null, threshold: null, resetsAt: LATE }
    })

    expect(resetsAtFromUsage(usage)).toBe(LATE)
  })

  test('and then to the busiest window that has a reset time', () => {
    const usage = claudeUsage({
      status: 'rejected',
      fiveHour: { utilization: 3, resetsAt: EARLY },
      sevenDay: { utilization: 88, resetsAt: LATE }
    })

    expect(resetsAtFromUsage(usage)).toBe(LATE)
  })

  test('a full window that meters one model does not make the plan come back later', () => {
    const usage = claudeUsage({
      fiveHour: { utilization: 10, resetsAt: EARLY },
      sevenDayOpus: { utilization: 100, resetsAt: LATE }
    })

    expect(resetsAtFromUsage(usage)).toBeNull()
  })
})

describe('the weekly windows', () => {
  test('are the windows seven days long, which the weekly limit is measured against', () => {
    const windows = allUsageWindows(claudeUsage({
      fiveHour: { utilization: 1, resetsAt: null },
      sevenDay: { utilization: 2, resetsAt: null }
    }))
    expect(windows.map((window) => [window.key, isSevenDayWindow(window)]))
      .toEqual([['five_hour', false], ['seven_day', true]])
    expect(allUsageWindows(codexUsage()).map((window) => isSevenDayWindow(window))).toEqual([true])
  })
})
