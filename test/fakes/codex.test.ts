// Tests of the fake `codex`: they start it as a child process and speak its line protocol.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FAKE_CODEX_DEFAULT_VERSION,
  FAKE_CODEX_SCRIPT,
  installFakeCodex,
  readCodexRecord,
  writeCodexApiKeyAuth,
  writeCodexAuth,
  writeCodexScenario,
  writeSharedCodexScenario
} from './codex.ts'

type Message = Record<string, unknown>

/** A started fake app-server and a minimal client for its line protocol. */
interface AppServer {
  child: ChildProcessWithoutNullStreams
  /** Every message the fake wrote, in order. */
  received: Message[]
  stderr: () => string
  send: (message: Message) => void
  /** Sends a request and waits for the message that answers its id. */
  request: (method: string, params?: unknown, timeoutMs?: number) => Promise<Message>
  /** Resolves with the exit code once the process has ended. */
  exited: Promise<number | null>
}

let dir = ''
let nextId = 1

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kurmis-fake-codex-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
})

function startAppServer(env: Record<string, string | undefined>, command: readonly string[] = [process.execPath, FAKE_CODEX_SCRIPT]): AppServer {
  const [program, ...rest] = command
  const child = spawn(program ?? process.execPath, [...rest, 'app-server'], { env: { ...process.env, ...env }, stdio: 'pipe' })
  const received: Message[] = []
  const waiters = new Map<unknown, (message: Message) => void>()
  let buffer = ''
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => (stderr += chunk))
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const message = JSON.parse(buffer.slice(0, newline)) as Message
      buffer = buffer.slice(newline + 1)
      received.push(message)
      waiters.get(message.id)?.(message)
      newline = buffer.indexOf('\n')
    }
  })
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
  const send = (message: Message): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }
  const request = (method: string, params?: unknown, timeoutMs = 5000): Promise<Message> => {
    const id = nextId++
    return new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method} within ${String(timeoutMs)} ms`)), timeoutMs)
      waiters.set(id, (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      send(params === undefined ? { id, method } : { id, method, params })
    })
  }
  return { child, received, stderr: () => stderr, send, request, exited }
}

async function initialize(server: AppServer): Promise<Message> {
  const answer = await server.request('initialize', { clientInfo: { name: 'kurmis', title: 'Kurmis', version: '0.1.0' }, capabilities: null })
  server.send({ method: 'initialized' })
  return answer
}

async function closeServer(server: AppServer): Promise<number | null> {
  server.child.stdin.end()
  return await server.exited
}

function resultOf(message: Message): Record<string, unknown> {
  expect(message.error).toBeUndefined()
  return message.result as Record<string, unknown>
}

describe('codex --version', () => {
  it('prints codex-cli and the version', () => {
    const run = spawnSync(process.execPath, [FAKE_CODEX_SCRIPT, '--version'], { encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe(`codex-cli ${FAKE_CODEX_DEFAULT_VERSION}\n`)
  })

  it('takes the version from FAKE_CODEX_VERSION', () => {
    const run = spawnSync(process.execPath, [FAKE_CODEX_SCRIPT, '-V'], { encoding: 'utf8', env: { ...process.env, FAKE_CODEX_VERSION: '9.8.7' } })
    expect(run.stdout).toBe('codex-cli 9.8.7\n')
  })

  it.skipIf(process.platform === 'win32')('works through the installed launcher', () => {
    const installed = installFakeCodex(join(dir, 'bin'))
    const run = spawnSync(installed.path, ['--version'], { encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe(`codex-cli ${FAKE_CODEX_DEFAULT_VERSION}\n`)
  })
})

describe('codex app-server', () => {
  it('frames messages as the real one does and answers initialize', async () => {
    const home = join(dir, 'home')
    writeCodexAuth(home)
    const server = startAppServer({ CODEX_HOME: home })
    const answer = await initialize(server)
    expect(answer).not.toHaveProperty('jsonrpc')
    const result = resultOf(answer)
    expect(result.userAgent).toMatch(new RegExp(`^kurmis/${FAKE_CODEX_DEFAULT_VERSION.replaceAll('.', '\\.')} \\(.+; .+\\) unknown \\(kurmis; 0\\.1\\.0\\)$`))
    expect(result.codexHome).toBe(realpathSync(home))
    expect(['unix', 'windows']).toContain(result.platformFamily)
    expect(typeof result.platformOs).toBe('string')
    await resultOf(await server.request('account/read', {}))
    const notification = server.received.find((message) => message.method === 'remoteControl/status/changed')
    expect(notification).toMatchObject({ params: { status: 'disabled' } })
    expect(typeof notification?.emittedAtMs).toBe('number')
    expect(await closeServer(server)).toBe(0)
  })

  it('refuses requests before initialize, a second initialize, a missing params and unknown methods', async () => {
    const server = startAppServer({ CODEX_HOME: join(dir, 'empty') })
    expect(await server.request('account/read', {})).toMatchObject({ error: { code: -32600, message: 'Not initialized' } })
    await initialize(server)
    expect(await server.request('initialize', { clientInfo: { name: 'kurmis', version: '0.1.0' } })).toMatchObject({
      error: { code: -32600, message: 'Already initialized' }
    })
    expect(await server.request('account/read')).toMatchObject({ error: { code: -32600, message: 'Invalid request: missing field `params`' } })
    const unknown = await server.request('thread/doesNotExist', {})
    expect(unknown).toMatchObject({ error: { code: -32600 } })
    expect((unknown.error as { message: string }).message).toMatch(/^Invalid request: unknown variant `thread\/doesNotExist`, expected one of `initialize`/)
    expect(await closeServer(server)).toBe(0)
  })

  it('echoes string request ids', async () => {
    const server = startAppServer({ CODEX_HOME: join(dir, 'empty') })
    await initialize(server)
    server.send({ id: 'abc', method: 'account/read', params: {} })
    await expect.poll(() => server.received.find((message) => message.id === 'abc')).toBeTruthy()
    await closeServer(server)
  })

  it('answers signed out when CODEX_HOME has no auth.json', async () => {
    const server = startAppServer({ CODEX_HOME: join(dir, 'empty') })
    await initialize(server)
    expect(resultOf(await server.request('account/read', {}))).toEqual({ account: null, requiresOpenaiAuth: true, workspaceRouting: null })
    expect(await server.request('account/rateLimits/read')).toMatchObject({
      error: { code: -32600, message: 'codex account authentication required to read rate limits' }
    })
    await closeServer(server)
  })

  it('reads the login from auth.json in CODEX_HOME', async () => {
    const home = join(dir, 'pro')
    writeCodexAuth(home, { email: 'pro-user@example.com', planType: 'pro', accountId: 'fake-account-pro' })
    const server = startAppServer({ CODEX_HOME: home })
    await initialize(server)
    expect(resultOf(await server.request('account/read', {}))).toEqual({
      account: { type: 'chatgpt', email: 'pro-user@example.com', planType: 'pro' },
      requiresOpenaiAuth: true,
      workspaceRouting: null
    })
    const limits = resultOf(await server.request('account/rateLimits/read'))
    expect(limits.accountId).toBe('fake-account-pro')
    expect(limits.rateLimits).toMatchObject({ limitId: 'codex', planType: 'pro' })
    await closeServer(server)
  })

  it('defaults to ~/.codex under the home folder when CODEX_HOME is not set', async () => {
    const home = join(dir, 'user')
    writeCodexAuth(join(home, '.codex'), { email: 'default-user@example.com' })
    const server = startAppServer({ CODEX_HOME: undefined, HOME: home, USERPROFILE: home })
    expect(resultOf(await initialize(server)).codexHome).toBe(realpathSync(join(home, '.codex')))
    expect(resultOf(await server.request('account/read', {}))).toMatchObject({ account: { email: 'default-user@example.com' } })
    await closeServer(server)
  })

  it('treats an API-key auth.json as an API-key login with no rate limits', async () => {
    const home = join(dir, 'apikey')
    writeCodexApiKeyAuth(home)
    const server = startAppServer({ CODEX_HOME: home })
    await initialize(server)
    expect(resultOf(await server.request('account/read', {}))).toMatchObject({ account: { type: 'apiKey' } })
    expect(await server.request('account/rateLimits/read')).toMatchObject({ error: { code: -32600 } })
    await closeServer(server)
  })

  it('reports default rate limits in the real shape', async () => {
    const home = join(dir, 'plus')
    writeCodexAuth(home)
    const server = startAppServer({ CODEX_HOME: home })
    await initialize(server)
    const before = Math.floor(Date.now() / 1000)
    const limits = resultOf(await server.request('account/rateLimits/read'))
    const snapshot = limits.rateLimits as Record<string, unknown>
    expect(snapshot).toMatchObject({
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent: 0, windowDurationMins: 300 },
      secondary: { usedPercent: 0, windowDurationMins: 10080 },
      credits: { hasCredits: false, unlimited: false, balance: '0' },
      planType: 'plus',
      rateLimitReachedType: null
    })
    const resetsAt = (snapshot.primary as { resetsAt: number }).resetsAt
    expect(resetsAt).toBeGreaterThanOrEqual(before + 300 * 60)
    expect(resetsAt).toBeLessThan(before + 300 * 60 + 60)
    expect(limits.rateLimitsByLimitId).toEqual({ codex: snapshot })
    expect(limits.rateLimitResetCredits).toEqual({ availableCount: 0, credits: [] })
    expect(limits).toMatchObject({ ordinaryUsageAllowed: true, rateLimitUpsell: null })
    await closeServer(server)
  })

  it('takes rate limits from the scenario file in CODEX_HOME', async () => {
    const home = join(dir, 'scripted')
    writeCodexAuth(home)
    writeCodexScenario(home, {
      primary: { usedPercent: 87.5, resetsAt: 1900000000 },
      secondary: null,
      credits: { hasCredits: true, unlimited: false, balance: '12.5' },
      planType: 'prolite',
      buckets: { codex_spark: { limitName: 'Spark', primary: { usedPercent: 3 }, secondary: { usedPercent: 45, resetsInSeconds: 600 } } },
      resetCredits: 2
    })
    const server = startAppServer({ CODEX_HOME: home })
    await initialize(server)
    const now = Math.floor(Date.now() / 1000)
    const limits = resultOf(await server.request('account/rateLimits/read'))
    expect(limits.rateLimits).toMatchObject({
      primary: { usedPercent: 87.5, windowDurationMins: 300, resetsAt: 1900000000 },
      secondary: null,
      credits: { hasCredits: true, balance: '12.5' },
      planType: 'prolite'
    })
    const spark = (limits.rateLimitsByLimitId as Record<string, Record<string, { resetsAt: number }>>).codex_spark
    expect(spark).toMatchObject({ limitId: 'codex_spark', limitName: 'Spark', primary: { usedPercent: 3 }, secondary: { usedPercent: 45 } })
    expect(spark?.secondary?.resetsAt).toBeGreaterThanOrEqual(now + 600)
    const credits = limits.rateLimitResetCredits as { availableCount: number; credits: { status: string }[] }
    expect(credits.availableCount).toBe(2)
    expect(credits.credits).toHaveLength(2)
    expect(credits.credits[0]).toMatchObject({ resetType: 'codexRateLimits', status: 'available' })
    await closeServer(server)
  })

  it('reads the scenario again for every request', async () => {
    const home = join(dir, 'changing')
    writeCodexAuth(home)
    const server = startAppServer({ CODEX_HOME: home })
    await initialize(server)
    expect(resultOf(await server.request('account/rateLimits/read')).rateLimits).toMatchObject({ primary: { usedPercent: 0 } })
    writeCodexScenario(home, { primary: { usedPercent: 50 } })
    expect(resultOf(await server.request('account/rateLimits/read')).rateLimits).toMatchObject({ primary: { usedPercent: 50 } })
    await closeServer(server)
  })

  it('uses the FAKE_CODEX_SCENARIO file only for a home without its own scenario', async () => {
    const shared = writeSharedCodexScenario(join(dir, 'shared.json'), { primary: { usedPercent: 10 } })
    const plain = join(dir, 'plain')
    const own = join(dir, 'own')
    writeCodexAuth(plain)
    writeCodexAuth(own)
    writeCodexScenario(own, { primary: { usedPercent: 90 } })
    for (const [home, used] of [[plain, 10], [own, 90]] as const) {
      const server = startAppServer({ CODEX_HOME: home, FAKE_CODEX_SCENARIO: shared })
      await initialize(server)
      expect(resultOf(await server.request('account/rateLimits/read')).rateLimits).toMatchObject({ primary: { usedPercent: used } })
      await closeServer(server)
    }
  })

  it('answers account/rateLimits/read with an error when told to', async () => {
    const home = join(dir, 'failing')
    writeCodexAuth(home)
    writeCodexScenario(home, { rateLimitsError: true })
    let server = startAppServer({ CODEX_HOME: home })
    await initialize(server)
    const failed = await server.request('account/rateLimits/read')
    expect(failed).toMatchObject({ error: { code: -32603 } })
    expect((failed.error as { message: string }).message).toMatch(/^failed to fetch codex rate limits: /)
    await closeServer(server)

    writeCodexScenario(home, { rateLimitsError: { code: -32001, message: 'Server overloaded; retry later.' } })
    server = startAppServer({ CODEX_HOME: home })
    await initialize(server)
    expect(await server.request('account/rateLimits/read')).toMatchObject({ error: { code: -32001, message: 'Server overloaded; retry later.' } })
    await closeServer(server)
  })

  it('never answers account/rateLimits/read when told to hang, and still exits 0 when stdin ends', async () => {
    const home = join(dir, 'hanging')
    writeCodexAuth(home)
    writeCodexScenario(home, { rateLimitsHang: true })
    const server = startAppServer({ CODEX_HOME: home })
    await initialize(server)
    await expect(server.request('account/rateLimits/read', undefined, 300)).rejects.toThrow(/no answer/)
    resultOf(await server.request('account/read', {}))
    expect(await closeServer(server)).toBe(0)
  })

  it('waits before answering when told to', async () => {
    const home = join(dir, 'slow')
    writeCodexAuth(home)
    writeCodexScenario(home, { delayMs: 100, rateLimitsDelayMs: 200 })
    const server = startAppServer({ CODEX_HOME: home })
    await initialize(server)
    let started = Date.now()
    await server.request('account/read', {})
    expect(Date.now() - started).toBeGreaterThanOrEqual(90)
    started = Date.now()
    await server.request('account/rateLimits/read')
    expect(Date.now() - started).toBeGreaterThanOrEqual(290)
    await closeServer(server)
  })

  it('exits at once while an answer is delayed and stdin ends', async () => {
    const home = join(dir, 'slow-close')
    writeCodexAuth(home)
    writeCodexScenario(home, { rateLimitsDelayMs: 60_000 })
    const server = startAppServer({ CODEX_HOME: home })
    await initialize(server)
    server.send({ id: 'pending', method: 'account/rateLimits/read' })
    const started = Date.now()
    expect(await closeServer(server)).toBe(0)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(server.received.some((message) => message.id === 'pending')).toBe(false)
  })

  it('fails at startup when told to', async () => {
    const home = join(dir, 'broken')
    writeCodexScenario(home, { startupFailure: { exitCode: 3, stderr: 'Error loading config.toml: made-up failure' } })
    const server = startAppServer({ CODEX_HOME: home })
    expect(await server.exited).toBe(3)
    expect(server.stderr()).toBe('Error loading config.toml: made-up failure\n')
    expect(server.received).toEqual([])
  })

  it('exits 2 with a message when the scenario file is not JSON', async () => {
    const home = join(dir, 'bad-scenario')
    writeCodexScenario(home, {})
    writeFileSync(join(home, 'fake-codex-scenario.json'), '{ not json')
    const server = startAppServer({ CODEX_HOME: home })
    expect(await server.exited).toBe(2)
    expect(server.stderr()).toMatch(/^fake-codex: could not read the scenario file /)
  })

  it.skipIf(process.platform === 'win32')('runs through the installed launcher', async () => {
    const home = join(dir, 'launcher')
    writeCodexAuth(home, { email: 'launcher@example.com' })
    const installed = installFakeCodex(join(dir, 'bin'))
    const server = startAppServer({ CODEX_HOME: home }, [installed.path])
    await initialize(server)
    expect(resultOf(await server.request('account/read', {}))).toMatchObject({ account: { email: 'launcher@example.com' } })
    expect(await closeServer(server)).toBe(0)
  })
})

describe('FAKE_CODEX_RECORD', () => {
  it('records the start, each request and notification, and the exit, without token values', async () => {
    const home = join(dir, 'recorded')
    writeCodexAuth(home)
    const recordPath = join(dir, 'record.jsonl')
    const server = startAppServer({ CODEX_HOME: home, FAKE_CODEX_RECORD: recordPath, OPENAI_API_KEY: 'sk-fake-secret-value' })
    await initialize(server)
    await server.request('account/rateLimits/read')
    await closeServer(server)
    const lines = readCodexRecord(recordPath)
    const pid = server.child.pid
    expect(lines).toEqual([
      {
        pid,
        event: 'start',
        mode: 'app-server',
        argv: ['app-server'],
        codexHome: home,
        authFile: true,
        envNames: expect.arrayContaining(['CODEX_HOME', 'OPENAI_API_KEY'])
      },
      { pid, event: 'request', method: 'initialize', id: expect.any(Number) },
      { pid, event: 'notification', method: 'initialized' },
      { pid, event: 'request', method: 'account/rateLimits/read', id: expect.any(Number) },
      { pid, event: 'exit', reason: 'stdinEnded', code: 0 }
    ])
    const text = readFileSync(recordPath, 'utf8')
    expect(text).not.toContain('sk-fake-secret-value')
    expect(text).not.toContain('fake-refresh-token')
  })

  it('records a null CODEX_HOME when it is not set', () => {
    const recordPath = join(dir, 'record.jsonl')
    spawnSync(process.execPath, [FAKE_CODEX_SCRIPT, '--version'], { env: { ...process.env, CODEX_HOME: undefined, FAKE_CODEX_RECORD: recordPath } })
    expect(readCodexRecord(recordPath)).toMatchObject([{ event: 'start', mode: 'version', argv: ['--version'], codexHome: null }])
  })
})

describe('any other codex command line', () => {
  it('records argv, prints one line and exits with FAKE_CODEX_EXIT_CODE', () => {
    const home = join(dir, 'interactive')
    const recordPath = join(dir, 'record.jsonl')
    const argv = ['-c', 'model="gpt-made-up"', 'resume', '--last']
    const run = spawnSync(process.execPath, [FAKE_CODEX_SCRIPT, ...argv], {
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME: home, FAKE_CODEX_RECORD: recordPath, FAKE_CODEX_EXIT_CODE: '7' }
    })
    expect(run.status).toBe(7)
    expect(run.stdout.trim().split('\n')).toHaveLength(1)
    expect(run.stdout).toMatch(/^fake-codex: /)
    expect(readCodexRecord(recordPath)).toMatchObject([{ event: 'start', mode: 'other', argv, codexHome: home, authFile: false }])
  })

  it('exits 0 by default', () => {
    const run = spawnSync(process.execPath, [FAKE_CODEX_SCRIPT, 'exec', 'say hello'], { encoding: 'utf8' })
    expect(run.status).toBe(0)
  })
})
