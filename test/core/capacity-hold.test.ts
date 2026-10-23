// The proxy's capacity hold, as rules: which answers mean Anthropic had no room rather than a
// used-up login, the backoff between tries, the per-session cooling, and the 529 a hold that
// lasted too long is given back as.
import { describe, expect, test } from 'vitest'
import {
  CAPACITY_HOLD_BASE_MS,
  CAPACITY_HOLD_MAX_MS,
  CAPACITY_HOLD_MS,
  CAPACITY_STREAK_MS,
  CapacityCooling,
  capacityHoldAnswer,
  capacityHoldDelayMs,
  capacityRefusal,
  retryAfterMs
} from '../../src/core/capacity-hold.ts'

describe('capacityRefusal', () => {
  test('a 529 and a 429 that names no usage limit are a want of capacity', () => {
    expect(capacityRefusal(529, false)).toBe('529 Overloaded')
    expect(capacityRefusal(429, false)).toBe('429 Too Many Requests')
  })

  test('a usage limit and every other answer are not', () => {
    expect(capacityRefusal(429, true)).toBeNull()
    for (const status of [200, 400, 401, 500, 502, 503, 504, 599]) expect(capacityRefusal(status, false)).toBeNull()
  })
})

describe('the backoff', () => {
  test('doubles from the base up to the ceiling, with up to half again of jitter', () => {
    expect(capacityHoldDelayMs(1, null, 0)).toBe(CAPACITY_HOLD_BASE_MS)
    expect(capacityHoldDelayMs(2, null, 0)).toBe(CAPACITY_HOLD_BASE_MS * 2)
    expect(capacityHoldDelayMs(20, null, 0)).toBe(CAPACITY_HOLD_MAX_MS)
    expect(capacityHoldDelayMs(1, null, 1)).toBe(CAPACITY_HOLD_BASE_MS * 1.5)
    expect(capacityHoldDelayMs(1, null, Number.NaN)).toBe(CAPACITY_HOLD_BASE_MS)
  })

  test('never waits less than the answer asked for', () => {
    expect(capacityHoldDelayMs(1, 12_000, 0)).toBe(12_000)
    expect(capacityHoldDelayMs(3, 1_000, 0)).toBe(CAPACITY_HOLD_BASE_MS * 4)
  })

  test('a ceiling below the base waits the base', () => {
    expect(capacityHoldDelayMs(3, null, 0, 400, 100)).toBe(400)
  })

  test('reads retry-after in seconds, and nothing else', () => {
    expect(retryAfterMs('2')).toBe(2000)
    expect(retryAfterMs('0.5')).toBe(500)
    expect(retryAfterMs(null)).toBeNull()
    expect(retryAfterMs('')).toBeNull()
    expect(retryAfterMs('Wed, 21 Oct 2026 07:28:00 GMT')).toBeNull()
  })

  test('a hold stays well inside the CLI\'s three minutes for a first byte, with Anthropic\'s answer on top', () => {
    expect(CAPACITY_HOLD_MS + 30_000).toBeLessThan(180_000)
  })
})

test('a hold given back is a 529 the CLI retries within its one-minute limit on a wait', () => {
  const answer = capacityHoldAnswer('529 Overloaded', 120_400)
  expect(answer.status).toBe(529)
  expect(Number(answer.headers['retry-after'])).toBeLessThanOrEqual(60)
  expect(JSON.parse(answer.body)).toEqual({ type: 'error', error: { type: 'overloaded_error',
    message: "Anthropic's API had no capacity for this request (529 Overloaded) for 120 s. The kurmis proxy holds it again when it is sent again." } })
})

describe('the cooling of one session', () => {
  const NOW = Date.parse('2026-10-15T10:00:00Z')

  test('each answer in a row backs the login off longer, and another session is not affected', () => {
    const cooling = new CapacityCooling()
    expect(cooling.noteNoCapacity('s1', 'aclaude', '529 Overloaded', null, 0, NOW))
      .toEqual({ attempt: 1, delayMs: CAPACITY_HOLD_BASE_MS, until: NOW + CAPACITY_HOLD_BASE_MS })
    expect(cooling.noteNoCapacity('s1', 'bclaude', '529 Overloaded', null, 0, NOW + 1000).attempt).toBe(2)
    expect(cooling.coolingOf('s2', NOW)).toBeNull()
    expect(cooling.noteNoCapacity('s2', 'aclaude', '529 Overloaded', null, 0, NOW + 1000).attempt).toBe(1)
  })

  test('a retry-after longer than the backoff is waited, and a shorter later backoff does not cut it short', () => {
    const cooling = new CapacityCooling()
    cooling.noteNoCapacity('s1', 'aclaude', '429 Too Many Requests', '600', 0, NOW)
    const later = cooling.noteNoCapacity('s1', 'aclaude', '529 Overloaded', null, 0, NOW + 1000)
    expect(later.until).toBe(NOW + 600_000)
    expect(cooling.coolingOf('s1', NOW + 1000)?.reason).toBe('529 Overloaded')
  })

  test('a login stops cooling once its backoff is over, and the session with it', () => {
    const cooling = new CapacityCooling()
    cooling.noteNoCapacity('s1', 'aclaude', '529 Overloaded', null, 0, NOW)
    expect(cooling.coolingOf('s1', NOW + CAPACITY_HOLD_BASE_MS - 1)?.logins.get('aclaude')).toBe(NOW + CAPACITY_HOLD_BASE_MS)
    expect(cooling.coolingOf('s1', NOW + CAPACITY_HOLD_BASE_MS)).toBeNull()
  })

  test('the count in a row starts over after an answer with room, or after ten quiet minutes', () => {
    const cooling = new CapacityCooling()
    cooling.noteNoCapacity('s1', 'aclaude', '529 Overloaded', null, 0, NOW)
    cooling.noteAnswered('s1')
    expect(cooling.noteNoCapacity('s1', 'aclaude', '529 Overloaded', null, 0, NOW + 1).attempt).toBe(1)
    expect(cooling.noteNoCapacity('s1', 'aclaude', '529 Overloaded', null, 0, NOW + 2).attempt).toBe(2)
    expect(cooling.noteNoCapacity('s1', 'aclaude', '529 Overloaded', null, 0, NOW + 3 + CAPACITY_STREAK_MS).attempt).toBe(1)
  })

  test('a held request waits only for logins the session may still use, until the first of them is free', () => {
    const cooling = new CapacityCooling({ baseMs: 1000, maxMs: 1000 })
    cooling.noteNoCapacity('s1', 'aclaude', '529 Overloaded', '20', 0, NOW)
    cooling.noteNoCapacity('s1', 'bclaude', '529 Overloaded', null, 0, NOW)
    expect(cooling.waitFor('s1', new Set(['aclaude', 'bclaude']), NOW))
      .toEqual({ cooling: new Set(['aclaude', 'bclaude']), wakeAt: NOW + 1000 })
    expect(cooling.waitFor('s1', new Set(['aclaude']), NOW))
      .toEqual({ cooling: new Set(['aclaude']), wakeAt: NOW + 20_000 })
    expect(cooling.waitFor('s1', new Set(), NOW)).toEqual({ cooling: new Set(), wakeAt: null })
  })
})
