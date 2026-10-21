import type * as Crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { isLoginId, isLoginProvider, newLoginId, NEW_LOGIN_ID_LENGTH, toLoginId } from '../../src/data/login-id.ts'

describe('newLoginId', () => {
  it('makes 10 lowercase letters and digits', () => {
    expect(NEW_LOGIN_ID_LENGTH).toBe(10)
    for (let index = 0; index < 200; index++) {
      const id = newLoginId()
      expect(id).toMatch(/^[a-z0-9]{10}$/)
      expect(isLoginId(id)).toBe(true)
    }
  })

  it('makes a different id each time', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newLoginId()))
    expect(ids.size).toBe(500)
  })

  it('makes none of the taken ids', async () => {
    // With the random source fixed to a sequence, the first id it makes is taken, so the
    // second is answered.
    vi.resetModules()
    const values = [...Array<number>(10).fill(0), ...Array<number>(10).fill(1)]
    vi.doMock('node:crypto', async (original) => ({
      ...(await original<typeof Crypto>()),
      randomInt: () => values.shift() ?? 2
    }))
    try {
      const fresh = await import('../../src/data/login-id.ts')
      expect(fresh.newLoginId(['aaaaaaaaaa'])).toBe('bbbbbbbbbb')
    } finally {
      vi.doUnmock('node:crypto')
      vi.resetModules()
    }
  })
})

describe('checking ids', () => {
  it.each(['a', 'ownclaude1', 'abc123', '0', 'a'.repeat(32), 'console', 'nonesuch', 'claudex'])('%j is an id', (text) => {
    expect(isLoginId(text)).toBe(true)
    expect(toLoginId(text)).toBe(text)
  })

  it.each(['', 'a'.repeat(33), 'Work', 'side-2', 'a_b', 'claude:work', '../x', 'a/b', 'a.b', ' work'])('%j is not an id', (text) => {
    expect(isLoginId(text)).toBe(false)
    expect(() => toLoginId(text)).toThrow(/not a login id/)
  })

  it.each(['con', 'prn', 'aux', 'nul', 'com1', 'lpt9', 'none', 'invalid', 'claude', 'codex'])('%j is reserved', (text) => {
    expect(isLoginId(text)).toBe(false)
    expect(() => toLoginId(text)).toThrow(/not a login id/)
  })

  it('takes only strings', () => {
    expect(isLoginId(42)).toBe(false)
    expect(isLoginId(null)).toBe(false)
    expect(isLoginId(undefined)).toBe(false)
  })

  it('knows the providers', () => {
    expect(isLoginProvider('claude')).toBe(true)
    expect(isLoginProvider('codex')).toBe(true)
    expect(isLoginProvider('Claude')).toBe(false)
    expect(isLoginProvider(1)).toBe(false)
  })
})
