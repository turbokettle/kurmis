// The headers a routed CLI sends the proxy, and the ANTHROPIC_CUSTOM_HEADERS value behind them.
import { describe, expect, test } from 'vitest'
import {
  formatCustomHeaders, KEY_HEADER, LOGIN_HEADER, parseCustomHeaders, readRouteRequest, routeKeyMatches,
  SESSION_HEADER, withRouteHeaders
} from '../../src/core/route-headers.ts'

describe('ANTHROPIC_CUSTOM_HEADERS', () => {
  test('is read as one Name: value per line, split at the first colon and trimmed', () => {
    expect(parseCustomHeaders('x-kurmis-key: abc\r\nX-Other:  a: b \n\nno colon here\n: no name')).toEqual([
      { name: 'x-kurmis-key', value: 'abc' },
      { name: 'X-Other', value: 'a: b' }
    ])
    expect(parseCustomHeaders(undefined)).toEqual([])
    expect(parseCustomHeaders('')).toEqual([])
  })

  test('is written back as the same lines', () => {
    const headers = [{ name: 'x-kurmis-key', value: 'abc' }, { name: 'x-kurmis-login', value: 'claude:work' }]
    expect(formatCustomHeaders(headers)).toBe('x-kurmis-key: abc\nx-kurmis-login: claude:work')
    expect(parseCustomHeaders(formatCustomHeaders(headers))).toEqual(headers)
  })

  test('keeps the person\'s own headers and replaces kurmis\' headers already there', () => {
    const inherited = 'X-Team: blue\nX-Kurmis-Key: old\nx-kurmis-login: claude:old'
    expect(withRouteHeaders(inherited, 'new', null)).toBe('X-Team: blue\nx-kurmis-key: new')
    expect(withRouteHeaders(null, 'new', 'claude:work')).toBe('x-kurmis-key: new\nx-kurmis-login: claude:work')
  })
})

describe('a request to the proxy', () => {
  const getter = (values: Record<string, string>) => (name: string): string | undefined => values[name]

  test('carries the key, the session and, when pinned, a Claude login', () => {
    expect(readRouteRequest(getter({ [KEY_HEADER]: 'secret', [LOGIN_HEADER]: 'claude:work', [SESSION_HEADER]: 'abc-123' })))
      .toEqual({ key: 'secret', login: 'claude:work', sessionId: 'abc-123' })
    expect(readRouteRequest(getter({}))).toEqual({ key: null, login: null, sessionId: null })
    expect(readRouteRequest(getter({ [KEY_HEADER]: '  ', [LOGIN_HEADER]: '' }))).toEqual({ key: null, login: null, sessionId: null })
  })

  test.each(['codex:work', 'work', 'claude:', 'claude:Work', 'claude:con'])('a login header of %j is invalid', (value) => {
    expect(readRouteRequest(getter({ [LOGIN_HEADER]: value })).login).toBe('invalid')
  })

  test('the key matches the secret exactly', () => {
    expect(routeKeyMatches('secret', 'secret')).toBe(true)
    expect(routeKeyMatches('secreT', 'secret')).toBe(false)
    expect(routeKeyMatches('secret2', 'secret')).toBe(false)
    expect(routeKeyMatches(null, 'secret')).toBe(false)
    expect(routeKeyMatches('', '')).toBe(false)
  })
})
