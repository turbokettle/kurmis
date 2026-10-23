// The usage snapshot's window table and number helpers.
import { describe, expect, test } from 'vitest'
import { claudeWindowSpec, isoFromSeconds, roundTenth } from '../../src/core/claude-usage.ts'

describe('the window table', () => {
  test('a window this build has never heard of is not in the table', () => {
    expect(claudeWindowSpec('thirty_day_something')).toBeNull()
    expect(claudeWindowSpec('five_hour')?.label).toBe('5 hour')
  })

  test('the five-hour window is a plan window of five hours, and the per-model ones are not plan windows', () => {
    expect(claudeWindowSpec('five_hour')).toMatchObject({ field: 'fiveHour', windowDurationMins: 300, plan: true })
    expect(claudeWindowSpec('seven_day_opus')).toMatchObject({ windowDurationMins: 7 * 24 * 60, plan: false })
  })
})

describe('the number helpers', () => {
  test('a unix-second reset becomes ISO, and nothing usable becomes null', () => {
    expect(isoFromSeconds(1_789_408_800)).toBe('2026-09-14T18:00:00.000Z')
    expect(isoFromSeconds(0)).toBeNull()
    expect(isoFromSeconds('1789408800')).toBeNull()
    expect(isoFromSeconds(Number.NaN)).toBeNull()
  })

  test('a percentage is rounded to one decimal place', () => {
    expect(roundTenth(0.13 * 100)).toBe(13)
    expect(roundTenth(42.25)).toBe(42.3)
  })
})
