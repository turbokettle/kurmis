// `kurmis daemon start|stop|restart|status` as the user runs them: each command is a process of
// a test bundle (`test/daemon/bundle.ts`), and the daemons it starts run `daemon run` around the
// fake request handling. Every daemon a test started is killed after it.
import { execFile, spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readDaemonFile, readOrCreateKey } from '../../src/data/daemon-file.ts'
import { controlRequest, processExists } from '../../src/daemon/lifecycle.ts'
import { buildTestBundle } from '../daemon/bundle.ts'
import { HOLD_PATH } from '../daemon/fake-app.ts'
import { dataFolderWithPort, freePort, waitUntil } from '../daemon/helpers.ts'

interface Run {
  code: number | null
  stdout: string
  stderr: string
}

let bundles: { older: string; newer: string }
/** The data folders the tests used, whose daemons are killed after each test. */
let homes: string[] = []
let servers: Server[] = []

beforeAll(async () => {
  const [older, newer] = await Promise.all([
    buildTestBundle({ version: '0.4.0', entry: 'fake' }),
    buildTestBundle({ version: '0.5.0', entry: 'fake' })
  ])
  bundles = { older, newer }
}, 30_000)

afterEach(async () => {
  for (const home of homes) {
    for (const pid of pidsStartedIn(home)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }
  homes = []
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  servers = []
})

/** Every daemon pid seen in a data folder: daemon.json now, and the ones the tests noted. */
const seenPids = new Map<string, Set<number>>()
function notePid(home: string, pid: number): void {
  const pids = seenPids.get(home) ?? new Set<number>()
  pids.add(pid)
  seenPids.set(home, pids)
}
function pidsStartedIn(home: string): number[] {
  const read = readDaemonFile(join(home, 'daemon.json'))
  if (read.status === 'ok') notePid(home, read.info.pid)
  return [...(seenPids.get(home) ?? [])].filter((pid) => pid !== process.pid)
}

async function newHome(): Promise<{ home: string; port: number }> {
  const port = await freePort()
  const home = dataFolderWithPort(port)
  homes.push(home)
  return { home, port }
}

function envFor(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, KURMIS_HOME: home, ...extra }
  delete env.NODE_OPTIONS
  return env
}

function kurmis(bundle: string, home: string, args: string[], extra: NodeJS.ProcessEnv = {}): Promise<Run> {
  return new Promise((resolve) => {
    execFile(process.execPath, [bundle, ...args], { env: envFor(home, extra), timeout: 40_000 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null
      resolve({ code, stdout, stderr })
    })
  })
}

function daemonInfo(home: string): { pid: number; port: number; version: string } | null {
  const read = readDaemonFile(join(home, 'daemon.json'))
  if (read.status !== 'ok') return null
  notePid(home, read.info.pid)
  return read.info
}

/**
 * The pids of the `daemon run` processes of `bundle`. Each test file builds its bundles into a
 * folder of its own, and its tests run one after another, so these are the current test's.
 * Empty on Windows, which has no `ps`.
 */
function daemonRunPids(bundle: string): number[] {
  if (process.platform === 'win32') return []
  const listed = spawnSync('ps', ['-ax', '-ww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout
  const names = [bundle, realpathSync(bundle)]
  return listed.split('\n')
    .filter((line) => names.some((name) => line.includes(`${name} daemon run`)))
    .map((line) => Number(line.trim().split(/\s+/)[0]))
}

describe('kurmis daemon', () => {
  it('starts a daemon, finds it again, shows its status and stops it', async () => {
    const { home, port } = await newHome()
    const started = await kurmis(bundles.newer, home, ['daemon', 'start'])
    expect(started).toMatchObject({ code: 0, stderr: '' })
    expect(started.stdout).toMatch(new RegExp(`Started the kurmis daemon 0\\.5\\.0 on 127\\.0\\.0\\.1:${String(port)} \\(pid \\d+\\)\\.`))
    const info = daemonInfo(home)
    expect(info).toMatchObject({ port, version: '0.5.0' })
    const pid = info?.pid ?? 0
    expect(processExists(pid)).toBe(true)

    const again = await kurmis(bundles.newer, home, ['daemon', 'start'])
    expect(again.stdout).toContain(`The kurmis daemon 0.5.0 already runs on 127.0.0.1:${String(port)} (pid ${String(pid)}).`)

    const status = await kurmis(bundles.newer, home, ['daemon', 'status', '--json'])
    expect(status.code).toBe(0)
    expect(JSON.parse(status.stdout)).toMatchObject({ running: true, pid, port, version: '0.5.0', cliVersion: '0.5.0' })

    const stopped = await kurmis(bundles.newer, home, ['daemon', 'stop'])
    expect(stopped).toMatchObject({ code: 0, stdout: `Stopped the kurmis daemon (pid ${String(pid)}).\n` })
    expect(processExists(pid)).toBe(false)
    expect(existsSync(join(home, 'daemon.json'))).toBe(false)

    const after = await kurmis(bundles.newer, home, ['daemon', 'status'])
    expect(after).toMatchObject({ code: 1, stdout: 'The kurmis daemon is not running.\n' })
    expect((await kurmis(bundles.newer, home, ['daemon', 'stop'])).stdout).toBe('The kurmis daemon is not running.\n')
  }, 60_000)

  it('ends with one daemon when two CLIs start one at the same moment', async () => {
    const { home } = await newHome()
    const [first, second] = await Promise.all([
      kurmis(bundles.newer, home, ['daemon', 'start']),
      kurmis(bundles.newer, home, ['daemon', 'start'])
    ])
    expect(first.code).toBe(0)
    expect(second.code).toBe(0)
    const pid = daemonInfo(home)?.pid ?? 0
    expect(first.stdout).toContain(`(pid ${String(pid)})`)
    expect(second.stdout).toContain(`(pid ${String(pid)})`)
    // Both CLIs started a daemon. The second one may still be starting when both CLIs have found
    // the first; it must exit once it finds the port taken. Were it still running after this
    // test's cleanup killed the first, it would bind the freed port and outlive the test.
    for (const other of daemonRunPids(bundles.newer)) if (other !== pid) notePid(home, other)
    await waitUntil(() => daemonRunPids(bundles.newer).every((other) => other === pid), 20_000, 'the second daemon to exit')
  }, 60_000)

  it('ignores a daemon.json left by a daemon that died', async () => {
    const { home, port } = await newHome()
    const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await new Promise((resolve) => dead.on('exit', resolve))
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ pid: dead.pid, port, version: '0.5.0', startedAt: 1 }))
    const started = await kurmis(bundles.newer, home, ['daemon', 'start'])
    expect(started.stdout).toContain('Started the kurmis daemon 0.5.0')
    expect(daemonInfo(home)?.pid).not.toBe(dead.pid)
  }, 60_000)

  it('says how to change the port when another program holds it', async () => {
    const { home, port } = await newHome()
    const server = createServer((_request, response) => response.writeHead(404).end())
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    servers.push(server)
    const started = await kurmis(bundles.newer, home, ['daemon', 'start'])
    expect(started.code).toBe(1)
    expect(started.stderr).toContain(`Port ${String(port)} on 127.0.0.1 is in use by another program`)
    expect(started.stderr).toContain(`"port" in ${join(home, 'config.json')}`)
    expect(existsSync(join(home, 'daemon.json'))).toBe(false)
  }, 60_000)

  it('replaces an older daemon, which finishes its open request first', async () => {
    const { home, port } = await newHome()
    expect((await kurmis(bundles.older, home, ['daemon', 'start'])).code).toBe(0)
    const old = daemonInfo(home)
    expect(old?.version).toBe('0.4.0')
    const key = readOrCreateKey(join(home, 'key'))
    const open = controlRequest({ port, key, method: 'GET', path: `${HOLD_PATH}?ms=2500`, timeoutMs: 15_000 })
    await new Promise((resolve) => setTimeout(resolve, 200))

    const started = await kurmis(bundles.newer, home, ['daemon', 'start'])
    expect(started.stdout).toContain('Started the kurmis daemon 0.5.0')
    expect(started.stdout).toContain('replacing version 0.4.0')
    const now = daemonInfo(home)
    expect(now?.version).toBe('0.5.0')
    expect(now?.pid).not.toBe(old?.pid)
    expect(processExists(old?.pid ?? 0)).toBe(true)

    expect(await open).toMatchObject({ kind: 'answered', status: 200, body: { pid: old?.pid } })
    await waitUntil(() => !processExists(old?.pid ?? 0), 10_000, 'the old daemon to exit')
    expect(daemonInfo(home)?.pid).toBe(now?.pid)
  }, 60_000)

  it('never lets an older kurmis replace a newer daemon', async () => {
    const { home } = await newHome()
    await kurmis(bundles.newer, home, ['daemon', 'start'])
    const pid = daemonInfo(home)?.pid
    const start = await kurmis(bundles.older, home, ['daemon', 'start'])
    expect(start.stdout).toContain('A newer kurmis daemon (0.5.0) already runs')
    const restart = await kurmis(bundles.older, home, ['daemon', 'restart'])
    expect(restart.code).toBe(1)
    expect(restart.stderr).toContain('newer than this kurmis (0.4.0)')
    expect(daemonInfo(home)?.pid).toBe(pid)
    const status = await kurmis(bundles.older, home, ['daemon', 'status'])
    expect(status.stdout).toContain('This kurmis is 0.4.0, older than the daemon.')
  }, 60_000)

  it('restarts: a new daemon serves at once', async () => {
    const { home } = await newHome()
    await kurmis(bundles.newer, home, ['daemon', 'start'])
    const before = daemonInfo(home)?.pid ?? 0
    const restarted = await kurmis(bundles.newer, home, ['daemon', 'restart'])
    expect(restarted.code).toBe(0)
    const after = daemonInfo(home)?.pid ?? 0
    expect(after).not.toBe(before)
    expect(restarted.stdout).toContain(`(pid ${String(after)})`)
    await waitUntil(() => !processExists(before), 10_000, 'the old daemon to exit')
  }, 60_000)

  it('starts the daemon through launchd from an ssh login on macOS', async () => {
    const { home } = await newHome()
    const launchctlDir = join(home, 'fake-launchctl')
    const extra = { SSH_CONNECTION: '192.0.2.1 50000 192.0.2.2 22', FAKE_LAUNCHCTL_RUN: '1', FAKE_LAUNCHCTL_DIR: launchctlDir }
    const started = await kurmis(bundles.newer, home, ['daemon', 'start'], extra)
    if (process.platform !== 'darwin') {
      expect(started.stdout).toContain('Started the kurmis daemon 0.5.0 on')
      return
    }
    expect(started).toMatchObject({ code: 0, stderr: '' })
    expect(started.stdout).toContain('Started the kurmis daemon 0.5.0 through launchd')
    const calls = readFileSync(join(launchctlDir, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[])
    expect(calls.map((call) => call[0])).toEqual(['bootstrap', 'bootout'])
    // The one-shot plist is gone once the daemon answers.
    expect(readdirSync(join(home, 'launchd')).filter((name) => name.endsWith('.plist'))).toEqual([])
    const runs = readFileSync(join(launchctlDir, 'runs.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { program: string[] })
    expect(runs[0]?.program.slice(-3)).toEqual(['daemon', 'start', '--no-launchd'])
    expect(processExists(daemonInfo(home)?.pid ?? 0)).toBe(true)
  }, 60_000)

  it('starts the daemon directly with a warning when launchd refuses', async () => {
    if (process.platform !== 'darwin') return
    const { home } = await newHome()
    const extra = { SSH_CONNECTION: '192.0.2.1 50000 192.0.2.2 22', FAKE_LAUNCHCTL_FAIL_BOOTSTRAP: '125', FAKE_LAUNCHCTL_DIR: join(home, 'fake-launchctl') }
    const started = await kurmis(bundles.newer, home, ['daemon', 'start'], extra)
    expect(started.code).toBe(0)
    expect(started.stderr).toContain('could not be started through launchd')
    expect(started.stdout).toContain('Started the kurmis daemon 0.5.0 on')
  }, 60_000)
})
