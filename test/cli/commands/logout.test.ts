import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLoginLogout, createLogoutCommand, type LogoutDeps } from '../../../src/cli/commands/logout.ts'
import { keychainService } from '../../../src/core/keychain-service.ts'
import { addLogin, changeConfig, findLogin, loadConfig } from '../../../src/data/config.ts'
import type { LoginRef } from '../../../src/data/login-id.ts'
import { kurmisHome, loginFolder, loginLockPath } from '../../../src/data/paths.ts'
import { findProgram, ProgramNotFoundError } from '../../../src/platform/programs.ts'
import { runProgram, type RunResult } from '../../../src/platform/run.ts'
import { FAKE_CLAUDE_SCRIPT, readFakeClaudeRecord, writeClaudeCredentials } from '../../fakes/index.ts'
import { claudeRef, OWN_CLAUDE, OWN_CLAUDE_REF, writeTestConfig } from '../../logins.ts'
import { collect, fakeDaemonClient } from '../helpers.ts'

const home = process.env.HOME!

interface Run {
  program: string
  args: readonly string[]
  env: NodeJS.ProcessEnv | undefined
}

function fakeRun(result: Partial<RunResult> = {}, order?: string[]): { runs: Run[]; runProgram: LogoutDeps['runProgram'] } {
  const runs: Run[] = []
  return {
    runs,
    async runProgram(program, args, options) {
      runs.push({ program, args, env: options.env })
      order?.push('runProgram')
      return { stdout: '', stderr: '', code: 0, timedOut: false, outputTooLarge: false, error: null, ...result }
    }
  }
}

const fakeProgram: LogoutDeps['findProgram'] = () => ({ command: '/fake/bin/claude', args: ['--fake'] })

/** Adds an extra login with this id and alias to config.json, and makes its folder. */
function addWithFolder(id: string, alias?: string): string {
  changeConfig((config) => addLogin(config, id, alias === undefined ? {} : { alias }))
  const folder = loginFolder(claudeRef(id))
  mkdirSync(folder, { recursive: true })
  return folder
}

const WORK: LoginRef = claudeRef('workclaude')

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
  writeTestConfig()
})

describe('kurmis logout', () => {
  it('stops at once, changing nothing, while a kurmis login of the same login runs', async () => {
    const folder = addWithFolder(WORK.id, 'work-example')
    mkdirSync(join(kurmisHome(), 'locks'), { recursive: true })
    writeFileSync(loginLockPath(WORK.id), JSON.stringify({ pid: process.ppid, createdAt: Date.now(), token: 'a-login' }))
    const run = fakeRun()
    const out = collect()
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram, platform: 'linux' })
    expect(await logout.run(['work-example'], out.context)).toBe(1)
    expect(out.stderr()).toContain('another "kurmis login" or "kurmis logout" of work-example is running now')
    expect(existsSync(folder)).toBe(true)
    expect(findLogin(loadConfig(), WORK.id)).toBeDefined()
    expect(run.runs).toEqual([])
  })

  it('removes a login by alias: config first, then the daemon, then its logout and its folder', async () => {
    const folder = addWithFolder(WORK.id, 'work-example')
    writeClaudeCredentials(folder)
    const order: string[] = []
    const daemon = fakeDaemonClient()
    const reload = daemon.requestReload.bind(daemon)
    daemon.requestReload = async (connection) => {
      order.push(findLogin(loadConfig(), WORK.id) === undefined ? 'reload-after-removal' : 'reload-before-removal')
      await reload(connection)
    }
    const run = fakeRun({}, order)
    const logout = createLogoutCommand({ daemon, findProgram: fakeProgram, runProgram: run.runProgram, platform: 'darwin' })
    const out = collect({ PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' })
    expect(await logout.run(['work-example'], out.context)).toBe(0)

    expect(order).toEqual(['reload-after-removal', 'runProgram'])
    expect(run.runs[0]!.program).toBe('/fake/bin/claude')
    expect(run.runs[0]!.args).toEqual(['--fake', 'auth', 'logout'])
    expect(run.runs[0]!.env?.CLAUDE_CONFIG_DIR).toBe(folder)
    expect(run.runs[0]!.env?.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(existsSync(folder)).toBe(false)
    expect(out.stdout()).toContain('Removed work-example (id workclaude).')
    expect(out.stdout()).toContain('The running daemon has read the change.')
    expect(out.stderr()).toBe('')
  })

  it('finds the login by alias or by id, in any case', async () => {
    addWithFolder(WORK.id, 'work-example')
    addWithFolder('sideclaude', 'side-example')
    const logout = createLogoutCommand({ daemon: fakeDaemonClient({ running: false }), findProgram: fakeProgram, runProgram: fakeRun().runProgram })
    expect(await logout.run([' Work-Example '], collect().context)).toBe(0)
    expect(findLogin(loadConfig(), WORK.id)).toBeUndefined()
    expect(await logout.run(['SIDECLAUDE'], collect().context)).toBe(0)
    expect(loadConfig().logins.map((login) => login.id)).toEqual([OWN_CLAUDE])
  })

  it('goes on when the logout CLI fails, naming the Keychain item on macOS', async () => {
    const folder = addWithFolder(WORK.id, 'work-example')
    const run = fakeRun({ code: 1 })
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram, platform: 'darwin' })
    const out = collect()
    expect(await logout.run(['work-example'], out.context)).toBe(0)
    expect(out.stderr()).toContain('"claude auth logout" did not finish (exit code 1); work-example is removed anyway.')
    expect(out.stderr()).toContain(`Keychain item "${keychainService(folder)}"`)
    expect(existsSync(folder)).toBe(false)
    expect(findLogin(loadConfig(), WORK.id)).toBeUndefined()
  })

  it('on Windows runs claude auth logout with CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1, and names the credentials it may leave', async () => {
    const folder = addWithFolder(WORK.id)
    const run = fakeRun({ code: 1 })
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram, platform: 'win32' })
    const out = collect()
    expect(await logout.run([WORK.id], out.context)).toBe(0)
    expect(run.runs[0]!.env?.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBe('1')
    expect(out.stderr()).toContain(`Windows credentials "${keychainService(folder)}/…" may be left`)
    const elsewhere = fakeRun()
    addWithFolder('otherclaude')
    await createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: elsewhere.runProgram, platform: 'darwin' })
      .run(['otherclaude'], collect().context)
    expect(elsewhere.runs[0]!.env?.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBeUndefined()
  })

  it('goes on when the CLI is missing or times out, with no Keychain note off macOS', async () => {
    addWithFolder('claudea')
    const missing = createLogoutCommand({
      daemon: fakeDaemonClient(),
      findProgram: () => {
        throw new ProgramNotFoundError('claude was not found on PATH.')
      },
      runProgram: fakeRun().runProgram,
      platform: 'linux'
    })
    const first = collect()
    expect(await missing.run(['claudea'], first.context)).toBe(0)
    expect(first.stderr()).toContain('claude was not found on PATH.')
    expect(first.stderr()).not.toContain('Keychain')

    addWithFolder('claudeb')
    const slow = createLogoutCommand({
      daemon: fakeDaemonClient(),
      findProgram: fakeProgram,
      runProgram: fakeRun({ code: null, timedOut: true, error: 'claude did not finish within 30000 ms and was killed' }).runProgram,
      platform: 'linux'
    })
    const second = collect()
    expect(await slow.run(['claudeb'], second.context)).toBe(0)
    expect(second.stderr()).toContain('"claude auth logout" did not finish (claude did not finish within 30000 ms')
    expect(second.stderr()).not.toContain('Keychain')
    expect(findLogin(loadConfig(), 'claudeb')).toBeUndefined()
  })

  it('refuses the login plain claude uses and a wrong command line without running anything', async () => {
    const run = fakeRun()
    const daemon = fakeDaemonClient()
    const logout = createLogoutCommand({ daemon, findProgram: fakeProgram, runProgram: run.runProgram })
    for (const [args, message] of [
      [[OWN_CLAUDE], `${OWN_CLAUDE} is the login plain claude uses and cannot be removed. To sign it out, run "claude auth logout" yourself.`],
      [[], 'takes one login, by its alias or id'],
      [['a', 'b'], 'takes one login, by its alias or id']
    ] as const) {
      const out = collect()
      expect(await logout.run([...args], out.context)).toBe(2)
      expect(out.stderr()).toContain(message)
    }
    expect(run.runs).toEqual([])
    expect(daemon.calls).toEqual([])
  })

  it('as a function, refuses the login plain claude uses without running anything', async () => {
    const run = fakeRun()
    const logOut = createLoginLogout({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram, platform: 'darwin' })
    for (const login of [OWN_CLAUDE_REF, claudeRef(OWN_CLAUDE)]) {
      const out = collect()
      expect(await logOut(login, out.context)).toBe(1)
      expect(out.stderr()).toContain('cannot be removed')
    }
    expect(run.runs).toEqual([])
    expect(findLogin(loadConfig(), OWN_CLAUDE)).toBeDefined()
  })

  it('with keepWhenSignOutFails, keeps the login and its folder when the logout CLI fails, naming the command that tries again', async () => {
    const folder = addWithFolder(WORK.id, 'work-example')
    const daemon = fakeDaemonClient()
    const logOut = createLoginLogout({ daemon, findProgram: fakeProgram, runProgram: fakeRun({ code: 1 }).runProgram, platform: 'darwin' })
    const out = collect()
    expect(await logOut(WORK, out.context, { keepWhenSignOutFails: true, again: 'kurmis setup --uninstall-and-logout', prefix: 'kurmis setup' })).toBe(1)
    expect(out.stderr()).toMatch(/^kurmis setup: "claude auth logout" did not finish \(exit code 1\)\./)
    expect(out.stderr()).toContain(`work-example stays in kurmis with its folder ${folder}, so that ` +
      '"kurmis setup --uninstall-and-logout" runs it again.')
    expect(out.stderr()).not.toContain('kurmis logout:')
    expect(existsSync(folder)).toBe(true)
    expect(findLogin(loadConfig(), WORK.id)).toBeDefined()
    // Nothing changed, so the daemon was not told anything.
    expect(daemon.calls).toEqual([])

    // The second run finds the login in config.json, and removes it once the logout CLI finishes.
    const second = collect()
    const run = fakeRun()
    const again = createLoginLogout({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram, platform: 'darwin' })
    expect(await again(WORK, second.context, { keepWhenSignOutFails: true })).toBe(0)
    expect(second.stdout()).toContain('Removed work-example (id workclaude).')
    expect(run.runs).toHaveLength(1)
    expect(existsSync(folder)).toBe(false)
    expect(findLogin(loadConfig(), WORK.id)).toBeUndefined()
  })

  it('with keepWhenSignOutFails, keeps a folder left behind when its logout CLI fails', async () => {
    const folder = loginFolder(claudeRef('leftclaude'))
    mkdirSync(folder, { recursive: true })
    const logOut = createLoginLogout({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: fakeRun({ code: 1 }).runProgram, platform: 'linux' })
    const out = collect()
    expect(await logOut(claudeRef('leftclaude'), out.context, { keepWhenSignOutFails: true, again: 'kurmis setup --uninstall-and-logout' })).toBe(1)
    expect(out.stderr()).toContain(`Its folder ${folder} is kept, so that "kurmis setup --uninstall-and-logout" runs it again.`)
    expect(existsSync(folder)).toBe(true)
  })

  it('with keepWhenSignOutFails, counts a failed logout of a login without a folder as a failure and keeps the login', async () => {
    changeConfig((config) => addLogin(config, WORK.id, { alias: 'work-example' }))
    const logOut = createLoginLogout({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: fakeRun({ code: 1 }).runProgram, platform: 'darwin' })
    const out = collect()
    expect(await logOut(WORK, out.context, { keepWhenSignOutFails: true, again: 'kurmis setup --uninstall-and-logout' })).toBe(1)
    expect(out.stderr()).toContain(`Its Keychain item "${keychainService(loginFolder(WORK))}" may be left`)
    expect(out.stderr()).toContain('work-example stays in kurmis, so that "kurmis setup --uninstall-and-logout" runs it again.')
    expect(out.stderr()).not.toContain('removed anyway')
    expect(findLogin(loadConfig(), WORK.id)).toBeDefined()
  })

  it('with keepWhenSignOutFails and the logout CLI missing, names "kurmis logout <id>" as the way out, which removes the login anyway', async () => {
    const folder = addWithFolder(WORK.id, 'work-example')
    const missing: LogoutDeps['findProgram'] = () => {
      throw new ProgramNotFoundError('claude was not found on PATH.')
    }
    const deps = { daemon: fakeDaemonClient(), findProgram: missing, runProgram: fakeRun().runProgram, platform: 'darwin' as const }
    const out = collect()
    expect(await createLoginLogout(deps)(WORK, out.context, { keepWhenSignOutFails: true, again: 'kurmis setup --uninstall-and-logout' })).toBe(1)
    expect(out.stderr()).toContain('claude was not found on PATH.')
    expect(out.stderr()).toContain('If that cannot work, for example because claude is not installed, "kurmis logout workclaude" ' +
      'removes work-example and its folder without signing it out, which leaves the item named above.')
    expect(existsSync(folder)).toBe(true)

    // The way out works with the CLI still missing.
    const way = collect()
    expect(await createLogoutCommand(deps).run(['workclaude'], way.context)).toBe(0)
    expect(way.stderr()).toContain('work-example is removed anyway.')
    expect(existsSync(folder)).toBe(false)
    expect(findLogin(loadConfig(), WORK.id)).toBeUndefined()
  })

  it('answers a login that does not exist', async () => {
    const run = fakeRun()
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram })
    for (const [text, message] of [
      ['none-example', 'there is no login called "none-example"'],
      ['../x', 'there is no login called "../x"'],
      ['claude:none', 'there is no login called "claude:none"']
    ] as const) {
      const out = collect()
      expect(await logout.run([text], out.context)).toBe(1)
      expect(out.stderr()).toContain(message)
    }
    expect(run.runs).toEqual([])
  })

  it('cleans up a folder left by a removal that stopped half-way, named by its id, and signs it out first', async () => {
    const folder = loginFolder(claudeRef('leftclaude'))
    writeClaudeCredentials(folder)
    const run = fakeRun()
    const daemon = fakeDaemonClient()
    const logout = createLogoutCommand({ daemon, findProgram: fakeProgram, runProgram: run.runProgram })
    // claude: in front is no way to name a login any more.
    expect(await logout.run(['claude:leftclaude'], collect().context)).toBe(1)
    expect(existsSync(folder)).toBe(true)
    const out = collect()
    // Read as an alias is read: without the spaces around it and without regard to case.
    expect(await logout.run([' LEFTCLAUDE '], out.context)).toBe(0)
    expect(out.stdout()).toContain('Deleted the folder that leftclaude left behind.')
    expect(run.runs.map((entry) => [entry.args, entry.env?.CLAUDE_CONFIG_DIR])).toEqual([[['--fake', 'auth', 'logout'], folder]])
    expect(existsSync(folder)).toBe(false)
    expect(daemon.calls).toEqual([])
  })

  it('runs the fake claude\'s logout on the login\'s folder', async () => {
    const folder = addWithFolder(WORK.id, 'work-example')
    writeClaudeCredentials(folder)
    const record = join(home, 'logout-record.jsonl')
    const logout = createLogoutCommand({ daemon: fakeDaemonClient({ running: false }), findProgram, runProgram })
    const out = collect({ ...process.env, KURMIS_CLAUDE_BIN: FAKE_CLAUDE_SCRIPT, FAKE_CLAUDE_RECORD: record })
    expect(await logout.run(['work-example'], out.context)).toBe(0)
    expect(out.stderr()).toBe('')
    expect(readFakeClaudeRecord(record).filter((line) => line.kind === 'logout')).toEqual([
      expect.objectContaining({ credentialsDir: folder })
    ])
    expect(existsSync(folder)).toBe(false)
  })
})
