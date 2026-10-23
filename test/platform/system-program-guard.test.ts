import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { daemonEnvironment } from '../../src/cli/daemon-client.ts'
import { findProgram } from '../../src/platform/programs.ts'
import { runProgram } from '../../src/platform/run.ts'
import { spawnDetached } from '../../src/platform/detach.ts'
import { startFrameProcess } from '../../src/platform/frame-process.ts'
import { inheritedTestHooks } from '../../src/platform/system-programs.ts'
import { GUARD_VARIABLE, REFUSAL_LOG_VARIABLE, refusedByGuard, withGuard } from '../../src/platform/system-program-guard.ts'
import { canCreateSymlinks } from '../host.ts'

const log = process.env[REFUSAL_LOG_VARIABLE] ?? ''

/** What the guard recorded, emptied, so the check in test/setup.ts does not fail these tests that ask for refusals. */
function takeRefusals(): string[] {
  const lines = readFileSync(log, 'utf8').split('\n').filter((line) => line !== '')
  writeFileSync(log, '')
  return lines
}

afterEach(() => {
  takeRefusals()
})

describe('the system program guard', () => {
  it('is on in every test, with a refusal log', () => {
    expect(process.env[GUARD_VARIABLE]).toBe('1')
    expect(log).not.toBe('')
  })

  it('refuses the real system programs and CLIs, whatever the path, case or .exe, and records each refusal', () => {
    const programs = ['/bin/launchctl', '/usr/bin/security', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\reg.exe', 'C:\\Windows\\System32\\TASKKILL.EXE', 'C:\\Windows\\System32\\wscript.exe',
      '/opt/homebrew/bin/claude']
    for (const program of programs) expect(refusedByGuard(program, {}), program).not.toBeNull()
    expect(refusedByGuard(process.execPath, {})).toBeNull()
    expect(takeRefusals()).toEqual(programs)
  })

  it('stops runProgram and spawnDetached even with an environment that has no stand-ins', async () => {
    const run = await runProgram('/bin/launchctl', ['print', 'gui/0'], { timeoutMs: 5_000, env: {} })
    expect(run.error).toMatch(/KURMIS_REFUSE_SYSTEM_PROGRAMS/)
    await expect(spawnDetached({ command: '/usr/bin/security', args: [], env: {} })).rejects.toThrow(/KURMIS_REFUSE_SYSTEM_PROGRAMS/)
    expect(takeRefusals()).toEqual(['/bin/launchctl', '/usr/bin/security'])
  })

  it('is passed on, with the refusal log and the test home, to the programs kurmis starts', () => {
    expect(withGuard({ PATH: '/usr/bin' })).toEqual({
      PATH: '/usr/bin',
      [GUARD_VARIABLE]: '1',
      [REFUSAL_LOG_VARIABLE]: log,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      KURMIS_HOME: process.env.KURMIS_HOME,
      KURMIS_CLAUDE_BIN: process.env.KURMIS_CLAUDE_BIN,
      KURMIS_UPSTREAM_URL: process.env.KURMIS_UPSTREAM_URL
    })
    // A value the environment has, even an empty one, is kept.
    expect(withGuard({ HOME: '/elsewhere', KURMIS_CLAUDE_BIN: '' })).toMatchObject({ HOME: '/elsewhere', KURMIS_CLAUDE_BIN: '' })
  })

  it('refuses cmd.exe', () => {
    expect(refusedByGuard('C:\\Windows\\System32\\cmd.exe', {})).not.toBeNull()
    expect(takeRefusals()).toEqual(['C:\\Windows\\System32\\cmd.exe'])
  })
})

describe('the guard against the real claude run through Node', () => {
  const root = mkdtempSync(join(tmpdir(), 'kurmis-guard-'))
  afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10 }))

  /** A script at the place an npm package keeps the real CLI's entry, which leaves a mark when it runs. */
  function packageScript(relative: string): { script: string; mark: string } {
    const script = join(root, 'lib', 'node_modules', ...relative.split('/'))
    const mark = `${script}.ran`
    mkdirSync(join(script, '..'), { recursive: true })
    writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(mark)}, '')\n`, { mode: 0o755 })
    return { script, mark }
  }

  it('refuses Node running an entry script of the npm package, and records it', () => {
    for (const script of ['/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js',
      'C:\\Users\\Example\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
      '/usr/lib/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs']) {
      expect(refusedByGuard(process.execPath, {}, [script]), script).not.toBeNull()
      expect(refusedByGuard('C:\\Program Files\\nodejs\\node.exe', {}, ['--no-warnings', script]), script).not.toBeNull()
    }
    expect(takeRefusals()).toHaveLength(6)
    // A stand-in script is started.
    expect(refusedByGuard(process.execPath, {}, ['/repo/test/fakes/claude/fake-claude.js'])).toBeNull()
  })

  it('refuses the native programs of the per-platform packages and of the native installer, by their real path', () => {
    expect(refusedByGuard('/x/node_modules/@anthropic-ai/claude-code-darwin-arm64/claude', {})).not.toBeNull()
    expect(refusedByGuard('/Users/example/.local/share/claude/versions/2.1.306', {})).not.toBeNull()
    expect(takeRefusals()).toHaveLength(2)
  })

  it('stops every way kurmis starts a program from running such a script', async () => {
    const { script, mark } = packageScript('@anthropic-ai/claude-code/cli.js')
    const run = await runProgram(script, ['--version'], { timeoutMs: 10_000, env: {} })
    expect(run.error).toMatch(/KURMIS_REFUSE_SYSTEM_PROGRAMS/)
    await expect(spawnDetached({ command: process.execPath, args: [script], env: {} })).rejects.toThrow(/KURMIS_REFUSE_SYSTEM_PROGRAMS/)
    const frames = startFrameProcess(script, ['-p', '--input-format', 'stream-json'], { env: {}, timeoutMs: 10_000, onFrame: () => undefined })
    expect((await frames.exited).end).toBe('refused')
    expect(existsSync(mark)).toBe(false)
    expect(takeRefusals()).toHaveLength(3)
  })

  it.skipIf(!canCreateSymlinks())('refuses a claude on PATH that links to the npm package, which findProgram runs through Node', async () => {
    const { script, mark } = packageScript('@anthropic-ai/claude-code/cli.js')
    const bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    symlinkSync(script, join(bin, 'claude'))
    // An empty KURMIS_CLAUDE_BIN asks for the PATH search, as only the tests of the search do.
    const found = findProgram({ env: { PATH: bin, KURMIS_CLAUDE_BIN: '' }, platform: 'darwin', ownEntry: null })
    expect(found.command).toBe(process.execPath)
    const run = await runProgram(found.command, found.args, { timeoutMs: 10_000, env: {} })
    expect(run.error).toMatch(/KURMIS_REFUSE_SYSTEM_PROGRAMS/)
    expect(existsSync(mark)).toBe(false)
    expect(takeRefusals()).toHaveLength(1)
  })

  it('makes findProgram use the program test/setup.ts names when the environment it is given has none', () => {
    const named = process.env.KURMIS_CLAUDE_BIN ?? ''
    expect(named).not.toBe('')
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(findProgram({ env: { PATH: '/usr/local/bin:/opt/homebrew/bin' }, platform, ownEntry: null }))
        .toEqual({ command: process.execPath, args: [named] })
      expect(findProgram({ env: {}, platform, ownEntry: null }).args).toEqual([named])
    }
  })
})

describe('a daemon a test starts with an environment of its own', () => {
  it('gets the test home, the claude and the API address of test/setup.ts, not the real ones', () => {
    const env = daemonEnvironment({})
    expect(env.HOME).toBe(process.env.HOME)
    expect(env.USERPROFILE).toBe(process.env.USERPROFILE)
    expect(env.KURMIS_HOME).toBe(process.env.KURMIS_HOME)
    expect(env.KURMIS_CLAUDE_BIN).toBe(process.env.KURMIS_CLAUDE_BIN)
    expect(env.KURMIS_UPSTREAM_URL).toBe('http://127.0.0.1:1')
    expect(env[GUARD_VARIABLE]).toBe('1')
  })

  it('outside the tests gets nothing added', () => {
    expect(inheritedTestHooks({}, { HOME: '/home/example', KURMIS_HOME: '/home/example/.kurmis' })).toEqual({})
    expect(inheritedTestHooks({}, { [GUARD_VARIABLE]: '1', HOME: '/tmp/test-home' })).toEqual({ [GUARD_VARIABLE]: '1', HOME: '/tmp/test-home' })
  })
})
