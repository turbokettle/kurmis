import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { windowsCommandLine } from '../../src/platform/detach.ts'
import {
  RUN_ENTRY_DESCRIPTION,
  RUN_KEY,
  autostartCommandLine,
  autostartScript,
  encodeScript,
  jscriptString,
  parseRegQuery,
  regAddArgs,
  regDeleteArgs,
  regFor,
  regProgram,
  regQueryArgs,
  registerWindowsAutostart,
  runValueData,
  sameRunData,
  scriptHostDisabled,
  systemRoot,
  unregisterWindowsAutostart,
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
const SCRIPT = 'C:\\Users\\Example User\\.kurmis\\autostart.js'
const PROGRAM = [NODE, ENTRY, 'daemon', 'start', '--no-launchd']

describe('programs', () => {
  it('finds the Windows folder from the environment', () => {
    expect(systemRoot({ SystemRoot: 'D:\\Windows\\' })).toBe('D:\\Windows')
    expect(systemRoot({ windir: 'E:\\WINDOWS' })).toBe('E:\\WINDOWS')
    expect(systemRoot({})).toBe('C:\\Windows')
  })

  it('runs reg.exe and wscript.exe from System32, unless the test hook names a reg', () => {
    expect(regProgram({ SystemRoot: 'C:\\Windows' }, {})).toBe('C:\\Windows\\System32\\reg.exe')
    expect(regProgram({ KURMIS_REG_PROGRAM: '/tmp/reg.mjs' })).toBe('/tmp/reg.mjs')
    expect(regProgram()).toMatch(/fake-reg[\\/]reg\.mjs$/)
    expect(wscriptPath({ SystemRoot: 'C:\\Windows' }, {})).toBe('C:\\Windows\\System32\\wscript.exe')
  })
})

describe('the Run value', () => {
  it('runs wscript hidden, without dialogs, on the script', () => {
    expect(runValueData('C:\\Windows\\System32\\wscript.exe', SCRIPT))
      .toBe('C:\\Windows\\System32\\wscript.exe //B //Nologo //E:JScript "C:\\Users\\Example User\\.kurmis\\autostart.js"')
  })

  it('is a REG_SZ set, queried and deleted under HKCU Run', () => {
    expect(regAddArgs('x y')).toEqual(['add', RUN_KEY, '/v', 'kurmis', '/t', 'REG_SZ', '/d', 'x y', '/f'])
    expect(regQueryArgs()).toEqual(['query', RUN_KEY, '/v', 'kurmis'])
    expect(regDeleteArgs()).toEqual(['delete', RUN_KEY, '/v', 'kurmis', '/f'])
    expect(RUN_KEY).toBe('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')
  })

  it('keeps its quotes through the command line Node builds for reg.exe', () => {
    const data = runValueData('C:\\Windows\\System32\\wscript.exe', 'C:\\Users\\Example User\\kurmis data\\autostart.js')
    const args = regAddArgs(data)
    // Node quotes each argument for CreateProcess with the C runtime's rules, which is what
    // `windowsCommandLine` writes too; reg.exe splits its command line with the same rules.
    const line = windowsCommandLine(['reg.exe', ...args])
    expect(line).toContain('"C:\\Windows\\System32\\wscript.exe //B //Nologo //E:JScript \\"C:\\Users\\Example User\\kurmis data\\autostart.js\\""')
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

  it('matches a value read back in the OEM code page against the one written', () => {
    const written = 'C:\\Windows\\System32\\wscript.exe //B //Nologo //E:JScript "C:\\Users\\Zoë Ärger\\.kurmis\\autostart.js"'
    // reg.exe printed ë and Ä in code page 850; read as UTF-8 each became a replacement character.
    const read = written.replace('ë', '\ufffd').replace('Ä', '\ufffd')
    expect(sameRunData(read, written)).toBe(true)
    expect(sameRunData(written, written)).toBe(true)
    expect(sameRunData(read.replace('Users', 'Usr'), written)).toBe(false)
    expect(sameRunData('C:\\a\ufffd\ufffdb', 'C:\\aüb')).toBe(true)
    expect(sameRunData('C:\\ab', 'C:\\aüb')).toBe(false)
  })

  it('reads whether Windows Script Host is turned off', () => {
    const answer = (stdout: string, code = 0) => ({ stdout, stderr: '', code, timedOut: false, outputTooLarge: false, error: null })
    const key = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows Script Host\\Settings\r\n'
    expect(scriptHostDisabled(answer(`${key}    Enabled    REG_DWORD    0x0\r\n`))).toBe(true)
    expect(scriptHostDisabled(answer(`${key}    Enabled    REG_SZ    0\r\n`))).toBe(true)
    expect(scriptHostDisabled(answer(`${key}    Enabled    REG_DWORD    0x1\r\n`))).toBe(false)
    expect(scriptHostDisabled(answer('', 1))).toBe(false)
  })
})

describe('the logon script', () => {
  it('escapes backslashes and quotes in JScript strings and refuses line breaks', () => {
    expect(jscriptString('a "b" C:\\x\\')).toBe('"a \\"b\\" C:\\\\x\\\\"')
    expect(jscriptString('')).toBe('""')
    expect(() => jscriptString('a\nb')).toThrow(/line break/)
    expect(() => jscriptString('a\u2028b')).toThrow(/line break/)
  })

  it('sets the folder and starts node hidden without waiting, with the kurmis variables on its command line', () => {
    const script = { programArguments: PROGRAM, environment: { KURMIS_HOME: 'D:\\kurmis data' }, cwd: 'C:\\Users\\Example User' }
    const command = autostartCommandLine(script)
    expect(splitWindowsCommandLine(command)).toEqual([...PROGRAM, '--env', 'KURMIS_HOME=D:\\kurmis data'])
    expect(autostartScript(script).split('\r\n')).toEqual([
      '// Written by kurmis setup: starts the kurmis daemon at logon without a console window.',
      '// kurmis setup --undo removes it.',
      'var shell = new ActiveXObject("WScript.Shell");',
      'shell.CurrentDirectory = "C:\\\\Users\\\\Example User";',
      `shell.Run(${jscriptString(command)}, 0, false);`,
      ''
    ])
  })

  it('carries only the kurmis variables', () => {
    expect(windowsAutostartEnvironment({
      KURMIS_HOME: 'D:\\k', KURMIS_CLAUDE_BIN: 'C:\\c.exe', KURMIS_ENTRY: '',
      ANTHROPIC_API_KEY: 'sk-ant-api03-fake', Path: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Example User'
    }, {})).toEqual({ KURMIS_HOME: 'D:\\k', KURMIS_CLAUDE_BIN: 'C:\\c.exe' })
  })

  it('makes a relative KURMIS_HOME absolute, since the daemon starts in the profile folder', () => {
    const home = windowsAutostartEnvironment({ KURMIS_HOME: 'kurmis-data' }).KURMIS_HOME ?? ''
    expect(win32.isAbsolute(home)).toBe(true)
    expect(home).toBe(win32.resolve('kurmis-data'))
    expect(windowsAutostartEnvironment({ KURMIS_HOME: 'D:\\data\\' }).KURMIS_HOME).toBe('D:\\data')
  })

  it('is written as UTF-16 with a byte order mark', () => {
    const bytes = encodeScript("' Zoë\r\n")
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe])
    expect(bytes.subarray(2).toString('utf16le')).toBe("' Zoë\r\n")
  })
})

describe('registering through reg.exe', () => {
  const regDir = (): string => process.env.FAKE_REG_DIR ?? ''
  const scriptPath = (): string => join(process.env.HOME ?? '', 'win', 'Zoë Example', 'autostart.js')
  const env = (): NodeJS.ProcessEnv => ({ ...process.env, SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Zoë Example', KURMIS_HOME: 'C:\\Users\\Zoë Example\\.kurmis' })
  const regCalls = (): string[][] => {
    const file = join(regDir(), 'calls.jsonl')
    return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]) : []
  }

  beforeEach(() => {
    rmSync(regDir(), { recursive: true, force: true, maxRetries: 10 })
    mkdirSync(regDir(), { recursive: true })
    rmSync(join(process.env.HOME ?? '', 'win'), { recursive: true, force: true, maxRetries: 10 })
  })

  it('writes the script and the value once, and changes nothing the second time', async () => {
    const first = await registerWindowsAutostart({ env: env(), programArguments: PROGRAM, scriptPath: scriptPath() })
    expect(first).toEqual({ changed: true, where: RUN_ENTRY_DESCRIPTION })
    const bytes = readFileSync(scriptPath())
    const text = bytes.subarray(2).toString('utf16le')
    expect(text).toContain(jscriptString(autostartCommandLine({ programArguments: PROGRAM, environment: { KURMIS_HOME: 'C:\\Users\\Zoë Example\\.kurmis' }, cwd: '' }))
      .slice(1, -1))
    expect(text).toContain('shell.CurrentDirectory = "C:\\\\Users\\\\Zoë Example";')
    const query = await regFor()(regQueryArgs())
    expect(parseRegQuery(query.stdout, 'kurmis')).toEqual({ type: 'REG_SZ', data: runValueData(wscriptPath(), scriptPath()) })

    const second = await registerWindowsAutostart({ env: env(), programArguments: PROGRAM, scriptPath: scriptPath() })
    expect(second).toEqual({ changed: false, where: RUN_ENTRY_DESCRIPTION })
    const runCalls = regCalls().filter((call) => call[1] === RUN_KEY).map((call) => call[0])
    expect(runCalls).toEqual(['query', 'add', 'query', 'query'])
    // Each register asks whether Windows Script Host is turned off, for the user and the machine.
    expect(regCalls().filter((call) => call[1]?.includes('Windows Script Host')).length).toBe(4)
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

  it('writes no entry, and says so, when wscript.exe is missing or Windows Script Host is turned off', async () => {
    const missing = await registerWindowsAutostart({ env: { ...env(), KURMIS_WSCRIPT_PROGRAM: join(process.env.HOME ?? '', 'no-wscript.exe') },
      programArguments: PROGRAM, scriptPath: scriptPath() })
    expect(missing.where).toBeNull()
    expect(missing.warning).toContain('no-wscript.exe does not exist, so Windows Script Host')
    await regFor()(['add', 'HKCU\\Software\\Microsoft\\Windows Script Host\\Settings', '/v', 'Enabled', '/t', 'REG_SZ', '/d', '0', '/f'])
    const off = await registerWindowsAutostart({ env: env(), programArguments: PROGRAM, scriptPath: scriptPath() })
    expect(off.warning).toContain('Windows Script Host, which starts the daemon at logon without a console window, is turned off')
    expect(regCalls().some((call) => call[1] === RUN_KEY && call[0] === 'add')).toBe(false)
    expect(existsSync(scriptPath())).toBe(false)
  })

  it('removes the VBScript an older kurmis wrote', async () => {
    const old = join(join(process.env.HOME ?? '', 'win', 'Zoë Example'), 'autostart.vbs')
    mkdirSync(join(process.env.HOME ?? '', 'win', 'Zoë Example'), { recursive: true })
    writeFileSync(old, 'old')
    expect((await registerWindowsAutostart({ env: env(), programArguments: PROGRAM, scriptPath: scriptPath() })).changed).toBe(true)
    expect(existsSync(old)).toBe(false)
    writeFileSync(old, 'old')
    await unregisterWindowsAutostart({ env: env(), scriptPath: scriptPath() })
    expect(existsSync(old)).toBe(false)
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
