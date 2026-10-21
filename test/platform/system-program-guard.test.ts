import { describe, expect, it } from 'vitest'
import { runProgram } from '../../src/platform/run.ts'
import { spawnDetached } from '../../src/platform/detach.ts'
import { GUARD_VARIABLE, refusedByGuard, withGuard } from '../../src/platform/system-program-guard.ts'

describe('the system program guard', () => {
  it('is on in every test', () => {
    expect(process.env[GUARD_VARIABLE]).toBe('1')
  })

  it('refuses the real system programs and CLIs, whatever the path, case or .exe', () => {
    for (const program of ['/bin/launchctl', '/usr/bin/security', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\reg.exe', 'C:\\Windows\\System32\\TASKKILL.EXE', 'C:\\Windows\\System32\\wscript.exe',
      '/opt/homebrew/bin/claude', '/usr/local/bin/codex']) {
      expect(refusedByGuard(program, {}), program).not.toBeNull()
    }
    expect(refusedByGuard(process.execPath, {})).toBeNull()
  })

  it('stops runProgram and spawnDetached even with an environment that has no stand-ins', async () => {
    const run = await runProgram('/bin/launchctl', ['print', 'gui/0'], { timeoutMs: 5_000, env: {} })
    expect(run.error).toMatch(/KURMIS_REFUSE_SYSTEM_PROGRAMS/)
    await expect(spawnDetached({ command: '/usr/bin/security', args: [], env: {} })).rejects.toThrow(/KURMIS_REFUSE_SYSTEM_PROGRAMS/)
  })

  it('is passed on to the programs kurmis starts', () => {
    expect(withGuard({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin', [GUARD_VARIABLE]: '1' })
  })
})
