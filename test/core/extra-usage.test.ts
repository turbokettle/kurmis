// The seven-day window with extra usage counted in. It counts only when extra usage is enabled
// and the window says something the plain seven-day window does not.
import { describe, expect, test } from 'vitest'
import type { AccountUsage } from '../../src/core/claude-usage.ts'
import { usageFromGetUsage, usageFromRateLimitEvent } from '../../src/core/usage.ts'
import { allUsageWindows, busiestPlanWindow, planUsageWindows } from '../../src/core/usage-rules.ts'

const NOW = Date.parse('2026-09-01T12:00:00Z')
const RESET = '2026-09-06T12:00:00.000Z'
const EXTRA_KEY = 'seven_day_overage_included'

function probe(enabled = false): AccountUsage {
  return usageFromGetUsage('exampleclaude', {
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 12, resets_at: RESET },
      seven_day: { utilization: 34, resets_at: RESET },
      model_scoped: [{ display_name: 'Fable', utilization: 45, resets_at: RESET }],
      extra_usage: {
        is_enabled: enabled, monthly_limit: 100, used_credits: 0, utilization: 0
      }
    }
  }, NOW)
}

function event(previous: AccountUsage | null, percent: number): AccountUsage {
  return usageFromRateLimitEvent('exampleclaude', previous, {
    status: 'allowed_warning',
    rateLimitType: EXTRA_KEY,
    utilization: percent / 100,
    surpassedThreshold: 0.75,
    resetsAt: Date.parse(RESET) / 1000,
    unifiedWindows: {
      seven_day: { utilization: 0.34, resetsAt: Date.parse(RESET) / 1000 },
      [EXTRA_KEY]: { utilization: percent / 100, resetsAt: Date.parse(RESET) / 1000 }
    }
  }, NOW + 1000)
}

function expectHidden(usage: AccountUsage): void {
  expect(allUsageWindows(usage).map((window) => window.key)).not.toContain(EXTRA_KEY)
  expect(planUsageWindows(usage).map((window) => window.key)).not.toContain(EXTRA_KEY)
}

describe('the extra-usage window', () => {
  test('a disabled one is left out of a probe and of a rate-limit report alike', () => {
    const probed = probe()
    const streamed = event(probed, 35)
    expect(probed.sevenDayOverage).toBeNull()
    expect(streamed.sevenDayOverage?.utilization).toBe(35)
    for (const usage of [probed, streamed]) {
      expect(allUsageWindows(usage).map((window) => window.label)).toEqual(['5 hour', '7 day', 'Fable'])
      expectHidden(usage)
    }
  })

  test('a disabled extra window cannot warn or exhaust the account even at 100%', () => {
    expectHidden(event(probe(false), 100))
  })

  test('a rate-limit report alone does not establish that extra usage is enabled', () => {
    expectHidden(event(null, 100))
  })

  test('enabled extra usage hides a mirror, including equivalent reset time formats', () => {
    const usage = event(probe(true), 34)
    usage.sevenDay = { utilization: 34, resetsAt: '2026-09-06T15:00:00+03:00' }
    expectHidden(usage)
  })

  test('enabled extra usage with distinct figures remains visible and counts toward limits', () => {
    const usage = event(probe(true), 100)
    expect(planUsageWindows(usage).map((window) => window.key)).toContain(EXTRA_KEY)
    expect(busiestPlanWindow(usage)?.key).toBe(EXTRA_KEY)
  })

  test('enabled windows with different resets or no plain window are not mirrors', () => {
    const usage = event(probe(true), 34)
    usage.sevenDay = { utilization: 34, resetsAt: '2026-09-07T12:00:00Z' }
    expect(allUsageWindows(usage).map((window) => window.key)).toContain(EXTRA_KEY)
    usage.sevenDay = null
    expect(allUsageWindows(usage).map((window) => window.key)).toContain(EXTRA_KEY)
  })

  test('a probe can provide the distinct extra window and can later disable it', () => {
    const raw = {
      rate_limits_available: true,
      rate_limits: {
        seven_day: { utilization: 34, resets_at: RESET },
        seven_day_overage_included: { utilization: 100, resets_at: RESET },
        extra_usage: { is_enabled: true }
      }
    }
    const enabled = usageFromGetUsage('exampleclaude', raw, NOW)
    expect(allUsageWindows(enabled).map((window) => window.key)).toContain(EXTRA_KEY)
    raw.rate_limits.extra_usage.is_enabled = false
    const disabled = usageFromGetUsage('exampleclaude', raw, NOW + 1000, enabled)
    expect(disabled.sevenDayOverage?.utilization).toBe(100)
    expectHidden(disabled)
  })
})
