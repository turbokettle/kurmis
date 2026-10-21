// `kurmis daemon start|stop|restart|status` as the user runs them: each command is a process of
// a test bundle (`test/daemon/bundle.ts`), and the daemons it starts run `daemon run` around the
// fake request handling. Every daemon a test started is killed after it, once it is shown to be
// one (`test/daemon/own-daemons.ts`).
import { execFile, spawn } from 'node:child_process'
import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CONTROL_API_VERSION } from '../../src/core/control-api.ts'
import { readDaemonFile, readOrCreateKey } from '../../src/data/daemon-file.ts'
import { controlRequest, processExists } from '../../src/daemon/lifecycle.ts'
import { buildTestBundle } from '../daemon/bundle.ts'
import { commandLines, OwnDaemons } from '../daemon/own-daemons.ts'
import { HOLD_PATH } from '../daemon/fake-app.ts'
import { dataFolderWithPort, freePort, waitUntil } from '../daemon/helpers.ts'

interface Run {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * `older` and `newer` are 0.4.0 and 0.5.0 of this source. `lowApi` and `highApi` are both 0.5.0,
 * with this source's control API version and one more.
 */
let bundles: { older: string; newer: string; lowApi: string; highApi: string }
let servers: Server[] = []

beforeAll(async () => {
  const [older, newer, lowApi, highApi] = await Promise.all([
    buildTestBundle({ version: '0.4.0', entry: 'fake' }),
    buildTestBundle({ version: '0.5.0', entry: 'fake' }),
    buildTestBundle({ version: '0.5.0', entry: 'fake', apiVersion: CONTROL_API_VERSION }),
    buildTestBundle({ version: '0.5.0', entry: 'fake', apiVersion: CONTROL_API_VERSION + 1 })
  ])
  bundles = { older, newer, lowApi, highApi }
}, 30_000)

afterEach(async () => {
  // Only a pid shown to be a daemon of the test's data folder is killed (`OwnDaemons`).
  await Promise.all([...daemonsOf.values()].map((daemons) => daemons.stop()))
  daemonsOf.clear()
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  servers = []
})

/**
 * How long the older daemon is kept busy while the newer one starts. Starting a daemon takes far
 * longer on Windows, and longer still while every test file runs at once.
 */
const OPEN_REQUEST_MS = process.platform === 'win32' ? 8_000 : 2_500

/** The daemons of each data folder the tests used. */
const daemonsOf = new Map<string, OwnDaemons>()
function daemonsIn(home: string): OwnDaemons {
  let daemons = daemonsOf.get(home)
  if (daemons === undefined) {
    daemons = new OwnDaemons(home, Object.values(bundles))
    daemonsOf.set(home, daemons)
  }
  return daemons
}
function notePid(home: string, pid: number): void {
  daemonsIn(home).notePid(pid)
}

async function newHome(): Promise<{ home: string; port: number }> {
  const port = await freePort()
  const home = dataFolderWithPort(port)
  daemonsIn(home)
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
      daemonsIn(home).note()
      resolve({ code, stdout, stderr })
    })
  })
}

function daemonInfo(home: string): { pid: number; port: number; version: string } | null {
  const read = readDaemonFile(join(home, 'daemon.json'))
  daemonsIn(home).note()
  if (read.status !== 'ok') return null
  return read.info
}

/**
 * The pids of the `daemon run` processes of `bundle`. Each test file builds its bundles into a
 * folder of its own, and its tests run one after another, so these are the current test's.
 */
function daemonRunPids(bundle: string): number[] {
  const names = [bundle, realpathSync(bundle)]
  return [...commandLines()]
    .filter(([, command]) => names.some((name) => command.includes(`${name} daemon run`)))
    .map(([pid]) => pid)
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
    const open = controlRequest({ port, key, method: 'GET', path: `${HOLD_PATH}?ms=${String(OPEN_REQUEST_MS)}`, timeoutMs: 15_000 + OPEN_REQUEST_MS })
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

  it('kurmis status shows an older daemon without replacing it, and starts none when none runs', async () => {
    const { home } = await newHome()
    const none = await kurmis(bundles.newer, home, ['status', '--json'])
    expect(none.code, none.stderr).toBe(0)
    expect(JSON.parse(none.stdout)).toMatchObject({ daemon: null, source: 'files' })
    expect(daemonInfo(home)).toBeNull()

    expect((await kurmis(bundles.older, home, ['daemon', 'start'])).code).toBe(0)
    const pid = daemonInfo(home)?.pid
    const status = await kurmis(bundles.newer, home, ['status', '--json'])
    expect(status.code, status.stderr).toBe(0)
    expect(JSON.parse(status.stdout)).toMatchObject({ source: 'daemon', daemon: { version: '0.4.0', pid, older: true } })
    const text = await kurmis(bundles.newer, home, ['status'])
    expect(text.stdout).toContain('It runs an older kurmis than this one (0.5.0).')
    expect(daemonInfo(home)).toMatchObject({ pid, version: '0.4.0' })
  }, 60_000)

  it('never lets an older kurmis replace a newer daemon', async () => {
    const { home } = await newHome()
    await kurmis(bundles.newer, home, ['daemon', 'start'])
    const pid = daemonInfo(home)?.pid
    const start = await kurmis(bundles.older, home, ['daemon', 'start'])
    expect(start.code).toBe(0)
    const api = `control API version ${String(CONTROL_API_VERSION)}`
    expect(start.stdout).toContain(`A newer kurmis daemon (0.5.0 with ${api}) already runs`)
    expect(start.stdout).toContain(`this kurmis is 0.4.0 with ${api}, and can use it.`)
    const restart = await kurmis(bundles.older, home, ['daemon', 'restart'])
    expect(restart.code).toBe(1)
    expect(restart.stderr).toContain(`newer than this kurmis (the daemon is 0.5.0 with ${api}, this kurmis is 0.4.0 with ${api})`)
    expect(daemonInfo(home)?.pid).toBe(pid)
    const status = await kurmis(bundles.older, home, ['daemon', 'status'])
    expect(status.stdout).toContain('The daemon is newer; this kurmis can use it and does not replace it.')
  }, 60_000)

  it('of one version, replaces a daemon of a lower control API version, and never one of a higher one', async () => {
    const { home } = await newHome()
    const low = `0.5.0 with control API version ${String(CONTROL_API_VERSION)}`
    const high = `0.5.0 with control API version ${String(CONTROL_API_VERSION + 1)}`
    expect((await kurmis(bundles.lowApi, home, ['daemon', 'start'])).code).toBe(0)
    const first = daemonInfo(home)?.pid ?? 0

    // The build with the higher control API version replaces the one with the lower.
    const replaced = await kurmis(bundles.highApi, home, ['daemon', 'start'])
    expect(replaced.code, replaced.stderr).toBe(0)
    expect(replaced.stdout).toContain('replacing version 0.5.0')
    const second = daemonInfo(home)?.pid ?? 0
    expect(second).not.toBe(first)
    await waitUntil(() => !processExists(first), 10_000, 'the replaced daemon to exit')

    // The build with the lower one keeps it, says why it cannot use it, and fails.
    const start = await kurmis(bundles.lowApi, home, ['daemon', 'start'])
    expect(start.code).toBe(1)
    expect(start.stderr).toContain('A newer kurmis daemon runs on port')
    expect(start.stderr).toContain(`The daemon is ${high}, this kurmis is ${low}.`)
    expect(start.stderr).toContain('Update this kurmis, or stop the daemon with "kurmis daemon stop" and run the command again.')
    const restart = await kurmis(bundles.lowApi, home, ['daemon', 'restart'])
    expect(restart.code).toBe(1)
    expect(restart.stderr).toContain('so this kurmis does not replace it')
    const status = await kurmis(bundles.lowApi, home, ['daemon', 'status'])
    expect(status.code).toBe(0)
    expect(status.stdout).toContain(`The daemon is ${high}, this kurmis is ${low}. The daemon is newer, so this kurmis does not ` +
      'replace it, and it cannot use a daemon of another control API version.')
    const report = await kurmis(bundles.lowApi, home, ['status', '--json'])
    expect(JSON.parse(report.stdout)).toMatchObject({ source: 'files', daemon: { pid: second, older: false, newer: true } })
    expect(daemonInfo(home)?.pid).toBe(second)
    expect(processExists(second)).toBe(true)
  }, 90_000)

  it('never lets an older kurmis stop a newer daemon to move it to the port config.json now names', async () => {
    const { home, port } = await newHome()
    expect((await kurmis(bundles.newer, home, ['daemon', 'start'])).code).toBe(0)
    const pid = daemonInfo(home)?.pid ?? 0
    const moved = await freePort()
    writeFileSync(join(home, 'config.json'), JSON.stringify({ version: 2, port: moved }))
    const start = await kurmis(bundles.older, home, ['daemon', 'start'])
    expect(start.code).toBe(1)
    expect(start.stderr).toContain(`The kurmis daemon 0.5.0 runs on port ${String(port)}, but ${join(home, 'config.json')} names port ` +
      `${String(moved)}. It is newer than this kurmis (0.5.0 with control API version ${String(CONTROL_API_VERSION)}; this kurmis ` +
      `is 0.4.0 with control API version ${String(CONTROL_API_VERSION)}), so this kurmis does not stop it to move it.`)
    expect(processExists(pid)).toBe(true)
    expect(daemonInfo(home)).toMatchObject({ pid, port })
  }, 60_000)

  it('says the daemon no longer accepts a key file that changed while it ran, and names its pid', async () => {
    const { home, port } = await newHome()
    expect((await kurmis(bundles.newer, home, ['daemon', 'start'])).code).toBe(0)
    const pid = daemonInfo(home)?.pid ?? 0
    writeFileSync(join(home, 'key'), `${'b'.repeat(64)}\n`)
    const expected = `The program on port ${String(port)} refused the key in ${join(home, 'key')}, and daemon.json names pid ${String(pid)}`
    const status = await kurmis(bundles.newer, home, ['daemon', 'status'])
    expect(status.code).toBe(1)
    expect(status.stdout).toContain(expected)
    expect(status.stdout).toContain(`stop it with "${process.platform === 'win32' ? `taskkill /PID ${String(pid)} /F` : `kill ${String(pid)}`}"`)
    const start = await kurmis(bundles.newer, home, ['daemon', 'start'])
    expect(start).toMatchObject({ code: 1 })
    expect(start.stderr).toContain(expected)
    const stop = await kurmis(bundles.newer, home, ['daemon', 'stop'])
    expect(stop.code).toBe(1)
    expect(stop.stderr).toContain(expected)
    expect(processExists(pid)).toBe(true)
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

  it('starts the daemon directly from an ssh login, with no launchctl or PowerShell', async () => {
    const { home } = await newHome()
    const launchctlDir = join(home, 'fake-launchctl')
    const powershellDir = join(home, 'fake-powershell')
    const extra = { SSH_CONNECTION: '192.0.2.1 50000 192.0.2.2 22', FAKE_LAUNCHCTL_DIR: launchctlDir, FAKE_POWERSHELL_DIR: powershellDir }
    const started = await kurmis(bundles.newer, home, ['daemon', 'start'], extra)
    expect(started).toMatchObject({ code: 0, stderr: '' })
    expect(started.stdout).toContain('Started the kurmis daemon 0.5.0 on')
    expect(existsSync(join(launchctlDir, 'calls.jsonl'))).toBe(false)
    expect(existsSync(join(powershellDir, 'calls.jsonl'))).toBe(false)
    expect(processExists(daemonInfo(home)?.pid ?? 0)).toBe(true)
  }, 60_000)
})
