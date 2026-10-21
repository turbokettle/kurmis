import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  AUTOSTART_LABEL,
  LAUNCHCTL_PROGRAM,
  bootoutJob,
  bootstrapFailure,
  bootstrapJob,
  daemonJobEnvironment,
  daemonJobPlist,
  guiDomain,
  isMissingGuiDomain,
  isNotLoaded,
  jobState,
  launchAgentsDir,
  launchctlFor,
  launchctlProgram,
  parseLaunchctlPrint,
  plistXml
} from '../../src/platform/launchd.ts'
import type { RunResult } from '../../src/platform/run.ts'
import { withoutAddedVariables } from '../host.ts'

const fakeDir = (): string => process.env.FAKE_LAUNCHCTL_DIR ?? ''

function calls(): string[][] {
  const file = join(fakeDir(), 'calls.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[])
}

function result(code: number, stdout = '', stderr = ''): RunResult {
  return { code, stdout, stderr, timedOut: false, outputTooLarge: false, error: null }
}

beforeEach(() => {
  rmSync(fakeDir(), { recursive: true, force: true, maxRetries: 10 })
  mkdirSync(fakeDir(), { recursive: true })
})

describe('launchctl program', () => {
  it('is /bin/launchctl unless the test hook names another', () => {
    expect(launchctlProgram({}, {})).toBe(LAUNCHCTL_PROGRAM)
    expect(launchctlProgram({ KURMIS_LAUNCHCTL_PROGRAM: '' }, {})).toBe('/bin/launchctl')
    expect(launchctlProgram({ KURMIS_LAUNCHCTL_PROGRAM: '/tmp/fake.mjs' })).toBe('/tmp/fake.mjs')
  })

  it('is the fake in every test, also for an environment that does not name it', () => {
    expect(launchctlProgram()).toMatch(/fake-launchctl[\\/]launchctl\.mjs$/)
    expect(launchctlProgram({})).toMatch(/fake-launchctl[\\/]launchctl\.mjs$/)
  })

  it('names the GUI domain of a user', () => {
    expect(guiDomain(501)).toBe('gui/501')
    expect(guiDomain()).toMatch(/^gui\/\d+$/)
  })

  it('keeps LaunchAgents in the home folder, which is a temporary one in tests', () => {
    expect(launchAgentsDir()).toBe(join(homedir(), 'Library', 'LaunchAgents'))
    expect(launchAgentsDir().startsWith(process.env.HOME ?? '?')).toBe(true)
  })
})

describe('plistXml', () => {
  it('writes strings, booleans, arrays and dictionaries, escaping XML', () => {
    expect(plistXml({
      Label: 'a&b',
      RunAtLoad: true,
      KeepAlive: false,
      ProgramArguments: ['/usr/bin/node', '<x> "y"'],
      EnvironmentVariables: { HOME: '/Users/example', FLAG: true }
    })).toBe([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key>',
      '  <string>a&amp;b</string>',
      '  <key>RunAtLoad</key>',
      '  <true/>',
      '  <key>KeepAlive</key>',
      '  <false/>',
      '  <key>ProgramArguments</key>',
      '  <array>',
      '    <string>/usr/bin/node</string>',
      '    <string>&lt;x&gt; &quot;y&quot;</string>',
      '  </array>',
      '  <key>EnvironmentVariables</key>',
      '  <dict>',
      '    <key>HOME</key>',
      '    <string>/Users/example</string>',
      '    <key>FLAG</key>',
      '    <true/>',
      '  </dict>',
      '</dict>',
      '</plist>',
      ''
    ].join('\n'))
  })
})

describe('daemonJobEnvironment', () => {
  it('carries HOME, PATH, the data folder and the program variables, and nothing else', () => {
    const env = daemonJobEnvironment({
      HOME: '/Users/example',
      PATH: '/opt/homebrew/bin:/usr/bin',
      KURMIS_HOME: 'relative/home',
      KURMIS_CLAUDE_BIN: '/opt/claude',
      KURMIS_CODEX_BIN: '/opt/codex',
      KURMIS_UPSTREAM_URL: 'http://127.0.0.1:1234',
      KURMIS_SECURITY_PROGRAM: '/tmp/security.mjs',
      KURMIS_ENTRY: '/tmp/kurmis.cjs',
      KURMIS_LAUNCHCTL_PROGRAM: '/tmp/launchctl.mjs',
      ANTHROPIC_API_KEY: 'sk-ant-api03-fake',
      ANTHROPIC_AUTH_TOKEN: 'sk-ant-oat01-fake',
      ANTHROPIC_CUSTOM_HEADERS: 'x-kurmis-key: secret',
      SSH_CONNECTION: '192.0.2.1 22 192.0.2.2 50000',
      SSH_AUTH_SOCK: '/tmp/agent',
      CLAUDE_CONFIG_DIR: '/tmp/claude',
      CODEX_HOME: '/tmp/codex',
      KURMIS_SOMETHING_ELSE: 'x',
      TERM: 'xterm'
    }, {})
    expect(env).toEqual({
      HOME: '/Users/example',
      PATH: '/opt/homebrew/bin:/usr/bin',
      KURMIS_HOME: resolve('relative/home'),
      KURMIS_CLAUDE_BIN: '/opt/claude',
      KURMIS_CODEX_BIN: '/opt/codex',
      KURMIS_UPSTREAM_URL: 'http://127.0.0.1:1234',
      KURMIS_SECURITY_PROGRAM: '/tmp/security.mjs',
      KURMIS_ENTRY: '/tmp/kurmis.cjs',
      KURMIS_LAUNCHCTL_PROGRAM: '/tmp/launchctl.mjs'
    })
  })

  it('leaves out empty variables and gives a PATH and HOME when the caller has none', () => {
    const env = daemonJobEnvironment({ KURMIS_HOME: '', KURMIS_CLAUDE_BIN: '' }, {})
    expect(env).toEqual({ HOME: homedir(), PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' })
  })

  it("takes a test's stand-ins and the guard from this process when the caller's environment has none", () => {
    const env = daemonJobEnvironment({ HOME: '/Users/example', KURMIS_REG_PROGRAM: '/tmp/reg.mjs' })
    expect(env.KURMIS_REG_PROGRAM).toBe('/tmp/reg.mjs')
    expect(env.KURMIS_LAUNCHCTL_PROGRAM).toBe(process.env.KURMIS_LAUNCHCTL_PROGRAM)
    expect(env.KURMIS_POWERSHELL_PROGRAM).toBe(process.env.KURMIS_POWERSHELL_PROGRAM)
    expect(env.KURMIS_REFUSE_SYSTEM_PROGRAMS).toBe('1')
    expect(env.KURMIS_REFUSED_PROGRAMS_LOG).toBe(process.env.KURMIS_REFUSED_PROGRAMS_LOG)
  })
})

describe('daemonJobPlist', () => {
  it('runs once at load, abandons its process group, keeps nothing alive and throws output away', () => {
    const text = daemonJobPlist({ label: AUTOSTART_LABEL, programArguments: ['/usr/bin/node', '/tmp/k.cjs'], environment: { HOME: '/Users/example', PATH: '/usr/bin' } })
    expect(text).toContain('<key>Label</key>\n  <string>kurmis.daemon</string>')
    expect(text).toContain('<key>WorkingDirectory</key>\n  <string>/Users/example</string>')
    expect(text).toContain('<key>RunAtLoad</key>\n  <true/>')
    expect(text).toContain('<key>AbandonProcessGroup</key>\n  <true/>')
    expect(text).toContain('<key>StandardOutPath</key>\n  <string>/dev/null</string>')
    expect(text).toContain('<key>StandardErrorPath</key>\n  <string>/dev/null</string>')
    expect(text).not.toContain('KeepAlive')
  })
})

describe('launchctl answers', () => {
  it('reads a loaded job from print, ignoring nested lines', () => {
    const out = 'gui/501/kurmis.daemon = {\n\tactive count = 1\n\tpath = /Users/example/Library/LaunchAgents/kurmis.daemon.plist\n' +
      '\tstate = running\n\tpid = 4242\n\tendpoints = {\n\t\tpid = 7\n\t}\n}\n'
    expect(parseLaunchctlPrint(result(0, out))).toEqual({ loaded: true, path: '/Users/example/Library/LaunchAgents/kurmis.daemon.plist' })
    expect(parseLaunchctlPrint(result(0, 'x = {\n\tstate = not running\n\tsub = {\n\t\tpath = /tmp/nested\n\t}\n}\n'))).toEqual({ loaded: true, path: null })
    expect(parseLaunchctlPrint(result(113, '', 'Could not find service "x" in domain for port'))).toEqual({ loaded: false, path: null })
  })

  it('tells "not loaded" and "no GUI domain" apart from other failures', () => {
    expect(isNotLoaded(result(3, '', 'Boot-out failed: 3: No such process'))).toBe(true)
    expect(isNotLoaded(result(113, '', 'Could not find specified service'))).toBe(true)
    expect(isNotLoaded(result(5, '', 'Boot-out failed: 5: Input/output error'))).toBe(false)
    expect(isMissingGuiDomain(result(125, '', 'Bootstrap failed: 125: Domain does not support specified action'))).toBe(true)
    expect(isMissingGuiDomain(result(5, '', 'Bootstrap failed: 5: Input/output error'))).toBe(false)
  })

  it('says in plain words that nobody is logged in at the screen', () => {
    const said = bootstrapFailure(result(125, '', 'Bootstrap failed: 125: Domain does not support specified action'), 'gui/501')
    expect(said).toContain('exit 125: Bootstrap failed: 125: Domain does not support specified action')
    expect(said).toContain('nobody is logged in')
    expect(bootstrapFailure(result(5, '', 'Bootstrap failed: 5: Input/output error'), 'gui/501'))
      .toBe('launchd could not load the job into gui/501 (exit 5: Bootstrap failed: 5: Input/output error).')
    expect(bootstrapFailure({ ...result(0), code: null, error: '/bin/launchctl could not be started: ENOENT' }, 'gui/501'))
      .toBe('launchd could not load the job into gui/501 (/bin/launchctl could not be started: ENOENT).')
  })

  it('answers whether a bootout unloaded a job, and throws for other failures', async () => {
    expect(await bootoutJob('x', async () => result(0))).toBe(true)
    expect(await bootoutJob('x', async () => result(3, '', 'Boot-out failed: 3: No such process'))).toBe(false)
    await expect(bootoutJob('x', async () => result(5, '', 'Boot-out failed: 5: Input/output error'), 501))
      .rejects.toThrow('launchd could not unload gui/501/x (exit 5: Boot-out failed: 5: Input/output error).')
  })
})

describe('the login item in the fake launchctl', () => {
  it('loads and unloads it in the GUI domain', async () => {
    const plist = join(process.env.HOME ?? '', 'example-job.plist')
    writeFileSync(plist, daemonJobPlist({ label: 'example.job', programArguments: ['/usr/bin/true'], environment: daemonJobEnvironment() }))
    await bootstrapJob(plist, launchctlFor())
    expect(calls()).toEqual([['bootstrap', guiDomain(), plist]])
    expect(await jobState('example.job', launchctlFor())).toEqual({ loaded: true, path: plist })
    expect(await bootoutJob('example.job', launchctlFor())).toBe(true)
    expect((await jobState('example.job', launchctlFor())).loaded).toBe(false)
  })

  it('says why when launchd refuses it', async () => {
    const plist = join(process.env.HOME ?? '', 'example-refused.plist')
    writeFileSync(plist, daemonJobPlist({ label: 'example.refused', programArguments: ['/usr/bin/true'], environment: daemonJobEnvironment() }))
    await expect(bootstrapJob(plist, launchctlFor({ ...process.env, FAKE_LAUNCHCTL_FAIL_BOOTSTRAP: '125' })))
      .rejects.toThrow(/nobody is logged in at this Mac's screen/)
  })

  it('runs the program with only the plist environment and HOME as its folder, when the fake runs jobs', async () => {
    const out = join(process.env.HOME ?? '', 'job-ran.json')
    rmSync(out, { force: true })
    const script = 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ env: process.env, cwd: process.cwd() }))'
    const env = {
      ...process.env,
      FAKE_LAUNCHCTL_RUN: '1',
      ANTHROPIC_API_KEY: 'sk-ant-api03-fake-never-carried',
      SSH_TTY: '/dev/ttys001',
      KURMIS_CLAUDE_BIN: '/tmp/fake-claude.js'
    }
    const plist = join(process.env.HOME ?? '', 'example-run.plist')
    writeFileSync(plist, daemonJobPlist({ label: 'example.run', programArguments: [process.execPath, '-e', script, out], environment: daemonJobEnvironment(env) }))
    await bootstrapJob(plist, launchctlFor(env))
    for (let i = 0; i < 200 && !existsSync(out); i++) await sleep(25)
    const seen = JSON.parse(readFileSync(out, 'utf8')) as { env: Record<string, string>; cwd: string }
    const expected = { ...daemonJobEnvironment(env) }
    for (const [name, value] of Object.entries(env)) if (name.startsWith('FAKE_') && value !== undefined) expected[name] = value
    // The OS or Node may add variables of their own (macOS adds __CF_USER_TEXT_ENCODING, libuv
    // on Windows adds SYSTEMROOT, TEMP and a few more).
    const seenEnv = withoutAddedVariables(seen.env, expected)
    expect(seenEnv).toEqual(expected)
    expect(seenEnv.ANTHROPIC_API_KEY).toBeUndefined()
    expect(seenEnv.SSH_TTY).toBeUndefined()
    expect(seenEnv.KURMIS_CLAUDE_BIN).toBe('/tmp/fake-claude.js')
    expect(realpathSync(seen.cwd)).toBe(realpathSync(process.env.HOME ?? '.'))
    const runs = readFileSync(join(fakeDir(), 'runs.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { label: string })
    expect(runs.map((run) => run.label)).toEqual(['example.run'])
    await bootoutJob('example.run', launchctlFor(env))
  })
})

it('labels the login item with a fixed name', () => {
  expect(AUTOSTART_LABEL).toBe('kurmis.daemon')
})
