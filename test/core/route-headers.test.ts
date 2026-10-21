// The headers a routed CLI sends the proxy, and the ANTHROPIC_CUSTOM_HEADERS value behind them.
import { describe, expect, test } from 'vitest'
import {
  formatCustomHeaders, KEY_HEADER, LOGIN_HEADER, parseCustomHeaders, readRouteRequest, routeKeyMatches,
  SESSION_HEADER, STARTED_ON_HEADER, STARTED_ON_NONE, withRouteHeaders
} from '../../src/core/route-headers.ts'
import { OWN_CLAUDE } from '../logins.ts'

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
    const headers = [{ name: 'x-kurmis-key', value: 'abc' }, { name: 'x-kurmis-login', value: 'workclaude' }]
    expect(formatCustomHeaders(headers)).toBe('x-kurmis-key: abc\nx-kurmis-login: workclaude')
    expect(parseCustomHeaders(formatCustomHeaders(headers))).toEqual(headers)
  })

  test('keeps the person\'s own headers and replaces kurmis\' headers already there', () => {
    const inherited = 'X-Team: blue\nX-Kurmis-Key: old\nx-kurmis-login: oldclaude'
    expect(withRouteHeaders(inherited, 'new', null)).toBe('X-Team: blue\nx-kurmis-key: new')
    expect(withRouteHeaders(null, 'new', 'workclaude')).toBe('x-kurmis-key: new\nx-kurmis-login: workclaude')
    expect(withRouteHeaders('x-kurmis-started-on: oldclaude', 'new', null, 'workclaude'))
      .toBe('x-kurmis-key: new\nx-kurmis-started-on: workclaude')
  })
})

describe('a request to the proxy', () => {
  const getter = (values: Record<string, string>) => (name: string): string | undefined => values[name]

  test('carries the key, the session and, when pinned, a Claude login', () => {
    expect(readRouteRequest(getter({ [KEY_HEADER]: 'secret', [LOGIN_HEADER]: 'workclaude', [SESSION_HEADER]: 'abc-123' }), OWN_CLAUDE))
      .toEqual({ key: 'secret', login: 'workclaude', startedOn: OWN_CLAUDE, sessionId: 'abc-123' })
    expect(readRouteRequest(getter({}), OWN_CLAUDE)).toEqual({ key: null, login: null, startedOn: OWN_CLAUDE, sessionId: null })
    expect(readRouteRequest(getter({ [KEY_HEADER]: '  ', [LOGIN_HEADER]: '' }), OWN_CLAUDE))
      .toEqual({ key: null, login: null, startedOn: OWN_CLAUDE, sessionId: null })
  })

  test('names the login the CLI was started on, the login plain claude uses without the header', () => {
    expect(readRouteRequest(getter({ [STARTED_ON_HEADER]: 'workclaude' }), OWN_CLAUDE).startedOn).toBe('workclaude')
    expect(readRouteRequest(getter({ [STARTED_ON_HEADER]: ' workclaude ' }), OWN_CLAUDE).startedOn).toBe('workclaude')
    expect(readRouteRequest(getter({}), 'otherown01').startedOn).toBe('otherown01')
    expect(readRouteRequest(getter({ [STARTED_ON_HEADER]: 'claude:workclaude' }), OWN_CLAUDE).startedOn).toBe('invalid')
  })

  test('passes any login id on, since only the proxy knows which logins are Claude logins', () => {
    expect(readRouteRequest(getter({ [LOGIN_HEADER]: 'workcodex1' }), OWN_CLAUDE).login).toBe('workcodex1')
    expect(readRouteRequest(getter({ [STARTED_ON_HEADER]: 'workcodex1' }), OWN_CLAUDE).startedOn).toBe('workcodex1')
  })

  test('reads started-on none as no kurmis login', () => {
    expect(readRouteRequest(getter({ [STARTED_ON_HEADER]: STARTED_ON_NONE }), OWN_CLAUDE).startedOn).toBeNull()
    expect(readRouteRequest(getter({ [STARTED_ON_HEADER]: ' None ' }), OWN_CLAUDE).startedOn).toBeNull()
    expect(withRouteHeaders('X-Team: blue', 'k', null, STARTED_ON_NONE)).toBe('X-Team: blue\nx-kurmis-key: k\nx-kurmis-started-on: none')
  })

  test.each(['claude:workclaude', 'work-claude', 'Workclaude', 'con', 'invalid', 'claude', 'a'.repeat(33), 'a b'])('a login header of %j is invalid', (value) => {
    expect(readRouteRequest(getter({ [LOGIN_HEADER]: value }), OWN_CLAUDE).login).toBe('invalid')
  })

  test('the key matches the secret exactly', () => {
    expect(routeKeyMatches('secret', 'secret')).toBe(true)
    expect(routeKeyMatches('secreT', 'secret')).toBe(false)
    expect(routeKeyMatches('secret2', 'secret')).toBe(false)
    expect(routeKeyMatches(null, 'secret')).toBe(false)
    expect(routeKeyMatches('', '')).toBe(false)
  })
})
