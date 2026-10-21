import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { processExists } from '../../src/daemon/lifecycle.ts'
import { dataFolderWithPort, freePort, waitUntil } from './helpers.ts'
import { loggedDaemonPids, OwnDaemons } from './own-daemons.ts'

const KEY = 'a'.repeat(64)

/** A Node process that is no daemon: it only waits. */
const IDLE = 'setInterval(() => undefined, 1000)'

/** A Node process that answers the keyed status request on `port` with its own pid, as a daemon does. */
function answering(port: number): string {
  return `
    const server = require('node:http').createServer((request, response) => {
      if (request.headers['x-kurmis-key'] !== ${JSON.stringify(KEY)}) return response.writeHead(403).end()
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, apiVersion: 1, version: '0.5.0', pid: process.pid, port: ${String(port)}, startedAt: 1, logins: [] }))
    })
    server.listen(${String(port)}, '127.0.0.1', () => process.stdout.write('listening\\n'))`
}

const children: ChildProcess[] = []
afterEach(() => {
  for (const child of children) child.kill('SIGKILL')
  children.length = 0
})

async function start(script: string, waitForLine = false): Promise<number> {
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] })
  children.push(child)
  if (waitForLine) await new Promise((resolve) => child.stdout?.once('data', resolve))
  return child.pid ?? 0
}

function logStarted(home: string, pid: number, port: number): void {
  writeFileSync(join(home, 'daemon.log'), `2026-01-01T00:00:00.000Z daemon_started pid=${String(pid)} port=${String(port)}\n`)
}

describe('OwnDaemons', () => {
  it('reads the pids of daemon.log and daemon.log.1', async () => {
    const home = dataFolderWithPort(await freePort())
    writeFileSync(join(home, 'daemon.log.1'), '2026-01-01T00:00:00.000Z daemon_started pid=11 port=1\n')
    writeFileSync(join(home, 'daemon.log'), '2026-01-01T00:00:01.000Z config_loaded\n2026-01-01T00:00:02.000Z daemon_started pid=22 port=1\n')
    expect(loggedDaemonPids(home)).toEqual([11, 22])
  })

  it('never kills a pid daemon.json and daemon.log name when the process there is not shown to be the daemon', async () => {
    const port = await freePort()
    const home = dataFolderWithPort(port)
    writeFileSync(join(home, 'key'), `${KEY}\n`)
    // The pid of a daemon that has exited, now used by another program.
    const other = await start(IDLE)
    writeFileSync(join(home, 'daemon.json'), JSON.stringify({ pid: other, port, version: '0.5.0', startedAt: 1 }))
    logStarted(home, other, port)
    await new OwnDaemons(home, [join(home, 'no-such-bundle.cjs')]).stop(300)
    expect(processExists(other)).toBe(true)
  })

  it('kills a daemon that answers the key on the port with its pid, whatever its command line', async () => {
    const port = await freePort()
    const home = dataFolderWithPort(port)
    writeFileSync(join(home, 'key'), `${KEY}\n`)
    const daemon = await start(answering(port), true)
    logStarted(home, daemon, port)
    await new OwnDaemons(home).stop()
    await waitUntil(() => !processExists(daemon), 5_000, 'the daemon to exit')
  })

  it('kills a daemon that answers a key the folder held before it changed', async () => {
    const port = await freePort()
    const home = dataFolderWithPort(port)
    writeFileSync(join(home, 'key'), `${KEY}\n`)
    const daemon = await start(answering(port), true)
    const daemons = new OwnDaemons(home)
    writeFileSync(join(home, 'key'), `${'b'.repeat(64)}\n`)
    await daemons.stop()
    await waitUntil(() => !processExists(daemon), 5_000, 'the daemon to exit')
  })
})
