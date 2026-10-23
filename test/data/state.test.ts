import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountUsage } from '../../src/core/claude-usage.ts'
import { toLoginId } from '../../src/data/login-id.ts'
import { statePath } from '../../src/data/paths.ts'
import {
  createCoalescedWriter,
  emptyState,
  loadState,
  parseState,
  pruneState,
  saveState,
  saveStateSync,
  serializeState
} from '../../src/data/state.ts'

const NOW = Date.UTC(2026, 0, 15, 12)
const WORK = toLoginId('workclaude')

function usage(accountId: string, patch: Partial<AccountUsage> = {}): AccountUsage {
  return {
    accountId,
    fetchedAt: NOW - 1000,
    source: 'probe',
    subscriptionType: 'max',
    rateLimitsAvailable: true,
    fiveHour: { utilization: 12, resetsAt: '2026-01-15T14:00:00.000Z' },
    sevenDay: { utilization: 40, resetsAt: '2026-01-19T00:00:00.000Z' },
    sevenDayOverage: null,
    sevenDayOpus: null,
    sevenDaySonnet: null,
    modelScoped: [],
    extraUsage: null,
    status: 'allowed',
    limited: null,
    error: null,
    ...patch
  }
}

beforeEach(() => {
  rmSync(statePath(), { force: true })
})

describe('saving and loading', () => {
  it('round-trips usage, cooldowns (Infinity too) and sessions', async () => {
    const state = emptyState()
    state.usage.set(WORK, usage('workclaude'))
    state.cooldowns.set(WORK, NOW + 60_000)
    state.cooldowns.set(toLoginId('ownclaude1'), Infinity)
    state.sessions.set('0b7c0a52-1111-4222-8333-944445555666', { login: WORK, lastUsed: NOW - 5000 })
    await saveState(state)

    const file = JSON.parse(readFileSync(statePath(), 'utf8')) as Record<string, Record<string, unknown>>
    expect(file.cooldowns).toEqual({ 'workclaude': NOW + 60_000, 'ownclaude1': null })

    const read = loadState(NOW)
    expect(read.problem).toBeNull()
    expect(read.dropped).toBe(0)
    expect(read.state.cooldowns.get(toLoginId('ownclaude1'))).toBe(Infinity)
    expect(read.state.cooldowns.get(WORK)).toBe(NOW + 60_000)
    expect(read.state.usage.get(WORK)).toEqual(usage('workclaude'))
    expect(read.state.sessions.get('0b7c0a52-1111-4222-8333-944445555666')).toEqual({ login: WORK, lastUsed: NOW - 5000 })
  })

  it('saveStateSync writes the same', () => {
    const state = emptyState()
    state.cooldowns.set(WORK, NOW + 1)
    saveStateSync(state)
    expect(loadState(NOW).state.cooldowns.get(WORK)).toBe(NOW + 1)
  })

  it('starts empty from a missing, corrupt or unknown-version file, without throwing', () => {
    expect(loadState(NOW).problem).toBe('missing')
    writeFileSync(statePath(), '{"version":1,"usage":')
    expect(loadState(NOW)).toMatchObject({ problem: 'corrupt', dropped: 0 })
    writeFileSync(statePath(), '"text"')
    expect(loadState(NOW).problem).toBe('corrupt')
    writeFileSync(statePath(), '{"version":9}')
    expect(loadState(NOW).problem).toBe('wrong-version')
  })
})

describe('parseState', () => {
  it('drops each bad entry and keeps the rest', () => {
    const read = parseState(
      {
        version: 1,
        usage: {
          'workclaude': usage('workclaude'),
          'otherlogin': usage('workclaude'),
          '../x': usage('../x'),
          'sidelogin1': { ...usage('sidelogin1'), fiveHour: { utilization: 'high' } },
          'latelogin': { ...usage('latelogin'), fetchedAt: 'yesterday' }
        },
        cooldowns: { 'workclaude': NOW + 5, 'badlogin': 'soon', 'not-an-id': NOW + 5, 'claude:old': NOW + 5 },
        sessions: {
          good: { login: 'workclaude', lastUsed: NOW },
          'bad id with spaces': { login: 'workclaude', lastUsed: NOW },
          noLogin: { lastUsed: NOW },
          badLogin: { login: '../x', lastUsed: NOW }
        }
      },
      NOW
    )
    expect([...read.state.usage.keys()]).toEqual(['workclaude'])
    expect([...read.state.cooldowns.keys()]).toEqual(['workclaude'])
    expect([...read.state.sessions.keys()]).toEqual(['good'])
    expect(read.dropped).toBe(4 + 3 + 3)
  })

  it('keeps a session id that is also an Object property name as an ordinary key', async () => {
    const read = parseState(JSON.parse('{"version":1,"sessions":{"__proto__":{"login":"workclaude","lastUsed":1}}}'), 2)
    expect(read.state.sessions.get('__proto__')).toEqual({ login: 'workclaude', lastUsed: 1 })
    await saveState(read.state)
    expect(loadState(2).state.sessions.get('__proto__')).toEqual({ login: 'workclaude', lastUsed: 1 })
  })

  it('counts a section that is not an object as one dropped entry', () => {
    const read = parseState({ version: 1, usage: [], cooldowns: 3 }, NOW)
    expect(read.dropped).toBe(2)
    expect(read.problem).toBeNull()
  })

  it('leaves out run-out cooldowns and old sessions without counting them', () => {
    const read = parseState(
      {
        version: 1,
        cooldowns: { 'workclaude': NOW - 1 },
        sessions: { old: { login: 'workclaude', lastUsed: NOW - 8 * 24 * 3600 * 1000 } }
      },
      NOW
    )
    expect(read.state.cooldowns.size).toBe(0)
    expect(read.state.sessions.size).toBe(0)
    expect(read.dropped).toBe(0)
  })
})

describe('pruneState', () => {
  it('keeps only the newest sessions over the cap', () => {
    const state = emptyState()
    for (let i = 0; i < 5; i++) state.sessions.set(`s${String(i)}`, { login: WORK, lastUsed: NOW - i })
    pruneState(state, NOW, 1000, 2)
    expect([...state.sessions.keys()]).toEqual(['s0', 's1'])
  })

  it('keeps an Infinity cooldown', () => {
    const state = emptyState()
    state.cooldowns.set(WORK, Infinity)
    pruneState(state, NOW)
    expect(state.cooldowns.get(WORK)).toBe(Infinity)
  })
})

describe('serializeState', () => {
  it('writes version 1 and plain objects', () => {
    expect(serializeState(emptyState())).toEqual({ version: 1, usage: {}, cooldowns: {}, sessions: {} })
  })
})

describe('createCoalescedWriter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes at most once per interval however often it is asked', async () => {
    const write = vi.fn(async () => {})
    const writer = createCoalescedWriter(write, { minIntervalMs: 1000 })
    writer.schedule()
    writer.schedule()
    await vi.advanceTimersByTimeAsync(0)
    expect(write).toHaveBeenCalledTimes(1)

    writer.schedule()
    writer.schedule()
    await vi.advanceTimersByTimeAsync(500)
    expect(write).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(write).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(write).toHaveBeenCalledTimes(2)
    expect(writer.pending()).toBe(false)
  })

  it('never overlaps two writes, and writes again after one that saw a change mid-way', async () => {
    let active = 0
    let maxActive = 0
    let finish: (() => void) | null = null
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          active++
          maxActive = Math.max(maxActive, active)
          finish = () => {
            active--
            resolve()
          }
        })
    )
    const writer = createCoalescedWriter(write, { minIntervalMs: 100 })
    writer.schedule()
    await vi.advanceTimersByTimeAsync(0)
    writer.schedule()
    await vi.advanceTimersByTimeAsync(1000)
    expect(write).toHaveBeenCalledTimes(1)
    finish!()
    await vi.advanceTimersByTimeAsync(0)
    expect(write).toHaveBeenCalledTimes(2)
    finish!()
    await vi.advanceTimersByTimeAsync(0)
    expect(maxActive).toBe(1)
  })

  it('flush writes a pending change at once', async () => {
    const write = vi.fn(async () => {})
    const writer = createCoalescedWriter(write, { minIntervalMs: 60_000 })
    writer.schedule()
    await vi.advanceTimersByTimeAsync(0)
    writer.schedule()
    await writer.flush()
    expect(write).toHaveBeenCalledTimes(2)
    await writer.flush()
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('passes a failed write to onError and tries again on the next schedule', async () => {
    const errors: unknown[] = []
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const writer = createCoalescedWriter(write, { minIntervalMs: 10, onError: (error) => errors.push(error) })
    writer.schedule()
    await vi.advanceTimersByTimeAsync(0)
    expect(errors).toHaveLength(1)
    writer.schedule()
    await vi.advanceTimersByTimeAsync(10)
    expect(write).toHaveBeenCalledTimes(2)
  })
})
