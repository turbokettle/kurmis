// The daemon's lifecycle, run in this process around the fake request handling. Signals are
// faked with an EventEmitter; no signal is sent to the test process.
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Agent, createServer, request, type Server } from 'node:http'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CONTROL_API_VERSION, CONTROL_PATHS, type StatusAnswer } from '../../src/core/control-api.ts'
import { KEY_HEADER } from '../../src/core/route-headers.ts'
import { readDaemonFile, readOrCreateKey } from '../../src/data/daemon-file.ts'
import { runDaemon, type RunDaemonOptions } from '../../src/daemon/main.ts'
import { controlRequest, type ControlResult } from '../../src/daemon/lifecycle.ts'
import { fakeAppFactory, HOLD_PATH, type FakeAppBehaviour } from './fake-app.ts'
import { collector, dataFolderWithPort, freePort, waitUntil, type Collector } from './helpers.ts'

interface Running {
  events: EventEmitter
  stdout: Collector
  stderr: Collector
  factory: ReturnType<typeof fakeAppFactory>
  exit: Promise<number>
  exited: boolean
}

const savedHome = process.env.KURMIS_HOME
let home = ''
let port = 0
let running: Running[] = []

beforeEach(async () => {
  port = await freePort()
  home = dataFolderWithPort(port)
  process.env.KURMIS_HOME = home
})

afterEach(async () => {
  // Two signals end any daemon a test left running without waiting for its drain.
  for (const daemon of running) {
    if (daemon.exited) continue
    daemon.events.emit('SIGTERM')
    daemon.events.emit('SIGTERM')
    await daemon.exit
  }
  running = []
  process.env.KURMIS_HOME = savedHome
})

function start(options: Partial<RunDaemonOptions> & { behaviour?: FakeAppBehaviour } = {}): Running {
  const events = new EventEmitter()
  const stdout = collector()
  const stderr = collector()
  const factory = fakeAppFactory(options.behaviour)
  const daemon: Running = {
    events, stdout, stderr, factory, exited: false,
    exit: runDaemon({ env: process.env, stdout, stderr, processEvents: events, createApp: factory.createApp, ...options })
  }
  void daemon.exit.finally(() => {
    daemon.exited = true
  })
  running.push(daemon)
  return daemon
}

/** Starts a daemon and waits until daemon.json names it and its app has started. */
async function startListening(options: Parameters<typeof start>[0] = {}): Promise<Running> {
  const daemon = start(options)
  await waitUntil(() => {
    const read = readDaemonFile()
    return read.status === 'ok' && read.info.port === port
  }, 5_000, 'daemon.json')
  return daemon
}

function key(): string {
  return readOrCreateKey()
}

function status(): Promise<ControlResult> {
  return controlRequest({ port, key: key(), method: 'GET', path: CONTROL_PATHS.status })
}

function hold(ms: number): Promise<ControlResult> {
  return controlRequest({ port, key: key(), method: 'GET', path: `${HOLD_PATH}?ms=${String(ms)}`, timeoutMs: 30_000 })
}

function logText(): string {
  const path = join(home, 'daemon.log')
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/** Whether a new server can listen on the port now. */
function portIsFree(): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise((resolve) => server.close(() => resolve()))
}

describe('runDaemon', () => {
  it('listens, writes daemon.json and answers a keyed status', async () => {
    const daemon = await startListening()
    const read = readDaemonFile()
    expect(read.status === 'ok' && read.info).toMatchObject({ pid: process.pid, port, version: 'dev' })
    const answer = await status()
    expect(answer.kind === 'answered' && answer.status).toBe(200)
    const body = (answer as { body: StatusAnswer }).body
    expect(body).toMatchObject({ ok: true, apiVersion: CONTROL_API_VERSION, version: 'dev', pid: process.pid, port })
    expect(daemon.factory.apps[0]?.calls.start).toBe(1)
    expect(daemon.factory.apps[0]?.options).toMatchObject({ port, pid: process.pid, key: key() })
    expect(daemon.stdout.text()).toContain(`kurmis daemon dev runs on 127.0.0.1:${String(port)} (pid ${String(process.pid)})`)
    expect(logText()).toMatch(new RegExp(`daemon_started pid=${String(process.pid)} port=${String(port)}`))
  })

  it('stops on a control stop: drains, closes the app, removes daemon.json and exits 0', async () => {
    const daemon = await startListening()
    const answer = await controlRequest({ port, key: key(), method: 'POST', path: CONTROL_PATHS.stop })
    expect(answer).toMatchObject({ kind: 'answered', status: 200, body: { ok: true } })
    expect(await daemon.exit).toBe(0)
    expect(readDaemonFile().status).toBe('missing')
    expect(daemon.factory.apps[0]?.calls.close).toBe(1)
    expect(await portIsFree()).toBe(true)
    expect(logText()).toMatch(/daemon_stopping reason=shutdown/)
    expect(logText()).toMatch(/daemon_stopped pid=\d+ ok=true/)
  })

  it('waits for an open request after a signal, with the port free during the drain', async () => {
    const daemon = await startListening()
    const open = hold(800)
    await waitUntil(() => daemon.factory.apps[0]?.openRequests() === 1, 2_000, 'the open request')
    daemon.events.emit('SIGTERM')
    await waitUntil(portIsFree, 2_000, 'the port to be free')
    expect(daemon.exited).toBe(false)
    expect(readDaemonFile().status).toBe('ok')
    expect(await open).toMatchObject({ kind: 'answered', status: 200, body: { ok: true, pid: process.pid } })
    expect(await daemon.exit).toBe(0)
    expect(readDaemonFile().status).toBe('missing')
    expect(logText()).toMatch(/daemon_stopping reason=signal/)
    expect(logText()).not.toMatch(/drain_cut_short/)
  })

  it('cuts the drain at the cap and logs how many requests were open', async () => {
    const daemon = await startListening({ drainCapMs: 200 })
    const open = hold(10_000)
    await waitUntil(() => daemon.factory.apps[0]?.openRequests() === 1, 2_000, 'the open request')
    const stoppedAt = Date.now()
    daemon.events.emit('SIGINT')
    expect(await daemon.exit).toBe(0)
    expect(Date.now() - stoppedAt).toBeLessThan(3_000)
    expect((await open).kind).toBe('failed')
    expect(logText()).toMatch(/drain_cut_short count=1 reason=timeout/)
    expect(readDaemonFile().status).toBe('missing')
  })

  it('skips the rest of the drain on a second signal', async () => {
    const daemon = await startListening()
    const open = hold(10_000)
    await waitUntil(() => daemon.factory.apps[0]?.openRequests() === 1, 2_000, 'the open request')
    daemon.events.emit('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(daemon.exited).toBe(false)
    daemon.events.emit('SIGHUP')
    expect(await daemon.exit).toBe(0)
    expect((await open).kind).toBe('failed')
    expect(logText()).toMatch(/drain_cut_short count=1 reason=signal/)
  })

  it('closes idle keep-alive connections when it stops', async () => {
    const daemon = await startListening()
    const agent = new Agent({ keepAlive: true })
    const closed = new Promise<void>((resolve) => {
      const outgoing = request({ host: '127.0.0.1', port, path: '/api/hello', agent }, (incoming) => {
        incoming.resume()
        incoming.on('end', () => {
          daemon.events.emit('SIGTERM')
        })
      })
      outgoing.on('socket', (socket) => socket.once('close', () => resolve()))
      outgoing.end()
    })
    await closed
    expect(await daemon.exit).toBe(0)
    agent.destroy()
  })

  it('answers requests that arrive while the app starts once it has started', async () => {
    const daemon = start({ behaviour: { startDelayMs: 300 } })
    await waitUntil(() => readDaemonFile().status === 'ok', 5_000, 'daemon.json')
    const startedAt = Date.now()
    const answer = await status()
    expect(answer.kind === 'answered' && answer.status).toBe(200)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150)
    expect(daemon.factory.apps[0]?.calls.start).toBe(1)
  })

  it('exits 1 without daemon.json when the app fails to start', async () => {
    const daemon = start({ behaviour: { startError: new Error('state could not be read'), startDelayMs: 100 } })
    await waitUntil(() => readDaemonFile().status === 'ok', 5_000, 'daemon.json')
    const answer = await status()
    expect(answer.kind === 'answered' && answer.status).toBe(503)
    expect(await daemon.exit).toBe(1)
    expect(readDaemonFile().status).toBe('missing')
    expect(daemon.factory.apps[0]?.calls.close).toBe(0)
    expect(daemon.stderr.text()).toContain('could not start its request handling')
    expect(logText()).toMatch(/internal_error code=other/)
    expect(await portIsFree()).toBe(true)
  })

  it('exits 1 on an uncaught error, logs only its code and leaves no daemon.json', async () => {
    const daemon = await startListening()
    const open = hold(10_000)
    await waitUntil(() => daemon.factory.apps[0]?.openRequests() === 1, 2_000, 'the open request')
    daemon.events.emit('uncaughtException', Object.assign(new Error('secret-looking text sk-ant-example'), { code: 'ECONNRESET' }))
    expect(await daemon.exit).toBe(1)
    expect((await open).kind).toBe('failed')
    expect(readDaemonFile().status).toBe('missing')
    const text = logText()
    expect(text).toMatch(/internal_error code=ECONNRESET/)
    expect(text).toMatch(/daemon_stopping reason=error/)
    expect(text).toMatch(/daemon_stopped pid=\d+ ok=false/)
    expect(text).not.toContain('secret-looking')
    expect(await portIsFree()).toBe(true)
  })

  it('exits 1 on an unhandled rejection during the drain', async () => {
    const daemon = await startListening()
    void hold(10_000)
    await waitUntil(() => daemon.factory.apps[0]?.openRequests() === 1, 2_000, 'the open request')
    daemon.events.emit('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 50))
    daemon.events.emit('unhandledRejection', new Error('x'))
    expect(await daemon.exit).toBe(1)
    expect(readDaemonFile().status).toBe('missing')
  })

  it('removes its signal and error listeners when it is done', async () => {
    const daemon = await startListening()
    expect(daemon.events.listenerCount('SIGTERM')).toBe(1)
    expect(daemon.events.listenerCount('uncaughtException')).toBe(1)
    daemon.events.emit('SIGTERM')
    await daemon.exit
    for (const event of ['SIGTERM', 'SIGINT', 'SIGHUP', 'uncaughtException', 'unhandledRejection']) {
      expect(daemon.events.listenerCount(event)).toBe(0)
    }
  })

  it('exits 1 with a message naming config.json when another program holds the port', async () => {
    const other = createServer((_request, response) => {
      response.writeHead(404)
      response.end()
    })
    await listen(other)
    try {
      const daemon = start()
      expect(await daemon.exit).toBe(1)
      expect(daemon.stderr.text()).toContain(`port ${String(port)} on 127.0.0.1 is used by another program`)
      expect(daemon.stderr.text()).toContain(`"port" in ${join(home, 'config.json')} to a number from 1024 to 65535`)
      expect(readDaemonFile().status).toBe('missing')
      expect(daemon.factory.apps[0]?.calls.start).toBe(0)
      expect(logText()).toMatch(new RegExp(`port_in_use port=${String(port)}`))
    } finally {
      await closeServer(other)
    }
  })

  it('exits 0 and leaves the daemon alone when one of the same version holds the port', async () => {
    const first = await startListening()
    const second = start()
    expect(await second.exit).toBe(0)
    expect(second.stdout.text()).toContain(`kurmis daemon dev already runs on port ${String(port)} (pid ${String(process.pid)})`)
    expect(second.factory.apps[0]?.calls.start).toBe(0)
    expect(first.exited).toBe(false)
    expect(readDaemonFile().status).toBe('ok')
    expect((await status()).kind).toBe('answered')
  })

  it('exits 0 when a newer daemon holds the port', async () => {
    const first = await startListening({ version: '0.2.0', behaviour: { version: '0.2.0' } })
    const second = start({ version: '0.1.0' })
    expect(await second.exit).toBe(0)
    expect(second.stdout.text()).toContain('kurmis daemon 0.2.0 already runs')
    expect(first.exited).toBe(false)
  })

  it('replaces an older daemon: the old one drains while the new one takes the port', async () => {
    const old = await startListening({ version: '0.1.0', behaviour: { version: '0.1.0' } })
    const open = hold(1_000)
    await waitUntil(() => old.factory.apps[0]?.openRequests() === 1, 2_000, 'the open request')
    const replacement = start({ version: '0.2.0', behaviour: { version: '0.2.0' } })
    await waitUntil(async () => {
      const answer = await status()
      return answer.kind === 'answered' && (answer.body as StatusAnswer | null)?.version === '0.2.0'
    }, 5_000, 'the new daemon to answer')
    expect(old.exited).toBe(false)
    expect(await open).toMatchObject({ kind: 'answered', status: 200 })
    expect(await old.exit).toBe(0)
    expect(replacement.exited).toBe(false)
    // Both ran in this process, so daemon.json names the same pid; the new one wrote it last,
    // and the old one removed it when it stopped. A test with two processes checks the pids.
    expect(replacement.stdout.text()).toContain('Replacing kurmis daemon 0.1.0')
    expect(logText()).toMatch(/daemon_replacing_older pid=\d+ port=\d+/)
  })

  it('gives up when an older daemon does not free the port', async () => {
    const fakeKey = key()
    const stubborn = createServer((incoming, response) => {
      incoming.resume()
      if (incoming.headers[KEY_HEADER] !== fakeKey) {
        response.writeHead(403)
        response.end()
        return
      }
      const body: StatusAnswer | { ok: true } = incoming.url === CONTROL_PATHS.status
        ? { ok: true, apiVersion: CONTROL_API_VERSION, version: '0.1.0', pid: 4242, port, startedAt: 1, logins: [] }
        : { ok: true }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    })
    await listen(stubborn)
    try {
      const daemon = start({ version: '0.2.0', bindDeadlineMs: 400 })
      expect(await daemon.exit).toBe(1)
      expect(daemon.stderr.text()).toContain(`did not give up port ${String(port)}`)
      expect(daemon.factory.apps[0]?.calls.start).toBe(0)
    } finally {
      await closeServer(stubborn)
    }
  })

  it('exits 1 with the message when config.json is wrong', async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ version: 1, port: 80 }))
    const daemon = start()
    expect(await daemon.exit).toBe(1)
    expect(daemon.stderr.text()).toMatch(/port/)
    expect(daemon.factory.apps).toHaveLength(0)
    expect(logText()).toMatch(/config_invalid reason=invalid/)
  })

  it('exits 1 when the app cannot be created', async () => {
    const stderr = collector()
    const exit = await runDaemon({
      env: process.env, stderr, processEvents: new EventEmitter(),
      createApp: () => {
        throw new Error('not implemented')
      }
    })
    expect(exit).toBe(1)
    expect(stderr.text()).toContain('could not set up its request handling')
    expect(await portIsFree()).toBe(true)
  })

  it('stops at once when a signal comes before the port is bound', async () => {
    const events = new EventEmitter()
    const factory = fakeAppFactory({ startDelayMs: 1_000 })
    const exit = runDaemon({ env: process.env, processEvents: events, createApp: factory.createApp })
    events.emit('SIGTERM')
    expect(await exit).toBe(0)
    expect(readDaemonFile().status).toBe('missing')
    expect(factory.apps[0]?.calls.start ?? 0).toBe(0)
  })
})
