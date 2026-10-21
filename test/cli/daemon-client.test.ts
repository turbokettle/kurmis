// The daemon client against an in-process HTTP server standing in for the daemon. Starting real
// daemon processes is tested in `daemon-lifecycle.test.ts`.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve, win32 } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONTROL_API_VERSION, type StatusAnswer } from '../../src/core/control-api.ts'
import { saveConfig, defaultConfig } from '../../src/data/config.ts'
import { readOrCreateKey, writeDaemonFile } from '../../src/data/daemon-file.ts'
import { daemonFilePath, keyPath, kurmisHome } from '../../src/data/paths.ts'
import { processExists } from '../../src/daemon/lifecycle.ts'
import {
  chooseStartMethod,
  daemonEnvironment,
  DaemonError,
  findDaemon,
  keyRefusedProblem,
  readStatus,
  requestProbe,
  requestReload,
  restartDaemon,
  startDaemon,
  stopDaemon,
  wmiDaemonArguments
} from '../../src/cli/daemon-client.ts'

interface FakeDaemon {
  port: number
  requests: Array<{ method: string; url: string; key: string | undefined; body: string }>
  close(): Promise<void>
}

function status(port: number, patch: Partial<StatusAnswer> = {}): StatusAnswer {
  return { ok: true, apiVersion: CONTROL_API_VERSION, version: '1.2.3', pid: process.pid, port, startedAt: 1_768_478_400_000, logins: [], ...patch }
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse, body: string) => void): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => handler(request, response, Buffer.concat(chunks).toString('utf8')))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: (server.address() as AddressInfo).port }
}

async function freePort(): Promise<number> {
  const { server, port } = await listen(() => undefined)
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

let servers: Server[] = []

interface FakeDaemonBehaviour {
  /** How long it takes to answer a status request. */
  statusDelayMs?: number
  /** The HTTP status it answers a stop request with; 200 by default. */
  stopStatus?: number
}

/** A server that answers the control API like a daemon of `version` would, with the right key. */
async function fakeDaemon(key: string, patch: Partial<StatusAnswer> = {}, behaviour: FakeDaemonBehaviour = {}): Promise<FakeDaemon> {
  const requests: FakeDaemon['requests'] = []
  let port = 0
  const { server, port: bound } = await listen((request, response, body) => {
    const given = request.headers['x-kurmis-key'] as string | undefined
    requests.push({ method: request.method ?? '', url: request.url ?? '', key: given, body })
    if (given !== key) {
      response.writeHead(403).end()
      return
    }
    const json = (value: unknown): void => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    }
    if (request.url === '/_kurmis/status' && behaviour.statusDelayMs !== undefined) {
      setTimeout(() => json(status(port, patch)), behaviour.statusDelayMs)
    } else if (request.url === '/_kurmis/status' || request.url === '/_kurmis/probe') json(status(port, patch))
    else if (request.url === '/_kurmis/stop' && behaviour.stopStatus !== undefined) {
      response.writeHead(behaviour.stopStatus, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'example' }))
    } else if (request.url === '/_kurmis/reload' || request.url === '/_kurmis/stop') json({ ok: true })
    else response.writeHead(404).end()
  })
  port = bound
  servers.push(server)
  return { port, requests, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

function usePort(port: number): void {
  saveConfig({ ...defaultConfig(), port })
}

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true })
  mkdirSync(kurmisHome(), { recursive: true })
})

let children: number[] = []

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  servers = []
  for (const pid of children) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
  children = []
})

/** A process that runs until it is signalled, standing in for a daemon that does not exit by itself. */
async function lingeringPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  await new Promise((resolve) => child.once('spawn', resolve))
  const pid = child.pid ?? 0
  children.push(pid)
  return pid
}

/** A pid that existed and has exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise((resolve) => child.on('exit', resolve))
  return child.pid ?? 999_999
}

describe('findDaemon', () => {
  it('finds nothing without a key file', async () => {
    expect(await findDaemon({ env: {} })).toBeNull()
  })

  it('answers the daemon daemon.json names when it answers with the key', async () => {
    const key = readOrCreateKey()
    const daemon = await fakeDaemon(key)
    usePort(daemon.port)
    writeDaemonFile({ pid: process.pid, port: daemon.port, version: '1.2.3', startedAt: 1 })
    expect(await findDaemon({ env: {} })).toEqual({ port: daemon.port, key, pid: process.pid, version: '1.2.3' })
    expect(daemon.requests[0]?.key).toBe(key)
  })

  it('removes a daemon.json whose pid no longer exists', async () => {
    readOrCreateKey()
    usePort(await freePort())
    writeDaemonFile({ pid: await deadPid(), port: 1024, version: '1.2.3', startedAt: 1 })
    expect(await findDaemon({ env: {} })).toBeNull()
    expect(existsSync(daemonFilePath())).toBe(false)
  })

  it('removes a damaged daemon.json', async () => {
    readOrCreateKey()
    usePort(await freePort())
    writeFileSync(daemonFilePath(), '{ not json')
    expect(await findDaemon({ env: {} })).toBeNull()
    expect(existsSync(daemonFilePath())).toBe(false)
  })

  it('keeps the daemon.json of a live pid that does not answer, since it may be finishing its requests', async () => {
    readOrCreateKey()
    const port = await freePort()
    usePort(port)
    writeDaemonFile({ pid: process.pid, port, version: '1.2.3', startedAt: 1 })
    expect(await findDaemon({ env: {} })).toBeNull()
    expect(existsSync(daemonFilePath())).toBe(true)
  })

  it('finds a daemon on the configured port that has not written daemon.json yet', async () => {
    const key = readOrCreateKey()
    const daemon = await fakeDaemon(key)
    usePort(daemon.port)
    expect((await findDaemon({ env: {} }))?.port).toBe(daemon.port)
  })

  it('waits for a daemon that is slower than a few seconds to answer', async () => {
    const key = readOrCreateKey()
    const daemon = await fakeDaemon(key, {}, { statusDelayMs: 4_000 })
    writeDaemonFile({ pid: process.pid, port: daemon.port, version: '1.2.3', startedAt: 1 })
    usePort(daemon.port)
    expect((await findDaemon({ env: {} }))?.port).toBe(daemon.port)
  }, 20_000)

  it('does not take a server that refuses the key for a daemon', async () => {
    readOrCreateKey()
    const other = await fakeDaemon('0'.repeat(64))
    usePort(other.port)
    expect(await findDaemon({ env: {} })).toBeNull()
  })
})

describe('startDaemon', () => {
  it('uses a running daemon of the same version', async () => {
    const key = readOrCreateKey()
    const daemon = await fakeDaemon(key, { version: '1.2.3' })
    usePort(daemon.port)
    const result = await startDaemon({ env: {}, version: '1.2.3', entry: '/nonexistent/kurmis.cjs' })
    expect(result).toMatchObject({ started: false, replaced: null })
    expect(result.connection.version).toBe('1.2.3')
  })

  it('uses a running daemon of a newer version and never replaces it', async () => {
    const key = readOrCreateKey()
    const daemon = await fakeDaemon(key, { version: '2.0.0' })
    usePort(daemon.port)
    const result = await startDaemon({ env: {}, version: '1.2.3', entry: '/nonexistent/kurmis.cjs' })
    expect(result.started).toBe(false)
    expect(daemon.requests.some((request) => request.url === '/_kurmis/stop')).toBe(false)
  })

  it('says how to change the port when another program holds it', async () => {
    readOrCreateKey()
    const { server, port } = await listen((_request, response) => response.writeHead(404).end())
    servers.push(server)
    usePort(port)
    const failure = startDaemon({ env: {}, entry: '/nonexistent/kurmis.cjs' })
    await expect(failure).rejects.toThrow(DaemonError)
    await expect(failure).rejects.toThrow(/is in use by another program.*Set "port" in .*config\.json/)
  })

  it('refuses to start from the source tree without KURMIS_ENTRY', async () => {
    usePort(await freePort())
    await expect(startDaemon({ env: {} })).rejects.toThrow(/source tree.*KURMIS_ENTRY/)
  })

  it('does not stop a newer daemon on another port than config.json names', async () => {
    const key = readOrCreateKey()
    const daemon = await fakeDaemon(key, { version: '2.0.0' })
    writeDaemonFile({ pid: process.pid, port: daemon.port, version: '2.0.0', startedAt: 1 })
    const configured = await freePort()
    usePort(configured)
    const failure = startDaemon({ env: {}, version: '1.2.3', entry: '/nonexistent/kurmis.cjs' })
    await expect(failure).rejects.toThrow(DaemonError)
    const message = await failure.catch((error: unknown) => (error as Error).message)
    expect(message).toContain(`The kurmis daemon 2.0.0 runs on port ${String(daemon.port)}, but ${join(kurmisHome(), 'config.json')} ` +
      `names port ${String(configured)}. Its version is newer than this kurmis (1.2.3)`)
    expect(message).toContain('Update kurmis, or stop the daemon with "kurmis daemon stop"')
    expect(daemon.requests.some((request) => request.url === '/_kurmis/stop')).toBe(false)
  })

  it('says the running daemon no longer accepts the key file, with the pid and how to stop it', async () => {
    readOrCreateKey()
    const daemon = await fakeDaemon('1'.repeat(64))
    usePort(daemon.port)
    const pid = await lingeringPid()
    writeDaemonFile({ pid, port: daemon.port, version: '1.2.3', startedAt: 1 })
    const failure = startDaemon({ env: {}, version: '1.2.3', entry: '/nonexistent/kurmis.cjs' })
    const message = await failure.catch((error: unknown) => (error as Error).message)
    expect(message).toContain(`refused the key in ${keyPath()}, and daemon.json names pid ${String(pid)} on that port`)
    expect(message).toContain('its key no longer matches the key file')
    expect(message).toContain(`stop it with "kill ${String(pid)}"`)
    expect(processExists(pid)).toBe(true)
    // The same when the key file was deleted, and on Windows with taskkill.
    rmSync(keyPath())
    await expect(stopDaemon({ env: {}, platform: 'win32' })).rejects.toThrow(`stop it with "taskkill /PID ${String(pid)} /F"`)
    expect(await keyRefusedProblem({ env: {}, platform: 'linux' })).toContain(`"kill ${String(pid)}"`)
    expect(processExists(pid)).toBe(true)
  })

  it('says the stop failed, and starts nothing, when the daemon on the old port refuses to stop', async () => {
    const key = readOrCreateKey()
    const daemon = await fakeDaemon(key, { version: '1.0.0' }, { stopStatus: 500 })
    writeDaemonFile({ pid: process.pid, port: daemon.port, version: '1.0.0', startedAt: 1 })
    const configured = await freePort()
    usePort(configured)
    const failure = startDaemon({ env: {}, version: '1.2.3', entry: '/nonexistent/kurmis.cjs' })
    await expect(failure).rejects.toThrow(`The kurmis daemon 1.0.0 on port ${String(daemon.port)} (pid ${String(process.pid)}) could not ` +
      `be stopped to move it to port ${String(configured)}`)
    expect(daemon.requests.filter((request) => request.url === '/_kurmis/stop')).toHaveLength(1)
  })

  it('reports a config.json it cannot read as a DaemonError', async () => {
    writeFileSync(`${kurmisHome()}/config.json`, '{ "version": 1, "port": 80 }')
    await expect(startDaemon({ env: {} })).rejects.toThrow(DaemonError)
  })
})

describe('starting through launchd', () => {
  const securityDir = process.env.FAKE_SECURITY_DIR ?? ''
  const launchctlDir = process.env.FAKE_LAUNCHCTL_DIR ?? ''
  const ssh = { SSH_CONNECTION: '192.0.2.1 50000 192.0.2.2 22' }
  const launchctlCalls = (): string[] => {
    const file = join(launchctlDir, 'calls.jsonl')
    return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as string[])[0] ?? '') : []
  }
  const noBundle = (): string => join(kurmisHome(), 'no-such-bundle.cjs')

  beforeEach(() => {
    rmSync(launchctlDir, { recursive: true, force: true })
    mkdirSync(launchctlDir, { recursive: true })
    rmSync(join(securityDir, 'calls.jsonl'), { force: true })
  })

  afterEach(() => {
    rmSync(join(securityDir, 'mode'), { force: true })
  })

  it('reaches only the stand-ins when it is given an empty environment', async () => {
    // A test once called startDaemon({ env: {} }) this way, on a machine whose login Keychain
    // could not be read: the Keychain check ran the real security, and the start loaded a real
    // launchd job. test/setup.ts fails this test if the guard has to refuse a real program.
    usePort(await freePort())
    readOrCreateKey()
    writeFileSync(join(securityDir, 'mode'), 'locked')
    const warnings: string[] = []
    const failure = startDaemon({ env: {}, platform: 'darwin', entry: noBundle(), onWarning: (text) => warnings.push(text) })
    await expect(failure).rejects.toThrow(/exited at start/)
    expect(readFileSync(join(securityDir, 'calls.jsonl'), 'utf8')).toContain('show-keychain-info')
    // The launchctl stand-in ran; it fails here, since the empty environment names no folder for it.
    expect(warnings.join('\n')).toMatch(/could not be started through launchd .*fake launchctl: FAKE_LAUNCHCTL_DIR is not set/)
  }, 30_000)

  it('starts the daemon directly, and removes the job, when the job exits with an error', async () => {
    usePort(await freePort())
    readOrCreateKey()
    const warnings: string[] = []
    const failure = startDaemon({
      env: { ...process.env, ...ssh, FAKE_LAUNCHCTL_JOB_EXIT: '78' },
      platform: 'darwin',
      entry: noBundle(),
      // Only the exit code can end the wait early here.
      launchdAnswerTimeoutMs: 60_000,
      onWarning: (text) => warnings.push(text)
    })
    // The direct start runs node on a bundle that does not exist, which exits at once.
    await expect(failure).rejects.toThrow(/exited at start/)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('could not be started through launchd (its job exited with code 78, which launchd answers when it ' +
      'cannot start the program, for example one on an external volume)')
    expect(launchctlCalls()[0]).toBe('bootstrap')
    expect(launchctlCalls()).toContain('print')
    expect(launchctlCalls().at(-1)).toBe('bootout')
    expect(readdirSync(join(kurmisHome(), 'launchd')).filter((name) => name.endsWith('.plist'))).toEqual([])
  }, 30_000)

  it('starts the daemon directly when no daemon answers soon after the job is loaded', async () => {
    usePort(await freePort())
    readOrCreateKey()
    const warnings: string[] = []
    // The launchctl stand-in loads the job and runs nothing, like a job that hangs.
    const failure = startDaemon({ env: { ...process.env, ...ssh }, platform: 'darwin', entry: noBundle(), launchdAnswerTimeoutMs: 1_000,
      onWarning: (text) => warnings.push(text) })
    await expect(failure).rejects.toThrow(/exited at start/)
    expect(warnings[0]).toContain('could not be started through launchd (no daemon answered within 1 second of loading its job)')
    expect(launchctlCalls().at(-1)).toBe('bootout')
  }, 30_000)
})

describe('restartDaemon', () => {
  it('refuses to replace a newer daemon', async () => {
    const key = readOrCreateKey()
    const daemon = await fakeDaemon(key, { version: '9.0.0' })
    usePort(daemon.port)
    await expect(restartDaemon({ env: {}, version: '1.0.0', entry: '/nonexistent/kurmis.cjs' })).rejects.toThrow(/newer than this kurmis/)
    expect(daemon.requests.some((request) => request.url === '/_kurmis/stop')).toBe(false)
  })
})

describe('stopDaemon', () => {
  it('tells the daemon how long to wait for its open requests, and on Windows waits a grace period before it ends the process', async () => {
    const key = readOrCreateKey()
    const pid = await lingeringPid()
    const daemon = await fakeDaemon(key, { pid })
    usePort(daemon.port)
    const startedAt = Date.now()
    const stopping = stopDaemon({ env: {}, platform: 'win32', stopTimeoutMs: 300, stopGraceMs: 1_500 })
    await new Promise((resolve) => setTimeout(resolve, 900))
    // Past the deadline but within the grace period: not ended yet.
    expect(processExists(pid)).toBe(true)
    expect(await stopping).toBe(true)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_700)
    expect(processExists(pid)).toBe(false)
    const stop = daemon.requests.find((request) => request.url === '/_kurmis/stop')
    expect(JSON.parse(stop?.body ?? '')).toEqual({ maxWaitMs: 300 })
  })

  it('sends SIGTERM at the deadline on macOS and Linux', async () => {
    const key = readOrCreateKey()
    const pid = await lingeringPid()
    const daemon = await fakeDaemon(key, { pid })
    usePort(daemon.port)
    expect(await stopDaemon({ env: {}, platform: 'linux', stopTimeoutMs: 200, stopGraceMs: 60_000 })).toBe(true)
    expect(processExists(pid)).toBe(false)
  })
})

describe('control requests', () => {
  it('reads the status, asks for a probe with the logins, and asks for a reload', async () => {
    const key = readOrCreateKey()
    const daemon = await fakeDaemon(key)
    const connection = { port: daemon.port, key, pid: process.pid, version: '1.2.3' }
    expect((await readStatus(connection)).port).toBe(daemon.port)
    expect((await requestProbe(connection, ['claude:work'])).ok).toBe(true)
    await requestReload(connection)
    expect(daemon.requests.map((request) => `${request.method} ${request.url}`))
      .toEqual(['GET /_kurmis/status', 'POST /_kurmis/probe', 'POST /_kurmis/reload'])
    expect(JSON.parse(daemon.requests[1]?.body ?? '')).toEqual({ logins: ['claude:work'] })
  })

  it('turns a refused key and a stopped daemon into sentences', async () => {
    const key = readOrCreateKey()
    const daemon = await fakeDaemon('1'.repeat(64))
    await expect(readStatus({ port: daemon.port, key, pid: 1, version: '1' })).rejects.toThrow(/did not accept the key/)
    const port = await freePort()
    await expect(readStatus({ port, key, pid: 1, version: '1' })).rejects.toThrow(/not running/)
  })
})

describe('chooseStartMethod', () => {
  const readable = (value: boolean) => () => Promise.resolve(value)

  it('goes through launchd on macOS from ssh or where the Keychain cannot be read', async () => {
    expect(await chooseStartMethod({ platform: 'darwin', env: { SSH_CONNECTION: 'x' }, noLaunchd: false, keychainReadable: readable(true) })).toBe('launchd')
    expect(await chooseStartMethod({ platform: 'darwin', env: {}, noLaunchd: false, keychainReadable: readable(false) })).toBe('launchd')
    expect(await chooseStartMethod({ platform: 'darwin', env: {}, noLaunchd: false, keychainReadable: readable(true) })).toBe('direct')
    expect(await chooseStartMethod({ platform: 'darwin', env: { SSH_TTY: 'x' }, noLaunchd: true, keychainReadable: readable(false) })).toBe('direct')
  })

  it('goes through WMI on Windows from ssh only', async () => {
    expect(await chooseStartMethod({ platform: 'win32', env: { SSH_CLIENT: 'x' }, noLaunchd: false, keychainReadable: readable(false) })).toBe('wmi')
    expect(await chooseStartMethod({ platform: 'win32', env: {}, noLaunchd: false, keychainReadable: readable(false) })).toBe('direct')
    expect(await chooseStartMethod({ platform: 'linux', env: { SSH_CLIENT: 'x' }, noLaunchd: false, keychainReadable: readable(false) })).toBe('direct')
  })
})

describe('daemonEnvironment', () => {
  it('drops what a routed session put in the environment', () => {
    expect(daemonEnvironment({
      PATH: '/usr/bin',
      KURMIS_HOME: '/tmp/example',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
      ANTHROPIC_CUSTOM_HEADERS: 'x-kurmis-key: abc',
      ANTHROPIC_API_KEY: 'example',
      ANTHROPIC_AUTH_TOKEN: 'example',
      CLAUDE_SECURESTORAGE_CONFIG_DIR: '/tmp/example/claude/work'
    }, {})).toEqual({ PATH: '/usr/bin', KURMIS_HOME: '/tmp/example' })
  })

  it("adds this process's stand-ins and guard when the environment it is given has none", () => {
    expect(daemonEnvironment({ PATH: '/usr/bin' })).toMatchObject({
      KURMIS_SECURITY_PROGRAM: process.env.KURMIS_SECURITY_PROGRAM,
      KURMIS_LAUNCHCTL_PROGRAM: process.env.KURMIS_LAUNCHCTL_PROGRAM,
      KURMIS_REFUSE_SYSTEM_PROGRAMS: '1'
    })
  })

  it('makes a relative KURMIS_HOME absolute, since the daemon runs in the home folder', () => {
    const env = daemonEnvironment({ KURMIS_HOME: join('relative', 'data') })
    expect(isAbsolute(env.KURMIS_HOME ?? '')).toBe(true)
    expect(env.KURMIS_HOME).toBe(resolve('relative', 'data'))
  })
})

describe('wmiDaemonArguments', () => {
  it('puts the kurmis variables on the command line, KURMIS_HOME as an absolute Windows path', () => {
    expect(wmiDaemonArguments('C:\\Program Files\\nodejs\\node.exe', 'C:\\kurmis\\kurmis.cjs', {
      KURMIS_HOME: 'D:\\kurmis data', KURMIS_CLAUDE_BIN: 'C:\\c.exe', ANTHROPIC_API_KEY: 'sk-ant-api03-fake', Path: 'C:\\Windows'
    }, {})).toEqual(['C:\\Program Files\\nodejs\\node.exe', 'C:\\kurmis\\kurmis.cjs', 'daemon', 'run',
      '--env', 'KURMIS_HOME=D:\\kurmis data', '--env', 'KURMIS_CLAUDE_BIN=C:\\c.exe'])
    const relative = wmiDaemonArguments('node.exe', 'kurmis.cjs', { KURMIS_HOME: 'data' }, {})
    const home = relative[5]?.slice('KURMIS_HOME='.length) ?? ''
    expect(win32.isAbsolute(home)).toBe(true)
    expect(home.endsWith('\\data')).toBe(true)
  })
})
