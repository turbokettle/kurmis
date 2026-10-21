// The daemon client against an in-process HTTP server standing in for the daemon. Starting real
// daemon processes is tested in `daemon-lifecycle.test.ts`.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONTROL_API_VERSION, type StatusAnswer } from '../../src/core/control-api.ts'
import { saveConfig, defaultConfig } from '../../src/data/config.ts'
import { readOrCreateKey, writeDaemonFile } from '../../src/data/daemon-file.ts'
import { daemonFilePath, kurmisHome } from '../../src/data/paths.ts'
import {
  chooseStartMethod,
  daemonEnvironment,
  DaemonError,
  findDaemon,
  readStatus,
  requestProbe,
  requestReload,
  restartDaemon,
  startDaemon
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

/** A server that answers the control API like a daemon of `version` would, with the right key. */
async function fakeDaemon(key: string, patch: Partial<StatusAnswer> = {}): Promise<FakeDaemon> {
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
    if (request.url === '/_kurmis/status' || request.url === '/_kurmis/probe') json(status(port, patch))
    else if (request.url === '/_kurmis/reload' || request.url === '/_kurmis/stop') json({ ok: true })
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

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  servers = []
})

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

  it('reports a config.json it cannot read as a DaemonError', async () => {
    writeFileSync(`${kurmisHome()}/config.json`, '{ "version": 1, "port": 80 }')
    await expect(startDaemon({ env: {} })).rejects.toThrow(DaemonError)
  })
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
    })).toEqual({ PATH: '/usr/bin', KURMIS_HOME: '/tmp/example' })
  })
})
