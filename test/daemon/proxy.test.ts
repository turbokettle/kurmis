// The proxy's handling of a stream that starts within a capacity hold, a 401 from a login the
// CLI was not started on, the hold after a pin-back, stale usage probes that keep failing, and
// a body that is too large. Most tests run the whole daemon app in process (`harness.ts`)
// against the fake Anthropic API; the body test runs the proxy alone.
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CONTROL_PATHS, type StatusAnswer } from '../../src/core/control-api.ts'
import { loadConfig, saveConfig, updateLogin } from '../../src/data/config.ts'
import { loginFolder } from '../../src/data/paths.ts'
import { createProxy } from '../../src/daemon/proxy.ts'
import type { ProbeFunction } from '../../src/daemon/usage-poller.ts'
import { fakeToken, reply, writeClaudeCredentials } from '../fakes/index.ts'
import { FAKE_SECURITY, FakeKeychain } from './fake-security/fake-keychain.ts'
import { claudeRef, OWN_CLAUDE } from '../logins.ts'
import { call, KEY, messagesBody, routed, startHarness, type Harness } from './harness.ts'

const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'
const S3 = '33333333-3333-4333-8333-333333333333'
const DEFAULT = fakeToken('default')
const WORK = fakeToken('work')
const WORK_ID = 'workclaude'
const BAD_REQUEST = '{"type":"error","error":{"type":"invalid_request_error","message":"no"}}'

let harness: Harness | null = null

afterEach(async () => {
  await harness?.close()
  harness = null
})

/** A harness with the login plain claude uses and `WORK_ID`, both signed in with a file. */
async function twoLogins(options: Parameters<typeof startHarness>[0] = {},
  credentials: { default?: Parameters<typeof writeClaudeCredentials>[1] } = {}): Promise<Harness> {
  harness = await startHarness({ claude: { [WORK_ID]: {} }, ...options })
  writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT, ...credentials.default })
  writeClaudeCredentials(loginFolder(claudeRef(WORK_ID)), { accessToken: WORK })
  return harness
}

function messages(h: Harness, session: string | null, extra: Record<string, string> = {}): ReturnType<typeof call> {
  return call(h, '/v1/messages?beta=true', { headers: routed(session, extra), body: messagesBody() })
}

function bearers(h: Harness): Array<string | null> {
  return h.api.apiRequests().map((request) => request.bearer)
}

async function status(h: Harness): Promise<StatusAnswer['logins']> {
  const answer = await call(h, CONTROL_PATHS.status, { headers: { 'x-kurmis-key': KEY } })
  expect(answer.status).toBe(200)
  return (JSON.parse(answer.text) as StatusAnswer).logins
}

function events(h: Harness, event: string): number {
  return h.log.filter((line) => line.event === event).length
}

/** Marks `WORK_ID` "use first", so every Auto session that can moves to it. */
function useWorkFirst(): void {
  saveConfig(updateLogin(loadConfig(), WORK_ID, { useFirst: true }))
}

/**
 * S1 is placed on the login plain claude uses, then moves to WORK_ID (marked "use first"), which answers
 * 400, so S1 is sent back to the login plain claude uses and held there. The login plain claude uses can serve throughout.
 */
async function holdS1OnDefault(h: Harness): Promise<void> {
  expect((await messages(h, S1)).status).toBe(200)
  useWorkFirst()
  h.api.scriptFor(WORK, reply.raw(400, BAD_REQUEST))
  expect((await messages(h, S1)).status).toBe(200)
  expect(bearers(h)).toEqual([DEFAULT, WORK, DEFAULT])
  // Held: the next request stays on the login plain claude uses although WORK_ID comes first.
  expect((await messages(h, S1)).status).toBe(200)
  expect(bearers(h).at(-1)).toBe(DEFAULT)
}

describe('a capacity hold', () => {
  test('does not cut off a stream that started within the hold when the hold ends', async () => {
    harness = await startHarness({ tuning: { holdBaseMs: 50, holdMaxMs: 50, holdMs: 1_500 } })
    writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT })
    // 16 deltas 200 ms apart: the stream lasts about 4 s, well past the end of the hold.
    harness.api.scriptFor(DEFAULT, reply.overloaded(), reply.ok({ text: 'x'.repeat(16 * 16), eventDelayMs: 200 }))
    const answer = await messages(harness, S1)
    expect(answer.status).toBe(200)
    expect(answer.chunkTimes.at(-1)).toBeGreaterThan(1_500)
    expect(answer.text).toContain('message_stop')
    expect(bearers(harness)).toEqual([DEFAULT, DEFAULT])
  }, 30_000)
})

describe('a 401', () => {
  test('from a login the CLI was not started on goes to the next login, which Auto passes over until a probe succeeds', async () => {
    const h = await twoLogins()
    useWorkFirst()
    // Refused before and after the renewal the proxy tries through a probe.
    h.api.scriptFor(WORK, reply.unauthorized(), reply.unauthorized())
    const answer = await messages(h, S1)
    expect(answer.status).toBe(200)
    expect(bearers(h)).toEqual([WORK, WORK, DEFAULT])
    expect((await status(h)).find((login) => login.id === WORK_ID)?.block?.kind).toBe('signed-out')
    // A new session would go to WORK_ID, marked "use first", but it is passed over now.
    expect((await messages(h, S2)).status).toBe(200)
    expect(bearers(h).at(-1)).toBe(DEFAULT)
    // A probe that succeeds ends that.
    expect((await call(h, CONTROL_PATHS.probe, { headers: { 'x-kurmis-key': KEY }, body: { logins: [WORK_ID] } })).status).toBe(200)
    expect((await status(h)).find((login) => login.id === WORK_ID)?.block).toBeNull()
    expect((await messages(h, S3)).status).toBe(200)
    expect(bearers(h).at(-1)).toBe(WORK)
  }, 30_000)

  test('from a login without a refresh token goes to the next login at once', async () => {
    const h = await twoLogins({}, { default: { refreshToken: null } })
    h.api.scriptFor(DEFAULT, reply.unauthorized())
    const answer = await messages(h, S1, { 'x-kurmis-started-on': WORK_ID })
    expect(answer.status).toBe(200)
    expect(bearers(h)).toEqual([DEFAULT, WORK])
  })

  test('from the started-on login, or from the login a session is pinned to, reaches the CLI', async () => {
    const h = await twoLogins()
    h.api.scriptFor(DEFAULT, reply.unauthorized(), reply.unauthorized())
    expect((await messages(h, S1)).status).toBe(401)
    expect(bearers(h)).toEqual([DEFAULT, DEFAULT])
    h.api.scriptFor(WORK, reply.unauthorized(), reply.unauthorized())
    expect((await messages(h, S2, { 'x-kurmis-login': WORK_ID })).status).toBe(401)
    expect(bearers(h)).toEqual([DEFAULT, DEFAULT, WORK, WORK])
  }, 30_000)

  test('with no login left to try is the proxy\'s 599, not the 401', async () => {
    harness = await startHarness({ claude: { [WORK_ID]: {} } })
    writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT, refreshToken: null })
    harness.api.scriptFor(DEFAULT, reply.unauthorized())
    // Started on WORK_ID, which has no token here and the request no authorization header.
    const answer = await messages(harness, S1, { 'x-kurmis-started-on': WORK_ID })
    expect(answer.status).toBe(599)
    expect(bearers(harness)).toEqual([DEFAULT])
  })
})

describe('the hold after a pin-back', () => {
  test('ends when the held login is cooling down, and the request goes on Auto', async () => {
    const h = await twoLogins()
    expect((await messages(h, S1)).status).toBe(200) // S1 is on the login plain claude uses
    h.api.scriptFor(DEFAULT, reply.quota({ resetsAt: Date.now() + 3_600_000 }))
    expect((await messages(h, S2)).status).toBe(200) // the login plain claude uses is cooling, S2 is on WORK_ID
    h.api.scriptFor(WORK, reply.raw(400, BAD_REQUEST))
    // S1 moves to WORK_ID, which answers 400; the pin-back tries the login plain claude uses once.
    expect((await messages(h, S1)).status).toBe(200)
    expect(bearers(h)).toEqual([DEFAULT, DEFAULT, WORK, WORK, DEFAULT])
    // The login plain claude uses is still cooling, so the hold ends and S1 goes where Auto sends it.
    expect((await messages(h, S1)).status).toBe(200)
    expect(bearers(h).at(-1)).toBe(WORK)
    expect(events(h, 'session_hold_ended')).toBe(1)
  })

  test('ends when the held login answers a usage limit, and the 429 is sent again on another login', async () => {
    const h = await twoLogins()
    await holdS1OnDefault(h)
    h.api.scriptFor(DEFAULT, reply.quota({ resetsAt: Date.now() + 3_600_000 }))
    const answer = await messages(h, S1)
    expect(answer.status).toBe(200)
    expect(bearers(h).slice(-2)).toEqual([DEFAULT, WORK])
  })

  test('ends when the held login is signed out', async () => {
    const h = await twoLogins()
    await holdS1OnDefault(h)
    rmSync(join(h.home, '.claude', '.credentials.json'))
    const answer = await messages(h, S1)
    expect(answer.status).toBe(200)
    expect(bearers(h).at(-1)).toBe(WORK)
  })

  test('back to a previous login that is signed out gives the CLI the 400', async () => {
    const h = await twoLogins()
    expect((await messages(h, S1)).status).toBe(200) // S1 is on the login plain claude uses
    rmSync(join(h.home, '.claude', '.credentials.json'))
    h.api.scriptFor(WORK, reply.raw(400, BAD_REQUEST))
    const answer = await messages(h, S1)
    expect(answer.status).toBe(400)
    expect(answer.text).toBe(BAD_REQUEST)
    expect(bearers(h)).toEqual([DEFAULT, WORK])
  })

  test('that meets a usage limit on the previous login gives the CLI that 429, not the 400 again', async () => {
    const h = await twoLogins()
    expect((await messages(h, S1)).status).toBe(200) // S1 is on the login plain claude uses
    useWorkFirst()
    h.api.scriptFor(WORK, reply.raw(400, BAD_REQUEST))
    h.api.scriptFor(DEFAULT, reply.quota({ claim: 'seven_day', resetsAt: Date.now() + 3_600_000 }))
    const answer = await messages(h, S1)
    expect(answer.status).toBe(429)
    expect(answer.headers['anthropic-ratelimit-unified-representative-claim']).toBe('seven_day')
    expect(bearers(h)).toEqual([DEFAULT, WORK, DEFAULT])
  })
})

describe('a CLI whose credentials are no kurmis login\'s (x-kurmis-started-on: none)', () => {
  const none = { 'x-kurmis-started-on': 'none', authorization: 'Bearer cli-own-token' }

  test("is never signed as the login plain claude uses, and its own header is never forwarded", async () => {
    const h = await twoLogins()
    expect((await messages(h, S1, none)).status).toBe(200)
    expect((await messages(h, S2, none)).status).toBe(200)
    expect(bearers(h)).toEqual([WORK, WORK])
    // A 401 from the extra login does not reach that CLI, which could not sign it in again.
    h.api.scriptFor(WORK, reply.unauthorized(), reply.unauthorized())
    const answer = await messages(h, S3, none)
    expect(answer.status).toBe(599)
    expect(bearers(h).slice(2)).toEqual([WORK, WORK])
  }, 30_000)

  test('with no extra login to use gets the proxy\'s 599 saying why', async () => {
    harness = await startHarness()
    writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT })
    const answer = await messages(harness, S1, none)
    expect(answer.status).toBe(599)
    expect(answer.text).toContain('CLAUDE_CONFIG_DIR')
    expect(answer.text).toContain('kurmis login claude')
    expect(answer.text).toContain('which is not the login a plain `claude` uses')
    expect(harness.api.apiRequests()).toHaveLength(0)
  })
})

describe('a refusal whose body stalls', () => {
  const quotaHeaders = (): Record<string, string> => ({
    'content-type': 'application/json',
    'anthropic-ratelimit-unified-status': 'rejected',
    'anthropic-ratelimit-unified-representative-claim': 'five_hour',
    'anthropic-ratelimit-unified-reset': String(Math.floor(Date.now() / 1000) + 3_600)
  })

  test('a usage-limit 429 does not keep the request from the next login', async () => {
    const h = await twoLogins({ tuning: { keptAnswerTimeoutMs: 300 } })
    h.api.scriptFor(DEFAULT, reply.raw(429, '{"type":"error"', { headers: quotaHeaders(), stall: true }))
    const started = Date.now()
    const answer = await messages(h, S1)
    expect(answer.status).toBe(200)
    expect(bearers(h)).toEqual([DEFAULT, WORK])
    expect(Date.now() - started).toBeLessThan(5_000)
  }, 15_000)

  test('the 400 before a pin-back does not keep the request from the previous login', async () => {
    const h = await twoLogins({ tuning: { keptAnswerTimeoutMs: 300 } })
    expect((await messages(h, S1)).status).toBe(200)
    useWorkFirst()
    h.api.scriptFor(WORK, reply.raw(400, '{"type":"error"', { headers: { 'content-type': 'application/json' }, stall: true }))
    const started = Date.now()
    expect((await messages(h, S1)).status).toBe(200)
    expect(bearers(h)).toEqual([DEFAULT, WORK, DEFAULT])
    expect(Date.now() - started).toBeLessThan(5_000)
  }, 15_000)

  test('with no login left, the CLI gets the part of the 429 that came', async () => {
    harness = await startHarness({ tuning: { keptAnswerTimeoutMs: 300 } })
    writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT })
    harness.api.scriptFor(DEFAULT, reply.raw(429, '{"type":"error"', { headers: quotaHeaders(), stall: true }))
    const answer = await messages(harness, S1)
    expect(answer.status).toBe(429)
    expect(answer.text).toBe('{"type":"error"')
  }, 15_000)
})

describe('a token about to expire', () => {
  test('is read from the Keychain again before the proxy decides to renew it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kurmis-keychain-'))
    try {
      const keychain = new FakeKeychain(dir)
      vi.stubEnv('FAKE_SECURITY_DIR', keychain.dir)
      const item = (token: string, expiresAt: number): string =>
        JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: 'sk-ant-ort01-fake-refresh', expiresAt } })
      // Fresh for eight more seconds by the five-minute margin, which is room for a slow start.
      const expiresAt = Date.now() + 5 * 60_000 + 8_000
      keychain.setItem('Claude Code-credentials', item(DEFAULT, expiresAt))
      const h = harness = await startHarness({ tuning: { platform: 'darwin', poll: false }, env: { KURMIS_SECURITY_PROGRAM: FAKE_SECURITY } })
      expect((await messages(h, S1)).status).toBe(200)
      // The CLI renews the token; the daemon's Keychain answer is less than a minute old.
      const renewed = fakeToken('renewed')
      keychain.setItem('Claude Code-credentials', item(renewed, Date.now() + 8 * 3_600_000))
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, expiresAt - 5 * 60_000 - Date.now() + 300)))
      expect((await messages(h, S1)).status).toBe(200)
      expect(bearers(h)).toEqual([DEFAULT, renewed])
      expect(events(h, 'token_renewal_started')).toBe(0)
    } finally {
      vi.unstubAllEnvs()
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  }, 30_000)
})

describe('stale usage', () => {
  test('a probe for a stale reading that fails is not run again for the same login within a minute', async () => {
    let probes = 0
    const failing: ProbeFunction = () => {
      probes++
      return Promise.resolve({ ok: false, signedIn: null, reason: 'other', error: 'The usage probe failed.' })
    }
    harness = await startHarness({ tuning: { probeClaude: failing } })
    writeClaudeCredentials(join(harness.home, '.claude'), { accessToken: DEFAULT })
    // Every answer reports a five-hour window whose reset has passed, so the reading stays stale.
    harness.api.setDefault(reply.ok({ unified: { fiveHour: { utilization: 0.5, resetsAt: Date.now() - 60_000 } } }))
    for (const session of [S1, S2, S3]) expect((await messages(harness, session)).status).toBe(200)
    expect(probes).toBe(1)
  })
})

describe('a request body that is too large', () => {
  let server: Server | null = null
  afterEach(async () => {
    server?.closeAllConnections()
    await new Promise<void>((resolve) => { if (server === null) resolve(); else server.close(() => resolve()) })
    server = null
  })

  test('is answered 413 also for a client that sends its whole body before it reads the answer', async () => {
    const log: string[] = []
    // Nothing but the key and the body is looked at before a body that is too large is refused.
    // The table only names the login plain claude uses: the body is refused before anything else is read.
    const table = { plainClaudeLogin: () => ({ id: OWN_CLAUDE }) }
    const proxy = createProxy({ key: KEY, table: table as never, tokens: {} as never, identity: {} as never, poller: {} as never,
      upstream: {} as never, log: { write: (event) => { log.push(event) } }, now: Date.now, maxBodyBytes: 1_000 })
    server = createServer((req, res) => { void proxy.handle(req, res) })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const size = 16 * 1024 * 1024
    const received = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1')
      const chunks: Buffer[] = []
      socket.on('error', reject)
      socket.once('connect', () => {
        socket.write(`POST /v1/messages HTTP/1.1\r\nhost: 127.0.0.1\r\nx-kurmis-key: ${KEY}\r\n` +
          `content-type: application/json\r\ncontent-length: ${String(size)}\r\n\r\n`)
        // The whole body is written before anything is read.
        socket.pause()
        socket.write(Buffer.alloc(size, 0x20), () => {
          socket.on('data', (chunk: Buffer) => { chunks.push(chunk) })
          socket.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
          socket.resume()
        })
      })
    })
    expect(received.startsWith('HTTP/1.1 413')).toBe(true)
    expect(received).toContain('"type":"request_too_large"')
    expect(log).toEqual(['proxy_rejected'])
    expect(proxy.openRequests()).toBe(0)
  }, 30_000)
})
