// Usage snapshots and windows shared by the tests of the usage modules and of kurmis status.
import type { AccountUsage, UsageWindow } from '../../src/core/claude-usage.ts'

export function usageWindow(utilization: number, resetsAt: string | null = null): UsageWindow {
  return { utilization, resetsAt }
}

export function accountUsage(overrides: Partial<AccountUsage> = {}): AccountUsage {
  return {
    accountId: 'ownclaude1',
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
