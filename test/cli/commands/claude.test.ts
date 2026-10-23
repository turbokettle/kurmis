import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createClaudeCommand, type ClaudeDeps } from '../../../src/cli/commands/claude.ts'
import type { ChildRunner } from '../../../src/cli/command-deps.ts'
import type { ChildEnd, ChildSpec, FinishOptions } from '../../../src/cli/wrapper.ts'
import { CONTROL_API_VERSION } from '../../../src/core/control-api.ts'
import { ConfigError } from '../../../src/data/config.ts'
import { loginFolder, logPath } from '../../../src/data/paths.ts'
import { ProgramNotFoundError } from '../../../src/platform/programs.ts'
import { extraRef, OWN_CLAUDE, OWN_CLAUDE_REF, testConfig } from '../../logins.ts'
import { collect, FAKE_CONNECTION, fakeDaemonClient, loginStatus, statusAnswer, type FakeDaemonOptions } from '../helpers.ts'

const KEY = FAKE_CONNECTION.key
const BASE_URL = `http://127.0.0.1:${String(FAKE_CONNECTION.port)}`
const WORK = { ...extraRef('workclaude'), alias: 'work-example' }
const SPARE = extraRef('spareclaude')
const WORK_FOLDER = (): string => loginFolder(WORK)

let home: string
let cwd: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'kurmis-claude-cmd-home-'))
  cwd = mkdtempSync(join(tmpdir(), 'kurmis-claude-cmd-cwd-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 10 })
  rmSync(cwd, { recursive: true, force: true, maxRetries: 10 })
})

interface Harness {
  deps: Partial<ClaudeDeps>
  specs: ChildSpec[]
  runOptions: unknown[]
  finished: { end: ChildEnd; options: FinishOptions }[]
  daemon: ReturnType<typeof fakeDaemonClient>
}

/** The settings files kurmis would have written, by the path it passed to claude. */
const storedSettings = new Map<string, string>()
/** The files written with a copy of the person's settings, and the ones removed again. */
const ownFiles: string[] = []
const removedFiles: string[] = []
const storeSettings = (text: string, holdsUserSettings: boolean) => {
  const path = `/kurmis-settings/${String(storedSettings.size)}.json`
  storedSettings.set(path, text)
  if (holdsUserSettings) ownFiles.push(path)
  return { path, remove: () => void (holdsUserSettings && removedFiles.push(path)) }
}
beforeEach(() => {
  storedSettings.clear()
  ownFiles.length = 0
  removedFiles.length = 0
})

function harness(daemonOptions: FakeDaemonOptions = {}, overrides: Partial<ClaudeDeps> = {}): Harness {
  const specs: ChildSpec[] = []
  const runOptions: unknown[] = []
  const finished: Harness['finished'] = []
  const child: ChildRunner = {
    async runInteractive(spec, options) {
      specs.push(spec)
      runOptions.push(options)
      return { kind: 'exit', code: 3 }
    },
    finishLikeChild(end, options) {
      finished.push({ end, options })
      return end.kind === 'exit' ? end.code : 1
    }
  }
  const daemon = fakeDaemonClient(daemonOptions)
  return {
    specs,
    runOptions,
    finished,
    daemon,
    deps: {
      daemon,
      child,
      findProgram: () => ({ command: '/fake/claude', args: ['--from-find'] }),
      loadConfig: () => testConfig({ extras: [{ ...WORK }, { ...SPARE }] }),
      platform: 'darwin',
      cwd: () => cwd,
      homeDir: () => home,
      folderExists: () => true,
      storeSettings,
      ...overrides
    }
  }
}

/** The settings object kurmis passed with `--settings`, which must be the first claude argument. */
function passedSettings(spec: ChildSpec | undefined): Record<string, unknown> {
  expect(spec?.args[0]).toBe('--from-find')
  expect(spec?.args[1]).toBe('--settings')
  expect(spec?.args.filter((arg) => arg === '--settings' || arg.startsWith('--settings='))).toHaveLength(1)
  return JSON.parse(storedSettings.get(spec?.args[2] ?? '') ?? 'null') as Record<string, unknown>
}

const routedHeaders = (...lines: string[]): string => [...lines].join('\n')

/** What kurmis' --settings sets the variables that hand claude a token of its own to. */
const NO_TOKEN = { CLAUDE_CODE_OAUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '' }

describe('kurmis claude on Auto', () => {
  test('starts claude on the login plain claude uses, routed through the daemon, with the routing variables in --settings too', async () => {
    const h = harness()
    const out = collect({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-ant-api03-fake-x',
      ANTHROPIC_AUTH_TOKEN: 'fake',
      CLAUDE_SECURESTORAGE_CONFIG_DIR: '/somewhere/else',
      ANTHROPIC_BASE_URL: 'http://example.com'
    })
    const code = await createClaudeCommand(h.deps).run(['-p', 'hi', '--login', 'x'], out.context)
    expect(code).toBe(3)
    expect(out.stderr()).toBe('')
    expect(h.daemon.calls).toEqual(['ensureDaemon'])
    const headers = routedHeaders(`x-kurmis-key: ${KEY}`, `x-kurmis-started-on: ${OWN_CLAUDE}`)
    const routing = { ANTHROPIC_BASE_URL: BASE_URL, ANTHROPIC_CUSTOM_HEADERS: headers, ENABLE_TOOL_SEARCH: 'true', CLAUDE_CODE_MAX_RETRIES: '15' }
    expect(h.specs).toEqual([{
      command: '/fake/claude',
      args: ['--from-find', '--settings', '/kurmis-settings/0.json', '-p', 'hi', '--login', 'x'],
      env: { PATH: '/usr/bin', ...routing, CLAUDE_SECURESTORAGE_CONFIG_DIR: '' }
    }])
    // A subscription token set in a settings file is overridden with an empty value, which claude reads as unset.
    expect(storedSettings.get('/kurmis-settings/0.json')).toBe(JSON.stringify({ env: { ...routing, ...NO_TOKEN } }))
    // The key is in the settings file, never on claude's command line.
    expect(h.specs[0]?.args.some((arg) => arg.includes(KEY))).toBe(false)
    expect(h.runOptions).toEqual([{ platform: 'darwin' }])
    expect(h.finished).toEqual([{ end: { kind: 'exit', code: 3 }, options: { stderr: out.context.stderr, platform: 'darwin' } }])
  })

  test('starts claude without a subscription token from the shell, and says so once', async () => {
    const h = harness()
    const out = collect({ PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'fake-token', CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3' })
    await createClaudeCommand(h.deps).run([], out.context)
    expect(h.specs[0]?.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(h.specs[0]?.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR).toBeUndefined()
    expect(out.stderr().trim().split('\n')).toEqual([
      'kurmis claude: CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR are set, so claude would sign its ' +
        'requests with that token instead of a kurmis login. Kurmis starts claude without them; unset them to stop this note.'
    ])
    expect(out.stderr()).not.toContain('fake-token')
  })

  test('says nothing about token variables that are set to the empty string, as a shell in a routed session has them', async () => {
    const h = harness()
    const out = collect({ PATH: '/usr/bin', ...NO_TOKEN })
    await createClaudeCommand(h.deps).run([], out.context)
    expect(h.specs[0]?.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(h.specs[0]?.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR).toBeUndefined()
    expect(out.stderr()).not.toContain('token')
  })

  test('a subscription token in the person\'s --settings or settings.json is set to an empty value, with a note for each', async () => {
    mkdirSync(join(home, '.claude'))
    const userFile = join(home, '.claude', 'settings.json')
    writeFileSync(userFile, JSON.stringify({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'fake-file-token' } }))
    writeFileSync(join(cwd, 'mine.json'), JSON.stringify({ env: { MINE: 'yes', CLAUDE_CODE_OAUTH_TOKEN: 'fake-flag-token',
      CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3' } }))
    const h = harness()
    const out = collect()
    await createClaudeCommand(h.deps).run(['--settings', 'mine.json'], out.context)
    expect(passedSettings(h.specs[0]).env).toMatchObject({ MINE: 'yes', ...NO_TOKEN })
    expect(out.stderr().trim().split('\n')).toEqual([
      `kurmis claude: CLAUDE_CODE_OAUTH_TOKEN is set in the "env" of ${userFile}, so claude would sign its requests with ` +
        'that token instead of a kurmis login. Kurmis sets it to an empty value for this claude, which Claude Code reads as ' +
        'unset; remove it there to stop this note.',
      `kurmis claude: CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR are set in the "env" of ${join(cwd, 'mine.json')}, ` +
        'so claude would sign its requests with that token instead of a kurmis login. Kurmis sets them to an empty value ' +
        'for this claude, which Claude Code reads as unset; remove them there to stop this note.'
    ])
    expect(out.stderr()).not.toContain('fake-')
  })

  test('an empty token variable in a settings file gives no note', async () => {
    const h = harness()
    const out = collect()
    await createClaudeCommand(h.deps).run(['--settings', '{"env":{"CLAUDE_CODE_OAUTH_TOKEN":""}}'], out.context)
    expect(out.stderr()).toBe('')
    expect(passedSettings(h.specs[0]).env).toMatchObject(NO_TOKEN)
  })

  test('with CLAUDE_CONFIG_DIR naming ~/.claude itself, claude starts on the credentials of the login plain claude uses, with a note that says so', async () => {
    const h = harness()
    const out = collect({ CLAUDE_CONFIG_DIR: join(home, '.claude') })
    await createClaudeCommand(h.deps).run([], out.context)
    expect(h.specs[0]?.env).toMatchObject({ CLAUDE_CONFIG_DIR: join(home, '.claude'), CLAUDE_SECURESTORAGE_CONFIG_DIR: '' })
    expect(out.stderr()).toBe('kurmis claude: CLAUDE_CONFIG_DIR names ~/.claude, the folder of the login plain claude uses, but a claude ' +
      'started with it set keeps its credentials in a Keychain item of its own, which may hold another account. Kurmis starts ' +
      'claude with the credentials of the login plain claude uses, the ones a claude without CLAUDE_CONFIG_DIR reads.\n')
  })

  test('with CLAUDE_CONFIG_DIR set, claude starts on the credentials of the login plain claude uses, with a note', async () => {
    const h = harness()
    const out = collect({ CLAUDE_CONFIG_DIR: '/Users/example/other-claude' })
    await createClaudeCommand(h.deps).run([], out.context)
    expect(h.specs[0]?.env).toMatchObject({ CLAUDE_CONFIG_DIR: '/Users/example/other-claude', CLAUDE_SECURESTORAGE_CONFIG_DIR: '' })
    expect(out.stderr()).toContain('CLAUDE_CONFIG_DIR is set, but kurmis starts claude on the login plain claude uses, the one in ~/.claude')
  })

  test('a sign-in state of the login plain claude uses that the daemon does not know yet is probed first', async () => {
    // Right after a daemon start: no token for the login plain claude uses and no probe answer yet.
    const h = harness({
      status: statusAnswer([
        loginStatus(OWN_CLAUDE_REF, { signedIn: null }),
        loginStatus(SPARE, { signedIn: null }),
        loginStatus(WORK)
      ]),
      probed: statusAnswer([
        loginStatus(OWN_CLAUDE_REF, { signedIn: false }),
        loginStatus(SPARE, { signedIn: false }),
        loginStatus(WORK)
      ])
    })
    const out = collect()
    await createClaudeCommand(h.deps).run([], out.context)
    expect(h.daemon.calls).toContain(`requestProbe:${OWN_CLAUDE},spareclaude`)
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toContain('x-kurmis-started-on: workclaude')
    expect(h.specs[0]?.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(WORK_FOLDER())
    expect(out.stderr()).toBe('')
  })

  test('a known sign-in state of the login plain claude uses needs no probe, whatever the extra logins say', async () => {
    for (const signedIn of [true, false]) {
      const h = harness({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn }), loginStatus(SPARE, { signedIn: null }), loginStatus(WORK)]) })
      await createClaudeCommand(h.deps).run([], collect().context)
      expect(h.daemon.calls.filter((call) => call.startsWith('requestProbe'))).toEqual([])
    }
  })

  test('a sign-in state of the login plain claude uses that the probe leaves unknown counts as signed in', async () => {
    const h = harness({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn: null }), loginStatus(WORK)]) })
    await createClaudeCommand(h.deps).run([], collect().context)
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toContain(`x-kurmis-started-on: ${OWN_CLAUDE}`)
    expect(h.specs[0]?.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe('')
  })

  test('a first probe that takes longer than the wait, or fails, starts claude on the login plain claude uses with a note', async () => {
    const h = harness({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn: null }), loginStatus(WORK)]) }, { probeWaitMs: 20 })
    let aborted = false
    h.daemon.requestProbe = (_connection, _logins, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })
    })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context)).toBe(3)
    expect(aborted).toBe(true)
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toContain(`x-kurmis-started-on: ${OWN_CLAUDE}`)
    expect(out.stderr()).toContain('the daemon did not finish its first usage probe within 0.02 s')

    const failing = harness({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn: null }), loginStatus(WORK)]) })
    failing.daemon.requestProbe = () => Promise.reject(new Error('connection reset'))
    const failed = collect()
    expect(await createClaudeCommand(failing.deps).run([], failed.context)).toBe(3)
    expect(failing.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toContain(`x-kurmis-started-on: ${OWN_CLAUDE}`)
    expect(failed.stderr()).toContain('the usage probe failed (connection reset)')
  })

  test('with the login plain claude uses signed out, claude starts on a signed-in pool login, whose folder stays out of --settings', async () => {
    const h = harness({
      status: statusAnswer([
        loginStatus(OWN_CLAUDE_REF, { signedIn: false }),
        loginStatus(SPARE, { signedIn: null }),
        loginStatus(WORK)
      ])
    })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context)).toBe(3)
    const spec = h.specs[0]
    expect(spec?.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(WORK_FOLDER())
    expect(spec?.env.ANTHROPIC_CUSTOM_HEADERS).toBe(routedHeaders(`x-kurmis-key: ${KEY}`, 'x-kurmis-started-on: workclaude'))
    const settings = passedSettings(spec)
    expect(settings.env).not.toHaveProperty('CLAUDE_SECURESTORAGE_CONFIG_DIR')
    expect(out.stderr()).toBe('')
  })

  // A pool with nothing signed in is a sign-in problem with a pool login, so claude is not
  // started on the login plain claude uses, which an Auto session with a pool never runs on.
  test('with the login plain claude uses signed out and no pool login signed in, claude starts on the first pool login', async () => {
    const h = harness({
      status: statusAnswer([
        loginStatus(OWN_CLAUDE_REF, { signedIn: false, routing: false }),
        loginStatus({ ...extraRef('offclaude') }, { routing: false }),
        loginStatus(SPARE, { signedIn: null }),
        loginStatus(WORK, { signedIn: false })
      ])
    })
    await createClaudeCommand(h.deps).run([], collect().context)
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toContain('x-kurmis-started-on: spareclaude')
  })

  test('with the login plain claude uses signed out and no pool, claude starts on it, since Auto then runs on it', async () => {
    const h = harness({
      status: statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn: false, routing: false }), loginStatus(WORK, { routing: false })])
    })
    const out = collect()
    await createClaudeCommand(h.deps).run([], out.context)
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toContain(`x-kurmis-started-on: ${OWN_CLAUDE}`)
    expect(out.stderr()).toBe('')
  })

  test('a pool login to start on whose folder is missing is an error', async () => {
    const h = harness({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn: false }), loginStatus(WORK)]) },
      { folderExists: () => false })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context)).toBe(1)
    expect(out.stderr()).toContain(`the folder of work-example is missing (${WORK_FOLDER()})`)
    expect(h.specs).toEqual([])
  })

  test('a daemon that cannot be reached is an error naming how to start it and its log; claude is not started', async () => {
    const h = harness({ ensureFails: 'the daemon did not start within 10 s' })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context)).toBe(1)
    expect(out.stderr()).toContain('the kurmis daemon could not be reached (the daemon did not start within 10 s)')
    expect(out.stderr()).toContain('"kurmis daemon start"')
    expect(out.stderr()).toContain(logPath())
    expect(h.specs).toEqual([])
  })

  test('a newer daemon that this kurmis cannot use stops claude with that daemon\'s explanation', async () => {
    const h = harness({ ensureNotUsable: 'A newer kurmis daemon runs on port 40123 (pid 4242), so this kurmis does not replace it. Update this kurmis.' })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context)).toBe(1)
    expect(out.stderr()).toBe('kurmis claude: A newer kurmis daemon runs on port 40123 (pid 4242), so this kurmis does not replace it. Update this kurmis. Claude is not started unrouted.\n')
    expect(h.specs).toEqual([])
  })
})

describe('kurmis claude --login', () => {
  test('pins the session: the login header, the started-on header and the login\'s folder; no status is read', async () => {
    const h = harness()
    const out = collect({ PATH: '/usr/bin' })
    expect(await createClaudeCommand(h.deps).run(['mcp', 'list'], out.context, 'work-example')).toBe(3)
    expect(h.daemon.calls).toEqual(['ensureDaemon'])
    const spec = h.specs[0]
    const headers = routedHeaders(`x-kurmis-key: ${KEY}`, 'x-kurmis-login: workclaude', 'x-kurmis-started-on: workclaude')
    expect(spec?.env).toEqual({
      PATH: '/usr/bin',
      ANTHROPIC_BASE_URL: BASE_URL,
      ANTHROPIC_CUSTOM_HEADERS: headers,
      ENABLE_TOOL_SEARCH: 'true',
      CLAUDE_CODE_MAX_RETRIES: '15',
      CLAUDE_SECURESTORAGE_CONFIG_DIR: WORK_FOLDER()
    })
    // The subcommand comes after kurmis' --settings, where claude's parser accepts a root option.
    expect(spec?.args.slice(3)).toEqual(['mcp', 'list'])
    expect(passedSettings(spec)).toEqual({ env: {
      ANTHROPIC_BASE_URL: BASE_URL, ANTHROPIC_CUSTOM_HEADERS: headers, ENABLE_TOOL_SEARCH: 'true', CLAUDE_CODE_MAX_RETRIES: '15',
      ...NO_TOKEN
    } })
  })

  test('--login with the login plain claude uses starts on its credentials and needs no folder', async () => {
    const h = harness({}, { folderExists: () => false })
    expect(await createClaudeCommand(h.deps).run([], collect({ CLAUDE_SECURESTORAGE_CONFIG_DIR: '/x' }).context, OWN_CLAUDE)).toBe(3)
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toContain(`x-kurmis-login: ${OWN_CLAUDE}`)
    expect(h.specs[0]?.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe('')
  })

  test('--login takes the alias or the id, in any case', async () => {
    for (const text of ['work-example', 'workclaude', 'Work-Example', 'WORKCLAUDE']) {
      const h = harness()
      expect(await createClaudeCommand(h.deps).run([], collect().context, text)).toBe(3)
      expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toContain('x-kurmis-login: workclaude')
    }
  })

  test('a login that is not in config.json is an error, before the daemon is asked', async () => {
    const h = harness()
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context, 'nobody')).toBe(1)
    expect(out.stderr()).toBe('kurmis claude: there is no login called "nobody". "kurmis status" shows the logins, and "kurmis login" adds one.\n')
    expect(h.daemon.calls).toEqual([])
  })

  test('--login takes no claude: in front of a login', async () => {
    for (const text of ['claude:work-example']) {
      const h = harness()
      const out = collect()
      expect(await createClaudeCommand(h.deps).run([], out.context, text)).toBe(1)
      expect(out.stderr()).toContain(`there is no login called "${text}"`)
      expect(h.specs).toEqual([])
    }
  })

  test('without --login, a config.json that cannot be read starts claude on the login plain claude uses, with a warning', async () => {
    // The daemon's status names the login plain claude uses by its id; the signed-in extra login
    // that Auto would otherwise prefer is not looked at.
    const h = harness({ status: statusAnswer([loginStatus(OWN_CLAUDE_REF, { signedIn: false }), loginStatus(WORK)]) }, {
      loadConfig: () => {
        throw new ConfigError('Another kurmis command (pid 4321) holds the lock of config.json.')
      }
    })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run(['-p', 'hi'], out.context)).toBe(3)
    expect(out.stderr()).toBe('kurmis claude: Another kurmis command (pid 4321) holds the lock of config.json. ' +
      'Trying to start claude on the login plain claude uses.\n')
    expect(h.daemon.calls).toEqual(['findDaemon'])
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toBe(routedHeaders(`x-kurmis-key: ${KEY}`, `x-kurmis-started-on: ${OWN_CLAUDE}`))
    expect(h.specs[0]?.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe('')
  })

  test('with config.json unreadable and no daemon running, ensureDaemon is asked to start one', async () => {
    const h = harness({ running: false, status: statusAnswer([]) }, {
      loadConfig: () => {
        throw new ConfigError('config.json is not valid JSON.')
      }
    })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context)).toBe(3)
    expect(h.daemon.calls).toEqual(['findDaemon', 'ensureDaemon'])
    // The status names no login of plain claude, so no started-on header is sent: the daemon reads that as plain claude's login.
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toBe(routedHeaders(`x-kurmis-key: ${KEY}`))
  })

  test('with config.json unreadable, a running daemon of another control API version is not used', async () => {
    const h = harness({ connection: { ...FAKE_CONNECTION, apiVersion: CONTROL_API_VERSION + 1 }, ensureFails: 'config.json is not valid JSON.' }, {
      loadConfig: () => {
        throw new ConfigError('config.json is not valid JSON.')
      }
    })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context)).toBe(1)
    expect(h.daemon.calls).toEqual(['findDaemon', 'ensureDaemon'])
    expect(h.specs).toEqual([])
  })

  test('with config.json unreadable, a daemon that cannot be started stops claude', async () => {
    const h = harness({ running: false, ensureFails: 'config.json is not valid JSON.' }, {
      loadConfig: () => {
        throw new ConfigError('config.json is not valid JSON.')
      }
    })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context)).toBe(1)
    expect(out.stderr()).toContain('the kurmis daemon could not be reached (config.json is not valid JSON.)')
    expect(h.specs).toEqual([])
  })

  test('a damaged config.json is an error with its message', async () => {
    const h = harness({}, {
      loadConfig: () => {
        throw new ConfigError('config.json: logins[2].id must be 1 to 32 lowercase letters and digits')
      }
    })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context, 'work-example')).toBe(1)
    expect(out.stderr()).toBe('kurmis claude: config.json: logins[2].id must be 1 to 32 lowercase letters and digits\n')
  })

  test('an extra login whose folder is missing is an error that says how to sign it in again', async () => {
    const h = harness({}, { folderExists: () => false })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context, 'work-example')).toBe(1)
    expect(out.stderr()).toBe(`kurmis claude: the folder of work-example is missing (${WORK_FOLDER()}). Sign it in again with ` +
      '"kurmis login work-example".\n')
    expect(h.specs).toEqual([])
  })

})

describe('kurmis claude with the person\'s own settings', () => {
  test('an inline --settings is merged: their keys and variables kept, kurmis\' address and key winning', async () => {
    const h = harness()
    const theirs = JSON.stringify({ model: 'opus', env: { MINE: 'yes', ANTHROPIC_BASE_URL: 'http://example.com', ENABLE_TOOL_SEARCH: 'false' } })
    await createClaudeCommand(h.deps).run(['-p', '--settings', theirs, 'hi'], collect().context)
    const settings = passedSettings(h.specs[0])
    // Their own ENABLE_TOOL_SEARCH is theirs to choose; the address is kurmis'.
    expect(settings).toMatchObject({ model: 'opus', env: { MINE: 'yes', ANTHROPIC_BASE_URL: BASE_URL, ENABLE_TOOL_SEARCH: 'false' } })
    expect(h.specs[0]?.env.ENABLE_TOOL_SEARCH).toBeUndefined()
    expect(h.specs[0]?.args.slice(3)).toEqual(['-p', 'hi'])
    // The copy of their settings is removed once claude has ended, before the wrapper ends like it.
    expect(ownFiles).toEqual([h.specs[0]?.args[2]])
    expect(removedFiles).toEqual(ownFiles)
  })

  test('a value of the person\'s own for ENABLE_TOOL_SEARCH or CLAUDE_CODE_MAX_RETRIES is left as it is', async () => {
    const h = harness()
    await createClaudeCommand(h.deps).run([], collect({ CLAUDE_CODE_MAX_RETRIES: '4' }).context)
    expect(h.specs[0]?.env.CLAUDE_CODE_MAX_RETRIES).toBe('4')
    expect(h.specs[0]?.env.ENABLE_TOOL_SEARCH).toBe('true')
    const env = passedSettings(h.specs[0]).env as Record<string, string>
    expect(env.CLAUDE_CODE_MAX_RETRIES).toBeUndefined()
    expect(env.ENABLE_TOOL_SEARCH).toBe('true')
    // Without settings of the person's, the shared file is kept for claude's background sessions.
    expect(ownFiles).toEqual([])

    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { ENABLE_TOOL_SEARCH: 'false' } }))
    const again = harness()
    await createClaudeCommand(again.deps).run([], collect().context)
    expect(passedSettings(again.specs[0]).env).not.toHaveProperty('ENABLE_TOOL_SEARCH')
    expect(again.specs[0]?.env.ENABLE_TOOL_SEARCH).toBeUndefined()
  })

  test('a settings file is read relative to the folder, merged and passed in the settings file kurmis writes; theirs is not changed', async () => {
    const h = harness()
    const text = '{\n  "env": { "MINE": "yes", "ANTHROPIC_CUSTOM_HEADERS": "x-team: blue" }\n}\n'
    writeFileSync(join(cwd, 'mine.json'), text)
    await createClaudeCommand(h.deps).run(['--settings=mine.json'], collect({ ANTHROPIC_CUSTOM_HEADERS: 'x-from: process' }).context)
    const settings = passedSettings(h.specs[0]) as { env: Record<string, string> }
    expect(settings.env.MINE).toBe('yes')
    // Their --settings is the highest layer, so its headers are the ones kept, ahead of kurmis' own.
    expect(settings.env.ANTHROPIC_CUSTOM_HEADERS).toBe(routedHeaders('x-team: blue', `x-kurmis-key: ${KEY}`, `x-kurmis-started-on: ${OWN_CLAUDE}`))
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toBe(settings.env.ANTHROPIC_CUSTOM_HEADERS)
    expect(readFileSync(join(cwd, 'mine.json'), 'utf8')).toBe(text)
  })

  test('settings that cannot be read stop the start before the daemon is asked', async () => {
    const h = harness()
    const out = collect()
    expect(await createClaudeCommand(h.deps).run(['--settings', 'missing.json'], out.context)).toBe(1)
    expect(out.stderr()).toBe(`kurmis claude: --settings: cannot read the settings file ${join(cwd, 'missing.json')}: it does not exist\n`)
    expect(h.daemon.calls).toEqual([])
    expect(h.specs).toEqual([])
  })

  test('custom headers from ~/.claude/settings.json beat the process environment', async () => {
    mkdirSync(join(home, '.claude'))
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { ANTHROPIC_CUSTOM_HEADERS: 'x-team: green' } }))
    const h = harness()
    await createClaudeCommand(h.deps).run([], collect({ ANTHROPIC_CUSTOM_HEADERS: 'x-from: process' }).context)
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toBe(routedHeaders('x-team: green', `x-kurmis-key: ${KEY}`, `x-kurmis-started-on: ${OWN_CLAUDE}`))
  })

  test('in global mode the settings file\'s own kurmis headers are replaced, not repeated', async () => {
    mkdirSync(join(home, '.claude'))
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ env: {
      ANTHROPIC_BASE_URL: BASE_URL,
      ANTHROPIC_CUSTOM_HEADERS: `x-team: green\nx-kurmis-key: ${'b'.repeat(64)}`
    } }))
    const h = harness()
    await createClaudeCommand(h.deps).run([], collect().context, 'work-example')
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toBe(
      routedHeaders('x-team: green', `x-kurmis-key: ${KEY}`, 'x-kurmis-login: workclaude', 'x-kurmis-started-on: workclaude'))
  })

  test('CLAUDE_CONFIG_DIR moves the settings file it reads', async () => {
    const configDir = join(home, 'other-config')
    mkdirSync(configDir)
    writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_CUSTOM_HEADERS: 'x-team: red' } }))
    const h = harness()
    await createClaudeCommand(h.deps).run([], collect({ CLAUDE_CONFIG_DIR: configDir }).context)
    expect(h.specs[0]?.env.ANTHROPIC_CUSTOM_HEADERS).toMatch(/^x-team: red\n/)
    expect(h.specs[0]?.env.CLAUDE_CONFIG_DIR).toBe(configDir)
  })

  test('a settings file that is not JSON is a warning, and claude still starts', async () => {
    mkdirSync(join(home, '.claude'))
    writeFileSync(join(home, '.claude', 'settings.json'), '{"env":')
    const h = harness()
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context)).toBe(3)
    expect(out.stderr()).toContain('is not valid JSON (line 1, column 8), so custom headers set there are not kept')
  })
})

describe('kurmis claude, other cases', () => {
  test('--help and every other argument go to claude unchanged', async () => {
    const h = harness()
    expect(await createClaudeCommand(h.deps).run(['--help', '--login', 'x', '--'], collect().context)).toBe(3)
    expect(h.specs[0]?.args.slice(-4)).toEqual(['--help', '--login', 'x', '--'])
  })

  test('a claude that cannot be found exits 127 with the lookup\'s message', async () => {
    const h = harness({}, {
      findProgram: () => {
        throw new ProgramNotFoundError('claude was not found on PATH')
      }
    })
    const out = collect()
    expect(await createClaudeCommand(h.deps).run([], out.context)).toBe(127)
    expect(out.stderr()).toBe('kurmis claude: claude was not found on PATH\n')
    expect(h.daemon.calls).toEqual([])
  })

  test('on Windows the inherited variables are matched without regard to case', async () => {
    const h = harness({}, { platform: 'win32' })
    await createClaudeCommand(h.deps).run([], collect({ Path: 'C:\\Windows', Anthropic_Api_Key: 'fake', anthropic_base_url: 'http://example.com' }).context)
    expect(h.specs[0]?.env).toEqual({
      Path: 'C:\\Windows',
      ANTHROPIC_BASE_URL: BASE_URL,
      ANTHROPIC_CUSTOM_HEADERS: routedHeaders(`x-kurmis-key: ${KEY}`, `x-kurmis-started-on: ${OWN_CLAUDE}`),
      ENABLE_TOOL_SEARCH: 'true',
      CLAUDE_CODE_MAX_RETRIES: '15',
      CLAUDE_SECURESTORAGE_CONFIG_DIR: ''
    })
    expect(h.runOptions).toEqual([{ platform: 'win32' }])
    expect(h.finished[0]?.options.platform).toBe('win32')
  })
})
