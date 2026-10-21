import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createNetServer, type AddressInfo, type Socket } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANTHROPIC_API_URL, createUpstream, forwardBody, UPSTREAM_CONNECT_TIMEOUT_MS, UPSTREAM_IDLE_TIMEOUT_MS,
  upstreamOrigin, UpstreamError, type Upstream, type UpstreamAnswer, type UpstreamRequest
} from '../../src/daemon/upstream.ts'
import { startFakeAnthropic } from '../fakes/anthropic.ts'

interface TestServer {
  url: string
  port: number
  server: Server
  /** Every connection the server accepted, in order. */
  sockets: Socket[]
  close(): Promise<void>
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function startServer(handler: Handler): Promise<TestServer> {
  const sockets: Socket[] = []
  const server = createServer(handler)
  server.on('connection', (socket) => sockets.push(socket))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const result: TestServer = {
    url: `http://127.0.0.1:${String(port)}`,
    port,
    server,
    sockets,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
  cleanups.push(() => result.close())
  return result
}

function upstreamFor(origin: string, options: { idleTimeoutMs?: number; connectTimeoutMs?: number } = {}): Upstream {
  const upstream = createUpstream({ origin, ...options })
  cleanups.push(() => upstream.close())
  return upstream
}

function get(path: string, signal = new AbortController().signal): UpstreamRequest {
  return { method: 'GET', path, headers: {}, signal }
}

function readAll(body: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    body.on('data', (chunk: Buffer) => chunks.push(chunk))
    body.on('end', () => resolve(Buffer.concat(chunks)))
    body.on('error', reject)
    body.resume()
  })
}

/** Resolves with the error the body broke off with, or rejects when it ended normally. */
function bodyFailure(answer: UpstreamAnswer): Promise<UpstreamError | null> {
  return new Promise((resolve, reject) => {
    answer.body.on('data', () => undefined)
    answer.body.on('end', () => reject(new Error('the body ended normally')))
    answer.body.on('close', () => resolve(answer.failure()))
  })
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function closed(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) resolve()
    else socket.once('close', () => resolve())
  })
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/**
 * A downstream server that stands in for the proxy: it sends one upstream request per request
 * it gets and forwards the answer with `forwardBody`, recording the outcome.
 */
async function startForwarder(upstream: Upstream, path = '/'): Promise<TestServer & {
  outcomes: Promise<'done' | 'aborted' | 'failed'>[]
  responses: ServerResponse[]
  answers: UpstreamAnswer[]
}> {
  const outcomes: Promise<'done' | 'aborted' | 'failed'>[] = []
  const responses: ServerResponse[] = []
  const answers: UpstreamAnswer[] = []
  const server = await startServer((req, res) => {
    const controller = new AbortController()
    res.once('close', () => {
      if (!res.writableFinished) controller.abort()
    })
    responses.push(res)
    outcomes.push((async () => {
      const answer = await upstream.send({ method: 'GET', path, headers: {}, signal: controller.signal })
      answers.push(answer)
      res.writeHead(answer.status, { 'content-type': answer.get('content-type') ?? 'text/plain' })
      return forwardBody(answer, res, controller.signal)
    })())
  })
  return { ...server, outcomes, responses, answers }
}

describe('upstreamOrigin', () => {
  it('defaults to the Anthropic API', () => {
    expect(upstreamOrigin({})).toBe(ANTHROPIC_API_URL)
    expect(upstreamOrigin({ KURMIS_UPSTREAM_URL: '' })).toBe(ANTHROPIC_API_URL)
  })

  it('takes an http or https origin, with or without a trailing slash', () => {
    expect(upstreamOrigin({ KURMIS_UPSTREAM_URL: 'http://127.0.0.1:8080' })).toBe('http://127.0.0.1:8080')
    expect(upstreamOrigin({ KURMIS_UPSTREAM_URL: 'http://127.0.0.1:8080/' })).toBe('http://127.0.0.1:8080')
    expect(upstreamOrigin({ KURMIS_UPSTREAM_URL: 'https://api.example.com' })).toBe('https://api.example.com')
    expect(upstreamOrigin({ KURMIS_UPSTREAM_URL: 'http://[::1]:9000' })).toBe('http://[::1]:9000')
  })

  it.each([
    ['not a url', 'not a URL'],
    ['ftp://example.com', 'scheme'],
    ['http://user:secret@example.com', 'credentials'],
    ['http://example.com/v1', 'path'],
    ['http://example.com/?a=1', 'query'],
    ['http://example.com?', 'query'],
    ['http://example.com/#x', 'fragment']
  ])('refuses %s', (value, reason) => {
    expect(() => upstreamOrigin({ KURMIS_UPSTREAM_URL: value })).toThrow(reason)
  })

  it('does not repeat a password in its error', () => {
    expect(() => upstreamOrigin({ KURMIS_UPSTREAM_URL: 'http://user:hunter2@example.com' })).toThrow(/^(?!.*hunter2)/)
  })
})

describe('createUpstream', () => {
  it('passes method, path, headers and body up, and status, headers and body back', async () => {
    let seen: { method?: string; url?: string; headers?: IncomingMessage['headers']; body?: string } = {}
    const server = await startServer((req, res) => {
      void readAll(req).then((body) => {
        seen = { method: req.method, url: req.url, headers: req.headers, body: body.toString('utf8') }
        res.setHeader('X-Repeated', ['one', 'two'])
        res.setHeader('Set-Cookie', ['a=1', 'b=2'])
        res.writeHead(201, { 'Content-Type': 'application/json', 'request-id': 'req_test' })
        res.end('{"ok":true}')
      })
    })
    const upstream = upstreamFor(server.url)
    const body = '{"model":"claude-sonnet-5"}'
    const answer = await upstream.send({
      method: 'POST',
      path: '/v1/messages?beta=true',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'x-custom': 'value' },
      body: Buffer.from(body),
      signal: new AbortController().signal
    })
    expect(answer.status).toBe(201)
    expect(answer.get('CONTENT-TYPE')).toBe('application/json')
    expect(answer.get('x-repeated')).toBe('one, two')
    expect(answer.get('absent')).toBeNull()
    expect(answer.headers.filter(([name]) => name === 'x-repeated')).toEqual([['x-repeated', 'one'], ['x-repeated', 'two']])
    expect(answer.headers.filter(([name]) => name === 'set-cookie')).toEqual([['set-cookie', 'a=1'], ['set-cookie', 'b=2']])
    expect(answer.headers.every(([name]) => name === name.toLowerCase())).toBe(true)
    expect((await readAll(answer.body)).toString('utf8')).toBe('{"ok":true}')
    expect(answer.failure()).toBeNull()
    expect(seen.method).toBe('POST')
    expect(seen.url).toBe('/v1/messages?beta=true')
    expect(seen.headers?.['x-custom']).toBe('value')
    expect(seen.headers?.['host']).toBe(`127.0.0.1:${String(server.port)}`)
    expect(seen.body).toBe(body)
  })

  it('does not decode an encoded body', async () => {
    const gzipped = gzipSync(Buffer.from('{"compressed":true}'))
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }).end(gzipped)
    })
    const answer = await upstreamFor(server.url).send(get('/'))
    expect(answer.get('content-encoding')).toBe('gzip')
    expect((await readAll(answer.body)).equals(gzipped)).toBe(true)
  })

  it('reuses a connection for the next request', async () => {
    const server = await startServer((_req, res) => res.end('ok'))
    const upstream = upstreamFor(server.url)
    for (let index = 0; index < 3; index++) await readAll((await upstream.send(get('/'))).body)
    expect(server.sockets).toHaveLength(1)
  })

  it('works against the fake Anthropic API, streaming events as they come', async () => {
    const fake = await startFakeAnthropic()
    cleanups.push(() => fake.close())
    fake.script({ kind: 'ok', eventDelayMs: 20, text: 'A longer answer that comes in several pieces.' })
    const body = JSON.stringify({ model: 'claude-sonnet-5', stream: true, messages: [] })
    const answer = await upstreamFor(fake.url).send({
      method: 'POST',
      path: '/v1/messages',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      body: Buffer.from(body),
      signal: new AbortController().signal
    })
    expect(answer.status).toBe(200)
    expect(answer.get('content-type')).toContain('text/event-stream')
    const chunks: string[] = []
    answer.body.on('data', (chunk: Buffer) => chunks.push(chunk.toString('utf8')))
    await new Promise((resolve) => answer.body.on('end', resolve))
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks[0]).toContain('message_start')
    expect(chunks.join('')).toContain('message_stop')
    expect(fake.apiRequests()[0]?.json).toEqual(JSON.parse(body))
  })

  it('rejects with network ECONNREFUSED when nothing listens', async () => {
    const port = await freePort()
    const error = await upstreamFor(`http://127.0.0.1:${String(port)}`).send(get('/')).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UpstreamError)
    expect(error).toMatchObject({ kind: 'network', code: 'ECONNREFUSED' })
  })

  it('rejects with network ECONNRESET when the server drops the request', async () => {
    const fake = await startFakeAnthropic()
    cleanups.push(() => fake.close())
    fake.script({ kind: 'drop' })
    const error = await upstreamFor(fake.url).send(get('/v1/models')).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'network', code: 'ECONNRESET' })
    expect(fake.apiRequests()).toHaveLength(1)
  })

  it('sends a request again once when a reused connection is reset before any answer', async () => {
    let served = 0
    const usedSockets = new Set<Socket>()
    const server = await startServer((req, res) => {
      if (usedSockets.has(req.socket)) {
        req.socket.destroy()
        return
      }
      usedSockets.add(req.socket)
      served++
      res.end('ok')
    })
    const upstream = upstreamFor(server.url)
    await readAll((await upstream.send(get('/'))).body)
    const answer = await upstream.send(get('/'))
    expect((await readAll(answer.body)).toString('utf8')).toBe('ok')
    expect(served).toBe(2)
    expect(server.sockets).toHaveLength(2)
  })

  it('gives up with timeout when a new connection is not ready in time', async () => {
    // A TCP server that accepts and reads but says nothing, so the TLS handshake never finishes.
    const accepted: Socket[] = []
    const silent = createNetServer((socket) => {
      accepted.push(socket)
      socket.resume()
    })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => {
      for (const socket of accepted) socket.destroy()
      silent.close(() => resolve())
    }))
    const port = (silent.address() as AddressInfo).port
    const upstream = upstreamFor(`https://127.0.0.1:${String(port)}`, { connectTimeoutMs: 200 })
    const started = Date.now()
    const error = await upstream.send(get('/')).catch((e: unknown) => e)
    expect(error).toMatchObject({ kind: 'timeout', code: 'ETIMEDOUT' })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(UPSTREAM_CONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
    await closed(accepted[0] as Socket)
  })

  describe('the idle timeout', () => {
    const idleTimeoutMs = 400
    const gapMs = 250

    it('is far longer than the 300 s fetch would allow', () => {
      expect(UPSTREAM_IDLE_TIMEOUT_MS).toBeGreaterThan(300_000)
    })

    it('lets gaps shorter than it through: before the headers, before the first byte and between pieces', async () => {
      const server = await startServer((_req, res) => {
        void (async () => {
          await wait(gapMs)
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.flushHeaders()
          await wait(gapMs)
          res.write('one ')
          await wait(gapMs)
          res.end('two')
        })()
      })
      const answer = await upstreamFor(server.url, { idleTimeoutMs }).send(get('/'))
      expect((await readAll(answer.body)).toString('utf8')).toBe('one two')
      expect(answer.failure()).toBeNull()
    })

    it('ends a wait for the headers that is longer than it', async () => {
      const server = await startServer(() => undefined)
      const started = Date.now()
      const error = await upstreamFor(server.url, { idleTimeoutMs }).send(get('/')).catch((e: unknown) => e)
      expect(error).toMatchObject({ kind: 'timeout', code: 'ETIMEDOUT' })
      expect(Date.now() - started).toBeGreaterThanOrEqual(idleTimeoutMs - 50)
      expect(server.sockets[0]).toBeDefined()
      await closed(server.sockets[0] as Socket)
    })

    it('ends a gap in the body that is longer than it', async () => {
      const server = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('first ')
      })
      const answer = await upstreamFor(server.url, { idleTimeoutMs }).send(get('/'))
      const failure = await bodyFailure(answer)
      expect(failure).toMatchObject({ kind: 'timeout', code: 'ETIMEDOUT' })
      await closed(server.sockets[0] as Socket)
    })
  })

  describe('aborting', () => {
    it('rejects at once for a signal that is already aborted', async () => {
      const server = await startServer((_req, res) => res.end('ok'))
      const controller = new AbortController()
      controller.abort()
      const error = await upstreamFor(server.url).send(get('/', controller.signal)).catch((e: unknown) => e)
      expect(error).toMatchObject({ kind: 'aborted', code: 'ABORT_ERR' })
      expect(server.sockets).toHaveLength(0)
    })

    it('before the headers closes the upstream connection', async () => {
      let arrived!: () => void
      const requestArrived = new Promise<void>((resolve) => { arrived = resolve })
      const server = await startServer(() => arrived())
      const controller = new AbortController()
      const sent = upstreamFor(server.url).send(get('/', controller.signal)).catch((e: unknown) => e)
      await requestArrived
      controller.abort()
      expect(await sent).toMatchObject({ kind: 'aborted', code: 'ABORT_ERR' })
      await closed(server.sockets[0] as Socket)
    })

    it('in the middle of the body closes the upstream connection and breaks the body off', async () => {
      const server = await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('first ')
      })
      const controller = new AbortController()
      const answer = await upstreamFor(server.url).send(get('/', controller.signal))
      const first = await new Promise<string>((resolve) => answer.body.once('data', (chunk: Buffer) => resolve(chunk.toString('utf8'))))
      expect(first).toBe('first ')
      const failure = bodyFailure(answer)
      controller.abort()
      expect(await failure).toMatchObject({ kind: 'aborted', code: 'ABORT_ERR' })
      await closed(server.sockets[0] as Socket)
    })

    it('after the body ended does nothing to the kept-open connection', async () => {
      const server = await startServer((_req, res) => res.end('ok'))
      const upstream = upstreamFor(server.url)
      const controller = new AbortController()
      const answer = await upstream.send(get('/', controller.signal))
      await readAll(answer.body)
      await wait(10)
      controller.abort()
      await readAll((await upstream.send(get('/'))).body)
      expect(server.sockets).toHaveLength(1)
      expect(server.sockets[0]?.destroyed).toBe(false)
    })
  })

  it('discard drops the body and frees the connection for the next request', async () => {
    const server = await startServer((_req, res) => res.writeHead(429, { 'content-type': 'application/json' }).end('{"type":"error"}'))
    const upstream = upstreamFor(server.url)
    const answer = await upstream.send(get('/'))
    answer.discard()
    await new Promise((resolve) => answer.body.once('close', resolve))
    expect(answer.body.readableEnded).toBe(true)
    await readAll((await upstream.send(get('/'))).body)
    expect(server.sockets).toHaveLength(1)
  })

  it('close destroys kept-open connections, and send rejects afterwards', async () => {
    const server = await startServer((_req, res) => res.end('ok'))
    const upstream = createUpstream({ origin: server.url })
    await readAll((await upstream.send(get('/'))).body)
    expect(server.sockets[0]?.destroyed).toBe(false)
    upstream.close()
    await closed(server.sockets[0] as Socket)
    await expect(upstream.send(get('/'))).rejects.toBeInstanceOf(UpstreamError)
  })
})

describe('forwardBody', () => {
  function fetchDownstream(url: string): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(url, { agent: false }, resolve)
      req.on('error', reject)
      req.end()
    })
  }

  it('copies the body and ends the response', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('part one, ')
      setTimeout(() => res.end('part two'), 20)
    })
    const forwarder = await startForwarder(upstreamFor(server.url))
    const response = await fetchDownstream(forwarder.url)
    expect((await readAll(response)).toString('utf8')).toBe('part one, part two')
    expect(await forwarder.outcomes[0]).toBe('done')
  })

  it('stops reading upstream while the client does not read, and goes on when it does', async () => {
    const total = 32 * 1024 * 1024
    const piece = Buffer.alloc(64 * 1024, 'x')
    let written = 0
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      const pump = (): void => {
        while (written < total) {
          written += piece.length
          if (!res.write(piece)) {
            res.once('drain', pump)
            return
          }
        }
        res.end()
      }
      pump()
    })
    const forwarder = await startForwarder(upstreamFor(server.url))
    const response = await fetchDownstream(forwarder.url)
    response.pause()
    const downstream = forwarder.responses[0] as ServerResponse
    const writes = vi.spyOn(downstream, 'write')
    await wait(300)
    const stalled = written
    await wait(200)
    expect(written).toBe(stalled)
    expect(stalled).toBeLessThan(total / 2)
    expect(writes.mock.results.some((result) => result.value === false)).toBe(true)
    const received = await readAll(response)
    expect(received.length).toBe(total)
    expect(await forwarder.outcomes[0]).toBe('done')
  })

  it('breaks the response off when the upstream connection drops in the middle of the body', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('event: message_start\n\n')
      setTimeout(() => res.socket?.destroy(), 30)
    })
    const forwarder = await startForwarder(upstreamFor(server.url))
    const response = await fetchDownstream(forwarder.url)
    const broken = await new Promise<boolean>((resolve) => {
      response.on('data', () => undefined)
      response.on('end', () => resolve(false))
      response.on('error', () => resolve(true))
      response.on('aborted', () => resolve(true))
    })
    expect(broken).toBe(true)
    expect(response.complete).toBe(false)
    expect(await forwarder.outcomes[0]).toBe('failed')
    expect(forwarder.responses[0]?.destroyed).toBe(true)
    expect(forwarder.answers[0]?.failure()).toMatchObject({ kind: 'network', code: 'ECONNRESET' })
  })

  it('answers aborted and closes the upstream connection when the client goes away', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('event: ping\n\n')
    })
    const forwarder = await startForwarder(upstreamFor(server.url))
    const response = await fetchDownstream(forwarder.url)
    await new Promise((resolve) => response.once('data', resolve))
    response.destroy()
    expect(await forwarder.outcomes[0]).toBe('aborted')
    await closed(server.sockets[0] as Socket)
  })

  it('answers aborted and destroys both sides when the signal aborts', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('event: ping\n\n')
    })
    const upstream = upstreamFor(server.url)
    const controller = new AbortController()
    let outcome!: Promise<'done' | 'aborted' | 'failed'>
    const downstream = await startServer((_req, res) => {
      void upstream.send(get('/')).then((answer) => {
        res.writeHead(200)
        outcome = forwardBody(answer, res, controller.signal)
        setTimeout(() => controller.abort(), 20)
      })
    })
    const response = await fetchDownstream(downstream.url)
    const ended = new Promise<boolean>((resolve) => {
      response.on('data', () => undefined)
      response.on('end', () => resolve(false))
      response.on('error', () => resolve(true))
      response.on('aborted', () => resolve(true))
    })
    expect(await ended).toBe(true)
    expect(await outcome).toBe('aborted')
    await closed(server.sockets[0] as Socket)
  })

  it('answers aborted at once for a signal that is already aborted', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200)
      res.write('x')
    })
    const upstream = upstreamFor(server.url)
    let outcome!: Promise<'done' | 'aborted' | 'failed'>
    const downstream = await startServer((_req, res) => {
      void upstream.send(get('/')).then((answer) => {
        res.writeHead(200)
        outcome = forwardBody(answer, res, AbortSignal.abort())
      })
    })
    // The response is destroyed before its head went out, so the client sees a hang-up.
    await expect(fetchDownstream(downstream.url)).rejects.toMatchObject({ code: 'ECONNRESET' })
    expect(await outcome).toBe('aborted')
    await closed(server.sockets[0] as Socket)
  })
})
