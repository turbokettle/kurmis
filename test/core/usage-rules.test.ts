// The shared rules over a usage snapshot: which windows are shown, which are the plan's own,
// and when a used-up login comes back.
import { describe, expect, test } from 'vitest'
import { emptyAccountUsage } from '../../src/core/usage.ts'
import {
  allUsageWindows,
  busiestPlanWindow,
  isSevenDayWindow,
  planUsageWindows,
  resetsAtFromUsage
} from '../../src/core/usage-rules.ts'
import type { AccountUsage } from '../../src/core/claude-usage.ts'

const NOW = Date.parse('2026-09-05T12:00:00.000Z')

function claudeUsage(overrides: Partial<AccountUsage> = {}): AccountUsage {
  return { ...emptyAccountUsage('ownclaude1', NOW), rateLimitsAvailable: true, ...overrides }
}

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

    expect(allUsageWindows(usage).map((window) => [window.key, window.label])).toEqual([
      ['five_hour', '5 hour'],
      ['seven_day', '7 day'],
      ['seven_day_overage_included', '7 day (extra usage)'],
      ['seven_day_sonnet', '7 day Sonnet'],
      ['Fable', 'Fable']
    ])
  })

  test('a per-model entry that repeats the Opus or Sonnet window is shown once, under its fixed key', () => {
    const RESET = '2026-09-09T20:00:00.000Z'
    const usage = claudeUsage({
      sevenDayOpus: { utilization: 4, resetsAt: RESET },
      sevenDaySonnet: { utilization: 9, resetsAt: '2026-09-09T20:00:00Z' },
      modelScoped: [
        { displayName: 'Opus', utilization: 4, resetsAt: RESET },
        { displayName: 'sonnet', utilization: 9, resetsAt: RESET },
        { displayName: 'Fable', utilization: 4, resetsAt: RESET }
      ]
    })

    expect(allUsageWindows(usage).map((window) => window.key)).toEqual(['seven_day_opus', 'seven_day_sonnet', 'Fable'])
    // The stored snapshot keeps both.
    expect(usage.modelScoped).toHaveLength(3)
  })

  test('a per-model entry with other figures than the window of the same name is shown beside it', () => {
    const RESET = '2026-09-09T20:00:00.000Z'
    const usage = claudeUsage({
      sevenDayOpus: { utilization: 4, resetsAt: RESET },
      modelScoped: [
        { displayName: 'Opus', utilization: 30, resetsAt: RESET },
        { displayName: 'Sonnet', utilization: 9, resetsAt: RESET }
      ]
    })

    expect(allUsageWindows(usage).map((window) => window.key)).toEqual(['seven_day_opus', 'Opus', 'Sonnet'])
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
    expect(busiestPlanWindow(claudeUsage({ sevenDayOpus: { utilization: 100, resetsAt: null } }))).toBeNull()
    expect(busiestPlanWindow(claudeUsage({
      extraUsage: { isEnabled: true, monthlyLimit: 100, usedCredits: 5, utilization: 5, currency: null },
      sevenDayOverage: { utilization: 100, resetsAt: null }
    }))?.key).toBe('seven_day_overage_included')
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
      limited: { window: 'seven_day_opus', utilization: null, resetsAt: LATE }
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
  })
})
