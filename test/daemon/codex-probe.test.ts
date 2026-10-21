import { mkdtempSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { expect, test } from 'vitest'
import { LOG_REASONS } from '../../src/data/log.ts'
import { loginFolder } from '../../src/data/paths.ts'
import { CODEX_PROBE_ARGS, probeCodexUsage } from '../../src/daemon/codex-probe.ts'
import type { ProbeResult } from '../../src/daemon/probe-result.ts'
import {
  FAKE_CODEX_SCRIPT,
  readCodexRecord,
  writeCodexApiKeyAuth,
  writeCodexAuth,
  writeCodexScenario,
  type FakeCodexRecord,
  type FakeCodexScenario
} from '../fakes/index.ts'

let counter = 0

/** A fresh extra login with a record file of its own, so tests do not see each other's runs. */
function login(scenario?: FakeCodexScenario): { id: string; home: string; record: string; env: NodeJS.ProcessEnv } {
  counter += 1
  const id = `codex:probe${String(counter)}`
  const home = loginFolder(id)
  const record = join(mkdtempSync(join(homedir(), 'codex-probe-')), 'record.jsonl')
  if (scenario !== undefined) writeCodexScenario(home, scenario)
  return { id, home, record, env: { ...process.env, KURMIS_CODEX_BIN: FAKE_CODEX_SCRIPT, FAKE_CODEX_RECORD: record } }
}

function requests(record: string): string[] {
  return readCodexRecord(record).filter((line) => line.event === 'request').map((line) => (line as { method: string }).method)
}

function start(record: string): Extract<FakeCodexRecord, { event: 'start' }> | undefined {
  return readCodexRecord(record).find((line): line is Extract<FakeCodexRecord, { event: 'start' }> => line.event === 'start')
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
  expect(result.error).not.toMatch(/fake-codex|@example\.com|scenario/i)
}

test('a ChatGPT login answers its windows after the handshake, account/read and the rate-limit read', async () => {
  const { id, home, record, env } = login({ primary: { usedPercent: 30 }, secondary: { usedPercent: 12 } })
  writeCodexAuth(home, { planType: 'pro' })
  const result = await probeCodexUsage(id, { env, now: () => 5_000 })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.signedIn).toBe(true)
  expect(result.usage).toMatchObject({ accountId: id, provider: 'codex', fetchedAt: 5_000, subscriptionType: 'pro', rateLimitsAvailable: true, error: null })
  expect(result.usage.windows?.map((window) => [window.key, window.utilization])).toEqual([['codex:primary', 30], ['codex:secondary', 12]])
  // Nothing personal ends up in the snapshot.
  expect(JSON.stringify(result.usage)).not.toContain('@example.com')
  expect(requests(record)).toEqual(['initialize', 'account/read', 'account/rateLimits/read'])
  const lines = readCodexRecord(record)
  expect(lines.some((line) => line.event === 'notification' && line.method === 'initialized')).toBe(true)
  expect(lines.at(-1)).toMatchObject({ event: 'exit', reason: 'stdinEnded', code: 0 })
  expect(start(record)).toMatchObject({ mode: 'app-server', argv: [...CODEX_PROBE_ARGS], codexHome: home, authFile: true })
  expect(start(record)?.envNames).not.toContain('ANTHROPIC_BASE_URL')
})

test('an API-key login counts as signed out and is not asked for rate limits', async () => {
  const { id, home, record, env } = login()
  writeCodexApiKeyAuth(home)
  const result = await probeCodexUsage(id, { env })
  expect(result).toMatchObject({ ok: true, signedIn: false, usage: { subscriptionType: 'api key', rateLimitsAvailable: false, windows: [] } })
  expect(requests(record)).toEqual(['initialize', 'account/read'])
})

test('a home with no sign-in is signed out, which is an answer and not an error', async () => {
  const { id, record, env } = login()
  const result = await probeCodexUsage(id, { env })
  expect(result).toMatchObject({ ok: true, signedIn: false, usage: { subscriptionType: null, windows: [] } })
  expect(requests(record)).toEqual(['initialize', 'account/read'])
})

test('a refused rate-limit read is an error with a fixed sentence, on a signed-in login', async () => {
  const { id, home, env } = login({ rateLimitsError: true })
  writeCodexAuth(home)
  const result = await probeCodexUsage(id, { env })
  expect(result).toEqual({ ok: false, signedIn: true, reason: 'upstream_error', error: 'Codex could not read the plan usage from OpenAI.' })
  expectFixedError(result)
})

/**
 * The deadline of a probe whose CLI stops answering part-way. The fake CLI has to start and answer
 * the first requests before it, so the probe knows the login is signed in, and Node starts more
 * slowly on Windows.
 */
const HANG_DEADLINE_MS = process.platform === 'win32' ? 6_000 : 1_500

test('a rate-limit read that never answers is killed at the deadline', async () => {
  const { id, home, record, env } = login({ rateLimitsHang: true })
  writeCodexAuth(home)
  const started = Date.now()
  const result = await probeCodexUsage(id, { env, timeoutMs: HANG_DEADLINE_MS })
  expect(Date.now() - started).toBeLessThan(HANG_DEADLINE_MS + 6_500)
  expect(result).toEqual({ ok: false, signedIn: true, reason: 'timeout', error: `The usage probe timed out after ${String(HANG_DEADLINE_MS / 1000)} s.` })
  expect(isRunning(start(record)?.pid ?? 0)).toBe(false)
})

test('an app-server that fails at start is an error naming its exit code and nothing it printed', async () => {
  const { id, env } = login({ startupFailure: { exitCode: 3, stderr: 'fake-codex: cannot start' } })
  const result = await probeCodexUsage(id, { env })
  expect(result).toEqual({ ok: false, signedIn: null, reason: 'exited', error: 'codex exited with code 3 before it answered.' })
})

test('aborting the signal kills the app-server', async () => {
  const { id, home, record, env } = login({ rateLimitsHang: true })
  writeCodexAuth(home)
  const controller = new AbortController()
  const probe = probeCodexUsage(id, { env, signal: controller.signal })
  const until = Date.now() + 5_000
  while (!requests(record).includes('account/rateLimits/read')) {
    if (Date.now() > until) throw new Error('the probe never asked for rate limits')
    await sleep(20)
  }
  controller.abort()
  expect(await probe).toMatchObject({ ok: false, signedIn: true, reason: 'shutdown' })
  expect(isRunning(start(record)?.pid ?? 0)).toBe(false)
})

test('the default login runs with CODEX_HOME as inherited', async () => {
  const { record, env } = login()
  writeCodexAuth(join(homedir(), '.codex'))
  const result = await probeCodexUsage('codex:default', { env: { ...env, ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } })
  expect(result).toMatchObject({ ok: true, signedIn: true, usage: { accountId: 'codex:default' } })
  expect(start(record)).toMatchObject({ codexHome: null, authFile: true })
  expect(start(record)?.envNames).not.toContain('ANTHROPIC_BASE_URL')
})

test('an extra login runs in the probe folder with its own CODEX_HOME even when one is inherited', async () => {
  const { id, home, record, env } = login()
  writeCodexAuth(home)
  const result = await probeCodexUsage(id, { env: { ...env, CODEX_HOME: join(homedir(), 'other-home') } })
  expect(result).toMatchObject({ ok: true, signedIn: true })
  expect(start(record)?.codexHome).toBe(home)
})

test('a codex that cannot be found is an error with a fixed sentence', async () => {
  const empty = mkdtempSync(join(homedir(), 'empty-path-'))
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: empty, Path: empty }
  delete env.KURMIS_CODEX_BIN
  const result = await probeCodexUsage('codex:missing', { env })
  expect(result).toMatchObject({ ok: false, signedIn: null, reason: 'missing' })
  expectFixedError(result)
  // The daemon looks it up on the PATH it was started with, and the sentence says so.
  expect(result).toMatchObject({ error: expect.stringContaining('on the PATH the kurmis daemon was started with') })
  expect(result).toMatchObject({ error: expect.stringContaining('kurmis daemon restart') })
  expect(result).toMatchObject({ error: expect.stringContaining('KURMIS_CODEX_BIN') })
})
