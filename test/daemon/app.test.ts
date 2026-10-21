// The whole request handling in process: the daemon app behind a `node:http` server, against
// the fake Anthropic API, with logins whose `.credentials.json` the fake helpers write and the
// fake Keychain answering "no item".
import { readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { CONTROL_PATHS, type StatusAnswer } from '../../src/core/control-api.ts'
import { addLogin, loadConfig, saveConfig } from '../../src/data/config.ts'
import { loginFolder, statePath } from '../../src/data/paths.ts'
import { fakeToken, readFakeClaudeRecord, reply, writeClaudeCredentials, writeClaudeIdentity, writeCodexAuth } from '../fakes/index.ts'
import { call, KEY, messagesBody, routed, startHarness, type Harness } from './harness.ts'

const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'
const DEFAULT = fakeToken('default')
const WORK = fakeToken('work')

let harness: Harness | null = null

afterEach(async () => {
  await harness?.close()
  harness = null
})

/** A harness with `claude:default` and `claude:work`, both signed in with a file. */
async function twoLogins(options: Parameters<typeof startHarness>[0] = {}): Promise<Harness> {
  harness = await startHarness({ logins: { 'claude:work': {} }, ...options })
  writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT })
  writeClaudeCredentials(loginFolder('claude:work'), { accessToken: WORK })
  return harness
}

function messages(h: Harness, session: string | null, extra: Record<string, string> = {}, stream = true): ReturnType<typeof call> {
  return call(h, '/v1/messages?beta=true', { headers: routed(session, extra), body: messagesBody(stream) })
}

async function status(h: Harness): Promise<StatusAnswer> {
  const answer = await call(h, CONTROL_PATHS.status, { headers: { 'x-kurmis-key': KEY } })
  expect(answer.status).toBe(200)
  return JSON.parse(answer.text) as StatusAnswer
}

function bearers(h: Harness): Array<string | null> {
  return h.api.apiRequests().map((request) => request.bearer)
}

describe('what the daemon answers itself', () => {
  test('hello needs no key, unknown paths are 404, and a routed path without the key is 403 with no body', async () => {
    harness = await startHarness()
    expect((await call(harness, '/api/hello', { method: 'HEAD' })).status).toBe(200)
    expect((await call(harness, '/api/hello')).text).toBe('{"message":"hello"}')
    expect((await call(harness, '/v1/other', { headers: routed(null) })).status).toBe(404)
    const refused = await call(harness, '/v1/messages', { body: messagesBody() })
    expect(refused.status).toBe(403)
    expect(refused.text).toBe('')
    const wrongKey = await call(harness, '/v1/messages', { headers: { 'x-kurmis-key': 'b'.repeat(64) }, body: messagesBody() })
    expect(wrongKey.status).toBe(403)
    expect(harness.api.apiRequests()).toHaveLength(0)
  })

  test('a login header that names no Claude login is refused with a 400', async () => {
    harness = await startHarness()
    const pinned = await messages(harness, S1, { 'x-kurmis-login': 'codex:default' })
    expect(pinned.status).toBe(400)
    expect(JSON.parse(pinned.text)).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } })
    expect((await messages(harness, S1, { 'x-kurmis-started-on': 'nobody' })).status).toBe(400)
    expect(harness.api.apiRequests()).toHaveLength(0)
  })

  test('a body that is not JSON is refused with a 400', async () => {
    harness = await startHarness()
    writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT })
    const answer = await new Promise<number>((resolve, reject) => {
      void import('node:http').then(({ request }) => {
        const req = request({ host: '127.0.0.1', port: harness!.port, path: '/v1/messages', method: 'POST', headers: routed(S1) },
          (res) => { res.resume(); resolve(res.statusCode ?? 0) })
        req.on('error', reject)
        req.end('not json')
      })
    })
    expect(answer).toBe(400)
  })
})

describe('choosing and signing', () => {
  test('a request is signed with the chosen login\'s token and none of the kurmis headers go upstream', async () => {
    const h = await twoLogins()
    const answer = await messages(h, S1, { authorization: 'Bearer cli-own-token' })
    expect(answer.status).toBe(200)
    expect(bearers(h)).toEqual([DEFAULT])
    const sent = h.api.apiRequests()[0]!
    expect(sent.headers['x-kurmis-key']).toBeUndefined()
    expect(sent.headers['x-claude-code-session-id']).toBe(S1)
    expect(sent.url).toBe('/v1/messages?beta=true')
  })

  test('a quota 429 on the first login is sent again on the second, and the CLI sees only the 200', async () => {
    const h = await twoLogins()
    h.api.scriptFor(DEFAULT, reply.quota({ claim: 'five_hour', resetsAt: Date.now() + 3_600_000 }))
    const answer = await messages(h, S1)
    expect(answer.status).toBe(200)
    expect(answer.text).toContain('message_stop')
    expect(bearers(h)).toEqual([DEFAULT, WORK])
    const logins = (await status(h)).logins
    expect(logins.find((login) => login.id === 'claude:default')?.cooldownUntil).toBeGreaterThan(Date.now())
    expect(logins.find((login) => login.id === 'claude:default')?.block?.kind).toBe('cooldown')
    expect(logins.find((login) => login.id === 'claude:work')?.sessions).toBe(1)
    // The next request of the session stays on the login that served it.
    expect((await messages(h, S1)).status).toBe(200)
    expect(bearers(h)).toEqual([DEFAULT, WORK, WORK])
  })

  test('a session stays on the login that served it, while a new session is placed by the ranking', async () => {
    const h = await twoLogins()
    // No rate-limit headers, so neither login has a weekly reset and the ranking falls to the home login.
    h.api.setDefault(reply.ok({ unified: null }))
    expect((await messages(h, S1, { 'x-kurmis-login': 'claude:work' })).status).toBe(200)
    expect((await messages(h, S1)).status).toBe(200)
    expect((await messages(h, S2)).status).toBe(200)
    expect(bearers(h)).toEqual([WORK, WORK, DEFAULT])
    await h.app.close()
    const saved = JSON.parse(readFileSync(statePath(), 'utf8')) as { sessions: Record<string, { login: string }> }
    expect(saved.sessions[S1]?.login).toBe('claude:work')
    expect(saved.sessions[S2]?.login).toBe('claude:default')
  })

  test('requests without a session id share one placement', async () => {
    const h = await twoLogins()
    expect((await messages(h, null, { 'x-kurmis-login': 'claude:work' })).status).toBe(200)
    expect((await messages(h, null)).status).toBe(200)
    expect(bearers(h)).toEqual([WORK, WORK])
    await h.app.close()
    const saved = JSON.parse(readFileSync(statePath(), 'utf8')) as { sessions: Record<string, { login: string }> }
    expect(Object.values(saved.sessions).map((placement) => placement.login)).toEqual(['claude:work'])
  })

  test('a pinned session goes to its login whatever the ranking, and gets that login\'s 429 as it stands', async () => {
    const h = await twoLogins()
    h.api.scriptFor(WORK, reply.quota({ claim: 'seven_day', resetsAt: Date.now() + 3_600_000 }))
    const answer = await messages(h, S1, { 'x-kurmis-login': 'claude:work' })
    expect(answer.status).toBe(429)
    expect(answer.headers['anthropic-ratelimit-unified-representative-claim']).toBe('seven_day')
    expect(bearers(h)).toEqual([WORK])
  })

  test('the account uuid in metadata.user_id is the chosen login\'s', async () => {
    const h = await twoLogins()
    writeClaudeIdentity(join(loginFolder('claude:work'), '.claude.json'),
      { email: 'work@example.com', accountUuid: '00000000-0000-4000-8000-00000000a0a0' })
    await messages(h, S1, { 'x-kurmis-login': 'claude:work' })
    const sent = h.api.apiRequests()[0]!.json as { metadata: { user_id: string } }
    expect(JSON.parse(sent.metadata.user_id)).toEqual({
      device_id: 'device-1', account_uuid: '00000000-0000-4000-8000-00000000a0a0', session_id: 'session-1'
    })
  })

  test('the body goes upstream byte for byte, and only the account uuid changes when it must', async () => {
    const h = await twoLogins()
    writeClaudeIdentity(join(loginFolder('claude:work'), '.claude.json'),
      { email: 'work@example.com', accountUuid: '00000000-0000-4000-8000-00000000a0a0' })
    const userId = JSON.stringify(JSON.stringify({ device_id: 'device-1', account_uuid: '00000000-0000-4000-8000-00000000c11e' }))
    const text = `{ "model" : "claude-sonnet-5",\n "max_tokens": 100, "seed": 18446744073709551615, "stream": true,\n` +
      ` "messages": [{"role":"user","content":"caf\u00e9"}], "metadata": {"user_id": ${userId}} }`
    // claude:default has no identity here, so its request is not rewritten at all.
    await call(h, '/v1/messages?beta=true', { headers: { ...routed(S1), 'content-type': 'application/json' }, text })
    expect(h.api.apiRequests()[0]!.body).toBe(text)
    await call(h, '/v1/messages?beta=true', { headers: { ...routed(S2, { 'x-kurmis-login': 'claude:work' }), 'content-type': 'application/json' }, text })
    expect(h.api.apiRequests()[1]!.body).toBe(text.replace('00000000c11e', '00000000a0a0'))
  })

  test('with no token anywhere and no header of its own, the CLI gets the proxy\'s 599', async () => {
    harness = await startHarness({ logins: { 'claude:work': {} } })
    const answer = await messages(harness, S1)
    expect(answer.status).toBe(599)
    expect(answer.headers['retry-after']).toBe('5')
    expect(harness.api.apiRequests()).toHaveLength(0)
    expect(harness.log.some((line) => line.event === 'pool_exhausted' && line.fields.reason === 'no_credentials')).toBe(true)
  })

  test('the CLI\'s own authorization header signs for the login it was started on when no token was read for it', async () => {
    harness = await startHarness({ logins: { 'claude:work': {} } })
    const own = await messages(harness, S1, { authorization: 'Bearer cli-own-default' })
    expect(own.status).toBe(200)
    // Started on claude:work, whose token kurmis cannot read either: still the CLI's own header.
    const onWork = await messages(harness, S2, { authorization: 'Bearer cli-own-work', 'x-kurmis-started-on': 'claude:work' })
    expect(onWork.status).toBe(200)
    expect(bearers(harness)).toEqual(['cli-own-default', 'cli-own-work'])
  })

  test('a token the daemon read signs instead of the CLI\'s own header', async () => {
    const h = await twoLogins()
    await messages(h, S1, { authorization: 'Bearer cli-own', 'x-kurmis-login': 'claude:work' })
    expect(bearers(h)).toEqual([WORK])
  })

  test('a 400 on the login a session has just moved to sends it back to its previous login', async () => {
    const h = await twoLogins()
    expect((await messages(h, S1)).status).toBe(200) // S1 is placed on claude:default
    h.api.scriptFor(DEFAULT, reply.quota({ resetsAt: Date.now() + 3_600_000 }))
    expect((await messages(h, S2)).status).toBe(200) // claude:default is now cooling, S2 is on claude:work
    h.api.scriptFor(WORK, reply.raw(400, '{"type":"error","error":{"type":"invalid_request_error","message":"no"}}'))
    const answer = await messages(h, S1)
    expect(answer.status).toBe(200)
    expect(bearers(h)).toEqual([DEFAULT, DEFAULT, WORK, WORK, DEFAULT])
    // How long the session stays held there is tested in proxy.test.ts.
  })
})

describe('when every login is out', () => {
  test('the CLI gets the real 429 of the login that is back first', async () => {
    const h = await twoLogins()
    const workReset = Math.floor((Date.now() + 3_600_000) / 1000) * 1000
    h.api.scriptFor(DEFAULT, reply.quota({ claim: 'seven_day', resetsAt: Date.now() + 7_200_000 }))
    h.api.scriptFor(WORK, reply.quota({ claim: 'five_hour', resetsAt: workReset }))
    const answer = await messages(h, S1)
    expect(answer.status).toBe(429)
    expect(bearers(h)).toEqual([DEFAULT, WORK])
    expect(answer.headers['anthropic-ratelimit-unified-representative-claim']).toBe('five_hour')
    expect(Number(answer.headers['anthropic-ratelimit-unified-reset'])).toBe(workReset / 1000)
    expect(JSON.parse(answer.text)).toMatchObject({ error: { type: 'rate_limit_error' } })
    expect(answer.headers['request-id']).toBeDefined()
  })

  test('with logins skipped for known cooldowns and no 429 in hand, the proxy answers its own 429', async () => {
    const h = await twoLogins()
    h.api.scriptFor(DEFAULT, reply.quota({ resetsAt: Date.now() + 3_600_000 }))
    h.api.scriptFor(WORK, reply.quota({ resetsAt: Date.now() + 7_200_000 }))
    expect((await messages(h, S1)).status).toBe(429)
    const second = await messages(h, S2)
    expect(second.status).toBe(429)
    expect(second.text).toContain('every login kurmis may use')
    expect(bearers(h)).toHaveLength(2)
  })
})

describe('the capacity hold', () => {
  test('a 529 on one login goes to the other at once', async () => {
    const h = await twoLogins()
    h.api.scriptFor(DEFAULT, reply.overloaded())
    const answer = await messages(h, S1)
    expect(answer.status).toBe(200)
    expect(bearers(h)).toEqual([DEFAULT, WORK])
  })

  test('with one login, a 529 is held for the backoff and sent again on the same login', async () => {
    harness = await startHarness({ tuning: { holdBaseMs: 50, holdMaxMs: 100, holdMs: 5_000 } })
    writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT })
    harness.api.scriptFor(DEFAULT, reply.overloaded(), reply.rateLimited())
    const started = Date.now()
    const answer = await messages(harness, S1)
    expect(answer.status).toBe(200)
    expect(Date.now() - started).toBeGreaterThanOrEqual(140)
    expect(bearers(harness)).toEqual([DEFAULT, DEFAULT, DEFAULT])
  })

  test('a hold that runs out is answered with the proxy\'s own 529, which the CLI sends again', async () => {
    harness = await startHarness({ tuning: { holdBaseMs: 50, holdMaxMs: 50, holdMs: 300 } })
    writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT })
    harness.api.setDefault(reply.overloaded())
    const answer = await messages(harness, S1)
    expect(answer.status).toBe(529)
    expect(answer.headers['retry-after']).toBe('1')
    expect(answer.text).toContain('kurmis proxy')
  })

  test('the client closing a held request ends it', async () => {
    harness = await startHarness({ tuning: { holdBaseMs: 10_000, holdMaxMs: 10_000, holdMs: 60_000 } })
    writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT })
    harness.api.setDefault(reply.overloaded())
    const controller = new AbortController()
    const pending = messages(harness, S1, {}).catch(() => 'aborted')
    void pending
    const aborted = call(harness, '/v1/messages', { headers: routed(S2), body: messagesBody(), signal: controller.signal }).catch(() => 'aborted')
    await harness.api.waitForRequests(2)
    controller.abort()
    expect(await aborted).toBe('aborted')
    await expect.poll(() => harness!.app.openRequests()).toBe(1)
  })
})

describe('streaming', () => {
  test('an SSE answer reaches the CLI as it comes, not at the end', async () => {
    const h = await twoLogins()
    h.api.scriptFor(DEFAULT, reply.ok({ text: 'x'.repeat(16 * 6), eventDelayMs: 60 }))
    const answer = await messages(h, S1)
    expect(answer.status).toBe(200)
    expect(answer.headers['content-type']).toContain('text/event-stream')
    expect(answer.chunkTimes.length).toBeGreaterThan(3)
    expect(answer.chunkTimes.at(-1)! - answer.chunkTimes[0]!).toBeGreaterThan(200)
    expect(answer.text.indexOf('message_start')).toBeLessThan(answer.text.indexOf('message_stop'))
  })

  test('the CLI aborting its request aborts the upstream request, and the app drains', async () => {
    const h = await twoLogins()
    h.api.scriptFor(DEFAULT, reply.hang())
    const controller = new AbortController()
    const pending = call(h, '/v1/messages', { headers: routed(S1), body: messagesBody(), signal: controller.signal }).catch(() => 'aborted')
    await h.api.waitForRequests(1)
    expect(h.app.openRequests()).toBe(1)
    controller.abort()
    expect(await pending).toBe('aborted')
    await h.app.drained()
    expect(h.app.openRequests()).toBe(0)
  })

  test('the rate-limit headers of an answer update the login\'s usage', async () => {
    const h = await twoLogins()
    h.api.scriptFor(DEFAULT, reply.ok({ unified: { fiveHour: { utilization: 0.37, resetsAt: Date.now() + 3_600_000 } } }))
    await messages(h, S1)
    const usage = (await status(h)).logins.find((login) => login.id === 'claude:default')?.usage
    expect(usage?.source).toBe('session')
    expect(usage?.fiveHour?.utilization).toBeCloseTo(37)
  })
})

describe('tokens and probes', () => {
  test('an expiring token is renewed through a probe before the request is signed', async () => {
    harness = await startHarness()
    const dir = join(harness.home, '.claude')
    writeClaudeCredentials(dir, { accessToken: DEFAULT, expiresAt: Date.now() + 60_000 })
    const answer = await messages(harness, S1)
    expect(answer.status).toBe(200)
    expect(bearers(harness)).toEqual([`${DEFAULT}-renewed`])
  })

  test('a token without a refresh token is never renewed: the login just expires', async () => {
    const record = join(process.env.HOME ?? '', 'record.jsonl')
    harness = await startHarness({ env: { FAKE_CLAUDE_RECORD: record } })
    writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT, refreshToken: null, expiresAt: Date.now() + 60_000 })
    const answer = await messages(harness, S1)
    expect(answer.status).toBe(599)
    expect(harness.api.apiRequests()).toHaveLength(0)
    expect(() => readFakeClaudeRecord(record)).not.toThrow()
    expect(readFakeClaudeRecordSafe(record)).toHaveLength(0)
    const block = (await status(harness)).logins.find((login) => login.id === 'claude:default')?.block
    expect(block?.kind).toBe('token-expiring')
  })

  test('a probe request probes the Claude logins and answers the status with their usage', async () => {
    const h = await twoLogins()
    const answer = await call(h, CONTROL_PATHS.probe, { headers: { 'x-kurmis-key': KEY }, body: { logins: ['claude:work'] } })
    expect(answer.status).toBe(200)
    const work = (JSON.parse(answer.text) as StatusAnswer).logins.find((login) => login.id === 'claude:work')
    expect(work?.signedIn).toBe(true)
    expect(work?.usage?.source).toBe('probe')
    expect(work?.usage?.fiveHour?.utilization).toBe(42)
  })

  test('a probe request reaches Codex logins through the app-server', async () => {
    harness = await startHarness({ logins: { 'codex:work': {} } })
    writeCodexAuth(loginFolder('codex:work'))
    const answer = await call(harness, CONTROL_PATHS.probe, { headers: { 'x-kurmis-key': KEY }, body: { logins: ['codex:work'] } })
    expect(answer.status).toBe(200)
    const work = (JSON.parse(answer.text) as StatusAnswer).logins.find((login) => login.id === 'codex:work')
    expect(work?.signedIn).toBe(true)
    expect(work?.usage?.provider).toBe('codex')
    expect(work?.usage?.windows?.length).toBeGreaterThan(0)
  })
})

describe('the control API', () => {
  test('every control path needs the key', async () => {
    harness = await startHarness()
    for (const path of Object.values(CONTROL_PATHS)) {
      const answer = await call(harness, path, { method: path === CONTROL_PATHS.status ? 'GET' : 'POST' })
      expect(answer.status).toBe(403)
      expect(answer.text).toBe('')
    }
    expect(harness.stopRequested()).toBe(0)
  })

  test('status lists every login with its settings, the default ones first', async () => {
    const h = await twoLogins()
    writeClaudeIdentity(join(loginFolder('claude:work'), '.claude.json'), { email: 'work@example.com' })
    const answer = await status(h)
    expect(answer).toMatchObject({ ok: true, apiVersion: 1, pid: process.pid })
    expect(answer.logins.map((login) => login.id)).toEqual(['claude:default', 'codex:default', 'claude:work'])
    const work = answer.logins.find((login) => login.id === 'claude:work')!
    expect(work).toMatchObject({ provider: 'claude', routing: true, fiveHourLimit: 100, weeklyLimit: 100, useFirst: false,
      signedIn: true, usage: null, cooldownUntil: null, block: null, sessions: 0, email: 'work@example.com' })
    expect(answer.logins.find((login) => login.id === 'codex:default')?.block).toBeNull()
    expect(h.log.every((line) => !JSON.stringify(line).includes('example.com'))).toBe(true)
  })

  test('reload reads config.json again, and a request notices a change by itself', async () => {
    const h = await twoLogins()
    saveConfig(addLogin(loadConfig(), 'claude:extra', { label: 'Extra' }))
    expect((await call(h, CONTROL_PATHS.reload, { method: 'POST', headers: { 'x-kurmis-key': KEY } })).status).toBe(200)
    expect((await status(h)).logins.map((login) => login.id)).toContain('claude:extra')
    writeFileSync(join(process.env.KURMIS_HOME ?? '', 'config.json'), '{ not json')
    const broken = await call(h, CONTROL_PATHS.reload, { method: 'POST', headers: { 'x-kurmis-key': KEY } })
    expect(broken.status).toBe(500)
    expect(JSON.parse(broken.text)).toMatchObject({ ok: false })
    // The config the daemon had is kept.
    expect((await status(h)).logins.map((login) => login.id)).toContain('claude:extra')
  })

  test('stop answers ok and then asks the daemon to stop', async () => {
    harness = await startHarness()
    const answer = await call(harness, CONTROL_PATHS.stop, { method: 'POST', headers: { 'x-kurmis-key': KEY } })
    expect(answer.status).toBe(200)
    expect(JSON.parse(answer.text)).toEqual({ ok: true })
    await expect.poll(() => harness!.stopRequested()).toBe(1)
  })

  test('stop passes on how long the daemon may wait, and refuses a wait that is not a number', async () => {
    harness = await startHarness()
    const stop = (body?: unknown): ReturnType<typeof call> =>
      call(harness!, CONTROL_PATHS.stop, { method: 'POST', headers: { 'x-kurmis-key': KEY }, ...(body === undefined ? {} : { body }) })
    expect((await stop({ maxWaitMs: 1_500 })).status).toBe(200)
    expect((await stop()).status).toBe(200)
    const wrong = await stop({ maxWaitMs: -1 })
    expect(wrong.status).toBe(400)
    expect(JSON.parse(wrong.text)).toMatchObject({ ok: false, error: expect.stringContaining('maxWaitMs') as unknown })
    await expect.poll(() => harness!.stopRequested()).toBe(2)
    expect(harness.stopRequests).toEqual([{ maxWaitMs: 1_500 }, {}])
  })

  test('a body larger than 64 KB is answered 413, and the client gets the answer rather than a reset', async () => {
    harness = await startHarness()
    const body = Buffer.alloc(2 * 1024 * 1024, 0x20)
    /** Sends `body` in 64 KB pieces, with a content-length or chunked, and answers what came back. */
    const send = (path: string, chunked: boolean): Promise<{ status: number; text: string }> => new Promise((resolve, reject) => {
      const outgoing = request({
        host: '127.0.0.1', port: harness!.port, path, method: 'POST',
        headers: { 'x-kurmis-key': KEY, 'content-type': 'application/json', ...(chunked ? {} : { 'content-length': String(body.length) }) }
      }, (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }))
        incoming.on('error', reject)
      })
      outgoing.on('error', reject)
      for (let at = 0; at < body.length; at += 64 * 1024) outgoing.write(body.subarray(at, at + 64 * 1024))
      outgoing.end()
    })
    for (const [path, chunked] of [[CONTROL_PATHS.probe, false], [CONTROL_PATHS.probe, true], [CONTROL_PATHS.stop, false], [CONTROL_PATHS.stop, true]] as const) {
      const answer = await send(path, chunked)
      expect(answer.status).toBe(413)
      expect(JSON.parse(answer.text)).toEqual({ ok: false, error: "The control request's body is larger than 64 KB." })
    }
    expect(harness.stopRequested()).toBe(0)
  })

  test('a wrong method is 405, an unknown path 404, and a probe of an unknown login 400', async () => {
    harness = await startHarness()
    expect((await call(harness, CONTROL_PATHS.stop, { headers: { 'x-kurmis-key': KEY } })).status).toBe(405)
    expect((await call(harness, '/_kurmis/nothing', { headers: { 'x-kurmis-key': KEY } })).status).toBe(404)
    const probe = await call(harness, CONTROL_PATHS.probe, { headers: { 'x-kurmis-key': KEY }, body: { logins: ['claude:nobody'] } })
    expect(probe.status).toBe(400)
  })
})

function readFakeClaudeRecordSafe(file: string): unknown[] {
  try {
    return readFakeClaudeRecord(file)
  } catch {
    return []
  }
}
