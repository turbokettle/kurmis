// The real bundle, request handling included: `kurmis daemon start`, `status` and `stop` against
// a daemon that runs `createDaemonApp`. Skipped while `createDaemonApp` is not implemented.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readDaemonFile } from '../../src/data/daemon-file.ts'
import { openDaemonLog } from '../../src/data/log.ts'
import { createDaemonApp } from '../../src/daemon/app.ts'
import { processExists } from '../../src/daemon/lifecycle.ts'
import { buildTestBundle } from '../daemon/bundle.ts'
import { dataFolderWithPort, freePort } from '../daemon/helpers.ts'

function appImplemented(): boolean {
  try {
    createDaemonApp({ env: {}, log: openDaemonLog({ path: join(process.env.HOME ?? '', 'probe.log') }), key: 'x', port: 1, pid: 1, startedAt: 0, onStopRequested: () => undefined })
    return true
  } catch (error) {
    return !(error instanceof Error && /not implemented/.test(error.message))
  }
}

const homes: string[] = []
afterAll(() => {
  for (const home of homes) {
    const read = readDaemonFile(join(home, 'daemon.json'))
    if (read.status === 'ok' && processExists(read.info.pid)) process.kill(read.info.pid, 'SIGKILL')
  }
})

function kurmis(bundle: string, home: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, KURMIS_HOME: home }
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
})
