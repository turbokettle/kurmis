import { describe, expect, test } from 'vitest'
import { countdownIn, parseTime, resetIn, resetsInText, spanText } from '../../src/core/countdown.ts'

const NOW = Date.parse('2026-09-13T01:10:00.000Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('a time', () => {
  test('reads an ISO string, a millisecond count and a Date, and nothing else', () => {
    expect(parseTime('2026-09-13T01:10:00.000Z')).toBe(NOW)
    expect(parseTime(NOW)).toBe(NOW)
    expect(parseTime(new Date(NOW))).toBe(NOW)
    expect(parseTime('soon')).toBeNull()
    expect(parseTime(null)).toBeNull()
  })
})

describe('a span of time', () => {
  test('at most two units, minutes floored', () => {
    expect(spanText(45 * MINUTE)).toBe('45m')
    expect(spanText(90 * MINUTE + 59_000)).toBe('1h 30m')
    expect(spanText(3 * HOUR)).toBe('3h')
    expect(spanText(2 * DAY)).toBe('2d')
    expect(spanText(4 * DAY + 3 * HOUR + 20 * MINUTE)).toBe('4d 3h')
  })

  test('a span that has already gone is nothing at all', () => {
    expect(spanText(-HOUR)).toBe('0m')
  })
})

describe('the phrases built on it', () => {
  test('"resets in" is written once, and says nothing about a reset that has passed', () => {
    expect(resetsInText('2026-09-13T05:16:00.000Z', NOW)).toBe('resets in 4h 6m')
    expect(resetsInText('2026-09-13T01:10:00.000Z', NOW)).toBeNull()
    expect(resetsInText(null, NOW)).toBeNull()
  })

  test('a reset under a minute away is now', () => {
    expect(resetIn(NOW + 59_000, NOW)).toBe('now')
    expect(resetIn(NOW + 61_000, NOW)).toBe('1m')
    expect(resetIn('not a time', NOW)).toBeNull()
  })

  test('a countdown reads as "in", and as "now" once the moment is here', () => {
    expect(countdownIn(NOW + 2 * HOUR + 10 * MINUTE, NOW)).toBe('in 2h 10m')
    expect(countdownIn(NOW - MINUTE, NOW)).toBe('now')
    expect(countdownIn(undefined, NOW)).toBeNull()
  })
})
