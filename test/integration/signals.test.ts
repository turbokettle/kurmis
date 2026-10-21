// `kurmis claude` on a real terminal, through the real bundle: a pseudo-terminal driven by
// test/cli/pty-driver.py (run with `python3 -I`), with the fake claude held interactive
// (`FAKE_CLAUDE_HOLD_MS`). Ctrl-C there reaches the terminal's whole foreground process group,
// so these check that kurmis survives it, waits for claude and ends the way claude ended:
//
// - Ctrl-C: the fake claude gets SIGINT and exits 130; kurmis exits 130.
// - SIGTERM to kurmis alone: forwarded; the fake claude exits 143, and so does kurmis.
// - A claude that a signal ends (no handler of its own): kurmis ends by the same signal.
// - A claude that exits with a code: kurmis exits with that code.
//
// The driver passes its own environment on to kurmis, so it runs with the world's environment
// (plus python3's folder on PATH). Not on Windows, which has no pseudo-terminals of this kind and
// no signals between processes.
import { execFile, execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FakeClaudeRecord } from '../fakes/index.ts'
import { createWorld, type World } from './harness.ts'

const DRIVER = resolve('test/cli/pty-driver.py')
const FAKE_CLAUDE_READY = 'started without -p'

interface DriverResult {
  exitCode: number | null
  signal: string | null
  sent: boolean
  leftover: boolean
  timedOut: boolean
  output: string
}

/** The python3 the tests use, as an absolute path, or null when there is none. */
function findPython(): string | null {
  if (process.platform === 'win32') return null
  try {
    return execFileSync('python3', ['-I', '-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

const python = findPython()

/**
 * Runs `kurmis <args>` on a new pseudo-terminal and does `action` once `ready` appears there.
 * The driver gives up after 30 s and kills what is left; the test allows 60 s in all, because
 * the machine may be loaded.
 */
async function drive(world: World, action: 'ctrl-c' | 'sigterm', ready: string, args: string[],
  env: Record<string, string> = {}): Promise<DriverResult> {
  const childEnv = { ...world.env, PATH: `${world.env.PATH!}${delimiter}${dirname(python!)}`, ...env }
  return await new Promise((done, fail) => {
    execFile(python!, ['-I', DRIVER, action, ready, '30', process.execPath, world.bundle, ...args],
      { env: childEnv, cwd: world.work, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error !== null) {
          fail(new Error(`pty-driver failed: ${error.message}\n${stderr}`))
          return
        }
        done(JSON.parse(stdout) as DriverResult)
      })
  })
}

function signalsSeen(world: World): string[] {
  return world.claudeRecord().flatMap((line) => (line.kind === 'signal' ? [line.signal] : []))
}

/** An interactive start of the fake claude (kurmis passes `--settings` first, and no `-p`). */
function interactiveStarts(world: World): Array<Extract<FakeClaudeRecord, { kind: 'start' }>> {
  return world.claudeRecord().filter((line): line is Extract<FakeClaudeRecord, { kind: 'start' }> =>
    line.kind === 'start' && !line.argv.includes('-p') && !line.argv.includes('--input-format'))
}

/**
 * A claude with no signal handler of its own, so a signal ends it with the signal's default
 * action. It prints `default-signal claude waiting` once it waits.
 */
function writeDefaultSignalClaude(world: World): string {
  const file = join(world.root, 'default-signal-claude.mjs')
  writeFileSync(file, [
    "import process from 'node:process'",
    "import { setTimeout } from 'node:timers'",
    'setTimeout(() => process.exit(0), 20_000)',
    "process.stdout.write('default-signal claude waiting\\n')",
    ''
  ].join('\n'))
  return file
}

describe.skipIf(python === null)('kurmis claude on a pseudo-terminal', () => {
  it('Ctrl-C: the fake claude gets SIGINT and exits 130, kurmis waits and exits 130, and the daemon it started keeps running', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()

    // No daemon runs yet: this kurmis claude starts it, from inside the terminal.
    const result = await drive(world, 'ctrl-c', FAKE_CLAUDE_READY, ['claude'], { FAKE_CLAUDE_HOLD_MS: '20000' })
    expect(result, JSON.stringify(result)).toMatchObject({ sent: true, timedOut: false, leftover: false, exitCode: 130, signal: null })
    expect(signalsSeen(world)).toEqual(['SIGINT'])
    const starts = interactiveStarts(world)
    expect(starts).toHaveLength(1)
    expect(starts[0]!.effectiveEnv).toMatchObject({ ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(world.port)}` })
    expect(world.claudeRecord().filter((line) => line.kind === 'exit' && line.pid === starts[0]!.pid)).toHaveLength(1)

    // The daemon is in a session of its own, so the terminal's Ctrl-C did not reach it.
    const info = world.daemonInfo()
    expect(info).not.toBeNull()
    const status = await world.kurmis(['daemon', 'status'])
    expect(status, JSON.stringify(status)).toMatchObject({ code: 0 })
    expect(world.daemonInfo()?.pid).toBe(info!.pid)
  }, 90_000)

  it('SIGTERM to kurmis is forwarded: the fake claude exits 143, and so does kurmis', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()

    const result = await drive(world, 'sigterm', FAKE_CLAUDE_READY, ['claude'], { FAKE_CLAUDE_HOLD_MS: '20000' })
    expect(result, JSON.stringify(result)).toMatchObject({ sent: true, timedOut: false, leftover: false, exitCode: 143, signal: null })
    expect(signalsSeen(world)).toEqual(['SIGTERM'])
  }, 90_000)

  it('a claude that the signal ends makes kurmis end by the same signal, for Ctrl-C and for SIGTERM', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    // The daemon runs with the fake claude for its probes; only the CLI kurmis starts is the other one.
    expect((await world.kurmis(['daemon', 'start'])).code).toBe(0)
    const claude = writeDefaultSignalClaude(world)

    const interrupted = await drive(world, 'ctrl-c', 'default-signal claude waiting', ['claude'], { KURMIS_CLAUDE_BIN: claude })
    expect(interrupted, JSON.stringify(interrupted)).toMatchObject({ sent: true, timedOut: false, leftover: false, exitCode: null, signal: 'SIGINT' })

    const terminated = await drive(world, 'sigterm', 'default-signal claude waiting', ['claude'], { KURMIS_CLAUDE_BIN: claude })
    expect(terminated, JSON.stringify(terminated)).toMatchObject({ sent: true, timedOut: false, leftover: false, exitCode: null, signal: 'SIGTERM' })
  }, 90_000)

  it('kurmis exits with the exit code of claude', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()

    // The driver waits for text that never comes, so it sends nothing and only reports the end.
    const result = await drive(world, 'ctrl-c', 'text the fake claude never prints', ['claude'], { FAKE_CLAUDE_EXIT_CODE: '7' })
    expect(result, JSON.stringify(result)).toMatchObject({ sent: false, timedOut: false, leftover: false, exitCode: 7, signal: null })
    expect(result.output).toContain(FAKE_CLAUDE_READY)
  }, 90_000)
})
