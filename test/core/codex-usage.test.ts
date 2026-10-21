// Turning the Codex app-server's rate-limit answers into the shape the account
// cards read. The fixture is what `account/rateLimits/read` answered for a real
// prolite account, trimmed to the fields the conversion touches.
import { describe, expect, test } from 'vitest'
import {
  bankedResetsOf,
  codexWindowLabel,
  emptyCodexUsage,
  usageFromCodexRateLimits,
  usageFromCodexSnapshot
} from '../../src/core/codex-usage.ts'
import { resetsAtFromUsage } from '../../src/core/usage-rules.ts'
import type * as v2 from '../../src/core/codex-protocol.ts'

const NOW = Date.parse('2026-09-05T12:00:00.000Z')
/** A day after NOW, so a window's reset reads back as an ISO string. */
const RESET_ISO = '2026-09-06T12:00:00.000Z'
const RESET_SECONDS = Date.parse(RESET_ISO) / 1000

function snapshot(overrides: Partial<v2.RateLimitSnapshot> = {}): v2.RateLimitSnapshot {
  return {
    limitId: 'codex',
    limitName: null,
    normalModelSlug: null,
    primary: { usedPercent: 24, windowDurationMins: 10080, resetsAt: RESET_SECONDS },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    individualLimit: null,
    spendControlReached: false,
    planType: 'prolite',
    rateLimitReachedType: null,
    ...overrides
  }
}

const SPARK: v2.RateLimitSnapshot = snapshot({
  limitId: 'codex_bengalfox',
  limitName: 'GPT-5.3-Codex-Spark',
  primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: RESET_SECONDS },
  secondary: { usedPercent: 45, windowDurationMins: 10080, resetsAt: RESET_SECONDS },
  credits: null,
  spendControlReached: null
})

describe('codexWindowLabel', () => {
  test('names a window by how long it is', () => {
    expect(codexWindowLabel(300)).toBe('5h')
    expect(codexWindowLabel(10080)).toBe('7d')
    expect(codexWindowLabel(43200)).toBe('30d')
    expect(codexWindowLabel(30)).toBe('30m')
    expect(codexWindowLabel(null)).toBe('window')
  })
})

describe('a rate-limits read', () => {
  test('names every window by the limit it belongs to and how long it is', () => {
    const usage = usageFromCodexRateLimits(
      'codex:abc',
      { rateLimits: snapshot(), rateLimitsByLimitId: { codex: snapshot(), codex_bengalfox: SPARK } },
      NOW
    )

    expect(usage.provider).toBe('codex')
    expect(usage.subscriptionType).toBe('prolite')
    expect(usage.rateLimitsAvailable).toBe(true)
    expect(usage.windows?.map((window) => window.label)).toEqual([
      'GPT-5.3-Codex-Spark 5h',
      'Codex 7d',
      'GPT-5.3-Codex-Spark 7d'
    ])
    // The plan's general limit carries no name of its own, and the hover says so.
    expect(usage.windows?.[1]?.group).toBe('Codex')
    expect(usage.windows?.[1]?.title).toContain('general Codex limit')
    expect(usage.windows?.[0]?.title).toContain('metered on its own')
    expect(usage.windows?.map((window) => window.utilization)).toEqual([0, 24, 45])
    expect(usage.windows?.[0]?.resetsAt).toBe(RESET_ISO)
    expect(usage.creditBalance).toBe('0')
  })

  test('falls back to the single bucket when there is no multi-limit map', () => {
    const usage = usageFromCodexRateLimits('codex:abc', { rateLimits: snapshot() }, NOW)

    expect(usage.windows?.map((window) => window.key)).toEqual(['codex:primary'])
  })

  test('a read that answered nothing leaves the snapshot empty rather than wrong', () => {
    const usage = usageFromCodexRateLimits('codex:abc', null, NOW)

    expect(usage.windows).toEqual([])
    expect(usage.rateLimitsAvailable).toBe(false)
    expect(usage.status).toBeNull()
  })

  test('a reached limit reads as rejected', () => {
    const usage = usageFromCodexRateLimits(
      'codex:abc',
      { rateLimits: snapshot({ rateLimitReachedType: 'rate_limit_reached' }) },
      NOW
    )

    expect(usage.status).toBe('rejected')
  })
})

describe('a live snapshot from a running session', () => {
  test('replaces the windows of the limit it names and keeps the rest', () => {
    const previous = usageFromCodexRateLimits(
      'codex:abc',
      { rateLimits: snapshot(), rateLimitsByLimitId: { codex: snapshot(), codex_bengalfox: SPARK } },
      NOW
    )

    const next = usageFromCodexSnapshot(
      'codex:abc',
      previous,
      snapshot({ primary: { usedPercent: 88, windowDurationMins: 10080, resetsAt: RESET_SECONDS } }),
      NOW + 1000
    )

    expect(next.source).toBe('session')
    expect(next.windows?.map((window) => window.key)).toEqual([
      'codex_bengalfox:primary',
      'codex:primary',
      'codex_bengalfox:secondary'
    ])
    expect(next.windows?.find((window) => window.key === 'codex:primary')?.utilization).toBe(88)
  })

  test('a notification with no snapshot only moves the timestamp on', () => {
    const previous = emptyCodexUsage('codex:abc', NOW)

    const next = usageFromCodexSnapshot('codex:abc', previous, null, NOW + 1000)

    expect(next.fetchedAt).toBe(NOW + 1000)
    expect(next.windows).toEqual([])
  })
})

describe('the reset time a waiting session uses', () => {
  test('reads the Codex windows that are at or over their limit', () => {
    const usage = usageFromCodexRateLimits(
      'codex:abc',
      {
        rateLimits: snapshot({
          primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: RESET_SECONDS }
        })
      },
      NOW
    )

    expect(resetsAtFromUsage(usage)).toBe(RESET_ISO)
  })

  test('says nothing while every window still has room', () => {
    const usage = usageFromCodexRateLimits('codex:abc', { rateLimits: snapshot() }, NOW)

    expect(resetsAtFromUsage(usage)).toBeNull()
  })
})

describe('banked resets', () => {
  const credit = (id: string, status: v2.RateLimitResetCreditStatus, expiresAt: number | null): v2.RateLimitResetCredit => ({
    id, resetType: 'codexRateLimits', status, grantedAt: RESET_SECONDS - 86400, expiresAt, title: null, description: null
  })

  test('counts the available ones and lists when each runs out, soonest first', () => {
    const usage = usageFromCodexRateLimits('codex:abc', {
      rateLimits: snapshot(),
      // The wire carries a plain number where the generated type says bigint.
      rateLimitResetCredits: {
        availableCount: 3 as unknown as bigint,
        credits: [
          credit('never', 'available', null),
          credit('late', 'available', RESET_SECONDS + 86400),
          credit('spent', 'redeemed', RESET_SECONDS - 3600),
          credit('soon', 'available', RESET_SECONDS)
        ]
      }
    }, NOW)

    expect(usage.bankedResets).toEqual({
      count: 3,
      expiresAt: [RESET_ISO, '2026-09-07T12:00:00.000Z', null]
    })
  })

  test('keeps the count when the server describes none of them', () => {
    expect(bankedResetsOf({ availableCount: 2 as unknown as bigint, credits: null })).toEqual({ count: 2, expiresAt: [] })
  })

  test('is null when the read did not mention them, and zero when it has none', () => {
    expect(usageFromCodexRateLimits('codex:abc', { rateLimits: snapshot() }, NOW).bankedResets).toBeNull()
    expect(bankedResetsOf({ availableCount: 0 as unknown as bigint, credits: [] })).toEqual({ count: 0, expiresAt: [] })
  })

  test('survives a session’s rate-limit update, which does not carry them', () => {
    const read = usageFromCodexRateLimits('codex:abc', {
      rateLimits: snapshot(),
      rateLimitResetCredits: { availableCount: 1 as unknown as bigint, credits: [credit('a', 'available', RESET_SECONDS)] }
    }, NOW)

    const updated = usageFromCodexSnapshot('codex:abc', read, snapshot({ primary: null }), NOW + 1000)

    expect(updated.bankedResets).toEqual({ count: 1, expiresAt: [RESET_ISO] })
  })
})
