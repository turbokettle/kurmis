import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reply, startFakeAnthropic, type FakeAnthropic } from './anthropic.ts'
import {
  FAKE_CLAUDE_SCRIPT, FAKE_CLAUDE_VERSION, fakeToken, readClaudeCredentials, readFakeClaudeRecord,
  runFakeClaude, writeClaudeCredentials, writeClaudeIdentity, writeClaudeScenario
} from './claude.ts'

let root: string
let home: string
let recordFile: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kurmis-fake-claude-'))
  home = join(root, 'home')
  mkdirSync(home)
  recordFile = join(root, 'record.jsonl')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10 })
})

/** A clean environment: only what a test names, plus PATH, a home folder and the record file. */
function envOf(extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, FAKE_CLAUDE_RECORD: recordFile, ...extra }
}

function run(args: string[], extra: Record<string, string> = {}, input?: string) {
  return runFakeClaude(args, { env: envOf(extra), replaceEnv: true, ...(input === undefined ? {} : { input }) })
}

it('prints its version as the real CLI does', async () => {
  const result = await run(['--version'])
  expect(result).toMatchObject({ code: 0, stdout: `${FAKE_CLAUDE_VERSION} (Claude Code)\n` })
  expect((await run(['--version'], { FAKE_CLAUDE_VERSION: '9.9.9' })).stdout).toBe('9.9.9 (Claude Code)\n')
})

describe('auth status --json', () => {
  it('answers logged out with exit 1 and still prints the JSON', async () => {
    const result = await run(['auth', 'status', '--json'])
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual({
      loggedIn: false, authMethod: 'none', apiProvider: 'firstParty', analyticsDisabled: false,
      projectsDirectory: join(home, '.claude', 'projects')
    })
  })

  it('reads ~/.claude by default, with the identity from ~/.claude.json', async () => {
    writeClaudeCredentials(join(home, '.claude'), { subscriptionType: 'pro' })
    writeClaudeIdentity(join(home, '.claude.json'), { email: 'default@example.com', organizationName: 'Default Org' })
    const result = await run(['auth', 'status', '--json'])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^{\n {2}"loggedIn": true/)
    expect(JSON.parse(result.stdout)).toMatchObject({
      loggedIn: true, authMethod: 'claude.ai', email: 'default@example.com', orgName: 'Default Org', subscriptionType: 'pro'
    })
  })

  it('reads the credentials from CLAUDE_SECURESTORAGE_CONFIG_DIR before CLAUDE_CONFIG_DIR, with no fallback', async () => {
    const config = join(root, 'config')
    writeClaudeCredentials(config)
    writeClaudeIdentity(join(config, '.claude.json'), { email: 'config@example.com' })
    const empty = join(root, 'empty')
    const split = await run(['auth', 'status', '--json'], { CLAUDE_CONFIG_DIR: config, CLAUDE_SECURESTORAGE_CONFIG_DIR: empty })
    expect(split.code).toBe(1)
    const together = await run(['auth', 'status', '--json'], { CLAUDE_CONFIG_DIR: config })
    expect(JSON.parse(together.stdout)).toMatchObject({ loggedIn: true, email: 'config@example.com', projectsDirectory: join(config, 'projects') })
  })

  it('takes an empty CLAUDE_SECURESTORAGE_CONFIG_DIR as ~/.claude, and leaves the identity null when only the credentials move', async () => {
    writeClaudeCredentials(join(home, '.claude'))
    expect((await run(['auth', 'status', '--json'], { CLAUDE_SECURESTORAGE_CONFIG_DIR: '' })).code).toBe(0)
    const login = join(root, 'login')
    writeClaudeCredentials(login)
    const result = await run(['auth', 'status', '--json'], { CLAUDE_SECURESTORAGE_CONFIG_DIR: login })
    expect(JSON.parse(result.stdout)).toMatchObject({ loggedIn: true, email: null, orgId: null, orgName: null, subscriptionType: 'max' })
  })

  it('logs in and out in the credentials folder', async () => {
    const login = join(root, 'login')
    const result = await run(['auth', 'login', '--claudeai', '--email', 'new@example.com'], { CLAUDE_SECURESTORAGE_CONFIG_DIR: login })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Paste code here if prompted > ')
    expect(result.stdout).toContain('Login successful.')
    expect(readClaudeCredentials(login)?.accessToken).toMatch(/^sk-ant-oat01-fake-login-/)
    const status = await run(['auth', 'status', '--json'], { CLAUDE_SECURESTORAGE_CONFIG_DIR: login })
    expect(JSON.parse(status.stdout)).toMatchObject({ loggedIn: true, email: 'new@example.com' })
    expect((await run(['auth', 'logout'], { CLAUDE_SECURESTORAGE_CONFIG_DIR: login })).code).toBe(0)
    expect(readClaudeCredentials(login)).toBeNull()
    expect((await run(['auth', 'login'], { CLAUDE_SECURESTORAGE_CONFIG_DIR: login, FAKE_CLAUDE_LOGIN: 'fail' })).code).toBe(1)
  })
})

/** A stream-json process, the way the daemon's usage probe starts one. */
class StreamSession {
  readonly child: ChildProcessWithoutNullStreams
  private readonly waiting = new Map<string, (response: Record<string, unknown>) => void>()
  private seq = 0

  constructor(env: Record<string, string>) {
    this.child = spawn(process.execPath, [FAKE_CLAUDE_SCRIPT, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--verbose', '--setting-sources=', '--no-session-persistence'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const frame = JSON.parse(line) as { type: string; response?: { request_id: string } & Record<string, unknown> }
      if (frame.type !== 'control_response' || frame.response === undefined) return
      this.waiting.get(frame.response.request_id)?.(frame.response)
    })
  }

  request(subtype: string, payload: Record<string, unknown> = {}, timeoutMs = 5000): Promise<Record<string, unknown>> {
    const id = `req_${String(this.seq++)}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${subtype} was not answered`)), timeoutMs)
      this.waiting.set(id, (response) => {
        clearTimeout(timer)
        resolve(response)
      })
      this.child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: id, request: { subtype, ...payload } })}\n`)
    })
  }

  close(): Promise<number | null> {
    return new Promise((resolve) => {
      this.child.on('close', (code) => resolve(code))
      this.child.stdin.end()
    })
  }
}

interface UsageAnswer {
  subscription_type: string | null
  rate_limits_available: boolean
  rate_limits: Record<string, { utilization: number; resets_at: string | null } | null> | null
}

async function probe(env: Record<string, string>): Promise<UsageAnswer> {
  const session = new StreamSession(env)
  const init = await session.request('initialize', { supportedDialogKinds: [] })
  expect(init).toMatchObject({ subtype: 'success', response: { session_state: 'idle' } })
  const usage = await session.request('get_usage', { skip_behaviors: true })
  expect(await session.close()).toBe(0)
  expect(usage['subtype']).toBe('success')
  return usage['response'] as UsageAnswer
}

describe('stream-json get_usage', () => {
  it('answers the default plan usage in percent with ISO resets', async () => {
    const login = join(root, 'login')
    writeClaudeCredentials(login)
    const usage = await probe(envOf({ CLAUDE_SECURESTORAGE_CONFIG_DIR: login }))
    expect(usage).toMatchObject({ subscription_type: 'max', rate_limits_available: true })
    expect(usage.rate_limits?.['five_hour']?.utilization).toBe(42)
    expect(Date.parse(usage.rate_limits?.['seven_day']?.resets_at ?? '')).toBeGreaterThan(Date.now())
  })

  it('answers logged out without credentials', async () => {
    const usage = await probe(envOf({ CLAUDE_SECURESTORAGE_CONFIG_DIR: join(root, 'nobody') }))
    expect(usage).toMatchObject({ subscription_type: null, rate_limits_available: false, rate_limits: null })
  })

  it('takes each login its own numbers from the scenario file in its folder, over the shared ones', async () => {
    const shared = join(root, 'shared.json')
    writeFileSync(shared, JSON.stringify({ fiveHour: 10, sevenDay: 20 }))
    const first = join(root, 'first')
    const second = join(root, 'second')
    writeClaudeCredentials(first)
    writeClaudeCredentials(second)
    writeClaudeScenario(second, { fiveHour: { utilization: 97, resetsAt: '2030-01-01T00:00:00.000Z' }, usage: { subscription_type: 'team' } })
    const one = await probe(envOf({ CLAUDE_SECURESTORAGE_CONFIG_DIR: first, FAKE_CLAUDE_SCENARIO: shared }))
    const two = await probe(envOf({ CLAUDE_SECURESTORAGE_CONFIG_DIR: second, FAKE_CLAUDE_SCENARIO: shared }))
    expect(one.rate_limits?.['five_hour']?.utilization).toBe(10)
    expect(two.rate_limits?.['five_hour']).toEqual({ utilization: 97, resets_at: '2030-01-01T00:00:00.000Z' })
    expect(two.rate_limits?.['seven_day']?.utilization).toBe(20)
    expect(two.subscription_type).toBe('team')
  })

  it('renews a token that expires within five minutes, and only then', async () => {
    const login = join(root, 'login')
    writeClaudeCredentials(login, { accessToken: fakeToken('old'), expiresAt: Date.now() + 60_000 })
    await probe(envOf({ CLAUDE_SECURESTORAGE_CONFIG_DIR: login }))
    const renewed = readClaudeCredentials(login)
    expect(renewed?.accessToken).toBe(`${fakeToken('old')}-renewed`)
    expect(renewed?.expiresAt).toBeGreaterThan(Date.now() + 7 * 3_600_000)
    await probe(envOf({ CLAUDE_SECURESTORAGE_CONFIG_DIR: login }))
    expect(readClaudeCredentials(login)?.accessToken).toBe(`${fakeToken('old')}-renewed`)
    expect(readFakeClaudeRecord(recordFile).filter((entry) => entry.kind === 'renew')).toHaveLength(1)
  })

  it('renews as scripted, or fails and answers as logged out', async () => {
    const login = join(root, 'login')
    writeClaudeCredentials(login, { accessToken: fakeToken('old') })
    writeClaudeScenario(login, { renew: 'always', renewTo: { accessToken: fakeToken('new'), expiresInMs: 60_000 } })
    await probe(envOf({ CLAUDE_SECURESTORAGE_CONFIG_DIR: login }))
    expect(readClaudeCredentials(login)?.accessToken).toBe(fakeToken('new'))
    writeClaudeScenario(login, { renew: 'fail' })
    const usage = await probe(envOf({ CLAUDE_SECURESTORAGE_CONFIG_DIR: login }))
    expect(usage.rate_limits_available).toBe(false)
    expect(readClaudeCredentials(login)?.accessToken).toBe(fakeToken('new'))
  })

  it('can refuse get_usage or leave it unanswered', async () => {
    const login = join(root, 'login')
    writeClaudeCredentials(login)
    writeClaudeScenario(login, { getUsage: 'error' })
    const failing = new StreamSession(envOf({ CLAUDE_SECURESTORAGE_CONFIG_DIR: login }))
    expect(await failing.request('get_usage')).toMatchObject({ subtype: 'error', error: 'Failed to fetch usage' })
    await failing.close()
    writeClaudeScenario(login, { getUsage: 'hang' })
    const hanging = new StreamSession(envOf({ CLAUDE_SECURESTORAGE_CONFIG_DIR: login }))
    await expect(hanging.request('get_usage', {}, 300)).rejects.toThrow('not answered')
    expect(await hanging.close()).toBe(0)
  })
})

describe('-p <prompt>', () => {
  let api: FakeAnthropic
  let login: string

  beforeEach(async () => {
    api = await startFakeAnthropic()
    login = join(root, 'login')
    writeClaudeCredentials(login, { accessToken: fakeToken('one') })
  })

  afterEach(async () => {
    await api.close()
  })

  const routed = (extra: Record<string, string> = {}): Record<string, string> => envOf({
    ANTHROPIC_BASE_URL: api.url,
    ANTHROPIC_CUSTOM_HEADERS: 'x-kurmis-key: secret-1\nx-kurmis-login: claude:second',
    CLAUDE_SECURESTORAGE_CONFIG_DIR: login,
    ...extra
  })

  it('says hello without the custom headers, then sends one signed streaming request and prints the answer', async () => {
    api.script(reply.ok({ text: 'The answer.' }))
    const result = await run(['-p', 'What is it?', '--session-id', '11111111-2222-4333-8444-555555555555'], routed())
    expect(result).toMatchObject({ code: 0, stdout: 'The answer.\n' })
    const [hello, message] = api.requests
    expect(hello).toMatchObject({ method: 'HEAD', path: '/api/hello', bearer: null })
    expect(hello?.headers['x-kurmis-key']).toBeUndefined()
    expect(message).toMatchObject({
      method: 'POST', url: '/v1/messages?beta=true', bearer: fakeToken('one'), sessionId: '11111111-2222-4333-8444-555555555555',
      json: { stream: true, messages: [{ role: 'user', content: [{ type: 'text', text: 'What is it?' }] }] }
    })
    expect(message?.headers).toMatchObject({ 'x-kurmis-key': 'secret-1', 'x-kurmis-login': 'claude:second', 'x-app': 'cli' })
    expect(message?.headers['anthropic-beta']).toContain('oauth-2025-04-20')
    expect(api.requests).toHaveLength(2)
  })

  it('records what it was started with and what it sent', async () => {
    await run(['-p', 'hi'], routed({ ANTHROPIC_API_KEY: '' }))
    const lines = readFakeClaudeRecord(recordFile)
    const start = lines.find((line) => line.kind === 'start')
    expect(start).toMatchObject({ argv: ['-p', 'hi'], env: { ANTHROPIC_BASE_URL: api.url, CLAUDE_SECURESTORAGE_CONFIG_DIR: login } })
    const sent = lines.find((line) => line.kind === 'request')
    expect(sent).toMatchObject({ status: 200, headers: { authorization: `Bearer ${fakeToken('one')}` } })
    expect(lines.at(-1)).toMatchObject({ kind: 'exit', code: 0 })
  })

  it('generates a session id when none is given, and takes the prompt from stdin', async () => {
    const result = await run(['-p'], routed(), 'from stdin')
    expect(result.code).toBe(0)
    const sent = api.apiRequests()[0]
    expect(sent?.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(sent?.json)).toContain('from stdin')
  })

  it('lets settings.json env beat the process env, and --settings beat both', async () => {
    const other = await startFakeAnthropic()
    try {
      mkdirSync(join(home, '.claude'), { recursive: true })
      writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: other.url } }))
      await run(['-p', 'one'], routed())
      expect(other.apiRequests()).toHaveLength(1)
      expect(api.apiRequests()).toHaveLength(0)
      await run(['-p', 'two', '--settings', JSON.stringify({ env: { ANTHROPIC_BASE_URL: api.url } })], routed())
      expect(api.apiRequests()).toHaveLength(1)
      const start = readFakeClaudeRecord(recordFile).filter((line) => line.kind === 'start').at(-1)
      expect(start).toMatchObject({ env: { ANTHROPIC_BASE_URL: api.url }, effectiveEnv: { ANTHROPIC_BASE_URL: api.url } })
    } finally {
      await other.close()
    }
  })

  it('retries a 529 and a plain 429, then gives up after CLAUDE_CODE_MAX_RETRIES', async () => {
    api.script(reply.overloaded(), reply.rateLimited(), reply.ok({ text: 'third time' }))
    expect((await run(['-p', 'hi'], routed())).stdout).toBe('third time\n')
    api.setDefault(reply.overloaded())
    const result = await run(['-p', 'hi', '--output-format', 'json'], routed({ CLAUDE_CODE_MAX_RETRIES: '2' }))
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ is_error: true, result: 'API Error: Repeated 529 Overloaded errors', api_error_status: 529 })
    expect(api.apiRequests()).toHaveLength(3 + 3)
  })

  it('stops at once on a usage-limit 429 and says what a single exhausted login says', async () => {
    api.script(reply.quota({ claim: 'five_hour', resetsAt: Date.now() + 3_600_000 }))
    const result = await run(['-p', 'hi'], routed({ TZ: 'UTC' }))
    expect(result.code).toBe(1)
    expect(result.stdout).toMatch(/^You've hit your session limit · resets \d{1,2}(:\d\d)?(am|pm) \(UTC\)\n$/)
    expect(api.apiRequests()).toHaveLength(1)
    api.script(reply.quota({ claim: 'seven_day', resetsAt: Date.UTC(2030, 0, 2, 15, 30) }))
    expect((await run(['-p', 'hi'], routed({ TZ: 'UTC' }))).stdout).toBe('You\'ve hit your weekly limit · resets Jan 2, 3:30pm (UTC)\n')
    api.script(reply.quota({ claim: 'seven_day', resetsAt: null }))
    expect((await run(['-p', 'hi'], routed())).stdout).toBe('You\'ve hit your usage limit.\n')
  })

  it('renews its token after a 401 and sends again once', async () => {
    api.script(reply.unauthorized())
    expect((await run(['-p', 'hi'], routed())).code).toBe(0)
    expect(api.apiRequests().map((request) => request.bearer)).toEqual([fakeToken('one'), `${fakeToken('one')}-renewed`])
  })

  it('refuses without credentials, and refuses a base URL that is not loopback', async () => {
    const out = await run(['-p', 'hi'], routed({ CLAUDE_SECURESTORAGE_CONFIG_DIR: join(root, 'nobody') }))
    expect(out).toMatchObject({ code: 1, stdout: 'Not logged in · Please run /login\n' })
    const away = await run(['-p', 'hi'], routed({ ANTHROPIC_BASE_URL: 'https://api.example.com' }))
    expect(away.code).toBe(2)
    expect(api.requests).toHaveLength(0)
  })

  it('signs with ANTHROPIC_API_KEY when one is inherited', async () => {
    await run(['-p', 'hi'], routed({ ANTHROPIC_API_KEY: 'sk-ant-api03-fake-key' }))
    expect(api.apiRequests()[0]).toMatchObject({ bearer: null, apiKey: 'sk-ant-api03-fake-key' })
    expect(readFakeClaudeRecord(recordFile)[0]).toMatchObject({ kind: 'start', env: { ANTHROPIC_API_KEY: '<set>' } })
  })
})

describe('an interactive start', () => {
  it('exits with the scripted code', async () => {
    const result = await run(['--model', 'opus'], { FAKE_CLAUDE_EXIT_CODE: '3' })
    expect(result.code).toBe(3)
    expect(readFakeClaudeRecord(recordFile)[0]).toMatchObject({ kind: 'start', argv: ['--model', 'opus'] })
  })

  it.skipIf(process.platform === 'win32')('exits 130 on Ctrl-C while it is held open', async () => {
    const child = spawn(process.execPath, [FAKE_CLAUDE_SCRIPT], { env: envOf({ FAKE_CLAUDE_HOLD_MS: '10000' }) })
    await new Promise((resolve) => child.stdout.once('data', resolve))
    child.kill('SIGINT')
    const code = await new Promise((resolve) => child.on('close', resolve))
    expect(code).toBe(130)
    expect(readFakeClaudeRecord(recordFile).some((line) => line.kind === 'signal')).toBe(true)
  })
})
