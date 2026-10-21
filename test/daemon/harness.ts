// A daemon app behind a `node:http` server on a free port, against the fake Anthropic API and
// the fake claude and codex, with its own HOME and KURMIS_HOME. For the in-process tests of the
// whole request handling (`app.test.ts`).
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StopRequest } from '../../src/core/control-api.ts'
import { createDaemonApp, type DaemonApp, type DaemonTuning } from '../../src/daemon/app.ts'
import type { KurmisConfig, LoginSettingsPatch } from '../../src/data/config.ts'
import type { LogEvent, LogFields } from '../../src/data/log.ts'
import { FAKE_CLAUDE_SCRIPT, FAKE_CODEX_SCRIPT, startFakeAnthropic, type FakeAnthropic } from '../fakes/index.ts'
import { writeTestConfig } from '../logins.ts'

export const KEY = 'a'.repeat(64)

export interface LoggedLine {
  event: LogEvent
  fields: LogFields
}

export interface Harness {
  api: FakeAnthropic
  app: DaemonApp
  /** `http://127.0.0.1:<port>` of the daemon. */
  url: string
  port: number
  home: string
  env: NodeJS.ProcessEnv
  log: LoggedLine[]
  stopRequested: () => number
  /** What each control `stop` asked for, in order. */
  stopRequests: StopRequest[]
  close(): Promise<void>
}

export interface HarnessOptions {
  /** Extra Claude logins by id, with their settings, added after the machine's own logins. */
  claude?: Record<string, LoginSettingsPatch>
  /** Extra Codex logins by id, with their settings, added after the extra Claude logins. */
  codex?: Record<string, LoginSettingsPatch>
  /** Settings of the machine's own Claude login (`OWN_CLAUDE`). */
  ownClaude?: LoginSettingsPatch
  /** Settings of the machine's own Codex login (`OWN_CODEX`). */
  ownCodex?: LoginSettingsPatch
  tuning?: DaemonTuning
  env?: Record<string, string>
}

/** Makes a fresh HOME and KURMIS_HOME for one test and points the process at them. */
export function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'kurmis-app-'))
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.KURMIS_HOME = join(home, '.kurmis')
  return home
}

/**
 * Writes a `config.json` with the machine's own logins at `OWN_CLAUDE` and `OWN_CODEX` and the
 * given extra logins (`writeTestConfig`).
 */
export function writeLogins(options: Pick<HarnessOptions, 'claude' | 'codex' | 'ownClaude' | 'ownCodex'>): KurmisConfig {
  const extras = [
    ...Object.entries(options.claude ?? {}).map(([id, patch]) => ({ id, provider: 'claude' as const, ...patch })),
    ...Object.entries(options.codex ?? {}).map(([id, patch]) => ({ id, provider: 'codex' as const, ...patch }))
  ]
  return writeTestConfig({ extras,
    ...(options.ownClaude === undefined ? {} : { ownClaude: options.ownClaude }),
    ...(options.ownCodex === undefined ? {} : { ownCodex: options.ownCodex }) })
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const home = freshHome()
  writeLogins(options)
  const api = await startFakeAnthropic()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KURMIS_UPSTREAM_URL: api.url,
    KURMIS_CLAUDE_BIN: FAKE_CLAUDE_SCRIPT,
    KURMIS_CODEX_BIN: FAKE_CODEX_SCRIPT,
    ...options.env
  }
  const log: LoggedLine[] = []
  let stops = 0
  const stopRequests: StopRequest[] = []
  const app = createDaemonApp({
    env,
    log: { write: (event, fields = {}) => { log.push({ event, fields }) } },
    key: KEY,
    port: 0,
    pid: process.pid,
    startedAt: Date.now(),
    onStopRequested: (request) => { stops++; stopRequests.push(request) },
    tuning: { poll: false, configCheckMs: 0, stateWriteMs: 0, random: () => 0, ...options.tuning }
  })
  await app.start()
  const server: Server = createServer((req, res) => { app.handle(req, res) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    api, app, url: `http://127.0.0.1:${String(port)}`, port, home, env, log,
    stopRequested: () => stops,
    stopRequests,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await app.close()
      await api.close()
      rmSync(home, { recursive: true, force: true, maxRetries: 10 })
    }
  }
}

export interface CallResult {
  status: number
  headers: IncomingHttpHeaders
  text: string
  /** When each chunk of the body arrived, in ms since the request started. */
  chunkTimes: number[]
}

export interface CallOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  /** The body as exact text, sent as it is instead of `body`. */
  text?: string
  /** Aborts the request. */
  signal?: AbortSignal
}

/** One request to the daemon; the body is sent as JSON, or `text` as it is. */
export function call(harness: Pick<Harness, 'port'>, path: string, options: CallOptions = {}): Promise<CallResult> {
  const body = options.text ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const req = request({
      host: '127.0.0.1', port: harness.port, path, method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers },
      ...(options.signal === undefined ? {} : { signal: options.signal })
    }, (res) => {
      const chunks: Buffer[] = []
      const chunkTimes: number[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); chunkTimes.push(Date.now() - started) })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8'), chunkTimes }) })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

/** A `/v1/messages` body as the CLI sends it, with a `metadata.user_id` naming an account uuid. */
export function messagesBody(stream = true): Record<string, unknown> {
  return {
    model: 'claude-sonnet-5',
    max_tokens: 100,
    stream,
    messages: [{ role: 'user', content: 'Hello' }],
    metadata: { user_id: JSON.stringify({ device_id: 'device-1', account_uuid: '00000000-0000-4000-8000-00000000c11e', session_id: 'session-1' }) }
  }
}

/** The headers of a routed request: the key, a session id, and whatever else is given. */
export function routed(session: string | null, extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-kurmis-key': KEY, ...(session === null ? {} : { 'x-claude-code-session-id': session }), ...extra }
}
