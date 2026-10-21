// A Codex usage snapshot with the plan's general limit (`codex`) in two windows, for the tests of
// the Codex login choice and `kurmis status`.
import type { AccountUsage } from '../../src/core/claude-usage.ts'
import { emptyCodexUsage } from '../../src/core/codex-usage.ts'

export interface CodexUsageOptions {
  fiveHour?: number
  weekly?: number
  fiveHourResetsAt?: string | null
  weeklyResetsAt?: string | null
  fetchedAt: number
}

export function codexUsage(id: string, options: CodexUsageOptions): AccountUsage {
  return {
    ...emptyCodexUsage(id, options.fetchedAt),
    subscriptionType: 'plus',
    rateLimitsAvailable: true,
    windows: [
      {
        key: 'codex:primary',
        label: 'Codex 5h',
        group: 'Codex',
        windowDurationMins: 300,
        utilization: options.fiveHour ?? 0,
        resetsAt: options.fiveHourResetsAt ?? null
      },
      {
        key: 'codex:secondary',
        label: 'Codex 7d',
        group: 'Codex',
        windowDurationMins: 7 * 24 * 60,
        utilization: options.weekly ?? 0,
        resetsAt: options.weeklyResetsAt ?? null
      }
    ]
  }
}
