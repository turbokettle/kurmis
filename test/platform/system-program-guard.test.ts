import { readFileSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { runProgram } from '../../src/platform/run.ts'
import { spawnDetached } from '../../src/platform/detach.ts'
import { GUARD_VARIABLE, REFUSAL_LOG_VARIABLE, refusedByGuard, withGuard } from '../../src/platform/system-program-guard.ts'

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
      '/opt/homebrew/bin/claude', '/usr/local/bin/codex']
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

  it('is passed on, with the refusal log, to the programs kurmis starts', () => {
    expect(withGuard({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin', [GUARD_VARIABLE]: '1', [REFUSAL_LOG_VARIABLE]: log })
  })
})
