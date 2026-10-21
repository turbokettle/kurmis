// `kurmis claude -p` end to end: the real bundle starts the real daemon, which routes the fake
// claude's requests to the fake Anthropic API across the logins of the world.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeToken, reply, writeClaudeCredentials, writeClaudeScenario, type RecordedRequest } from '../fakes/index.ts'
import { createWorld, OWN_CLAUDE, waitUntil, type AddedLogin, type World } from './harness.ts'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** The requests that reached the fake API's Messages endpoint. */
function messages(world: World): RecordedRequest[] {
  return world.api.apiRequests().filter((request) => request.path.startsWith('/v1/messages'))
}

function bearers(world: World): Array<string | null> {
  return messages(world).map((request) => request.bearer)
}

/** No request that reached the fake API carried a kurmis header. */
function expectNoKurmisHeaders(world: World): void {
  for (const request of world.api.requests) {
    expect(Object.keys(request.headers).filter((name) => name.startsWith('x-kurmis'))).toEqual([])
  }
}

/** Waits until the daemon has probed the usage of each of `ids`. */
async function waitForProbes(world: World, ids: string[]): Promise<void> {
  await waitUntil(async () => {
    const status = await world.status()
    return ids.every((id) => status.logins.find((login) => login.id === id)?.usage?.source === 'probe')
  }, 45_000, `the first usage probes of ${ids.join(', ')}`)
}

/** A reset as the fake claude prints it in UTC: `2:10pm (UTC)`, with the date when it is more than a day away. */
function resetText(ms: number): string {
  const date = new Date(ms)
  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes()
  const time = `${String(hours % 12 === 0 ? 12 : hours % 12)}${minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`}${hours < 12 ? 'am' : 'pm'}`
  const day = ms - Date.now() > DAY_MS ? `${date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${String(date.getUTCDate())}, ` : ''
  return `${day}${time} (UTC)`
}

/** A time on a whole minute, `ms` from now. */
function wholeMinute(ms: number): number {
  return Math.ceil((Date.now() + ms) / MINUTE_MS) * MINUTE_MS
}

/** The machine's own Claude login signed in, and an extra Claude login work-example; answers the extra login. */
async function twoLogins(world: World): Promise<AddedLogin> {
  world.signInDefaultClaude()
  return await world.addClaudeLogin('work@example.com')
}

describe('routing kurmis claude -p', () => {
  it('replays a usage-limit 429 of the first login onto the second one', async () => {
    const world = await createWorld()
    const work = await twoLogins(world)
    expect((await world.kurmis(['set', OWN_CLAUDE, '--use-first', 'on'])).code).toBe(0)
    world.api.scriptFor(fakeToken('default'), reply.quota({ claim: 'five_hour', resetsAt: Date.now() + HOUR_MS }))
    world.api.setDefault(reply.ok({ text: 'Hello from the second login' }))

    const result = await world.kurmis(['claude', '-p', 'hi'])
    expect(result).toMatchObject({ code: 0, stdout: expect.stringContaining('Hello from the second login') as string })
    expect(bearers(world)).toEqual([fakeToken('default'), work.token])
    expectNoKurmisHeaders(world)
  }, 90_000)

  it('keeps a session on its login while a new session goes where the order now says', async () => {
    const world = await createWorld()
    const work = await twoLogins(world)
    // The machine's own login's week resets first, so a new session is placed there.
    writeClaudeScenario(join(world.home, '.claude'), { sevenDay: { utilization: 10, resetsAt: new Date(Date.now() + DAY_MS).toISOString() } })
    writeClaudeScenario(work.folder, { sevenDay: { utilization: 10, resetsAt: new Date(Date.now() + 3 * DAY_MS).toISOString() } })
    expect((await world.kurmis(['daemon', 'start'])).code).toBe(0)
    await waitForProbes(world, [OWN_CLAUDE, work.id])
    // The answer on the machine's own login says its week resets in five days, after work-example's.
    const later = { fiveHour: { utilization: 0.1, resetsAt: Date.now() + 3 * HOUR_MS }, sevenDay: { utilization: 0.1, resetsAt: Date.now() + 5 * DAY_MS } }
    world.api.setDefault(reply.ok({ text: 'answered', unified: later }))

    const first = randomUUID()
    expect((await world.kurmis(['claude', '-p', 'one', '--session-id', first])).code).toBe(0)
    expect((await world.kurmis(['claude', '-p', 'two', '--session-id', first])).code).toBe(0)
    const second = randomUUID()
    expect((await world.kurmis(['claude', '-p', 'three', '--session-id', second])).code).toBe(0)
    expect(messages(world).map((request) => [request.sessionId, request.bearer])).toEqual([
      [first, fakeToken('default')],
      [first, fakeToken('default')],
      [second, work.token]
    ])

    // A limit that the machine's own login is now over moves the first session too.
    expect((await world.kurmis(['set', OWN_CLAUDE, '--five-hour', '5'])).code).toBe(0)
    expect((await world.kurmis(['claude', '-p', 'four', '--session-id', first])).code).toBe(0)
    expect(messages(world).at(-1)).toMatchObject({ sessionId: first, bearer: work.token })
    expectNoKurmisHeaders(world)
  }, 120_000)

  it('sends a request that met a 529 on one login to the other at once', async () => {
    const world = await createWorld()
    const work = await twoLogins(world)
    expect((await world.kurmis(['set', OWN_CLAUDE, '--use-first', 'on'])).code).toBe(0)
    world.api.scriptFor(fakeToken('default'), reply.overloaded())
    world.api.setDefault(reply.ok({ text: 'Answered after the 529' }))

    const result = await world.kurmis(['claude', '-p', 'hi'])
    expect(result).toMatchObject({ code: 0, stdout: expect.stringContaining('Answered after the 529') as string })
    expect(bearers(world)).toEqual([fakeToken('default'), work.token])
    // The CLI never saw the 529, so it did not retry.
    expect(world.claudeRecord().filter((line) => line.kind === 'retry')).toEqual([])
  }, 90_000)

  it('holds a request that met a 529 on the only login and sends it again after the backoff', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    world.api.script(reply.overloaded({ retryAfter: 1 }))
    world.api.setDefault(reply.ok({ text: 'Answered after the hold' }))

    const result = await world.kurmis(['claude', '-p', 'hi'])
    expect(result).toMatchObject({ code: 0, stdout: expect.stringContaining('Answered after the hold') as string })
    expect(messages(world).map((request) => [request.bearer, request.answeredWith?.status]))
      .toEqual([[fakeToken('default'), 529], [fakeToken('default'), 200]])
    // The proxy held the request through the backoff (`CAPACITY_HOLD_BASE_MS`, 5 s and up), so
    // the CLI saw one answer, the 200, and did not retry.
    const requests = world.claudeRecord().filter((line) => line.kind === 'request')
    expect(requests.map((line) => line.status)).toEqual([200])
    expect(world.claudeRecord().filter((line) => line.kind === 'retry')).toEqual([])
  }, 90_000)

  it('gives the CLI the 429 of the login that is back first when every login is out', async () => {
    const world = await createWorld()
    const work = await twoLogins(world)
    const workBack = wholeMinute(HOUR_MS)
    const defaultBack = wholeMinute(2 * HOUR_MS)
    world.api.scriptFor(fakeToken('default'), reply.quota({ claim: 'five_hour', resetsAt: defaultBack }))
    world.api.scriptFor(work.token, reply.quota({ claim: 'five_hour', resetsAt: workBack }))

    const result = await world.kurmis(['claude', '-p', 'hi'])
    expect(result.code).toBe(1)
    expect(result.stdout).toContain(`You've hit your session limit · resets ${resetText(workBack)}`)
    expect([...bearers(world)].sort()).toEqual([fakeToken('default'), work.token].sort())
    expectNoKurmisHeaders(world)
  }, 90_000)

  it('keeps a session pinned with --login on its login even when it is over its limit', async () => {
    const world = await createWorld()
    const work = await twoLogins(world)
    // The probe reads work-example's five-hour window at 42 %, over the limit of 5.
    expect((await world.kurmis(['set', 'work-example', '--five-hour', '5'])).code).toBe(0)
    expect((await world.kurmis(['daemon', 'start'])).code).toBe(0)
    await waitForProbes(world, [OWN_CLAUDE, work.id])
    world.api.setDefault(reply.ok({ text: 'pinned answer', unified: { fiveHour: { utilization: 0.5, resetsAt: Date.now() + HOUR_MS } } }))

    const session = randomUUID()
    const first = await world.kurmis(['claude', '--login', 'work-example', '-p', 'hi', '--session-id', session])
    expect(first).toMatchObject({ code: 0, stdout: expect.stringContaining('pinned answer') as string })
    // Its usage-limit 429 reaches the CLI as it is, and the machine's own login is never tried.
    const back = wholeMinute(HOUR_MS)
    world.api.scriptFor(work.token, reply.quota({ claim: 'five_hour', resetsAt: back }))
    const second = await world.kurmis(['claude', '--login', 'claude:work-example', '-p', 'again', '--session-id', session])
    expect(second.code).toBe(1)
    expect(second.stdout).toContain(`You've hit your session limit · resets ${resetText(back)}`)
    expect(bearers(world)).toEqual([work.token, work.token])
    // An Auto request meanwhile goes to the machine's own login, which has room.
    expect((await world.kurmis(['claude', '-p', 'auto'])).code).toBe(0)
    expect(bearers(world).at(-1)).toBe(fakeToken('default'))
  }, 120_000)

  it("with CLAUDE_CONFIG_DIR set, starts claude on the machine's own Claude login's credentials, never on those in that folder", async () => {
    const world = await createWorld()
    expect((await world.kurmis(['daemon', 'start'])).code).toBe(0)
    // The person's shell sets CLAUDE_CONFIG_DIR to a folder signed in to another account.
    const ownConfig = join(world.root, 'own-claude-config')
    writeClaudeCredentials(ownConfig, { accessToken: fakeToken('own') })
    world.api.setDefault(reply.ok({ text: 'Answered with the token in ~/.claude' }))

    // The machine's own login, the one in ~/.claude, is not signed in: the CLI says so and sends nothing.
    const signedOut = await world.kurmis(['claude', '-p', 'hi'], { env: { CLAUDE_CONFIG_DIR: ownConfig } })
    expect(signedOut.code).not.toBe(0)
    expect(signedOut.stdout).toContain('Not logged in')
    expect(signedOut.stderr).toContain("CLAUDE_CONFIG_DIR is set, but the machine's own Claude login is the one in ~/.claude")
    expect(bearers(world)).toEqual([])

    world.signInDefaultClaude()
    const result = await world.kurmis(['claude', '-p', 'hi'], { env: { CLAUDE_CONFIG_DIR: ownConfig } })
    expect(result).toMatchObject({ code: 0, stdout: expect.stringContaining('Answered with the token in ~/.claude') as string })
    expect(bearers(world)).toEqual([fakeToken('default')])
    expectNoKurmisHeaders(world)
  }, 90_000)
})
