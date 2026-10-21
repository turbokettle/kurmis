import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createThroughWmi,
  inSshSession,
  kurmisEntry,
  nodeForJobs,
  parseWmiCreateAnswer,
  powerShellInvocation,
  powerShellQuote,
  spawnDetached,
  windowsCommandLine,
  wmiCreateScript
} from '../../src/platform/detach.ts'
import type { RunResult } from '../../src/platform/run.ts'
import { realSystemProgram } from '../../src/platform/system-programs.ts'

const scratch = mkdtempSync(join(tmpdir(), 'kurmis-detach-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function result(patch: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', code: 0, timedOut: false, outputTooLarge: false, error: null, ...patch }
}

describe('kurmisEntry', () => {
  it('takes KURMIS_ENTRY first', () => {
    expect(kurmisEntry({ env: { KURMIS_ENTRY: '/opt/example/kurmis.cjs' }, moduleFile: '/elsewhere/kurmis.cjs' })).toBe('/opt/example/kurmis.cjs')
  })

  it('is null when running from source with no KURMIS_ENTRY', () => {
    expect(kurmisEntry({ env: {}, moduleFile: null })).toBeNull()
    // Under vitest this module is a .ts file, which is not a bundle.
    expect(kurmisEntry({ env: {} })).toBeNull()
  })

  it('resolves a symlinked bundle to its real file', () => {
    const real = join(scratch, 'real.cjs')
    writeFileSync(real, '')
    const link = join(scratch, 'link.cjs')
    symlinkSync(real, link)
    expect(kurmisEntry({ env: {}, moduleFile: link })).toBe(kurmisEntry({ env: {}, moduleFile: real }))
  })
})

describe('nodeForJobs', () => {
  it('prefers the node on PATH when it is the same file as the running one', () => {
    const bin = join(scratch, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'node'), '')
    const realpath = (path: string): string => (path === join(bin, 'node') ? '/cellar/node/22.1.0/bin/node' : path)
    expect(nodeForJobs({ env: { PATH: bin }, platform: 'darwin', execPath: '/cellar/node/22.1.0/bin/node', realpath }))
      .toBe(join(bin, 'node'))
  })

  it('keeps the running node when the one on PATH is another', () => {
    const bin = join(scratch, 'other-bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'node'), '')
    const realpath = (path: string): string => path
    expect(nodeForJobs({ env: { PATH: bin }, platform: 'darwin', execPath: '/usr/local/bin/node22', realpath }))
      .toBe('/usr/local/bin/node22')
  })

  it('keeps the running node when PATH has none', () => {
    expect(nodeForJobs({ env: { PATH: join(scratch, 'empty') }, platform: 'linux', execPath: process.execPath }))
      .toBe(process.execPath)
  })
})

describe('inSshSession', () => {
  it('is true when the ssh server set its variables', () => {
    expect(inSshSession({ SSH_CONNECTION: '192.0.2.1 50000 192.0.2.2 22' })).toBe(true)
    expect(inSshSession({ SSH_CLIENT: '192.0.2.1 50000 22' })).toBe(true)
    expect(inSshSession({ SSH_TTY: '/dev/ttys001' })).toBe(true)
    expect(inSshSession({})).toBe(false)
    expect(inSshSession({ SSH_CONNECTION: '' })).toBe(false)
  })
})

describe('spawnDetached', () => {
  it('starts a program with the given environment and reports its exit', async () => {
    const marker = join(scratch, 'marker.txt')
    const child = await spawnDetached({
      command: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.env.EXAMPLE_VALUE)`],
      env: { ...process.env, EXAMPLE_VALUE: 'from-the-parent' }
    })
    expect(child.pid).toBeGreaterThan(0)
    expect(await child.exited).toBe(0)
    expect(existsSync(marker)).toBe(true)
  })

  it('rejects when the program does not exist', async () => {
    await expect(spawnDetached({ command: join(scratch, 'no-such-program'), args: [], env: process.env })).rejects.toThrow()
  })
})

describe('windowsCommandLine', () => {
  it('quotes the way the Microsoft C runtime splits again', () => {
    expect(windowsCommandLine(['C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\example\\kurmis.cjs', 'daemon', 'run']))
      .toBe('"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\example\\kurmis.cjs daemon run')
    expect(windowsCommandLine([''])).toBe('""')
    expect(windowsCommandLine(['say "hi"'])).toBe('"say \\"hi\\""')
    // Backslashes before the closing quote are doubled, others are kept.
    expect(windowsCommandLine(['C:\\a b\\'])).toBe('"C:\\a b\\\\"')
    expect(windowsCommandLine(['a\\\\"b'])).toBe('"a\\\\\\\\\\"b"')
  })
})

describe('the WMI start', () => {
  it('quotes every value in single-quoted PowerShell strings', () => {
    expect(powerShellQuote("it's")).toBe("'it''s'")
    const script = wmiCreateScript(['C:\\Program Files\\nodejs\\node.exe', "C:\\Users\\o'example\\kurmis.cjs", 'daemon', 'run'], 'C:\\Users\\o\'example')
    expect(script).toContain("CommandLine='\"C:\\Program Files\\nodejs\\node.exe\" C:\\Users\\o''example\\kurmis.cjs daemon run'")
    expect(script).toContain("CurrentDirectory='C:\\Users\\o''example'")
  })

  it('doubles every quote character PowerShell ends a single-quoted string at', () => {
    expect(powerShellQuote('a\u2018b\u2019c\u201ad\u201be')).toBe("'a\u2018\u2018b\u2019\u2019c\u201a\u201ad\u201b\u201be'")
    expect(powerShellQuote("O\u2019Brien's")).toBe("'O\u2019\u2019Brien''s'")
  })

  it('creates the process hidden, and uses nothing Constrained Language Mode blocks', () => {
    const script = wmiCreateScript(['node.exe', 'kurmis.cjs'], 'C:\\Users\\example')
    expect(script).toContain('New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}')
    expect(script).toContain(';ProcessStartupInformation=$s}')
    expect(script).not.toContain('[Console]')
    expect(script).toContain("Write-Output ('pid '+$r.ProcessId)")
  })

  it('runs powershell from the Windows folder with the script encoded', () => {
    const { program, args } = powerShellInvocation('Write-Output 1', { SystemRoot: 'D:\\Windows' })
    // Every test has the stand-in; the real program is in the Windows folder.
    expect(program).toBe(process.env.KURMIS_POWERSHELL_PROGRAM)
    expect(realSystemProgram('powershell', { SystemRoot: 'D:\\Windows' })).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
    expect(Buffer.from(args[5] ?? '', 'base64').toString('utf16le')).toBe('Write-Output 1')
  })

  it('reads the pid, or says why WMI refused', () => {
    expect(parseWmiCreateAnswer(result({ stdout: 'pid 4242\r\n' }))).toBe(4242)
    expect(() => parseWmiCreateAnswer(result({ code: 1, stderr: 'Win32_Process.Create answered 9' }))).toThrow(/answered 9/)
    expect(() => parseWmiCreateAnswer(result({ stdout: 'something else' }))).toThrow(/WMI did not create/)
  })

  it('passes the script to the runner and answers the pid', async () => {
    const calls: Array<{ program: string; args: readonly string[] }> = []
    const pid = await createThroughWmi(['node.exe', 'kurmis.cjs'], 'C:\\Users\\example', { SystemRoot: 'C:\\Windows' },
      (program, args) => {
        calls.push({ program, args })
        return Promise.resolve(result({ stdout: 'pid 77' }))
      })
    expect(pid).toBe(77)
    expect(calls[0]?.program).toBe(process.env.KURMIS_POWERSHELL_PROGRAM)
  })
})
