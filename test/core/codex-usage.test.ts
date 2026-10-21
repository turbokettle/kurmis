// Turning the Codex app-server's `account/rateLimits/read` answer into a login's usage.
// The fixture has the shape of an answer for a `prolite` plan, which meters one model apart from
// the general limit, trimmed to the fields the conversion reads.
import { describe, expect, test } from 'vitest'
import {
  CODEX_GENERAL_LIMIT_ID,
  bankedResetsOf,
  codexUsageFromResult,
  codexWindowKey,
  codexWindowLabel,
  codexWindowLimitId,
  emptyCodexUsage,
  parseCodexRateLimitsRead,
  usageFromCodexRateLimits
} from '../../src/core/codex-usage.ts'
import { resetsAtFromUsage } from '../../src/core/usage-rules.ts'
import type * as v2 from '../../src/core/codex-protocol.ts'

const NOW = Date.parse('2030-01-05T12:00:00.000Z')
/** A day after NOW, so a window's reset reads back as an ISO string. */
const RESET_ISO = '2030-01-06T12:00:00.000Z'
const RESET_SECONDS = Date.parse(RESET_ISO) / 1000

function snapshot(overrides: Partial<v2.RateLimitSnapshot> = {}): v2.RateLimitSnapshot {
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

/** A model the plan meters apart from its general limit. */
const SPARK: v2.RateLimitSnapshot = snapshot({
  limitId: 'codex_bengalfox',
  limitName: 'GPT-5.3-Codex-Spark',
  primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: RESET_SECONDS },
  secondary: { usedPercent: 45, windowDurationMins: 10080, resetsAt: RESET_SECONDS },
  credits: null,
  spendControlReached: null
})

function credit(status: v2.RateLimitResetCreditStatus, expiresAt: number | null): v2.RateLimitResetCredit {
  return { status, expiresAt }
}

describe('codexWindowLabel', () => {
  test('names a window by how long it is', () => {
    expect(codexWindowLabel(300)).toBe('5h')
    expect(codexWindowLabel(10080)).toBe('7d')
    expect(codexWindowLabel(43200)).toBe('30d')
    expect(codexWindowLabel(30)).toBe('30m')
    expect(codexWindowLabel(270)).toBe('4.5h')
    expect(codexWindowLabel(null)).toBe('window')
  })
})

describe('window keys', () => {
  test('read back the limit they belong to', () => {
    expect(codexWindowKey(CODEX_GENERAL_LIMIT_ID, 'primary')).toBe('codex:primary')
    expect(codexWindowLimitId('codex_bengalfox:secondary')).toBe('codex_bengalfox')
    expect(codexWindowLimitId('codex')).toBe('codex')
  })
})

describe('a rate-limits read', () => {
  test('names every window by the limit it belongs to and how long it is', () => {
    const usage = usageFromCodexRateLimits(
      'codex:work',
      { rateLimits: snapshot(), rateLimitsByLimitId: { codex: snapshot(), codex_bengalfox: SPARK } },
      NOW
    )

    expect(usage.accountId).toBe('codex:work')
    expect(usage.provider).toBe('codex')
    expect(usage.source).toBe('probe')
    expect(usage.subscriptionType).toBe('prolite')
    expect(usage.rateLimitsAvailable).toBe(true)
    expect(usage.windows?.map((window) => window.label)).toEqual([
      'GPT-5.3-Codex-Spark 5h',
      'Codex 7d',
      'GPT-5.3-Codex-Spark 7d'
    ])
    // The plan's general limit carries no name of its own.
    expect(usage.windows?.[1]?.group).toBe('Codex')
    expect(usage.windows?.[0]?.group).toBe('GPT-5.3-Codex-Spark')
    expect(usage.windows?.map((window) => window.utilization)).toEqual([0, 24, 45])
    expect(usage.windows?.[0]?.resetsAt).toBe(RESET_ISO)
    expect(usage.creditBalance).toBe('0')
  })

  test('falls back to the single bucket when there is no multi-limit map', () => {
    const usage = usageFromCodexRateLimits('codex:work', { rateLimits: snapshot() }, NOW)

    expect(usage.windows?.map((window) => window.key)).toEqual(['codex:primary'])
  })

  test('names a limit without a name or a known id by its id', () => {
    const usage = usageFromCodexRateLimits(
      'codex:work',
      { rateLimits: snapshot({ limitId: 'codex_other', limitName: '' }) },
      NOW
    )

    expect(usage.windows?.map((window) => window.label)).toEqual(['codex_other 7d'])
  })

  test('a read that answered nothing leaves the snapshot empty rather than wrong', () => {
    const usage = usageFromCodexRateLimits('codex:work', null, NOW)

    expect(usage).toEqual(emptyCodexUsage('codex:work', NOW))
    expect(usage.windows).toEqual([])
    expect(usage.rateLimitsAvailable).toBe(false)
    expect(usage.status).toBeNull()
  })

  test('a reached limit reads as rejected', () => {
    const usage = usageFromCodexRateLimits(
      'codex:work',
      { rateLimits: snapshot({ rateLimitReachedType: 'rate_limit_reached' }) },
      NOW
    )

    expect(usage.status).toBe('rejected')
  })

  // A limit on one model stops that model only, so the login can still be used.
  test('a reached limit on one model alone does not read as rejected', () => {
    const usage = usageFromCodexRateLimits(
      'codex:work',
      { rateLimits: snapshot(), rateLimitsByLimitId: { codex: snapshot(), codex_bengalfox: { ...SPARK, rateLimitReachedType: 'rate_limit_reached' } } },
      NOW
    )

    expect(usage.status).toBeNull()
  })

  test('a reached general limit reads as rejected beside a model limit with room', () => {
    const usage = usageFromCodexRateLimits(
      'codex:work',
      { rateLimitsByLimitId: { codex: snapshot({ rateLimitReachedType: 'rate_limit_reached' }), codex_bengalfox: SPARK } },
      NOW
    )

    expect(usage.status).toBe('rejected')
  })

  test('a reached limit counts from any bucket when none is the general limit', () => {
    const usage = usageFromCodexRateLimits(
      'codex:work',
      { rateLimitsByLimitId: { codex_other: snapshot({ limitId: 'codex_other', rateLimitReachedType: 'rate_limit_reached' }) } },
      NOW
    )

    expect(usage.status).toBe('rejected')
  })

  test('a spending control reached on a model bucket reads as rejected', () => {
    const usage = usageFromCodexRateLimits(
      'codex:work',
      { rateLimitsByLimitId: { codex: snapshot(), codex_bengalfox: { ...SPARK, spendControlReached: true } } },
      NOW
    )

    expect(usage.status).toBe('rejected')
  })

  test('a reached spending control reads as rejected', () => {
    const usage = usageFromCodexRateLimits('codex:work', { rateLimits: snapshot({ spendControlReached: true }) }, NOW)

    expect(usage.status).toBe('rejected')
  })
})

describe('the reset time a waiting session uses', () => {
  test('reads the Codex windows that are at or over their limit', () => {
    const usage = usageFromCodexRateLimits(
      'codex:work',
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
    const usage = usageFromCodexRateLimits('codex:work', { rateLimits: snapshot() }, NOW)

    expect(resetsAtFromUsage(usage)).toBeNull()
  })
})

describe('banked resets', () => {
  test('counts the available ones and lists when each runs out, soonest first', () => {
    const usage = usageFromCodexRateLimits('codex:work', {
      rateLimits: snapshot(),
      rateLimitResetCredits: {
        availableCount: 3,
        credits: [
          credit('available', null),
          credit('available', RESET_SECONDS + 86400),
          credit('redeemed', RESET_SECONDS - 3600),
          credit('available', RESET_SECONDS)
        ]
      }
    }, NOW)

    expect(usage.bankedResets).toEqual({
      count: 3,
      expiresAt: [RESET_ISO, '2030-01-07T12:00:00.000Z', null]
    })
  })

  test('keeps the count when the server describes none of them', () => {
    expect(bankedResetsOf({ availableCount: 2, credits: null })).toEqual({ count: 2, expiresAt: [] })
  })

  test('counts the listed ones when the count is lower', () => {
    expect(bankedResetsOf({ availableCount: 0, credits: [credit('available', null)] })).toEqual({ count: 1, expiresAt: [null] })
  })

  test('is null when the read did not mention them, and zero when it has none', () => {
    expect(usageFromCodexRateLimits('codex:work', { rateLimits: snapshot() }, NOW).bankedResets).toBeNull()
    expect(bankedResetsOf({ availableCount: 0, credits: [] })).toEqual({ count: 0, expiresAt: [] })
  })
})

describe('the raw JSON-RPC result', () => {
  /** An answer as the server writes it, with fields the conversion does not read. */
  const wire = {
    ordinaryUsageAllowed: true,
    rateLimits: {
      limitId: 'codex',
      limitName: null,
      normalModelSlug: null,
      primary: { usedPercent: 24, windowDurationMins: 10080, resetsAt: RESET_SECONDS },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: '0' },
      individualLimit: null,
      spendControlReached: false,
      planType: 'prolite',
      rateLimitReachedType: null
    },
    rateLimitsByLimitId: null,
    // A plain JSON number, though the generated type says bigint.
    rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'credit-1', resetType: 'codexRateLimits', status: 'available', grantedAt: RESET_SECONDS - 86400, expiresAt: null, title: null, description: null }] },
    accountId: 'account-id-1',
    rateLimitUpsell: null
  }

  test('reads a whole answer into the same usage as the checked one', () => {
    const usage = codexUsageFromResult('codex:work', wire, NOW)

    expect(usage).toEqual(usageFromCodexRateLimits('codex:work', {
      rateLimits: snapshot(),
      rateLimitsByLimitId: null,
      rateLimitResetCredits: { availableCount: 1, credits: [credit('available', null)] }
    }, NOW))
    expect(usage?.bankedResets).toEqual({ count: 1, expiresAt: [null] })
  })

  test('answers null for a result that is not an object, and never throws', () => {
    for (const result of [null, undefined, 'ok', 42, true, []]) {
      expect(codexUsageFromResult('codex:work', result, NOW)).toBeNull()
      expect(parseCodexRateLimitsRead(result)).toBeNull()
    }
  })

  test('reads an empty object as a read with nothing in it', () => {
    expect(codexUsageFromResult('codex:work', {}, NOW)).toEqual(emptyCodexUsage('codex:work', NOW))
  })

  test('leaves out the parts that have the wrong shape and keeps the rest', () => {
    const usage = codexUsageFromResult('codex:work', {
      rateLimits: 'broken',
      rateLimitsByLimitId: {
        codex: { ...wire.rateLimits, primary: { usedPercent: '24' }, secondary: { usedPercent: 50, windowDurationMins: 'week', resetsAt: 'soon' } },
        broken: 7,
        other: { limitId: 'codex_other', limitName: 42, primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: RESET_SECONDS }, spendControlReached: 'yes' }
      },
      rateLimitResetCredits: { availableCount: 'three', credits: [null, { status: 7 }, { status: 'available', expiresAt: 'later' }] }
    }, NOW)

    expect(usage?.windows).toEqual([
      { key: 'codex_other:primary', label: 'codex_other 5h', group: 'codex_other', windowDurationMins: 300, utilization: 10, resetsAt: RESET_ISO },
      { key: 'codex:secondary', label: 'Codex window', group: 'Codex', windowDurationMins: null, utilization: 50, resetsAt: null }
    ])
    expect(usage?.status).toBeNull()
    expect(usage?.subscriptionType).toBe('prolite')
    expect(usage?.creditBalance).toBeNull()
    expect(usage?.bankedResets).toEqual({ count: 1, expiresAt: [null] })
  })

  test('takes a limit id that names a property of every object as an ordinary key', () => {
    const read = parseCodexRateLimitsRead(JSON.parse('{"rateLimitsByLimitId":{"__proto__":{"limitId":"codex","primary":{"usedPercent":5,"windowDurationMins":300,"resetsAt":null}}}}'))

    expect(Object.keys(read?.rateLimitsByLimitId ?? {})).toEqual(['__proto__'])
    expect(usageFromCodexRateLimits('codex:work', read, NOW).windows?.map((window) => window.utilization)).toEqual([5])
  })
})
