import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import { invocationFor, runProgram } from '../../src/platform/run.ts'

const CHILD = resolve('test/platform/run-child.mjs')
const RUN = { timeoutMs: 10_000 }

test('a JavaScript entry point runs through node, with its arguments passed as they are', async () => {
  const result = await runProgram(CHILD, ['echo', 'two words', '--flag=a b', '"quoted"', ''], RUN)
  expect(result).toEqual({
    stdout: JSON.stringify(['two words', '--flag=a b', '"quoted"', '']),
    stderr: 'to stderr',
    code: 0,
    timedOut: false,
    outputTooLarge: false,
    error: null
  })
})

test('a non-zero exit is an answer, not an error', async () => {
  const result = await runProgram(CHILD, ['exit', '44'], RUN)
  expect(result).toMatchObject({ code: 44, stderr: 'failing', timedOut: false, outputTooLarge: false, error: null })
})

test('standard input is closed, so a program reading it gets end-of-file at once', async () => {
  const result = await runProgram(CHILD, ['stdin'], RUN)
  expect(result).toMatchObject({ code: 0, stdout: 'stdin ended after 0 bytes', timedOut: false })
})

test('the environment can be replaced', async () => {
  const result = await runProgram(CHILD, ['env', 'KURMIS_RUN_TEST'], { ...RUN, env: { ...process.env, KURMIS_RUN_TEST: 'set here' } })
  expect(result.stdout).toBe('set here')
  expect((await runProgram(CHILD, ['env', 'KURMIS_RUN_TEST'], RUN)).stdout).toBe('<unset>')
})

test('a program still running at its deadline is killed', async () => {
  const started = Date.now()
  const result = await runProgram(CHILD, ['hang'], { timeoutMs: 300 })
  expect(Date.now() - started).toBeLessThan(5_000)
  expect(result).toMatchObject({ code: null, timedOut: true, outputTooLarge: false })
  expect(result.error).toContain('did not finish within 300 ms')
})

test('a program that prints more than the cap is killed and keeps only the cap', async () => {
  const result = await runProgram(CHILD, ['flood', String(512 * 1024)], { ...RUN, maxOutputBytes: 1024 })
  expect(result).toMatchObject({ code: null, timedOut: false, outputTooLarge: true })
  expect(result.stdout).toBe('x'.repeat(1024))
  expect(result.error).toContain('printed more than 1024 bytes')
})

test('output under the cap is kept whole', async () => {
  const result = await runProgram(CHILD, ['flood', '1000'], { ...RUN, maxOutputBytes: 1024 })
  expect(result).toMatchObject({ code: 0, outputTooLarge: false, error: null })
  expect(result.stdout).toHaveLength(1000)
})

test('a program that is not there is an answer, not a thrown error', async () => {
  const result = await runProgram(join(tmpdir(), 'kurmis-no-such-program'), [], RUN)
  expect(result).toMatchObject({ stdout: '', stderr: '', code: null, timedOut: false, outputTooLarge: false })
  expect(result.error).toContain('could not be started')
})

test.each(['C:\\tools\\claude.cmd', 'C:\\tools\\CLAUDE.CMD', '/tmp/run.bat', 'run.Bat'])('%s is refused, never started', async (program) => {
  expect(invocationFor(program, ['--version'])).toEqual({ refused: expect.stringContaining('batch file') })
  const result = await runProgram(program, ['--version'], RUN)
  expect(result).toMatchObject({ code: null, timedOut: false, error: expect.stringContaining('never starts a program through a shell') })
})

test('the command for each kind of program', () => {
  expect(invocationFor('/usr/bin/security', ['-w'], '/node')).toEqual({ command: '/usr/bin/security', args: ['-w'] })
  expect(invocationFor('C:\\tools\\claude.exe', ['-p'], 'C:\\node.exe')).toEqual({ command: 'C:\\tools\\claude.exe', args: ['-p'] })
  expect(invocationFor('C:\\npm\\codex\\bin\\codex.js', ['app-server'], 'C:\\node.exe'))
    .toEqual({ command: 'C:\\node.exe', args: ['C:\\npm\\codex\\bin\\codex.js', 'app-server'] })
  expect(invocationFor('/x/fake.CJS', [], '/node')).toEqual({ command: '/node', args: ['/x/fake.CJS'] })
  expect(invocationFor('/x/fake.mjs', ['a'], '/node')).toEqual({ command: '/node', args: ['/x/fake.mjs', 'a'] })
})
