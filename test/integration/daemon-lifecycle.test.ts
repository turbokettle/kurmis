// `kurmis daemon start|status|stop|restart` and the version handover, end to end: the real bundle
// starts the real daemon, and the open requests the daemon has to finish are real
// `kurmis claude -p` runs whose answers the fake Anthropic API holds back until the test lets them
// go (`reply.ok({ hold })`). test/cli/daemon-lifecycle.test.ts covers the same commands around a
// fake request handler; this file covers what needs the real one: the drain of a proxied request,
// the handover under a running `claude -p`, `state.json` across a restart, and a port change.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTROL_API_VERSION } from '../../src/core/control-api.ts'
import { portAcceptsConnections, processExists } from '../../src/daemon/lifecycle.ts'
import { buildTestBundle } from '../daemon/bundle.ts'
import { freePort } from '../daemon/helpers.ts'
import { fakeToken, reply, writeClaudeScenario, type RecordedRequest } from '../fakes/index.ts'
import { createWorld, OWN_CLAUDE, PACKAGE_VERSION, waitUntil, type KurmisResult, type World } from './harness.ts'

/** A version older than every real one, for a daemon the current kurmis replaces. */
const OLDER_VERSION = '0.0.9'
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** For things that should happen; the machine may be loaded. */
const GENEROUS_MS = 30_000

const SESSION_A = '0b7c0a52-1111-4222-8333-94444555aaaa'
const SESSION_B = '0b7c0a52-1111-4222-8333-94444555bbbb'
const SESSION_C = '0b7c0a52-1111-4222-8333-94444555cccc'

/** A promise the test resolves itself, for `reply.ok({ hold })`. */
function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/** A run that is still going, and whether it has ended yet. */
function track(run: Promise<KurmisResult>): { promise: Promise<KurmisResult>; settled: () => boolean } {
  let settled = false
  const promise = run.finally(() => {
    settled = true
  })
  return { promise, settled: () => settled }
}

function daemonOf(world: World): { pid: number; port: number; version: string } {
  const info = world.daemonInfo()
  if (info === null) throw new Error('daemon.json is missing')
  return info
}

function messageRequests(world: World): RecordedRequest[] {
  return world.api.apiRequests().filter((request) => request.path.startsWith('/v1/messages'))
}

function expectNoKurmisHeaders(world: World): void {
  for (const request of world.api.requests) {
    expect(Object.keys(request.headers).filter((name) => name.startsWith('x-kurmis'))).toEqual([])
  }
}

function logEvents(world: World, event: string): string[] {
  const path = join(world.data, 'daemon.log')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.split(' ')[1] === event)
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('the kurmis daemon, end to end', () => {
  it('starts, connects a second start to the first, and stops only once its open request has finished', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    const port = String(world.port)

    const started = await world.kurmis(['daemon', 'start'])
    expect(started).toMatchObject({ code: 0, stderr: '' })
    const { pid } = daemonOf(world)
    expect(daemonOf(world)).toMatchObject({ port: world.port, version: PACKAGE_VERSION })
    expect(started.stdout).toBe(`Started the kurmis daemon ${PACKAGE_VERSION} on 127.0.0.1:${port} (pid ${String(pid)}).\n`)

    const again = await world.kurmis(['daemon', 'start'])
    expect(again).toMatchObject({ code: 0, stdout: `The kurmis daemon ${PACKAGE_VERSION} already runs on 127.0.0.1:${port} (pid ${String(pid)}).\n` })
    expect(daemonOf(world).pid).toBe(pid)

    const status = await world.kurmis(['daemon', 'status'])
    expect(status.code).toBe(0)
    expect(status.stdout).toMatch(new RegExp(`^The kurmis daemon ${escaped(PACKAGE_VERSION)} runs on 127\\.0\\.0\\.1:${port}, ` +
      `pid ${String(pid)}, since \\d{4}-\\d\\d-\\d\\dT[\\d:.]+Z, with 2 logins\\.\\n$`))

    const answer = gate()
    world.api.script(reply.ok({ text: 'Answered while the daemon stops', hold: answer.promise }))
    const open = track(world.kurmis(['claude', '--', '-p', 'hi']))
    try {
      await world.api.waitForRequests(1, GENEROUS_MS)
      const stop = track(world.kurmis(['daemon', 'stop']))
      // The daemon stops accepting at once, then waits for the request it has open.
      await waitUntil(async () => !(await portAcceptsConnections(world.port)), GENEROUS_MS, 'the daemon to free its port')
      const draining = await world.kurmis(['daemon', 'status'])
      expect(draining.code).toBe(1)
      expect(draining.stdout).toBe('The kurmis daemon is not running.\n' +
        `Process ${String(pid)}, named in daemon.json, does not answer on 127.0.0.1:${port}. ` +
        'It may be finishing its open requests before it stops.\n')
      expect(stop.settled()).toBe(false)
      expect(open.settled()).toBe(false)
      expect(processExists(pid)).toBe(true)

      answer.release()
      expect(await open.promise).toMatchObject({ code: 0, stdout: 'Answered while the daemon stops\n' })
      expect(await stop.promise).toMatchObject({ code: 0, stdout: `Stopped the kurmis daemon (pid ${String(pid)}).\n`, stderr: '' })
    } finally {
      answer.release()
    }
    expect(processExists(pid)).toBe(false)
    expect(world.daemonInfo()).toBeNull()
    expect(existsSync(join(world.data, 'state.json'))).toBe(true)
    expect(logEvents(world, 'drain_cut_short')).toEqual([])
    expect(await world.kurmis(['daemon', 'status'])).toMatchObject({ code: 1, stdout: 'The kurmis daemon is not running.\n' })
    expect(await world.kurmis(['daemon', 'stop'])).toMatchObject({ code: 0, stdout: 'The kurmis daemon is not running.\n' })
    expect(messageRequests(world).map((request) => request.bearer)).toEqual([fakeToken('default')])
    expectNoKurmisHeaders(world)
  }, 120_000)

  it('ends with one daemon when two kurmis claude runs start one at the same moment', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    const [first, second] = await Promise.all([
      world.kurmis(['claude', '--', '-p', 'one']),
      world.kurmis(['claude', '--', '-p', 'two'])
    ])
    expect(first).toMatchObject({ code: 0, stdout: 'Hello from the fake API.\n' })
    expect(second).toMatchObject({ code: 0, stdout: 'Hello from the fake API.\n' })
    const { pid } = daemonOf(world)
    expect(logEvents(world, 'daemon_started')).toHaveLength(1)
    expect(logEvents(world, 'daemon_started')[0]).toContain(`pid=${String(pid)}`)
    expect(messageRequests(world)).toHaveLength(2)
  }, 120_000)

  it('lets a newer kurmis claude replace an older daemon, which finishes its open request first', async () => {
    const older = await buildTestBundle({ version: OLDER_VERSION, entry: 'real' })
    const world = await createWorld()
    world.signInDefaultClaude()
    expect((await world.kurmis(['daemon', 'start'], { bundle: older })).stdout).toContain(`Started the kurmis daemon ${OLDER_VERSION} on`)
    const old = daemonOf(world)
    expect(old.version).toBe(OLDER_VERSION)

    const status = await world.kurmis(['daemon', 'status'])
    expect(status.code).toBe(0)
    expect(status.stdout).toContain(`The kurmis daemon ${OLDER_VERSION} runs on`)
    expect(status.stdout).toContain(`this kurmis is ${PACKAGE_VERSION} with control API version ${String(CONTROL_API_VERSION)}. The daemon is ` +
      'older, so the next "kurmis claude", "kurmis codex", "kurmis setup" or "kurmis daemon start" replaces it.')
    // `daemon status` only looks.
    expect(daemonOf(world).pid).toBe(old.pid)

    const answer = gate()
    world.api.script(reply.ok({ text: 'From the older daemon', hold: answer.promise }))
    world.api.setDefault(reply.ok({ text: 'From the newer daemon' }))
    const first = track(world.kurmis(['claude', '--', '-p', 'first', '--session-id', SESSION_A], { bundle: older }))
    try {
      await world.api.waitForRequests(1, GENEROUS_MS)
      const second = await world.kurmis(['claude', '--', '-p', 'second', '--session-id', SESSION_B])
      expect(second).toMatchObject({ code: 0, stdout: 'From the newer daemon\n' })
      const now = daemonOf(world)
      expect(now).toMatchObject({ version: PACKAGE_VERSION, port: world.port })
      expect(now.pid).not.toBe(old.pid)
      // The older daemon still holds the first request.
      expect(first.settled()).toBe(false)
      expect(processExists(old.pid)).toBe(true)

      answer.release()
      expect(await first.promise).toMatchObject({ code: 0, stdout: 'From the older daemon\n' })
      await waitUntil(() => !processExists(old.pid), GENEROUS_MS, 'the older daemon to exit')
      expect(daemonOf(world).pid).toBe(now.pid)
      expect(logEvents(world, 'daemon_replacing_older')).toEqual([expect.stringContaining(`pid=${String(old.pid)}`)])
      expect(logEvents(world, 'drain_cut_short')).toEqual([])

      // An older kurmis uses the newer daemon and leaves it running.
      const third = await world.kurmis(['claude', '--', '-p', 'third'], { bundle: older })
      expect(third).toMatchObject({ code: 0, stdout: 'From the newer daemon\n' })
      expect(daemonOf(world).pid).toBe(now.pid)

      // The older daemon wrote state.json when it exited, after the newer one had read it. The
      // newer one's own sessions must still be there once it stops.
      expect((await world.kurmis(['daemon', 'stop'])).code).toBe(0)
      const state = JSON.parse(readFileSync(join(world.data, 'state.json'), 'utf8')) as { sessions: Record<string, { login: string }> }
      expect(state.sessions[SESSION_B]).toMatchObject({ login: OWN_CLAUDE })
    } finally {
      answer.release()
    }
    expect(messageRequests(world).map((request) => request.bearer)).toEqual([fakeToken('default'), fakeToken('default'), fakeToken('default')])
    expectNoKurmisHeaders(world)
  }, 120_000)

  it('restarts at once while the old daemon finishes its open request in the background', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    expect((await world.kurmis(['daemon', 'start'])).code).toBe(0)
    const before = daemonOf(world)

    const answer = gate()
    world.api.script(reply.ok({ text: 'From the old daemon', hold: answer.promise }))
    world.api.setDefault(reply.ok({ text: 'From the new daemon' }))
    const open = track(world.kurmis(['claude', '--', '-p', 'first']))
    try {
      await world.api.waitForRequests(1, GENEROUS_MS)
      const restarted = await world.kurmis(['daemon', 'restart'])
      const after = daemonOf(world)
      expect(after.pid).not.toBe(before.pid)
      expect(restarted).toMatchObject({
        code: 0,
        stderr: '',
        stdout: `Started the kurmis daemon ${PACKAGE_VERSION} on 127.0.0.1:${String(world.port)} (pid ${String(after.pid)}), ` +
          `replacing version ${PACKAGE_VERSION}, which stops once its open requests finish.\n`
      })
      expect(open.settled()).toBe(false)
      expect(processExists(before.pid)).toBe(true)
      expect(await world.kurmis(['claude', '--', '-p', 'second'])).toMatchObject({ code: 0, stdout: 'From the new daemon\n' })

      answer.release()
      expect(await open.promise).toMatchObject({ code: 0, stdout: 'From the old daemon\n' })
      await waitUntil(() => !processExists(before.pid), GENEROUS_MS, 'the old daemon to exit')
      expect(daemonOf(world).pid).toBe(after.pid)
    } finally {
      answer.release()
    }
  }, 120_000)

  it('keeps session placements and cooldowns in state.json across a restart', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    const work = await world.addClaudeLogin('work@example.com')
    // A new session goes to the login whose week resets first: the login plain claude uses.
    const soon = new Date(Date.now() + DAY_MS).toISOString()
    const late = new Date(Date.now() + 5 * DAY_MS).toISOString()
    writeClaudeScenario(join(world.home, '.claude'), { sevenDay: { utilization: 10, resetsAt: soon } })
    writeClaudeScenario(work.folder, { sevenDay: { utilization: 10, resetsAt: late } })
    // No rate-limit headers, so the answers do not change the usage the probes read.
    world.api.setDefault((request) => reply.ok({ text: `served by ${request.bearer === work.token ? 'work' : 'default'}`, unified: null }))
    const ask = async (session: string): Promise<string> => {
      const result = await world.kurmis(['claude', '--', '-p', 'hi', '--session-id', session])
      expect(result.code, JSON.stringify(result)).toBe(0)
      return result.stdout.trim()
    }

    expect((await world.kurmis(['set', 'work-example', '--use-first', 'on'])).code).toBe(0)
    expect(await ask(SESSION_A)).toBe('served by work')
    expect((await world.kurmis(['set', 'work-example', '--use-first', 'off'])).code).toBe(0)
    await waitUntil(async () => (await world.status()).logins.every((login) => login.provider !== 'claude' || login.usage !== null),
      GENEROUS_MS, 'both Claude logins to be probed')
    expect((await world.kurmis(['daemon', 'restart'])).code).toBe(0)

    // Session A stays on the login it was placed on before the restart; a new one goes to the
    // login the ranking puts first.
    expect(await ask(SESSION_A)).toBe('served by work')
    expect(await ask(SESSION_C)).toBe('served by default')

    const resetsAt = Date.now() + 2 * HOUR_MS
    world.api.scriptFor(fakeToken('default'), reply.quota({ claim: 'five_hour', resetsAt }))
    // From now on the probes of the login plain claude uses agree with the 429.
    writeClaudeScenario(join(world.home, '.claude'), { fiveHour: { utilization: 100, resetsAt: new Date(resetsAt).toISOString() }, sevenDay: { utilization: 10, resetsAt: soon } })
    expect(await ask(SESSION_C)).toBe('served by work')

    expect((await world.kurmis(['daemon', 'stop'])).code).toBe(0)
    // Without a daemon, status shows what state.json kept and starts none.
    const stopped = await world.status()
    expect(stopped).toMatchObject({ daemon: null, source: 'files' })
    expect(world.daemonInfo()).toBeNull()
    const stoppedById = new Map(stopped.logins.map((login) => [login.id, login]))
    expect(stoppedById.get(work.id)?.sessions).toBe(2)
    expect(stoppedById.get(OWN_CLAUDE)?.usage?.windows.find((window) => window.key === 'five_hour')?.utilization).toBe(100)
    expect(stoppedById.get(OWN_CLAUDE)?.blocked).toBeNull()

    expect((await world.kurmis(['daemon', 'start'])).code).toBe(0)
    const status = await world.status()
    const byId = new Map(status.logins.map((login) => [login.id, login]))
    const cooldownEnd = new Date(Math.floor(resetsAt / 1000) * 1000).toISOString()
    expect(byId.get(OWN_CLAUDE)?.blocked).toMatchObject({ kind: 'cooldown', until: cooldownEnd })
    expect(byId.get(OWN_CLAUDE)?.sessions).toBe(0)
    expect(byId.get(work.id)?.sessions).toBe(2)
    expect(byId.get(work.id)?.blocked).toBeNull()
    expect(await ask(SESSION_C)).toBe('served by work')
  }, 120_000)

  it('moves the daemon when config.json names another port', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    expect((await world.kurmis(['daemon', 'start'])).code).toBe(0)
    const before = daemonOf(world)

    const port = await freePort()
    writeFileSync(join(world.data, 'config.json'), JSON.stringify({ ...world.readConfig(), port }))
    const started = await world.kurmis(['daemon', 'start'])
    const after = daemonOf(world)
    expect(after).toMatchObject({ port, version: PACKAGE_VERSION })
    expect(started).toMatchObject({
      code: 0,
      stdout: `Started the kurmis daemon ${PACKAGE_VERSION} on 127.0.0.1:${String(port)} (pid ${String(after.pid)}), ` +
        `replacing version ${PACKAGE_VERSION}, which stops once its open requests finish.\n`
    })
    await waitUntil(() => !processExists(before.pid), GENEROUS_MS, 'the daemon on the old port to exit')
    expect(await portAcceptsConnections(world.port)).toBe(false)

    const routed = await world.kurmis(['claude', '--', '-p', 'hi'])
    expect(routed).toMatchObject({ code: 0, stdout: 'Hello from the fake API.\n' })
    const start = world.claudeRecord().filter((line) => line.kind === 'start' && line.argv.includes('-p') && line.argv.includes('hi')).at(-1)
    expect(start?.kind === 'start' ? start.effectiveEnv.ANTHROPIC_BASE_URL : null).toBe(`http://127.0.0.1:${String(port)}`)
  }, 120_000)
})
