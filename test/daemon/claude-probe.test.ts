import { existsSync, mkdtempSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { expect, test } from 'vitest'
import type { AccountUsage } from '../../src/core/claude-usage.ts'
import { emptyAccountUsage } from '../../src/core/usage.ts'
import { LOG_REASONS } from '../../src/data/log.ts'
import { ownClaudeProbeFolder, loginFolder, probeWorkFolder } from '../../src/data/paths.ts'
import { CLAUDE_PROBE_ARGS, probeClaudeUsage } from '../../src/daemon/claude-probe.ts'
import type { ProbeResult } from '../../src/daemon/probe-result.ts'
import {
  FAKE_CLAUDE_SCRIPT,
  fakeToken,
  readClaudeCredentials,
  readFakeClaudeRecord,
  writeClaudeCredentials,
  writeClaudeScenario,
  type FakeClaudeRecord,
  type FakeClaudeScenario
} from '../fakes/index.ts'
import { claudeRef, OWN_CLAUDE, OWN_CLAUDE_REF } from '../logins.ts'

let counter = 0

/** A fresh extra login with a record file of its own, so tests do not see each other's runs. */
function login(scenario?: FakeClaudeScenario): { id: string; dir: string; record: string; env: NodeJS.ProcessEnv } {
  counter += 1
  const id = `probe${String(counter)}`
  const dir = loginFolder(claudeRef(id))
  const record = join(mkdtempSync(join(homedir(), 'claude-probe-')), 'record.jsonl')
  if (scenario !== undefined) writeClaudeScenario(dir, scenario)
  return { id, dir, record, env: { ...process.env, KURMIS_CLAUDE_BIN: FAKE_CLAUDE_SCRIPT, FAKE_CLAUDE_RECORD: record } }
}

function starts(record: string): Extract<FakeClaudeRecord, { kind: 'start' }>[] {
  return readFakeClaudeRecord(record).filter((line): line is Extract<FakeClaudeRecord, { kind: 'start' }> => line.kind === 'start')
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function expectFixedError(result: ProbeResult): void {
  if (result.ok) throw new Error('expected a failed probe')
  expect(LOG_REASONS).toContain(result.reason)
  // Never the CLI's own words, a token or an email.
  expect(result.error).not.toMatch(/Failed to fetch usage|sk-ant-|@example\.com|stderr/i)
}

test('a signed-in login answers its windows, and the CLI has exited when the promise resolves', async () => {
  const { id, dir, record, env } = login()
  writeClaudeCredentials(dir, { accessToken: fakeToken('work') })
  const result = await probeClaudeUsage(claudeRef(id), { env, now: () => 1_000 })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.signedIn).toBe(true)
  expect(result.usage).toMatchObject({
    accountId: id,
    fetchedAt: 1_000,
    source: 'probe',
    subscriptionType: 'max',
    rateLimitsAvailable: true,
    fiveHour: { utilization: 42 },
    sevenDay: { utilization: 13 },
    sevenDayOpus: { utilization: 4 },
    error: null
  })
  const lines = readFakeClaudeRecord(record)
  expect(lines.filter((line) => line.kind === 'control_request').map((line) => (line as { subtype: string }).subtype))
    .toEqual(['initialize', 'get_usage'])
  expect(lines.at(-1)).toMatchObject({ kind: 'exit', code: 0 })
  const [start] = starts(record)
  expect(start?.argv).toEqual([...CLAUDE_PROBE_ARGS])
  expect(start?.cwd).toBe(realpathSync(probeWorkFolder()))
  expect(start?.credentialsDir).toBe(dir)
  expect(start?.env.CLAUDE_CONFIG_DIR).toBe(dir)
  expect(start?.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBeUndefined()
})

test('a login with no credentials is signed out, which is an answer and not an error', async () => {
  const { id, env } = login()
  const result = await probeClaudeUsage(claudeRef(id), { env })
  expect(result).toMatchObject({ ok: true, signedIn: false })
  if (!result.ok) return
  expect(result.usage).toMatchObject({ rateLimitsAvailable: false, fiveHour: null, sevenDay: null, subscriptionType: null })
})

test('a login whose token lacks the profile scope is signed in but has no windows', async () => {
  const { id, dir, env } = login()
  writeClaudeCredentials(dir, { scopes: ['user:inference'] })
  const result = await probeClaudeUsage(claudeRef(id), { env })
  expect(result).toMatchObject({ ok: true, signedIn: true, usage: { rateLimitsAvailable: false, fiveHour: null, subscriptionType: 'max' } })
})

test('a failed get_usage is an error with a fixed sentence, and initialize said the login is signed in', async () => {
  const { id, dir, env } = login({ getUsage: 'error' })
  writeClaudeCredentials(dir)
  const result = await probeClaudeUsage(claudeRef(id), { env })
  expect(result).toEqual({ ok: false, signedIn: true, reason: 'upstream_error', error: 'Claude answered the usage request with an error.' })
})

test('rate limits that are available but missing mean the usage request failed', async () => {
  const { id, dir, env } = login({ usage: { rate_limits: null } })
  writeClaudeCredentials(dir)
  const result = await probeClaudeUsage(claudeRef(id), { env })
  expect(result).toMatchObject({ ok: false, signedIn: true, reason: 'upstream_error' })
  expectFixedError(result)
})

/**
 * The deadline of a probe whose CLI stops answering part-way. The fake CLI has to start and answer
 * the first requests before it, so the probe knows the login is signed in, and Node starts more
 * slowly on Windows.
 */
const HANG_DEADLINE_MS = process.platform === 'win32' ? 6_000 : 1_500

test('a CLI that never answers is killed at the deadline', { timeout: HANG_DEADLINE_MS + 10_000 }, async () => {
  const { id, dir, record, env } = login({ getUsage: 'hang' })
  writeClaudeCredentials(dir)
  const started = Date.now()
  const result = await probeClaudeUsage(claudeRef(id), { env, timeoutMs: HANG_DEADLINE_MS })
  expect(Date.now() - started).toBeLessThan(HANG_DEADLINE_MS + 6_500)
  expect(result).toEqual({ ok: false, signedIn: true, reason: 'timeout', error: `The usage probe timed out after ${String(HANG_DEADLINE_MS / 1000)} s.` })
  const [start] = starts(record)
  expect(start).toBeDefined()
  expect(isRunning(start?.pid ?? 0)).toBe(false)
})

test('a CLI that fails at start is an error naming its exit code and nothing it printed', async () => {
  const { id, env } = login({ startupFailure: 'fake startup failure on stderr' })
  const result = await probeClaudeUsage(claudeRef(id), { env })
  expect(result).toEqual({ ok: false, signedIn: null, reason: 'exited', error: 'claude exited with code 1 before it answered.' })
})

test('aborting the signal kills the CLI', async () => {
  const { id, dir, record, env } = login({ getUsage: 'hang' })
  writeClaudeCredentials(dir)
  const controller = new AbortController()
  const probe = probeClaudeUsage(claudeRef(id), { env, signal: controller.signal })
  const until = Date.now() + 5_000
  while (!readFakeClaudeRecord(record).some((line) => line.kind === 'control_request' && line.subtype === 'get_usage')) {
    if (Date.now() > until) throw new Error('the probe never asked get_usage')
    await sleep(20)
  }
  controller.abort()
  const result = await probe
  expect(result).toMatchObject({ ok: false, signedIn: true, reason: 'shutdown' })
  expect(isRunning(starts(record)[0]?.pid ?? 0)).toBe(false)
})

test('a signal that is already aborted starts nothing', async () => {
  const { id, record, env } = login()
  const controller = new AbortController()
  controller.abort()
  expect(await probeClaudeUsage(claudeRef(id), { env, signal: controller.signal })).toMatchObject({ ok: false, signedIn: null, reason: 'shutdown' })
  expect(existsSync(record)).toBe(false)
})

test('a token that expires within five minutes is renewed by the probe and on disk when it resolves', async () => {
  const { id, dir, env } = login()
  writeClaudeCredentials(dir, { accessToken: fakeToken('expiring'), expiresAt: Date.now() + 2 * 60_000 })
  const result = await probeClaudeUsage(claudeRef(id), { env })
  expect(result).toMatchObject({ ok: true, signedIn: true })
  const after = readClaudeCredentials(dir)
  expect(after?.accessToken).toBe(`${fakeToken('expiring')}-renewed`)
  expect(after?.expiresAt).toBeGreaterThan(Date.now() + 7 * 3_600_000)
})

test('a token without a refresh token is never renewed', async () => {
  const { id, dir, record, env } = login()
  const expiresAt = Date.now() + 2 * 60_000
  writeClaudeCredentials(dir, { accessToken: fakeToken('no-refresh'), refreshToken: null, expiresAt })
  const result = await probeClaudeUsage(claudeRef(id), { env })
  expect(result).toMatchObject({ ok: true, signedIn: true })
  expect(readClaudeCredentials(dir)).toMatchObject({ accessToken: fakeToken('no-refresh'), expiresAt })
  expect(readFakeClaudeRecord(record).some((line) => line.kind === 'renew')).toBe(false)
})

test('a failed renewal leaves the login signed out', async () => {
  const { id, dir, env } = login({ renew: 'fail' })
  writeClaudeCredentials(dir, { expiresAt: Date.now() + 60_000 })
  expect(await probeClaudeUsage(claudeRef(id), { env })).toMatchObject({ ok: true, signedIn: false, usage: { rateLimitsAvailable: false } })
})

test("the login plain claude uses runs with claudeProbeEnv, its own probe folder and the default credentials", async () => {
  const { record, env } = login()
  const credentials = join(homedir(), '.claude')
  writeClaudeCredentials(credentials, { accessToken: fakeToken('default') })
  const routed = {
    ...env,
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    ANTHROPIC_CUSTOM_HEADERS: 'x-kurmis-key: abc',
    ANTHROPIC_API_KEY: 'sk-ant-api03-fake-key',
    CLAUDE_CONFIG_DIR: join(homedir(), 'elsewhere'),
    CLAUDE_CODE_OAUTH_TOKEN: fakeToken('from-env')
  }
  const result = await probeClaudeUsage(OWN_CLAUDE_REF, { env: routed })
  expect(result).toMatchObject({ ok: true, signedIn: true, usage: { accountId: OWN_CLAUDE, fiveHour: { utilization: 42 } } })
  const [start] = starts(record)
  expect(start?.env).toMatchObject({ CLAUDE_CONFIG_DIR: ownClaudeProbeFolder(), CLAUDE_SECURESTORAGE_CONFIG_DIR: '' })
  expect(start?.env.ANTHROPIC_BASE_URL).toBeUndefined()
  expect(start?.env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
  expect(start?.env.ANTHROPIC_API_KEY).toBeUndefined()
  expect(start?.credentialsDir).toBe(credentials)
  expect(statSync(ownClaudeProbeFolder()).isDirectory()).toBe(true)
  if (process.platform !== 'win32') {
    expect(statSync(ownClaudeProbeFolder()).mode & 0o777).toBe(0o700)
    expect(statSync(probeWorkFolder()).mode & 0o777).toBe(0o700)
  }
})

test('the last snapshot decides whether a status the probe cannot measure still stands', async () => {
  const { id, dir, env } = login()
  writeClaudeCredentials(dir)
  const previous: AccountUsage = {
    ...emptyAccountUsage(id, 0),
    status: 'rejected',
    limited: { window: 'seven_day_sonnet', utilization: 100, threshold: null, resetsAt: new Date(Date.now() + 86_400_000).toISOString() }
  }
  const result = await probeClaudeUsage(claudeRef(id), { env, previous })
  expect(result).toMatchObject({ ok: true, usage: { status: 'rejected', limited: { window: 'seven_day_sonnet' } } })
})

test('a claude that cannot be found is an error with a fixed sentence', async () => {
  const empty = mkdtempSync(join(homedir(), 'empty-path-'))
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: empty, Path: empty }
  // Empty rather than removed: in the tests a missing variable is taken from test/setup.ts.
  env.KURMIS_CLAUDE_BIN = ''
  const result = await probeClaudeUsage(claudeRef('missing'), { env })
  expect(result).toMatchObject({ ok: false, signedIn: null, reason: 'missing' })
  expectFixedError(result)
  // The daemon looks it up on the PATH it was started with, and the sentence says so.
  expect(result).toMatchObject({ error: expect.stringContaining('on the PATH the kurmis daemon was started with') })
  expect(result).toMatchObject({ error: expect.stringContaining('kurmis daemon restart') })
  expect(result).toMatchObject({ error: expect.stringContaining('KURMIS_CLAUDE_BIN') })
})

test('a claude that does not exist at the named path is a failed start', async () => {
  const env = { ...process.env, KURMIS_CLAUDE_BIN: join(homedir(), 'no-such-claude') }
  const result = await probeClaudeUsage(claudeRef('nowhere'), { env })
  expect(result).toEqual({ ok: false, signedIn: null, reason: 'missing', error: 'claude could not be started (ENOENT).' })
})
