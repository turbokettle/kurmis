// Usage snapshots and rate-limit reports shared by the tests of the usage modules.
import type { AccountUsage, UsageWindow } from '../../src/core/claude-usage.ts'

export function usageWindow(utilization: number, resetsAt: string | null = null): UsageWindow {
  return { utilization, resetsAt }
}

/**
 * A rate-limit report warning about the seven-day window that counts extra usage: that window
 * at 96% while the five-hour and plain seven-day windows were nowhere near their limits.
 */
export const OVERAGE_WARNING = {
  status: 'allowed_warning',
  resetsAt: 1_789_408_800,
  rateLimitType: 'seven_day_overage_included',
  utilization: 0.96,
  isUsingOverage: false,
  surpassedThreshold: 0.75,
  unifiedWindows: {
    five_hour: { utilization: 0.02, resetsAt: 1_789_267_200 },
    seven_day: { utilization: 0.73, resetsAt: 1_789_408_800 },
    seven_day_overage_included: { utilization: 0.96, resetsAt: 1_789_408_800 }
  }
}

export function accountUsage(overrides: Partial<AccountUsage> = {}): AccountUsage {
  return {
    accountId: 'ownclaude1',
    provider: 'claude',
    fetchedAt: 1_700_000_000_000,
    source: 'probe',
    subscriptionType: 'max',
    rateLimitsAvailable: true,
    fiveHour: null,
    sevenDay: null,
    sevenDayOverage: null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    modelScoped: [],
    extraUsage: null,
    status: null,
    limited: null,
    error: null,
    ...overrides
  }
}
