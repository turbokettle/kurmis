// The usage snapshot: the window table and the rule for choosing between two snapshots.
import { describe, expect, test } from 'vitest'
import {
  claudeWindowSpec,
  isoFromSeconds,
  mergeUsageMaps,
  newerUsage,
  roundTenth
} from '../../src/core/claude-usage.ts'
import { accountUsage as usage } from './usage-fixtures.ts'

describe('the window table', () => {
  test('a window this build has never heard of is not in the table', () => {
    expect(claudeWindowSpec('thirty_day_something')).toBeNull()
    expect(claudeWindowSpec('five_hour')?.short).toBe('5h')
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

describe('folding a fresh snapshot into the map', () => {
  test('the newer one wins, and a sample of the same moment replaces what is held', () => {
    const held = usage({ fetchedAt: 200 })

    expect(newerUsage(held, usage({ fetchedAt: 100 })).fetchedAt).toBe(200)
    expect(newerUsage(held, usage({ fetchedAt: 200, source: 'session' })).source).toBe('session')
    expect(newerUsage(undefined, usage({ fetchedAt: 1 })).fetchedAt).toBe(1)
  })

  test('a map merge applies that rule per row and leaves the rest alone', () => {
    const merged = mergeUsageMaps(
      { 'claude:default': usage({ fetchedAt: 200 }), 'claude:old': usage({ accountId: 'claude:old', fetchedAt: 5 }) },
      { 'claude:default': usage({ fetchedAt: 100 }), 'claude:work': usage({ accountId: 'claude:work', fetchedAt: 7 }) }
    )

    expect(merged['claude:default']?.fetchedAt).toBe(200)
    expect(merged['claude:old']?.fetchedAt).toBe(5)
    expect(merged['claude:work']?.fetchedAt).toBe(7)
  })
})
