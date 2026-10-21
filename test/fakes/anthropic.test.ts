import { request } from 'node:http'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { reply, startFakeAnthropic, unifiedHeaders, type FakeAnthropic } from './anthropic.ts'

let api: FakeAnthropic

beforeEach(async () => {
  api = await startFakeAnthropic()
})

afterEach(async () => {
  await api.close()
})

interface Answer { status: number; headers: Record<string, string>; body: string }

function call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const text = body === undefined ? undefined : JSON.stringify(body)
    const req = request(`${api.url}${path}`, { method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = ''
      res.setEncoding('utf8').on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string>, body: data }))
    })
    req.on('error', reject)
    req.end(text)
  })
}

const messages = (token: string): Promise<Answer> =>
  call('POST', '/v1/messages?beta=true', { authorization: `Bearer ${token}`, 'x-claude-code-session-id': 'session-1' },
    { model: 'claude-sonnet-5', stream: true, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })

it('listens on loopback and answers HEAD /api/hello without using the script', async () => {
  expect(api.url).toBe(`http://127.0.0.1:${String(api.port)}`)
  api.script(reply.overloaded())
  const hello = await call('HEAD', '/api/hello')
  expect(hello.status).toBe(200)
  expect(api.requests[0]).toMatchObject({ method: 'HEAD', path: '/api/hello', answeredWith: { kind: 'hello', status: 200 } })
  expect((await messages('sk-ant-oat01-fake-a')).status).toBe(529)
})

it('streams a message as server-sent events with the rate-limit headers', async () => {
  api.script(reply.ok({ text: 'Hello there, from a test.' }))
  const answer = await messages('sk-ant-oat01-fake-a')
  expect(answer.status).toBe(200)
  expect(answer.headers['content-type']).toContain('text/event-stream')
  expect(answer.headers['anthropic-ratelimit-unified-status']).toBe('allowed')
  expect(answer.headers['anthropic-ratelimit-unified-5h-utilization']).toBe('0.1')
  expect(Number(answer.headers['anthropic-ratelimit-unified-7d-reset'])).toBeGreaterThan(Date.now() / 1000)
  const events = [...answer.body.matchAll(/^event: (\w+)$/gm)].map((match) => match[1])
  expect(events[0]).toBe('message_start')
  expect(events.at(-1)).toBe('message_stop')
  const text = [...answer.body.matchAll(/"text_delta","text":"([^"]*)"/g)].map((match) => match[1]).join('')
  expect(text).toBe('Hello there, from a test.')
})

it('records the method, path, headers, bearer, session and body of each request', async () => {
  await messages('sk-ant-oat01-fake-a')
  const [seen] = await api.waitForRequests(1)
  expect(seen).toMatchObject({
    method: 'POST', url: '/v1/messages?beta=true', path: '/v1/messages', bearer: 'sk-ant-oat01-fake-a',
    apiKey: null, sessionId: 'session-1', json: { model: 'claude-sonnet-5' }, answeredWith: { kind: 'ok', status: 200 }
  })
  expect(seen?.headers['x-claude-code-session-id']).toBe('session-1')
})

it('answers a token from its own queue before the shared one', async () => {
  api.script(reply.ok({ text: 'shared' }))
  api.scriptFor('sk-ant-oat01-fake-b', reply.quota({ claim: 'seven_day' }))
  expect((await messages('sk-ant-oat01-fake-b')).status).toBe(429)
  expect((await messages('sk-ant-oat01-fake-b')).body).toContain('shared')
  api.setDefault((req) => req.bearer === 'sk-ant-oat01-fake-c' ? reply.unauthorized() : reply.ok())
  expect((await messages('sk-ant-oat01-fake-c')).status).toBe(401)
  expect((await messages('sk-ant-oat01-fake-a')).status).toBe(200)
})

it('refuses a usage limit with the headers that make it final', async () => {
  const resetsAt = Date.now() + 2 * 3_600_000
  api.script(reply.quota({ claim: 'five_hour', resetsAt }))
  const answer = await messages('sk-ant-oat01-fake-a')
  expect(answer.status).toBe(429)
  expect(answer.headers).toMatchObject({
    'anthropic-ratelimit-unified-status': 'rejected',
    'anthropic-ratelimit-unified-representative-claim': 'five_hour',
    'anthropic-ratelimit-unified-reset': String(Math.floor(resetsAt / 1000)),
    'anthropic-ratelimit-unified-5h-status': 'rejected'
  })
  expect(JSON.parse(answer.body)).toMatchObject({ type: 'error', error: { type: 'rate_limit_error' } })
})

it('answers 529, a plain 429 and a 401 the way the API does', async () => {
  api.script(reply.overloaded({ retryAfter: 2 }), reply.rateLimited(), reply.unauthorized(), reply.serverError(503))
  const overloaded = await messages('t')
  expect(overloaded.status).toBe(529)
  expect(overloaded.headers['retry-after']).toBe('2')
  expect(JSON.parse(overloaded.body)).toMatchObject({ error: { type: 'overloaded_error', message: 'Overloaded' } })
  const limited = await messages('t')
  expect(limited.status).toBe(429)
  expect(Object.keys(limited.headers).filter((name) => name.startsWith('anthropic-ratelimit-unified-'))).toEqual([])
  const unauthorized = await messages('t')
  expect(unauthorized.status).toBe(401)
  expect(JSON.parse(unauthorized.body)).toMatchObject({ error: { type: 'authentication_error' } })
  expect((await messages('t')).status).toBe(503)
})

it('builds the unified headers from windows, naming the rejected window as the claim', () => {
  const headers = unifiedHeaders({
    fiveHour: { utilization: 0.5, resetsAt: 1_900_000_000_000 },
    sevenDay: { utilization: 1, resetsAt: 1_900_100_000_000 }
  })
  expect(headers).toMatchObject({
    'anthropic-ratelimit-unified-status': 'rejected',
    'anthropic-ratelimit-unified-representative-claim': 'seven_day',
    'anthropic-ratelimit-unified-reset': '1900100000',
    'anthropic-ratelimit-unified-5h-status': 'allowed',
    'anthropic-ratelimit-unified-7d-status': 'rejected'
  })
})
