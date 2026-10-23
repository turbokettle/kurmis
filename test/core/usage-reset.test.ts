// Reading a usage snapshot at a moment: a window whose reset has gone by is empty,
// because what was measured on it belongs to the window that ended.
import { describe, expect, it } from 'vitest'
import {
  planUsageWindows,
  usageAsOf,
  usageResetPassed,
  windowHasReset
} from '../../src/core/usage-rules.ts'
import { accountUsage, usageWindow } from './usage-fixtures.ts'

const NOW = Date.parse('2026-09-16T12:00:00.000Z')
const PAST = new Date(NOW - 60_000).toISOString()
const SOON = new Date(NOW + 30 * 60_000).toISOString()
const LATER = new Date(NOW + 4 * 60 * 60_000).toISOString()

describe('windowHasReset', () => {
  it('is true once the reset time has gone by, and at the moment itself', () => {
    expect(windowHasReset(usageWindow(90, PAST), NOW)).toBe(true)
    expect(windowHasReset(usageWindow(90, new Date(NOW).toISOString()), NOW)).toBe(true)
  })

  it('is false ahead of the reset, with no reset time, and with no window', () => {
    expect(windowHasReset(usageWindow(90, SOON), NOW)).toBe(false)
    expect(windowHasReset(usageWindow(90, null), NOW)).toBe(false)
    expect(windowHasReset(null, NOW)).toBe(false)
    expect(windowHasReset(undefined, NOW)).toBe(false)
  })

  it('is false for a reset time that is not a time', () => {
    expect(windowHasReset({ resetsAt: 'whenever' }, NOW)).toBe(false)
  })
})

describe('usageAsOf', () => {
  it('empties the window that has reset and leaves the one that has not', () => {
    const before = accountUsage({
      fiveHour: usageWindow(94, PAST),
      sevenDay: usageWindow(61, LATER)
    })
    const after = usageAsOf(before, NOW)
    expect(after.fiveHour?.utilization).toBe(0)
    expect(after.sevenDay?.utilization).toBe(61)
  })

  it('keeps the reset time, so a display can say the window has just turned over', () => {
    const after = usageAsOf(accountUsage({ fiveHour: usageWindow(94, PAST) }), NOW)
    expect(after.fiveHour?.resetsAt).toBe(PAST)
    expect(usageResetPassed(after, NOW)).toBe(true)
  })

  it('leaves a snapshot with nothing expired exactly as it came', () => {
    const before = accountUsage({ fiveHour: usageWindow(94, SOON), sevenDay: usageWindow(61, LATER) })
    expect(usageAsOf(before, NOW)).toBe(before)
  })

  it('passes a missing snapshot through', () => {
    expect(usageAsOf(null, NOW)).toBe(null)
    expect(usageAsOf(undefined, NOW)).toBe(undefined)
  })

  it('empties the per-model and the extra-usage windows too', () => {
    const after = usageAsOf(
      accountUsage({
        sevenDayOverage: usageWindow(99, PAST),
        sevenDayOpus: usageWindow(80, PAST),
        modelScoped: [{ displayName: 'Fable', utilization: 77, resetsAt: PAST }]
      }),
      NOW
    )
    expect(after.sevenDayOverage?.utilization).toBe(0)
    expect(after.sevenDayOpus?.utilization).toBe(0)
    expect(after.modelScoped[0]?.utilization).toBe(0)
  })

  it('clears a refusal once the window it named has reset', () => {
    const after = usageAsOf(
      accountUsage({
        fiveHour: usageWindow(100, PAST),
        status: 'rejected',
        limited: { window: 'five_hour', utilization: 100, resetsAt: PAST }
      }),
      NOW
    )
    expect(after.status).toBe(null)
    expect(after.limited).toBe(null)
  })

  it('keeps a refusal whose window has not reset', () => {
    const after = usageAsOf(
      accountUsage({
        fiveHour: usageWindow(30, PAST),
        sevenDay: usageWindow(100, LATER),
        status: 'rejected',
        limited: { window: 'seven_day', utilization: 100, resetsAt: LATER }
      }),
      NOW
    )
    expect(after.status).toBe('rejected')
    expect(after.limited?.window).toBe('seven_day')
  })

  it('is what the plan windows are read from, so a reset window counts as empty', () => {
    const usage = usageAsOf(
      accountUsage({ fiveHour: usageWindow(94, PAST), sevenDay: usageWindow(61, LATER) }),
      NOW
    )
    const read = planUsageWindows(usage).map((window) => [window.key, window.utilization])
    expect(read).toEqual([['five_hour', 0], ['seven_day', 61]])
  })
})
