import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { windowsCommandLine } from '../../src/platform/detach.ts'
import {
  RUN_ENTRY_DESCRIPTION,
  RUN_KEY,
  autostartScript,
  encodeScript,
  parseRegQuery,
  regAddArgs,
  regDeleteArgs,
  regFor,
  regProgram,
  regQueryArgs,
  registerWindowsAutostart,
  runValueData,
  systemRoot,
  unregisterWindowsAutostart,
  vbsString,
  windowsAutostartEnvironment,
  wscriptPath
} from '../../src/platform/windows-autostart.ts'

/**
 * Splits a Windows command line the way the Microsoft C runtime does (and so reg.exe and
 * node.exe): the inverse of what Node does to an argument list for CreateProcess.
 */
function splitWindowsCommandLine(line: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuotes = false
  let started = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '\\') {
      let count = 0
      while (line[i] === '\\') { count++; i++ }
      if (line[i] === '"') {
        current += '\\'.repeat(Math.floor(count / 2))
        if (count % 2 === 1) current += '"'
        else { inQuotes = !inQuotes }
      } else {
        current += '\\'.repeat(count)
        i--
      }
      started = true
    } else if (char === '"') {
      inQuotes = !inQuotes
      started = true
    } else if ((char === ' ' || char === '\t') && !inQuotes) {
      if (started) args.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) args.push(current)
  return args
}

const NODE = 'C:\\Program Files\\nodejs\\node.exe'
const ENTRY = 'C:\\Users\\Example User\\AppData\\Roaming\\npm\\node_modules\\kurmis\\dist\\kurmis.cjs'
const SCRIPT = 'C:\\Users\\Example User\\.kurmis\\autostart.vbs'
const PROGRAM = [NODE, ENTRY, 'daemon', 'start', '--no-launchd']

describe('programs', () => {
  it('finds the Windows folder from the environment', () => {
    expect(systemRoot({ SystemRoot: 'D:\\Windows\\' })).toBe('D:\\Windows')
    expect(systemRoot({ windir: 'E:\\WINDOWS' })).toBe('E:\\WINDOWS')
    expect(systemRoot({})).toBe('C:\\Windows')
  })

  it('runs reg.exe and wscript.exe from System32, unless the test hook names a reg', () => {
    expect(regProgram({ SystemRoot: 'C:\\Windows' })).toBe('C:\\Windows\\System32\\reg.exe')
    expect(regProgram({ KURMIS_REG_PROGRAM: '/tmp/reg.mjs' })).toBe('/tmp/reg.mjs')
    expect(regProgram()).toMatch(/fake-reg[\\/]reg\.mjs$/)
    expect(wscriptPath({ SystemRoot: 'C:\\Windows' })).toBe('C:\\Windows\\System32\\wscript.exe')
  })
})

describe('the Run value', () => {
  it('runs wscript hidden, without dialogs, on the script', () => {
    expect(runValueData('C:\\Windows\\System32\\wscript.exe', SCRIPT))
      .toBe('C:\\Windows\\System32\\wscript.exe //B //Nologo "C:\\Users\\Example User\\.kurmis\\autostart.vbs"')
  })

  it('is a REG_SZ set, queried and deleted under HKCU Run', () => {
    expect(regAddArgs('x y')).toEqual(['add', RUN_KEY, '/v', 'kurmis', '/t', 'REG_SZ', '/d', 'x y', '/f'])
    expect(regQueryArgs()).toEqual(['query', RUN_KEY, '/v', 'kurmis'])
    expect(regDeleteArgs()).toEqual(['delete', RUN_KEY, '/v', 'kurmis', '/f'])
    expect(RUN_KEY).toBe('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')
  })

  it('keeps its quotes through the command line Node builds for reg.exe', () => {
    const data = runValueData('C:\\Windows\\System32\\wscript.exe', 'C:\\Users\\Example User\\kurmis data\\autostart.vbs')
    const args = regAddArgs(data)
    // Node quotes each argument for CreateProcess with the C runtime's rules, which is what
    // `windowsCommandLine` writes too; reg.exe splits its command line with the same rules.
    const line = windowsCommandLine(['reg.exe', ...args])
    expect(line).toContain('"C:\\Windows\\System32\\wscript.exe //B //Nologo \\"C:\\Users\\Example User\\kurmis data\\autostart.vbs\\""')
    expect(splitWindowsCommandLine(line).slice(1)).toEqual(args)
  })

  it('reads the value out of what reg query prints', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n' +
      '    OneDrive    REG_SZ    "C:\\Program Files\\Example\\app.exe" /background\r\n' +
      '    kurmis    REG_SZ    C:\\Windows\\System32\\wscript.exe //B "C:\\a b\\x.vbs"\r\n' +
      '    Empty    REG_EXPAND_SZ\r\n\r\n'
    expect(parseRegQuery(out, 'kurmis')).toEqual({ type: 'REG_SZ', data: 'C:\\Windows\\System32\\wscript.exe //B "C:\\a b\\x.vbs"' })
    expect(parseRegQuery(out, 'KURMIS')).toEqual({ type: 'REG_SZ', data: 'C:\\Windows\\System32\\wscript.exe //B "C:\\a b\\x.vbs"' })
    expect(parseRegQuery(out, 'Empty')).toEqual({ type: 'REG_EXPAND_SZ', data: '' })
    expect(parseRegQuery(out, 'missing')).toBeNull()
    expect(parseRegQuery('', 'kurmis')).toBeNull()
  })
})

describe('the logon script', () => {
  it('doubles quotes in VBScript strings and refuses line breaks', () => {
    expect(vbsString('a "b" c')).toBe('"a ""b"" c"')
    expect(vbsString('')).toBe('""')
    expect(() => vbsString('a\nb')).toThrow(/line break/)
  })

  it('sets the kurmis variables, the folder, and starts node hidden without waiting', () => {
    const text = autostartScript({
      programArguments: PROGRAM,
      environment: { KURMIS_HOME: 'D:\\kurmis data' },
      cwd: 'C:\\Users\\Example User'
    })
    expect(text.split('\r\n')).toEqual([
      "' Written by kurmis setup: starts the kurmis daemon at logon without a console window.",
      "' kurmis setup --undo removes it.",
      'Set shell = CreateObject("WScript.Shell")',
      'shell.Environment("Process")("KURMIS_HOME") = "D:\\kurmis data"',
      'shell.CurrentDirectory = "C:\\Users\\Example User"',
      'shell.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\Users\\Example User\\AppData\\Roaming\\npm\\node_modules\\kurmis\\dist\\kurmis.cjs"" daemon start --no-launchd", 0, False',
      ''
    ])
  })

  it('carries only the kurmis variables', () => {
    expect(windowsAutostartEnvironment({
      KURMIS_HOME: 'D:\\k', KURMIS_CLAUDE_BIN: 'C:\\c.exe', KURMIS_ENTRY: '',
      ANTHROPIC_API_KEY: 'sk-ant-api03-fake', Path: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Example User'
    })).toEqual({ KURMIS_HOME: 'D:\\k', KURMIS_CLAUDE_BIN: 'C:\\c.exe' })
  })

  it('is written as UTF-16 with a byte order mark', () => {
    const bytes = encodeScript("' Zoë\r\n")
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe])
    expect(bytes.subarray(2).toString('utf16le')).toBe("' Zoë\r\n")
  })
})

describe('registering through reg.exe', () => {
  const regDir = (): string => process.env.FAKE_REG_DIR ?? ''
  const scriptPath = (): string => join(process.env.HOME ?? '', 'win', 'Zoë Example', 'autostart.vbs')
  const env = (): NodeJS.ProcessEnv => ({ ...process.env, SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Zoë Example', KURMIS_HOME: 'C:\\Users\\Zoë Example\\.kurmis' })
  const regCalls = (): string[][] => {
    const file = join(regDir(), 'calls.jsonl')
    return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]) : []
  }

  beforeEach(() => {
    rmSync(regDir(), { recursive: true, force: true })
    mkdirSync(regDir(), { recursive: true })
    rmSync(join(process.env.HOME ?? '', 'win'), { recursive: true, force: true })
  })

  it('writes the script and the value once, and changes nothing the second time', async () => {
    const first = await registerWindowsAutostart({ env: env(), programArguments: PROGRAM, scriptPath: scriptPath() })
    expect(first).toEqual({ changed: true, where: RUN_ENTRY_DESCRIPTION })
    const bytes = readFileSync(scriptPath())
    expect(bytes.subarray(2).toString('utf16le')).toContain('shell.Environment("Process")("KURMIS_HOME") = "C:\\Users\\Zoë Example\\.kurmis"')
    expect(bytes.subarray(2).toString('utf16le')).toContain('shell.CurrentDirectory = "C:\\Users\\Zoë Example"')
    const query = await regFor()(regQueryArgs())
    expect(parseRegQuery(query.stdout, 'kurmis')).toEqual({ type: 'REG_SZ', data: runValueData('C:\\Windows\\System32\\wscript.exe', scriptPath()) })

    const second = await registerWindowsAutostart({ env: env(), programArguments: PROGRAM, scriptPath: scriptPath() })
    expect(second).toEqual({ changed: false, where: RUN_ENTRY_DESCRIPTION })
    expect(regCalls().map((call) => call[0])).toEqual(['query', 'add', 'query', 'query'])
  })

  it('rewrites a script or a value that differs', async () => {
    await registerWindowsAutostart({ env: env(), programArguments: PROGRAM, scriptPath: scriptPath() })
    writeFileSync(scriptPath(), 'old')
    expect((await registerWindowsAutostart({ env: env(), programArguments: PROGRAM, scriptPath: scriptPath() })).changed).toBe(true)
    await regFor()(regAddArgs('C:\\old.exe'))
    expect((await registerWindowsAutostart({ env: env(), programArguments: PROGRAM, scriptPath: scriptPath() })).changed).toBe(true)
    expect(regCalls().filter((call) => call[0] === 'add').length).toBe(3)
  })

  it('removes the value and the script, and does it twice without complaint', async () => {
    await registerWindowsAutostart({ env: env(), programArguments: PROGRAM, scriptPath: scriptPath() })
    expect(await unregisterWindowsAutostart({ env: env(), scriptPath: scriptPath() })).toEqual({ changed: true, where: RUN_ENTRY_DESCRIPTION })
    expect(existsSync(scriptPath())).toBe(false)
    expect((await regFor()(regQueryArgs())).code).toBe(1)
    expect(await unregisterWindowsAutostart({ env: env(), scriptPath: scriptPath() })).toEqual({ changed: false, where: RUN_ENTRY_DESCRIPTION })
  })

  it('answers a warning when reg.exe refuses', async () => {
    const failing = { ...env(), FAKE_REG_FAIL: '1' }
    const result = await registerWindowsAutostart({ env: failing, programArguments: PROGRAM, scriptPath: scriptPath() })
    expect(result.where).toBeNull()
    expect(result.warning).toMatch(/reg\.exe could not write the logon entry .*Access is denied/)
  })

  it('refuses a variable with a line break as a warning', async () => {
    const result = await registerWindowsAutostart({ env: { ...env(), KURMIS_HOME: 'C:\\a\nb' }, programArguments: PROGRAM, scriptPath: scriptPath() })
    expect(result).toEqual({ changed: false, where: null, warning: 'The logon entry was not written: a value for the logon script has a line break in it.' })
    expect(regCalls()).toEqual([])
  })
})
