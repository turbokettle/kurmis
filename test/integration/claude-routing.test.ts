// `kurmis claude -p` end to end: the real bundle starts the real daemon, which routes the fake
// claude's requests to the fake Anthropic API across two logins.
import { describe, expect, it } from 'vitest'
import { fakeToken, reply } from '../fakes/index.ts'
import { createWorld } from './harness.ts'

const HOUR_MS = 3_600_000

describe.skipIf(process.platform === 'win32')('routing kurmis claude -p', () => {
  it('replays a usage-limit 429 of the first login onto the second one', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    const work = await world.addClaudeLogin('work')
    expect((await world.kurmis(['set', 'claude:default', '--use-first', 'on'])).code).toBe(0)
    world.api.scriptFor(fakeToken('default'), reply.quota({ claim: 'five_hour', resetsAt: Date.now() + HOUR_MS }))
    world.api.setDefault(reply.ok({ text: 'Hello from the second login' }))

    const result = await world.kurmis(['claude', '-p', 'hi'])
    expect(result).toMatchObject({ code: 0, stdout: expect.stringContaining('Hello from the second login') as string })
    const requests = world.api.apiRequests().filter((request) => request.path.startsWith('/v1/messages'))
    expect(requests.map((request) => request.bearer)).toEqual([fakeToken('default'), work])
    for (const request of world.api.requests) {
      expect(Object.keys(request.headers).filter((name) => name.startsWith('x-kurmis'))).toEqual([])
    }
  }, 90_000)
})
