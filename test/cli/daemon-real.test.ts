// The real bundle, request handling included: `kurmis daemon start`, `status`, `stop` and the
// version handover against a daemon that runs `createDaemonApp`, with the fake claude, codex and
// Anthropic API. Skipped while `createDaemonApp` is not implemented.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readDaemonFile, readOrCreateKey } from '../../src/data/daemon-file.ts'
import { openDaemonLog } from '../../src/data/log.ts'
import { createDaemonApp } from '../../src/daemon/app.ts'
import { processExists } from '../../src/daemon/lifecycle.ts'
import { buildTestBundle } from '../daemon/bundle.ts'
import { call, messagesBody } from '../daemon/harness.ts'
import { dataFolderWithPort, freePort, waitUntil } from '../daemon/helpers.ts'
import { FAKE_CLAUDE_SCRIPT, FAKE_CODEX_SCRIPT, reply, startFakeAnthropic, type FakeAnthropic } from '../fakes/index.ts'

function appImplemented(): boolean {
  try {
    createDaemonApp({ env: {}, log: openDaemonLog({ path: join(process.env.HOME ?? '', 'probe.log') }), key: 'x', port: 1, pid: 1, startedAt: 0, onStopRequested: () => undefined })
    return true
  } catch (error) {
    return !(error instanceof Error && /not implemented/.test(error.message))
  }
}

let api: FakeAnthropic
beforeAll(async () => {
  api = await startFakeAnthropic()
})

const homes: string[] = []
afterAll(async () => {
  await api.close()
  for (const home of homes) {
    const read = readDaemonFile(join(home, 'daemon.json'))
    if (read.status === 'ok' && processExists(read.info.pid)) process.kill(read.info.pid, 'SIGKILL')
  }
})

function kurmis(bundle: string, home: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KURMIS_HOME: home,
    KURMIS_CLAUDE_BIN: FAKE_CLAUDE_SCRIPT,
    KURMIS_CODEX_BIN: FAKE_CODEX_SCRIPT,
    KURMIS_UPSTREAM_URL: api.url
  }
  delete env.NODE_OPTIONS
  return new Promise((resolve) => {
    execFile(process.execPath, [bundle, ...args], { env, timeout: 40_000 }, (error, stdout, stderr) => {
      resolve({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : null, stdout, stderr })
    })
  })
}

describe.skipIf(!appImplemented())('the real daemon', () => {
  it('starts, answers its status and stops', async () => {
    const bundle = await buildTestBundle({ version: '0.5.0', entry: 'real' })
    const port = await freePort()
    const home = dataFolderWithPort(port)
    homes.push(home)
    const started = await kurmis(bundle, home, ['daemon', 'start'])
    expect(started).toMatchObject({ code: 0, stderr: '' })
    const status = await kurmis(bundle, home, ['daemon', 'status', '--json'])
    const answer = JSON.parse(status.stdout) as { running: boolean; port: number; version: string; logins: number }
    expect(answer).toMatchObject({ running: true, port, version: '0.5.0' })
    expect(answer.logins).toBeGreaterThanOrEqual(2)
    const read = readDaemonFile(join(home, 'daemon.json'))
    const pid = read.status === 'ok' ? read.info.pid : 0
    const stopped = await kurmis(bundle, home, ['daemon', 'stop'])
    expect(stopped.code).toBe(0)
    expect(processExists(pid)).toBe(false)
    expect(existsSync(join(home, 'daemon.json'))).toBe(false)
  }, 60_000)

  it('hands over to a newer version while a proxied request finishes on the older one', async () => {
    const [older, newer] = await Promise.all([
      buildTestBundle({ version: '0.4.0', entry: 'real' }),
      buildTestBundle({ version: '0.5.0', entry: 'real' })
    ])
    const port = await freePort()
    const home = dataFolderWithPort(port)
    homes.push(home)
    expect((await kurmis(older, home, ['daemon', 'start'])).code).toBe(0)
    const read = readDaemonFile(join(home, 'daemon.json'))
    const oldPid = read.status === 'ok' ? read.info.pid : 0
    const key = readOrCreateKey(join(home, 'key'))

    // No token can be read for claude:default here, so the proxy forwards the CLI's own header.
    api.script(reply.ok({ text: 'Hello from the older daemon', delayMs: 2_500 }))
    const open = call({ port }, '/v1/messages', {
      headers: { 'x-kurmis-key': key, authorization: 'Bearer example-token', 'x-claude-code-session-id': 'session-1' },
      body: messagesBody(false)
    })
    await waitUntil(() => api.apiRequests().length > 0, 10_000, 'the request to reach the fake API')

    const started = await kurmis(newer, home, ['daemon', 'start'])
    expect(started.stdout).toContain('replacing version 0.4.0')
    const now = readDaemonFile(join(home, 'daemon.json'))
    expect(now.status === 'ok' && now.info).toMatchObject({ version: '0.5.0' })
    expect(processExists(oldPid)).toBe(true)

    const answer = await open
    expect(answer.status).toBe(200)
    expect(answer.text).toContain('Hello from the older daemon')
    await waitUntil(() => !processExists(oldPid), 10_000, 'the older daemon to exit')
    const status = JSON.parse((await kurmis(newer, home, ['daemon', 'status', '--json'])).stdout) as { version: string; running: boolean }
    expect(status).toMatchObject({ running: true, version: '0.5.0' })
  }, 60_000)
})
