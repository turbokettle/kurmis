import { spawnSync } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTROL_API_VERSION, CONTROL_PATHS, type StatusAnswer } from '../../src/core/control-api.ts'
import { KEY_HEADER } from '../../src/core/route-headers.ts'
import {
  compareVersions,
  controlRequest,
  delay,
  isStatusAnswer,
  portAcceptsConnections,
  portHolder,
  processExists,
  shouldReplace
} from '../../src/daemon/lifecycle.ts'
import { freePort } from './helpers.ts'

const KEY = 'a'.repeat(64)

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  servers.length = 0
})

/** A server on a free port that answers with `handler`. Resolves with the port. */
async function serve(handler: (request: IncomingMessage, body: string, response: ServerResponse) => void): Promise<number> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    request.on('end', () => handler(request, body, response))
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return typeof address === 'object' && address !== null ? address.port : 0
}

function status(version: string, port: number): StatusAnswer {
  return { ok: true, apiVersion: CONTROL_API_VERSION, version, pid: 4242, port, startedAt: 1, logins: [] }
}

describe('compareVersions', () => {
  it.each([
    ['0.1.0', '0.1.0', 0],
    ['0.9.1', '0.10.0', -1],
    ['0.10.0', '0.9.1', 1],
    ['1.0', '1.0.0', 0],
    ['1.0.1', '1.0', 1],
    ['v1.2.3', '1.2.3', 0],
    ['1.0.0-beta.1', '1.0.0', -1],
    ['1.0.0', '1.0.0-beta.1', 1],
    ['1.0.0-beta.1', '1.0.0-beta.2', -1],
    ['1.0.0+build.5', '1.0.0', 0],
    [' 2.0.0 ', '2.0.0', 0]
  ] as const)('%s against %s is %d', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected)
  })

  it.each([['dev', '0.1.0'], ['0.1.0', 'dev'], ['', '1.0.0'], ['1..0', '1.0.0'], ['1.0.x', '1.0.0']])('%s against %s is null', (a, b) => {
    expect(compareVersions(a, b)).toBe(null)
  })
})

describe('shouldReplace', () => {
  it('replaces only an older daemon', () => {
    expect(shouldReplace('0.1.0', '0.2.0')).toBe(true)
    expect(shouldReplace('0.2.0', '0.2.0')).toBe(false)
    expect(shouldReplace('0.3.0', '0.2.0')).toBe(false)
  })

  it('never replaces when either version is not a version', () => {
    expect(shouldReplace('dev', '0.2.0')).toBe(false)
    expect(shouldReplace('0.1.0', 'dev')).toBe(false)
  })
})

describe('isStatusAnswer', () => {
  it('accepts a status answer and rejects other shapes', () => {
    expect(isStatusAnswer(status('0.1.0', 1))).toBe(true)
    expect(isStatusAnswer({ ...status('0.1.0', 1), ok: false })).toBe(false)
    expect(isStatusAnswer({ ...status('0.1.0', 1), logins: undefined })).toBe(false)
    expect(isStatusAnswer({ ok: true })).toBe(false)
    expect(isStatusAnswer(null)).toBe(false)
  })
})

describe('controlRequest', () => {
  it('sends the key and a JSON body and parses the JSON answer', async () => {
    let seen: { method?: string; url?: string; key?: string; type?: string; body?: string; connection?: string } = {}
    const port = await serve((request, body, response) => {
      seen = {
        method: request.method, url: request.url, key: request.headers[KEY_HEADER] as string,
        type: request.headers['content-type'], body, connection: request.headers.connection
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
    const result = await controlRequest({ port, key: KEY, method: 'POST', path: CONTROL_PATHS.probe, body: { logins: ['workclaude'] } })
    expect(result).toEqual({ kind: 'answered', status: 200, body: { ok: true } })
    expect(seen).toEqual({
      method: 'POST', url: CONTROL_PATHS.probe, key: KEY, type: 'application/json',
      body: JSON.stringify({ logins: ['workclaude'] }), connection: 'close'
    })
  })

  it('answers a body of null when the answer is empty or not JSON', async () => {
    const port = await serve((request, _body, response) => {
      response.writeHead(request.url === '/empty' ? 403 : 200)
      response.end(request.url === '/empty' ? '' : 'not json')
    })
    expect(await controlRequest({ port, key: KEY, method: 'GET', path: '/empty' })).toEqual({ kind: 'answered', status: 403, body: null })
    expect(await controlRequest({ port, key: KEY, method: 'GET', path: '/text' })).toEqual({ kind: 'answered', status: 200, body: null })
  })

  it('answers refused when nothing listens', async () => {
    const port = await freePort()
    expect(await controlRequest({ port, key: KEY, method: 'GET', path: CONTROL_PATHS.status })).toEqual({ kind: 'refused' })
  })

  it('fails after its deadline when no answer comes', async () => {
    const port = await serve(() => {
      // Never answers.
    })
    const result = await controlRequest({ port, key: KEY, method: 'GET', path: CONTROL_PATHS.status, timeoutMs: 150 })
    expect(result).toEqual({ kind: 'failed', reason: 'no answer within 150 ms' })
  })

  it('fails when the answer is too large', async () => {
    const port = await serve((_request, _body, response) => {
      response.writeHead(200)
      const chunk = Buffer.alloc(1024 * 1024, 'a')
      for (let index = 0; index < 5; index++) response.write(chunk)
      response.end()
    })
    expect(await controlRequest({ port, key: KEY, method: 'GET', path: '/' })).toEqual({ kind: 'failed', reason: 'the answer was too large' })
  })

  it('fails when the connection is reset', async () => {
    const port = await serve((request) => {
      request.socket.destroy()
    })
    const result = await controlRequest({ port, key: KEY, method: 'GET', path: '/' })
    expect(result.kind).toBe('failed')
  })
})

describe('portHolder', () => {
  it('is free when nothing listens', async () => {
    expect(await portHolder(await freePort(), KEY)).toEqual({ kind: 'free' })
  })

  it('is kurmis when a keyed status answers', async () => {
    const port = await serve((request, _body, response) => {
      if (request.headers[KEY_HEADER] !== KEY || request.url !== CONTROL_PATHS.status) {
        response.writeHead(403)
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(status('0.1.0', 1)))
    })
    expect(await portHolder(port, KEY)).toEqual({ kind: 'kurmis', status: status('0.1.0', 1) })
    // A kurmis daemon with another key is not this user's daemon.
    expect(await portHolder(port, 'b'.repeat(64))).toEqual({ kind: 'other', reason: 'it answered 403 to a kurmis status request', status: 403 })
  })

  it('is other when the answer is not a status answer', async () => {
    const port = await serve((_request, _body, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ hello: 'world' }))
    })
    expect(await portHolder(port, KEY)).toEqual({ kind: 'other', reason: 'it answered 200 to a kurmis status request', status: 200 })
  })

  it('is other when the holder does not answer in time', async () => {
    const port = await serve(() => {
      // Never answers.
    })
    expect(await portHolder(port, KEY, 150)).toEqual({ kind: 'other', reason: 'no answer within 150 ms' })
  })
})

describe('portAcceptsConnections', () => {
  it('tells a listening port from a free one', async () => {
    const port = await serve((_request, _body, response) => response.end())
    expect(await portAcceptsConnections(port)).toBe(true)
    expect(await portAcceptsConnections(await freePort())).toBe(false)
  })
})

describe('processExists', () => {
  it('is true for this process and false for one that has exited', () => {
    expect(processExists(process.pid)).toBe(true)
    const child = spawnSync(process.execPath, ['-e', ''])
    expect(child.pid).toBeGreaterThan(0)
    expect(processExists(child.pid ?? 0)).toBe(false)
  })
})

describe('delay', () => {
  it('resolves after the time', async () => {
    const before = Date.now()
    await delay(50)
    expect(Date.now() - before).toBeGreaterThanOrEqual(45)
  })
})
