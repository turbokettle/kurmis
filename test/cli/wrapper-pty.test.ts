// The wrapper on a real terminal: a pseudo-terminal driven by test/cli/pty-driver.py. Ctrl-C
// reaches the whole foreground process group there, as it does in a terminal, so this checks
// that the wrapper itself survives it and waits for the child.
//
// What the wrapper ends with:
// - Ctrl-C to the fake claude: it exits 130 by itself, and the wrapper exits 130.
// - SIGTERM to the wrapper: forwarded; the fake claude exits 143, and so does the wrapper.
// - A child that the signal ends (no handler of its own): the wrapper raises the same signal on
//   itself, so the shell sees it ended by SIGINT or SIGTERM.
//
// Not on Windows, which has no pseudo-terminals of this kind and no signals between processes.
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { ChildSpec } from '../../src/cli/wrapper.ts'
import { FAKE_CLAUDE_SCRIPT, readFakeClaudeRecord } from '../fakes/claude.ts'

const DRIVER = resolve('test/cli/pty-driver.py')
const CHILD = resolve('test/cli/wrapper-child.mjs')
const FAKE_CLAUDE_READY = 'started without -p'

interface DriverResult {
  exitCode: number | null
  signal: string | null
  sent: boolean
  leftover: boolean
  timedOut: boolean
  output: string
}

let dir: string
let entry: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kurmis-wrapper-pty-'))
  entry = join(dir, 'wrapper-entry.mjs')
  await build({
    entryPoints: [resolve('test/cli/wrapper-pty-entry.ts')],
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning'
  })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

let specs = 0
function writeSpec(args: string[], env: Record<string, string> = {}): string {
  const spec: ChildSpec = { command: process.execPath, args, env: { ...(process.env as Record<string, string>), ...env } }
  const file = join(dir, `spec-${String(++specs)}.json`)
  writeFileSync(file, JSON.stringify(spec))
  return file
}

async function drive(action: 'ctrl-c' | 'sigterm', ready: string, spec: string): Promise<DriverResult> {
  return await new Promise((done, fail) => {
    execFile('python3', ['-I', DRIVER, action, ready, '15', process.execPath, entry, spec], { timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error !== null) {
          fail(new Error(`pty-driver failed: ${error.message}\n${stderr}`))
          return
        }
        done(JSON.parse(stdout) as DriverResult)
      })
  })
}

test.skipIf(process.platform === 'win32')('Ctrl-C: the fake claude exits 130, and the wrapper waits for it and exits 130', async () => {
  const record = join(dir, 'ctrl-c.jsonl')
  const result = await drive('ctrl-c', FAKE_CLAUDE_READY,
    writeSpec([FAKE_CLAUDE_SCRIPT], { FAKE_CLAUDE_HOLD_MS: '20000', FAKE_CLAUDE_RECORD: record }))
  expect(result).toMatchObject({ sent: true, timedOut: false, leftover: false, exitCode: 130, signal: null })
  expect(readFakeClaudeRecord(record).filter((line) => line.kind === 'signal')).toMatchObject([{ signal: 'SIGINT' }])
}, 30_000)

test.skipIf(process.platform === 'win32')('SIGTERM to the wrapper is forwarded; the fake claude exits 143 and so does the wrapper', async () => {
  const record = join(dir, 'sigterm.jsonl')
  const result = await drive('sigterm', FAKE_CLAUDE_READY,
    writeSpec([FAKE_CLAUDE_SCRIPT], { FAKE_CLAUDE_HOLD_MS: '20000', FAKE_CLAUDE_RECORD: record }))
  expect(result).toMatchObject({ sent: true, timedOut: false, leftover: false, exitCode: 143, signal: null })
  expect(readFakeClaudeRecord(record).filter((line) => line.kind === 'signal')).toMatchObject([{ signal: 'SIGTERM' }])
}, 30_000)

test.skipIf(process.platform === 'win32')('a child that Ctrl-C ends makes the wrapper end by SIGINT too', async () => {
  const result = await drive('ctrl-c', 'ready', writeSpec([CHILD, 'hold-default', '-']))
  expect(result).toMatchObject({ sent: true, timedOut: false, leftover: false, exitCode: null, signal: 'SIGINT' })
}, 30_000)

test.skipIf(process.platform === 'win32')('a child that the forwarded SIGTERM ends makes the wrapper end by SIGTERM', async () => {
  const result = await drive('sigterm', 'ready', writeSpec([CHILD, 'hold-default', '-']))
  expect(result).toMatchObject({ sent: true, timedOut: false, leftover: false, exitCode: null, signal: 'SIGTERM' })
}, 30_000)
