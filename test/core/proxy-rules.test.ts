// The proxy's decisions that are not I/O. Several cases are the pure halves of the original router's
// integration tests of its router proxy (`test/integration/claude-tool/account-router-proxy.test.ts`).
import { describe, expect, test } from 'vitest'
import type { RouteAccount, RouteSession } from '../../src/core/account-router.ts'
import type { AccountUsage } from '../../src/core/claude-usage.ts'
import {
  cooldownAfterProbe, downstreamResponseHeaders, noSignerAnswer, outgoingBody, poolLimitAnswer, refusalAnswer,
  requestKind, rewriteUserId, ROUTE_PATHS, ROUTER_REFUSAL_STATUS, routeBlockText, staleUsageLogins, upstreamRequest,
  whyPassedOver, withoutExpiringTokens
} from '../../src/core/proxy-rules.ts'
import { emptyAccountUsage } from '../../src/core/usage.ts'

const NOW = 1_789_560_000_000
const RESET = NOW + 60 * 60_000
const iso = (at: number): string => new Date(at).toISOString()

function account(id: string, patch: Partial<RouteAccount> = {}): RouteAccount {
  return {
    id, loggedIn: true, credentialsReadable: true, tokenExpiresAt: null, usage: null, autoRoute: true,
    fiveHourLimitPercent: 90, weeklyLimitPercent: 90, useFirst: false, cooldownUntil: null, ...patch
  }
}

function usage(id: string, patch: Partial<AccountUsage>): AccountUsage {
  return { ...emptyAccountUsage(id, NOW), rateLimitsAvailable: true, ...patch }
}

const auto: RouteSession = { homeAccountId: 'claude:default', currentAccountId: null }

describe('which requests the proxy routes', () => {
  test('the three inference endpoints, and nothing else under the base URL', () => {
    expect(ROUTE_PATHS).toEqual([
      { method: 'POST', path: '/v1/messages' },
      { method: 'POST', path: '/v1/messages/count_tokens' },
      { method: 'GET', path: '/v1/models' }
    ])
    expect(requestKind('POST', '/v1/messages?beta=true')).toEqual({ kind: 'route', path: '/v1/messages' })
    expect(requestKind('GET', '/v1/messages')).toEqual({ kind: 'unknown' })
    expect(requestKind('POST', '/v1/other')).toEqual({ kind: 'unknown' })
    expect(requestKind(undefined, undefined)).toEqual({ kind: 'unknown' })
  })

  test('the CLI\'s check of the base URL, and the control API', () => {
    expect(requestKind('HEAD', '/api/hello')).toEqual({ kind: 'hello' })
    expect(requestKind('POST', '/api/hello')).toEqual({ kind: 'unknown' })
    expect(requestKind('GET', '/_kurmis/status?json=1')).toEqual({ kind: 'control', path: '/_kurmis/status' })
  })
})

describe('the request sent upstream', () => {
  const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value))

  test('signs for the chosen login, drops kurmis\' headers and the replaced ones, and keeps the rest', () => {
    const { headers, body } = upstreamRequest({
      'x-kurmis-key': 'secret', 'x-kurmis-login': 'claude:work', authorization: 'Bearer cli-token',
      'x-api-key': 'sk-example', host: '127.0.0.1:1234', 'content-length': '999', 'accept-encoding': 'gzip',
      connection: 'keep-alive, x-private', 'x-private': 'drop', 'keep-alive': 'timeout=5',
      'anthropic-beta': ['oauth-2025-04-20', 'other'], 'x-claude-code-session-id': 'abc'
    }, bytes({ model: 'claude-example', metadata: { user_id: '{"account_uuid":"old","session_id":"abc"}' } }),
    'Bearer work-token', 'work-uuid')
    expect(headers).toEqual({
      authorization: 'Bearer work-token',
      'accept-encoding': 'identity',
      'anthropic-beta': 'oauth-2025-04-20, other',
      'x-claude-code-session-id': 'abc',
      'content-length': String(body?.length)
    })
    expect(JSON.parse(body?.toString('utf8') ?? '')).toEqual({ model: 'claude-example',
      metadata: { user_id: '{"account_uuid":"work-uuid","session_id":"abc"}' } })
  })

  test('a request with no body goes without one', () => {
    const { headers, body } = upstreamRequest({ authorization: 'Bearer cli-token' }, undefined, 'Bearer cli-token', null)
    expect(body).toBeUndefined()
    expect(headers['content-length']).toBeUndefined()
  })

  test('rewrites only account_uuid and preserves the other fields and their order', () => {
    const input = '{"device_id":"device","account_uuid":"old","session_id":"session","extra":{"a":1}}'
    expect(rewriteUserId(input, 'new')).toBe('{"device_id":"device","account_uuid":"new","session_id":"session","extra":{"a":1}}')
    expect(rewriteUserId('{"session_id":"session"}', 'new')).toBe('{"session_id":"session","account_uuid":"new"}')
    expect(rewriteUserId('{}', 'new')).toBe('{"account_uuid":"new"}')
    expect(rewriteUserId(' { "a" : 1 } ', 'new')).toBe(' { "a" : 1 ,"account_uuid":"new"} ')
  })

  test('changes no other byte of user_id: spacing, escapes and large numbers stay', () => {
    const input = '{ "device_id" : "d\\u00e9v", "account_uuid": "old", "n": 12345678901234567890 }'
    expect(rewriteUserId(input, 'new')).toBe('{ "device_id" : "d\\u00e9v", "account_uuid": "new", "n": 12345678901234567890 }')
    expect(rewriteUserId('{"account_uuid":"same"}', 'same')).toBe('{"account_uuid":"same"}')
    // A repeated name: JSON.parse keeps the last, and so does the rewrite.
    expect(rewriteUserId('{"account_uuid":"a","account_uuid":"b"}', 'new')).toBe('{"account_uuid":"a","account_uuid":"new"}')
  })

  test.each(['not json', '', 'null', '[]', '42', '"string"'])('leaves unsupported user_id %j unchanged', (input) => {
    expect(rewriteUserId(input, 'new')).toBe(input)
  })

  test('a body is passed as it is with no uuid, no user_id, or a uuid that is already right', () => {
    const withUserId = bytes({ metadata: { user_id: '{}' } })
    expect(outgoingBody(withUserId, null)).toBe(withUserId)
    const plain = bytes({ model: 'm' })
    expect(outgoingBody(plain, 'uuid')).toBe(plain)
    expect(outgoingBody(Buffer.from('null'), 'uuid').toString()).toBe('null')
    const same = bytes({ metadata: { user_id: '{"account_uuid":"uuid"}' } })
    expect(outgoingBody(same, 'uuid')).toBe(same)
    for (const text of ['{"metadata":"x"}', '{"metadata":{"user_id":7}}', '[{"metadata":{"user_id":"{}"}}]', '{"other":{"metadata":{"user_id":"{}"}}}']) {
      expect(outgoingBody(Buffer.from(text), 'uuid').toString()).toBe(text)
    }
  })

  test('only the user_id string changes: integers above 2^53, key order, spacing and other text keep their bytes', () => {
    const text = '{\n  "max_tokens": 9007199254740993,\n  "z": "caf\u00e9 \\"quoted\\" {not: a, brace]",\n' +
      '  "metadata" : { "x": [1, {"user_id": "inner"}], "user_id" : "{\\"device_id\\":\\"d\\",\\"account_uuid\\":\\"old\\"}" },\n' +
      '  "a": 1.50e+3\n}'
    const out = outgoingBody(Buffer.from(text, 'utf8'), 'new-uuid').toString('utf8')
    expect(out).toBe(text.replace('\\"account_uuid\\":\\"old\\"', '\\"account_uuid\\":\\"new-uuid\\"'))
    expect(out).toContain('9007199254740993')
    expect((JSON.parse(out) as { metadata: { user_id: string } }).metadata.user_id).toBe('{"device_id":"d","account_uuid":"new-uuid"}')
  })

  test('the content-length is that of the bytes sent', () => {
    const text = '{"metadata":{"user_id":"{\\"account_uuid\\":\\"o\\"}"},"t":"\u00e9\u00e9"}'
    const { headers, body } = upstreamRequest({}, Buffer.from(text, 'utf8'), 'Bearer t', 'a-much-longer-uuid')
    expect(headers['content-length']).toBe(String(Buffer.byteLength(body?.toString('utf8') ?? '', 'utf8')))
  })
})

test('the answer passed back has no hop-by-hop or length headers, and keeps its encoding', () => {
  expect(downstreamResponseHeaders([
    ['Content-Type', 'text/event-stream'], ['content-encoding', 'gzip'], ['content-length', '12'],
    ['connection', 'x-private'], ['x-private', 'drop'], ['transfer-encoding', 'chunked'],
    ['anthropic-ratelimit-unified-status', 'allowed']
  ])).toEqual([['content-type', 'text/event-stream'], ['content-encoding', 'gzip'], ['anthropic-ratelimit-unified-status', 'allowed']])
})

describe('the answer when no login can serve', () => {
  test('an exhausted pool is a 429 naming the next login\'s blocking window and its reset', () => {
    const rows = [
      account('claude:default', { usage: usage('claude:default', { fiveHour: { utilization: 95, resetsAt: iso(RESET + 1000) } }) }),
      account('claude:work', { usage: usage('claude:work', { sevenDay: { utilization: 95, resetsAt: iso(RESET) } }) })
    ]
    const answer = refusalAnswer(auto, rows, NOW)
    expect(answer).toMatchObject({ kind: 'pool-limit', status: 429, resetAt: RESET })
    expect(answer.headers).toMatchObject({
      'anthropic-ratelimit-unified-status': 'rejected',
      'anthropic-ratelimit-unified-reset': String(RESET / 1000),
      'anthropic-ratelimit-unified-representative-claim': 'seven_day',
      'retry-after': '3600'
    })
    expect(JSON.parse(answer.body)).toMatchObject({ type: 'error', error: { type: 'rate_limit_error' } })
  })

  test('an unknown pool reset is still a usage limit', () => {
    const rows = ['claude:default', 'claude:work'].map((id) =>
      account(id, { usage: usage(id, { fiveHour: { utilization: 95, resetsAt: null } }) }))
    const answer = poolLimitAnswer(auto, rows, NOW)
    expect(answer.resetAt).toBeNull()
    expect(answer.headers['anthropic-ratelimit-unified-reset']).toBeUndefined()
    expect(answer.headers['anthropic-ratelimit-unified-representative-claim']).toBe('five_hour')
    expect(answer.headers['retry-after']).toBe('1')
  })

  test('a pinned session is measured to 100% of its own login', () => {
    const pinned: RouteSession = { ...auto, pinnedAccountId: 'claude:work' }
    const rows = [
      account('claude:default'),
      account('claude:work', { usage: usage('claude:work', { fiveHour: { utilization: 100, resetsAt: iso(RESET) } }) })
    ]
    expect(poolLimitAnswer(pinned, rows, NOW)).toMatchObject({ resetAt: RESET,
      headers: { 'anthropic-ratelimit-unified-representative-claim': 'five_hour' } })
  })

  test('a pool with nothing the proxy can sign for is the proxy\'s own 599, not a usage limit', () => {
    const rows = [account('claude:default', { credentialsReadable: false }), account('claude:work', { loggedIn: false })]
    const answer = refusalAnswer(auto, rows, NOW)
    expect(answer).toMatchObject({ kind: 'no-signer', status: ROUTER_REFUSAL_STATUS, resetAt: null })
    expect(answer).toMatchObject(noSignerAnswer())
    expect(JSON.parse(answer.body)).toMatchObject({ type: 'error', error: { type: 'api_error' } })
  })

  test('a login whose token could not be renewed is not counted as room', () => {
    // Its room would answer "now" for a pool that cannot serve.
    const rows = [
      account('claude:default', { tokenExpiresAt: NOW + 60_000 }),
      account('claude:work', { usage: usage('claude:work', { fiveHour: { utilization: 95, resetsAt: iso(RESET) } }) })
    ]
    expect(withoutExpiringTokens(rows, NOW, auto).map((row) => row.credentialsReadable)).toEqual([false, true])
    expect(refusalAnswer(auto, rows, NOW)).toMatchObject({ kind: 'pool-limit', resetAt: RESET })
    expect(refusalAnswer(auto, [rows[0]!], NOW).kind).toBe('no-signer')
  })

  test('a pinned login whose token is expiring keeps its reset and loses only its room', () => {
    const pinned: RouteSession = { ...auto, pinnedAccountId: 'claude:work' }
    const full = account('claude:work', { tokenExpiresAt: NOW + 60_000,
      usage: usage('claude:work', { fiveHour: { utilization: 100, resetsAt: iso(RESET) } }) })
    expect(withoutExpiringTokens([full], NOW, pinned)[0]?.credentialsReadable).toBe(true)
    expect(withoutExpiringTokens([{ ...full, usage: null }], NOW, pinned)[0]?.credentialsReadable).toBe(false)
  })
})

describe('a cooldown with no known end', () => {
  const probe = (patch: Partial<AccountUsage>): AccountUsage => usage('claude:work', { source: 'probe', ...patch })

  test('ends at the reset a successful probe names', () => {
    expect(cooldownAfterProbe(Infinity, probe({ status: 'rejected', fiveHour: { utilization: 100, resetsAt: iso(RESET) } })))
      .toBe(RESET)
  })

  test('ends at once when the probe shows nothing used up', () => {
    expect(cooldownAfterProbe(Infinity, probe({ fiveHour: { utilization: 40, resetsAt: iso(RESET) } }))).toBeNull()
  })

  test('stays when the probe still says rejected with no reset, failed, or was not a probe', () => {
    expect(cooldownAfterProbe(Infinity, probe({ status: 'rejected' }))).toBe(Infinity)
    expect(cooldownAfterProbe(Infinity, probe({ error: 'probe failed' }))).toBe(Infinity)
    expect(cooldownAfterProbe(Infinity, probe({ rateLimitsAvailable: false }))).toBe(Infinity)
    expect(cooldownAfterProbe(Infinity, probe({ source: 'session' }))).toBe(Infinity)
  })

  test('a cooldown with a known end is left alone', () => {
    expect(cooldownAfterProbe(RESET, probe({}))).toBe(RESET)
    expect(cooldownAfterProbe(null, probe({ status: 'rejected' }))).toBeNull()
  })
})

describe('the logins to probe again before choosing', () => {
  const expired = (id: string, patch: Partial<RouteAccount> = {}): RouteAccount =>
    account(id, { usage: usage(id, { fiveHour: { utilization: 95, resetsAt: iso(NOW - 1000) } }), ...patch })

  test('are those the session may use whose busiest window has reset, once per request', () => {
    const rows = [expired('claude:default'), expired('claude:off', { autoRoute: false }),
      account('claude:ahead', { usage: usage('claude:ahead', { fiveHour: { utilization: 95, resetsAt: iso(RESET) } }) }),
      expired('claude:out', { loggedIn: false }), account('claude:none')]
    expect(staleUsageLogins(auto, rows, NOW, new Set())).toEqual(['claude:default'])
    expect(staleUsageLogins(auto, rows, NOW, new Set(['claude:default']))).toEqual([])
    expect(staleUsageLogins({ ...auto, pinnedAccountId: 'claude:off' }, rows, NOW, new Set())).toEqual(['claude:off'])
  })
})

describe('why a login was passed over, for the log', () => {
  const context = { pinned: false, attempted: new Set<string>(), keychain: false, startedOn: 'claude:default' }

  test('names each block in plain words', () => {
    expect(whyPassedOver(account('claude:work', { autoRoute: false }), context, NOW)).toBe('not opted in to routing')
    expect(whyPassedOver(account('claude:work', { cooldownUntil: Infinity }), context, NOW))
      .toBe('cooling down until a usage probe says it is back')
    expect(whyPassedOver(account('claude:work', { cooldownUntil: RESET }), context, NOW)).toBe(`cooling down until ${iso(RESET)}`)
    expect(whyPassedOver(account('claude:work', { usage: usage('claude:work', { fiveHour: { utilization: 95.4, resetsAt: null } }) }),
      context, NOW)).toBe('at its limit, the 5 hour window is at 95% of 90%')
    expect(whyPassedOver(account('claude:work'), { ...context, attempted: new Set(['claude:work']) }, NOW))
      .toBe('already tried for this request')
  })

  test('a pinned session ignores the opt-in and is measured to 100%', () => {
    const row = account('claude:work', { autoRoute: false, usage: usage('claude:work', { fiveHour: { utilization: 95, resetsAt: null } }) })
    expect(whyPassedOver(row, { ...context, pinned: true }, NOW)).toBe('usable now, so it had room only after the choice was made')
  })

  test('says which token source did not read', () => {
    expect(routeBlockText({ kind: 'no-credentials' })).toBe('no token, its .credentials.json did not read')
    expect(whyPassedOver(account('claude:default', { credentialsReadable: false }), { ...context, keychain: true }, NOW))
      .toContain('carried no authorization header of its own')
    expect(whyPassedOver(account('claude:work', { credentialsReadable: false }), { ...context, keychain: true }, NOW))
      .toContain('signs only for the login it was started on')
  })
})
