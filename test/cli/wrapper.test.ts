import { spawn as realSpawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  finishLikeChild,
  forwardedSignals,
  ignoredSignals,
  MAX_WRAPPER_DEPTH,
  notStartedExitCode,
  runInteractive,
  signalExitCode,
  type ChildEnd,
  type SignalProcess,
  withWrapperPid,
  wrapperLoop
} from '../../src/cli/wrapper.ts'

const CHILD = resolve('test/cli/wrapper-child.mjs')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kurmis-wrapper-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
})

/** A stand-in for `process` that records what the wrapper did with signals. */
class FakeProcess extends EventEmitter implements SignalProcess {
  readonly pid = 99_999
  readonly killed: Array<[number, NodeJS.Signals]> = []
  override on(signal: NodeJS.Signals, listener: () => void): this {
    return super.on(signal, listener)
  }
  override removeListener(signal: NodeJS.Signals, listener: () => void): this {
    return super.removeListener(signal, listener)
  }
  override removeAllListeners(signal: NodeJS.Signals): this {
    return super.removeAllListeners(signal)
  }
  kill(pid: number, signal: NodeJS.Signals): boolean {
    this.killed.push([pid, signal])
    return true
  }
  signalCount(): number {
    return ['SIGINT', 'SIGQUIT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].reduce((sum, name) => sum + this.listenerCount(name), 0)
  }
}

function collector(): { write: (text: string) => void; text: () => string } {
  let text = ''
  return { write: (chunk) => void (text += chunk), text: () => text }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`${path} did not appear`)
    await new Promise((done) => setTimeout(done, 20))
  }
}

// Sending SIGHUP to a child only works on macOS and Linux; on Windows libuv answers ENOSYS.
const posixTest = test.skipIf(process.platform === 'win32')

// How a `hold` child that the wrapper sends SIGTERM ends. On macOS and Linux its handler exits
// 143. On Windows any signal Node sends to a child is TerminateProcess, which no handler sees,
// and Node reports the child as ended by the signal it sent.
const endedBySigterm: ChildEnd = process.platform === 'win32' ? { kind: 'signal', signal: 'SIGTERM' } : { kind: 'exit', code: 143 }

const env = (extra: Record<string, string> = {}): Record<string, string> => {
  const out: Record<string, string> = { ...(process.env as Record<string, string>), ...extra }
  // The tests may themselves run under a kurmis wrapper.
  if (extra.KURMIS_WRAPPER_PIDS === undefined) delete out.KURMIS_WRAPPER_PIDS
  return out
}

test('the child gets its arguments as they are, the environment it is given and the folder', async () => {
  const out = join(dir, 'out.json')
  const end = await runInteractive({
    command: process.execPath,
    args: [CHILD, 'write', out, 'two words', '--flag=a b', '"quoted"', ''],
    env: env({ WRAPPER_TEST_ONE: 'one' }),
    cwd: dir
  }, { process: new FakeProcess() })
  expect(end).toEqual({ kind: 'exit', code: 0 })
  expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({
    args: ['two words', '--flag=a b', '"quoted"', ''],
    one: 'one',
    wrappers: '99999',
    cwd: realpathSync(dir)
  })
})

test('a wrapper whose parent is a wrapper, or that is nested too deep, does not start its child', async () => {
  expect(wrapperLoop({}, 10)).toBeNull()
  expect(wrapperLoop({ KURMIS_WRAPPER_PIDS: '7,8' }, 10)).toBeNull()
  expect(wrapperLoop({ KURMIS_WRAPPER_PIDS: '7,10' }, 10)).toContain('its parent is a kurmis wrapper')
  const deep = Array.from({ length: MAX_WRAPPER_DEPTH }, (_, index) => String(index + 100)).join(',')
  expect(wrapperLoop({ KURMIS_WRAPPER_PIDS: deep }, 10)).toContain(`${String(MAX_WRAPPER_DEPTH)} kurmis wrappers run inside each other`)
  expect(withWrapperPid({ KURMIS_WRAPPER_PIDS: '7,junk' }, 9)).toEqual({ KURMIS_WRAPPER_PIDS: '7,9' })

  const out = join(dir, 'never.json')
  const proc = new FakeProcess()
  const end = await runInteractive({ command: process.execPath, args: [CHILD, 'write', out], env: env({ KURMIS_WRAPPER_PIDS: '4242' }) },
    { process: proc, parentPid: 4242 })
  expect(end).toMatchObject({ kind: 'not-started', code: 'ELOOP' })
  expect((end as { message: string }).message).toContain('KURMIS_CLAUDE_BIN')
  expect(existsSync(out)).toBe(false)
  expect(proc.signalCount()).toBe(0)
})

test('the child\'s exit code is the answer', async () => {
  const end = await runInteractive({ command: process.execPath, args: [CHILD, 'exit', '7'], env: env() }, { process: new FakeProcess() })
  expect(end).toEqual({ kind: 'exit', code: 7 })
})

test('in a terminal, while the child runs, SIGINT and SIGQUIT are ignored and SIGTERM and SIGHUP have handlers; all are removed after', async () => {
  const proc = new FakeProcess()
  const ready = join(dir, 'ready')
  const running = runInteractive({ command: process.execPath, args: [CHILD, 'hold', ready], env: env() },
    { process: proc, platform: 'darwin', stdinIsTerminal: true })
  await waitForFile(ready)
  expect(proc.listenerCount('SIGINT')).toBe(1)
  expect(proc.listenerCount('SIGQUIT')).toBe(1)
  expect(proc.listenerCount('SIGTERM')).toBe(1)
  expect(proc.listenerCount('SIGHUP')).toBe(1)
  proc.emit('SIGINT')
  proc.emit('SIGQUIT')
  // The child is still running: the ignored signals did nothing to it. SIGTERM ends it.
  await new Promise((done) => setTimeout(done, 200))
  proc.emit('SIGTERM')
  expect(await running).toEqual(endedBySigterm)
  expect(proc.signalCount()).toBe(0)
  expect(proc.killed).toEqual([])
})

test('SIGTERM is forwarded to the child, and a child it ends is reported as ended by it', async () => {
  const proc = new FakeProcess()
  const ready = join(dir, 'ready')
  const running = runInteractive({ command: process.execPath, args: [CHILD, 'hold-default', ready], env: env() },
    { process: proc, platform: 'linux' })
  await waitForFile(ready)
  proc.emit('SIGTERM')
  expect(await running).toEqual({ kind: 'signal', signal: 'SIGTERM' })
})

test('without a terminal on stdin, SIGINT sent to the wrapper alone is forwarded to the child', async () => {
  const proc = new FakeProcess()
  const ready = join(dir, 'ready')
  const running = runInteractive({ command: process.execPath, args: [CHILD, 'hold-default', ready], env: env() },
    { process: proc, platform: 'linux', stdinIsTerminal: false })
  await waitForFile(ready)
  proc.emit('SIGINT')
  expect(await running).toEqual({ kind: 'signal', signal: 'SIGINT' })
  expect(proc.signalCount()).toBe(0)
})

test('a kill that fails more than once after the start does not end the wrapper', async () => {
  const proc = new FakeProcess()
  const ready = join(dir, 'ready')
  let failKills = (): void => {}
  const running = runInteractive({ command: process.execPath, args: [CHILD, 'hold', ready], env: env() }, {
    process: proc,
    platform: 'linux',
    stdinIsTerminal: true,
    spawn: (command, args, options) => {
      const real = realSpawn(command, args, options)
      failKills = () => {
        real.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' }))
        real.emit('error', Object.assign(new Error('kill EPERM'), { code: 'EPERM' }))
      }
      return real
    }
  })
  await waitForFile(ready)
  // With a one-time handler the second 'error' would be unhandled and throw.
  failKills()
  proc.emit('SIGTERM')
  expect(await running).toEqual(endedBySigterm)
})

posixTest('SIGHUP is forwarded to the child', async () => {
  const proc = new FakeProcess()
  const ready = join(dir, 'ready')
  const running = runInteractive({ command: process.execPath, args: [CHILD, 'hold-default', ready], env: env() },
    { process: proc, platform: 'darwin' })
  await waitForFile(ready)
  proc.emit('SIGHUP')
  expect(await running).toEqual({ kind: 'signal', signal: 'SIGHUP' })
})

test('on Windows nothing is forwarded: Ctrl-C, Ctrl-Break and closing the console reach the child by themselves', async () => {
  expect(ignoredSignals('win32')).toEqual(['SIGINT', 'SIGBREAK', 'SIGHUP'])
  expect(forwardedSignals('win32')).toEqual([])
  expect(ignoredSignals('darwin')).toEqual(['SIGINT', 'SIGQUIT'])
  expect(forwardedSignals('linux')).toEqual(['SIGTERM', 'SIGHUP'])
  expect(ignoredSignals('darwin', false)).toEqual([])
  expect(forwardedSignals('linux', false)).toEqual(['SIGTERM', 'SIGHUP', 'SIGINT', 'SIGQUIT'])
  expect(ignoredSignals('win32', false)).toEqual(['SIGINT', 'SIGBREAK', 'SIGHUP'])
  expect(forwardedSignals('win32', false)).toEqual([])

  // Run with the Windows rules: SIGHUP must not end the child; it ends by itself (SIGTERM from
  // the test, which stands in for the child's own reaction).
  const proc = new FakeProcess()
  const ready = join(dir, 'ready')
  const child = { kills: [] as string[], end: (): void => {} }
  const running = runInteractive({ command: process.execPath, args: [CHILD, 'hold', ready], env: env() }, {
    process: proc,
    platform: 'win32',
    spawn: (command, args, options) => {
      const real = realSpawn(command, args, options)
      const kill = real.kill.bind(real)
      real.kill = (signal?: NodeJS.Signals | number) => {
        child.kills.push(String(signal))
        return kill(signal)
      }
      child.end = () => kill('SIGTERM')
      return real
    }
  })
  await waitForFile(ready)
  expect(proc.listenerCount('SIGBREAK')).toBe(1)
  expect(proc.listenerCount('SIGTERM')).toBe(0)
  proc.emit('SIGHUP')
  proc.emit('SIGINT')
  proc.emit('SIGBREAK')
  // The emitted signals were handled synchronously; had any reached the child, it would be gone.
  await new Promise((resolve) => setTimeout(resolve, 100))
  child.end()
  expect(await running).toEqual(endedBySigterm)
  expect(child.kills).toEqual([])
  expect(proc.signalCount()).toBe(0)
})

test('a program that does not exist is not started, with a message and code ENOENT', async () => {
  const proc = new FakeProcess()
  const missing = join(dir, 'no-such-program')
  const end = await runInteractive({ command: missing, args: [], env: env() }, { process: proc })
  expect(end).toMatchObject({ kind: 'not-started', code: 'ENOENT' })
  expect((end as { message: string }).message).toContain(missing)
  expect(proc.signalCount()).toBe(0)
})

test.skipIf(process.platform === 'win32')('a file that is not executable is not started, with code EACCES', async () => {
  const file = join(dir, 'not-executable')
  writeFileSync(file, '#!/bin/sh\nexit 0\n')
  chmodSync(file, 0o644)
  const end = await runInteractive({ command: file, args: [], env: env() }, { process: new FakeProcess() })
  expect(end).toMatchObject({ kind: 'not-started', code: 'EACCES' })
})

test('a spawn that throws is a child that was not started, and the handlers are removed', async () => {
  const proc = new FakeProcess()
  const end = await runInteractive({ command: 'x', args: [], env: {} }, {
    process: proc,
    spawn: () => {
      throw Object.assign(new TypeError('The argument must not contain null bytes'), { code: 'ERR_INVALID_ARG_VALUE' })
    }
  })
  expect(end).toMatchObject({ kind: 'not-started', code: 'ERR_INVALID_ARG_VALUE' })
  expect((end as { message: string }).message).toContain('null bytes')
  expect(proc.signalCount()).toBe(0)
})

test('finishing: an exit code is passed on as it is', () => {
  const stderr = collector()
  expect(finishLikeChild({ kind: 'exit', code: 0 }, { stderr, name: 'claude' })).toBe(0)
  expect(finishLikeChild({ kind: 'exit', code: 42 }, { stderr, name: 'claude' })).toBe(42)
  expect(stderr.text()).toBe('')
})

test('finishing: a child that was not started prints its message and answers a shell\'s code', () => {
  const stderr = collector()
  const end: ChildEnd = { kind: 'not-started', code: 'ENOENT', message: 'could not start /x/claude: there is no such program (ENOENT)' }
  expect(finishLikeChild(end, { stderr, name: 'claude' })).toBe(127)
  expect(stderr.text()).toBe('kurmis: claude: could not start /x/claude: there is no such program (ENOENT)\n')
  expect(notStartedExitCode('EACCES')).toBe(126)
  expect(notStartedExitCode('ENOEXEC')).toBe(126)
  expect(notStartedExitCode('EMFILE')).toBe(1)
})

test('finishing: a child ended by a signal makes the wrapper raise the same signal on itself, with no listener left', () => {
  const proc = new FakeProcess()
  proc.on('SIGTERM', () => {})
  const code = finishLikeChild({ kind: 'signal', signal: 'SIGTERM' }, { stderr: collector(), name: 'claude', platform: 'darwin', process: proc })
  expect(proc.listenerCount('SIGTERM')).toBe(0)
  expect(proc.killed).toEqual([[proc.pid, 'SIGTERM']])
  expect(code).toBe(143)
})

test('finishing: a core-dump signal and any signal on Windows give 128 + its number instead', () => {
  const proc = new FakeProcess()
  expect(finishLikeChild({ kind: 'signal', signal: 'SIGQUIT' }, { stderr: collector(), name: 'claude', platform: 'linux', process: proc }))
    .toBe(signalExitCode('SIGQUIT'))
  expect(finishLikeChild({ kind: 'signal', signal: 'SIGINT' }, { stderr: collector(), name: 'claude', platform: 'win32', process: proc }))
    .toBe(130)
  expect(proc.killed).toEqual([])
  expect(signalExitCode('SIGHUP')).toBe(129)
})
