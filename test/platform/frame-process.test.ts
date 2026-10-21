import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { expect, test } from 'vitest'
import {
  createLineSplitter,
  startFrameProcess,
  treeKillCommand,
  type FrameProcessOptions
} from '../../src/platform/frame-process.ts'

const CHILD = resolve('test/platform/frame-child.mjs')

function start(mode: string[], options: Partial<FrameProcessOptions> = {}): { frames: unknown[]; proc: ReturnType<typeof startFrameProcess> } {
  const frames: unknown[] = []
  const proc = startFrameProcess(CHILD, mode, {
    env: process.env,
    timeoutMs: 10_000,
    onFrame: (frame) => frames.push(frame),
    ...options
  })
  return { frames, proc }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(check: () => boolean, ms = 5_000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting')
    await sleep(20)
  }
}

test('frames go out as JSON lines and come back parsed; lines that are not JSON are skipped', async () => {
  const { frames, proc } = start(['echo'])
  proc.send({ n: 1 })
  proc.send({ text: 'two words\nand a newline' })
  await waitFor(() => frames.length === 2)
  const exit = await proc.close(5_000)
  expect(frames).toEqual([{ echo: { n: 1 } }, { echo: { text: 'two words\nand a newline' } }])
  expect(exit).toEqual({ end: 'exited', code: 0, signal: null, errorCode: null })
})

test('a frame that arrives in pieces is put together, and a CRLF line end is dropped', async () => {
  const { frames, proc } = start(['split'])
  const exit = await proc.exited
  expect(frames).toEqual([{ parts: ['one', 'two'] }])
  expect(exit.end).toBe('exited')
})

test('the exit code is answered', async () => {
  const { proc } = start(['exit', '3'])
  expect(await proc.exited).toEqual({ end: 'exited', code: 3, signal: null, errorCode: null })
})

test('the environment given is the one the program sees', async () => {
  const { frames, proc } = start(['env', 'KURMIS_FRAME_TEST'], { env: { ...process.env, KURMIS_FRAME_TEST: 'here' } })
  await proc.exited
  expect(frames).toEqual([{ value: 'here' }])
})

test('a program still running at its deadline is killed', async () => {
  const started = Date.now()
  const { proc } = start(['hang'], { timeoutMs: 300 })
  const exit = await proc.exited
  expect(Date.now() - started).toBeLessThan(5_000)
  expect(exit).toMatchObject({ end: 'timeout', code: null })
  expect(isRunning(proc.pid ?? 0)).toBe(false)
})

test('close kills a program that does not exit after its input ends', async () => {
  const { proc } = start(['hang'])
  const exit = await proc.close(200)
  expect(exit).toMatchObject({ end: 'close_timeout', code: null })
})

test('aborting the signal kills the program', async () => {
  const controller = new AbortController()
  const { proc } = start(['hang'], { signal: controller.signal })
  await sleep(100)
  controller.abort()
  expect(await proc.exited).toMatchObject({ end: 'aborted', code: null })
})

test('a signal that is already aborted means the program is not started', async () => {
  const controller = new AbortController()
  controller.abort()
  const { proc } = start(['echo'], { signal: controller.signal })
  expect(proc.pid).toBeUndefined()
  expect(await proc.exited).toEqual({ end: 'aborted', code: null, signal: null, errorCode: null })
})

test('kill ends the program', async () => {
  const { proc } = start(['hang'])
  proc.kill()
  expect(await proc.exited).toMatchObject({ end: 'killed' })
})

test('a line longer than the cap kills the program', async () => {
  const { proc, frames } = start(['longline', String(64 * 1024)], { maxFrameBytes: 1024 })
  expect(await proc.exited).toMatchObject({ end: 'output_too_large' })
  expect(frames).toEqual([])
})

test('more output than the cap in all kills the program', async () => {
  const { proc } = start(['echo'], { maxOutputBytes: 64 })
  for (let i = 0; i < 20; i++) proc.send({ i })
  expect(await proc.exited).toMatchObject({ end: 'output_too_large' })
})

test('a program that does not exist is a failed start, not a thrown error', async () => {
  const proc = startFrameProcess(resolve('test/platform/no-such-program'), [], { env: process.env, timeoutMs: 1_000, onFrame: () => undefined })
  expect(await proc.exited).toEqual({ end: 'start_failed', code: null, signal: null, errorCode: 'ENOENT' })
})

test('a batch file is refused on every platform', async () => {
  for (const name of ['claude.cmd', 'CODEX.BAT']) {
    const proc = startFrameProcess(name, [], { env: process.env, timeoutMs: 1_000, onFrame: () => undefined })
    expect(proc.pid).toBeUndefined()
    expect((await proc.exited).end).toBe('refused')
  }
})

test.skipIf(process.platform === 'win32')('a kill takes the processes the program started with it', async () => {
  const { proc, frames } = start(['grandchild'])
  await waitFor(() => frames.length === 1)
  const grandchild = (frames[0] as { grandchild: number }).grandchild
  expect(isRunning(grandchild)).toBe(true)
  proc.kill()
  await proc.exited
  await waitFor(() => !isRunning(grandchild))
})

test('sending after the input is closed does nothing', async () => {
  const { proc, frames } = start(['echo'])
  proc.endInput()
  proc.send({ late: true })
  await proc.exited
  expect(frames).toEqual([])
})

test('on Windows the tree is ended with taskkill from System32, found without regard to case', () => {
  expect(treeKillCommand(4242, 'win32', { SYSTEMROOT: 'D:\\Win' })).toEqual({
    command: 'D:\\Win\\System32\\taskkill.exe',
    args: ['/PID', '4242', '/T', '/F']
  })
  expect(treeKillCommand(7, 'win32', {})?.command).toBe('C:\\Windows\\System32\\taskkill.exe')
  expect(treeKillCommand(7, 'darwin', {})).toBeNull()
  expect(treeKillCommand(7, 'linux', {})).toBeNull()
})

test('the line splitter keeps an incomplete line and reports one past the cap', () => {
  const lines: string[] = []
  const split = createLineSplitter(8, (line) => lines.push(line))
  expect(split(Buffer.from('ab\ncd'))).toBe(true)
  expect(split(Buffer.from('ef\r\n\n'))).toBe(true)
  expect(lines).toEqual(['ab', 'cdef', ''])
  expect(split(Buffer.from('123456789'))).toBe(false)
})
