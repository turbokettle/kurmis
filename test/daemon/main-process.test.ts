// The daemon's lifecycle as a process of its own: a test bundle (`bundle.ts`) whose `daemon run`
// uses the fake request handling, built with the version each test needs. Every process a test
// starts is killed after it.
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CONTROL_PATHS, type StatusAnswer } from '../../src/core/control-api.ts'
import { readDaemonFile, readOrCreateKey } from '../../src/data/daemon-file.ts'
import { controlRequest, processExists } from '../../src/daemon/lifecycle.ts'
import { buildTestBundle } from './bundle.ts'
import { HOLD_PATH } from './fake-app.ts'
import { dataFolderWithPort, freePort, waitUntil } from './helpers.ts'

interface DaemonProcess {
  child: ChildProcess
  pid: number
  stdout: () => string
  stderr: () => string
  exit: Promise<number | null>
}

let started: DaemonProcess[] = []

afterEach(() => {
  for (const daemon of started) {
    if (daemon.child.exitCode === null && daemon.child.signalCode === null) daemon.child.kill('SIGKILL')
  }
  started = []
})

let bundles: Record<'0.0.1' | '0.0.2', string>

beforeAll(async () => {
  const [older, newer] = await Promise.all([
    buildTestBundle({ version: '0.0.1', entry: 'fake' }),
    buildTestBundle({ version: '0.0.2', entry: 'fake' })
  ])
  bundles = { '0.0.1': older, '0.0.2': newer }
}, 30_000)

function spawnDaemon(bundle: string, home: string): DaemonProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, KURMIS_HOME: home }
  delete env.NODE_OPTIONS
  const child = spawn(process.execPath, [bundle, 'daemon', 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8')
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    err += chunk.toString('utf8')
  })
  const exit = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
  const daemon: DaemonProcess = { child, pid: child.pid ?? 0, stdout: () => out, stderr: () => err, exit }
  started.push(daemon)
  return daemon
}

function daemonFile(home: string): ReturnType<typeof readDaemonFile> {
  return readDaemonFile(join(home, 'daemon.json'))
}

async function waitForDaemonFile(home: string, pid: number): Promise<void> {
  await waitUntil(() => {
    const read = daemonFile(home)
    return read.status === 'ok' && read.info.pid === pid
  }, 10_000, `daemon.json to name pid ${String(pid)}`)
}

describe('the daemon process', () => {
  it('stops on SIGTERM, exits 0 and removes daemon.json', async () => {
    const port = await freePort()
    const home = dataFolderWithPort(port)
    const daemon = spawnDaemon(bundles['0.0.2'], home)
    await waitForDaemonFile(home, daemon.pid)
    const key = readOrCreateKey(join(home, 'key'))
    const answer = await controlRequest({ port, key, method: 'GET', path: CONTROL_PATHS.status })
    expect(answer.kind === 'answered' && (answer.body as StatusAnswer).version).toBe('0.0.2')
    daemon.child.kill('SIGTERM')
    expect(await daemon.exit).toBe(0)
    expect(daemonFile(home).status).toBe('missing')
    expect(daemon.stdout()).toContain('kurmis daemon 0.0.2 runs on')
  })

  it('hands the port to a newer version while the older one finishes its open request', async () => {
    const port = await freePort()
    const home = dataFolderWithPort(port)
    const old = spawnDaemon(bundles['0.0.1'], home)
    await waitForDaemonFile(home, old.pid)
    const key = readOrCreateKey(join(home, 'key'))
    const open = controlRequest({ port, key, method: 'GET', path: `${HOLD_PATH}?ms=2000`, timeoutMs: 10_000 })
    // Let the request reach the old daemon before the new one starts.
    await new Promise((resolve) => setTimeout(resolve, 200))

    const replacement = spawnDaemon(bundles['0.0.2'], home)
    await waitForDaemonFile(home, replacement.pid)
    const answer = await controlRequest({ port, key, method: 'GET', path: CONTROL_PATHS.status })
    expect(answer.kind === 'answered' && (answer.body as StatusAnswer).pid).toBe(replacement.pid)
    expect(processExists(old.pid)).toBe(true)

    expect(await open).toMatchObject({ kind: 'answered', status: 200, body: { ok: true, pid: old.pid } })
    expect(await old.exit).toBe(0)
    const read = daemonFile(home)
    expect(read.status === 'ok' && read.info).toMatchObject({ pid: replacement.pid, version: '0.0.2' })
    expect(replacement.child.exitCode).toBe(null)
    expect(replacement.stdout()).toContain(`Replacing kurmis daemon 0.0.1 (pid ${String(old.pid)})`)
  }, 20_000)

  it('leaves a newer daemon running when an older version starts', async () => {
    const port = await freePort()
    const home = dataFolderWithPort(port)
    const newer = spawnDaemon(bundles['0.0.2'], home)
    await waitForDaemonFile(home, newer.pid)
    const older = spawnDaemon(bundles['0.0.1'], home)
    expect(await older.exit).toBe(0)
    expect(older.stdout()).toContain(`kurmis daemon 0.0.2 already runs on port ${String(port)} (pid ${String(newer.pid)})`)
    expect(newer.child.exitCode).toBe(null)
    const read = daemonFile(home)
    expect(read.status === 'ok' && read.info.pid).toBe(newer.pid)
  }, 20_000)
})
