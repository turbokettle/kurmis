import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerAutostart, unregisterAutostart } from '../../src/platform/autostart.ts'
import { AUTOSTART_LABEL, autostartPlistPath, guiDomain, jobState, launchAgentsDir, launchctlFor } from '../../src/platform/launchd.ts'
import { RUN_ENTRY_DESCRIPTION, parseRegQuery, regFor, regQueryArgs, wscriptPath } from '../../src/platform/windows-autostart.ts'

const ENTRY = '/opt/example/lib/node_modules/kurmis/dist/kurmis.cjs'
const NODE = '/opt/homebrew/bin/node'

function launchctlCalls(): string[][] {
  const file = join(process.env.FAKE_LAUNCHCTL_DIR ?? '', 'calls.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[])
}

const mac = (env: NodeJS.ProcessEnv = process.env) => ({ env, platform: 'darwin' as const, entry: ENTRY, nodePath: NODE })

beforeEach(() => {
  for (const dir of [process.env.FAKE_LAUNCHCTL_DIR ?? '', process.env.FAKE_REG_DIR ?? '']) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    mkdirSync(dir, { recursive: true })
  }
  rmSync(launchAgentsDir(), { recursive: true, force: true, maxRetries: 10 })
})

describe('macOS login item', () => {
  it('writes the plist in LaunchAgents and loads it', async () => {
    const result = await registerAutostart(mac())
    expect(result).toEqual({ changed: true, where: autostartPlistPath() })
    expect(autostartPlistPath()).toBe(join(process.env.HOME ?? '', 'Library', 'LaunchAgents', 'kurmis.daemon.plist'))
    const text = readFileSync(autostartPlistPath(), 'utf8')
    expect(text).toContain('<key>ProgramArguments</key>\n  <array>\n' +
      `    <string>${NODE}</string>\n    <string>${ENTRY}</string>\n` +
      '    <string>daemon</string>\n    <string>start</string>\n    <string>--no-launchd</string>\n  </array>')
    expect(text).toContain(`<key>KURMIS_HOME</key>\n    <string>${process.env.KURMIS_HOME ?? ''}</string>`)
    expect(text).toContain('<key>RunAtLoad</key>\n  <true/>')
    expect(text).toContain('<key>AbandonProcessGroup</key>\n  <true/>')
    expect(text).not.toContain('KeepAlive')
    if (process.platform !== 'win32') expect(statSync(autostartPlistPath()).mode & 0o777).toBe(0o644)
    expect(launchctlCalls()).toEqual([
      ['print', `${guiDomain()}/${AUTOSTART_LABEL}`],
      ['bootstrap', guiDomain(), autostartPlistPath()]
    ])
    expect((await jobState(AUTOSTART_LABEL, launchctlFor())).loaded).toBe(true)
  })

  it('changes nothing when the same plist is already loaded', async () => {
    await registerAutostart(mac())
    const before = launchctlCalls().length
    expect(await registerAutostart(mac())).toEqual({ changed: false, where: autostartPlistPath() })
    expect(launchctlCalls().slice(before)).toEqual([['print', `${guiDomain()}/${AUTOSTART_LABEL}`]])
  })

  it('loads a plist that is written but not loaded', async () => {
    await registerAutostart(mac())
    await launchctlFor()(['bootout', `${guiDomain()}/${AUTOSTART_LABEL}`])
    expect(await registerAutostart(mac())).toEqual({ changed: true, where: autostartPlistPath() })
    expect(launchctlCalls().at(-1)).toEqual(['bootstrap', guiDomain(), autostartPlistPath()])
  })

  it('unloads and loads again when the plist changed', async () => {
    await registerAutostart(mac())
    const before = launchctlCalls().length
    const result = await registerAutostart(mac({ ...process.env, PATH: '/usr/bin:/bin' }))
    expect(result).toEqual({ changed: true, where: autostartPlistPath() })
    expect(readFileSync(autostartPlistPath(), 'utf8')).toContain('<key>PATH</key>\n    <string>/usr/bin:/bin</string>')
    expect(launchctlCalls().slice(before)).toEqual([
      ['print', `${guiDomain()}/${AUTOSTART_LABEL}`],
      ['bootout', `${guiDomain()}/${AUTOSTART_LABEL}`],
      ['bootstrap', guiDomain(), autostartPlistPath()]
    ])
  })

  it('keeps the plist and warns when launchd cannot load it now', async () => {
    const result = await registerAutostart(mac({ ...process.env, FAKE_LAUNCHCTL_FAIL_BOOTSTRAP: '125' }))
    expect(result.changed).toBe(true)
    expect(result.where).toBe(autostartPlistPath())
    expect(result.warning).toMatch(/^The login item is written and starts the daemon at your next login, but it could not be loaded now: .*nobody is logged in/)
    expect(existsSync(autostartPlistPath())).toBe(true)
  })

  it('unloads and removes the plist, and does it twice without complaint', async () => {
    await registerAutostart(mac())
    expect(await unregisterAutostart(mac())).toEqual({ changed: true, where: autostartPlistPath() })
    expect(existsSync(autostartPlistPath())).toBe(false)
    expect((await jobState(AUTOSTART_LABEL, launchctlFor())).loaded).toBe(false)
    expect(await unregisterAutostart(mac())).toEqual({ changed: false, where: autostartPlistPath() })
  })

  it('removes a plist that was never loaded', async () => {
    mkdirSync(launchAgentsDir(), { recursive: true })
    writeFileSync(autostartPlistPath(), 'old')
    expect(await unregisterAutostart(mac())).toEqual({ changed: true, where: autostartPlistPath() })
    expect(existsSync(autostartPlistPath())).toBe(false)
  })

  it('warns, and writes nothing, when there is no bundle to start', async () => {
    const result = await registerAutostart({ env: process.env, platform: 'darwin', entry: null })
    expect(result.changed).toBe(false)
    expect(result.where).toBeNull()
    expect(result.warning).toMatch(/not running from its bundle/)
    expect(existsSync(autostartPlistPath())).toBe(false)
    expect(launchctlCalls()).toEqual([])
  })

  it('takes the bundle from KURMIS_ENTRY by default', async () => {
    await registerAutostart({ env: { ...process.env, KURMIS_ENTRY: '/tmp/example/kurmis.cjs' }, platform: 'darwin', nodePath: NODE })
    expect(readFileSync(autostartPlistPath(), 'utf8')).toContain('<string>/tmp/example/kurmis.cjs</string>\n    <string>daemon</string>')
  })
})

describe('a Node in a temporary folder', () => {
  it('is registered with a warning that it may be gone at the next login', async () => {
    const result = await registerAutostart({ env: process.env, platform: 'darwin', entry: ENTRY,
      nodePath: '/Users/example/.local/state/fnm_multishells/4242_1/bin/node' })
    expect(result.changed).toBe(true)
    expect(result.warning).toContain('which is in a temporary folder and may be gone at your next login')
    expect((await registerAutostart(mac())).warning).toBeUndefined()
  })
})

describe('Windows logon entry', () => {
  const scriptPath = (): string => join(process.env.HOME ?? '', 'win-autostart', 'autostart.js')
  const win = () => ({
    env: { ...process.env, SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\Example User' },
    platform: 'win32' as const,
    entry: 'C:\\Users\\Example User\\AppData\\Roaming\\npm\\node_modules\\kurmis\\dist\\kurmis.cjs',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    windowsScriptPath: scriptPath()
  })

  // About ten runs of the reg.exe stand-in, each a Node start, which takes longer on Windows and
  // on a loaded machine than the default 5 s allow.
  it('registers the Run value and the script, idempotently, and removes them', async () => {
    expect(await registerAutostart(win())).toEqual({ changed: true, where: RUN_ENTRY_DESCRIPTION })
    const script = readFileSync(scriptPath()).subarray(2).toString('utf16le')
    expect(script).toContain('shell.Run("\\"C:\\\\Program Files\\\\nodejs\\\\node.exe\\" \\"C:\\\\Users\\\\Example User\\\\AppData\\\\Roaming' +
      '\\\\npm\\\\node_modules\\\\kurmis\\\\dist\\\\kurmis.cjs\\" daemon start --no-launchd --env KURMIS_HOME=')
    expect(script).toContain(', 0, false);')
    const value = parseRegQuery((await regFor()(regQueryArgs())).stdout, 'kurmis')
    expect(value?.data).toBe(`${wscriptPath()} //B //Nologo //E:JScript ${scriptPath().includes(' ') ? `"${scriptPath()}"` : scriptPath()}`)
    expect(await registerAutostart(win())).toEqual({ changed: false, where: RUN_ENTRY_DESCRIPTION })
    expect(await unregisterAutostart(win())).toEqual({ changed: true, where: RUN_ENTRY_DESCRIPTION })
    expect(existsSync(scriptPath())).toBe(false)
    expect(launchctlCalls()).toEqual([])
  }, 30_000)
})

describe('other platforms', () => {
  it('answer that autostart is not supported', async () => {
    const result = await registerAutostart({ env: process.env, platform: 'linux', entry: ENTRY, nodePath: NODE })
    expect(result).toEqual({ changed: false, where: null, warning: expect.stringMatching(/not supported on this platform/) })
    expect(await unregisterAutostart({ env: process.env, platform: 'linux' })).toEqual({ changed: false, where: null })
    expect(launchctlCalls()).toEqual([])
  })
})
