import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLogoutCommand, type LogoutDeps } from '../../../src/cli/commands/logout.ts'
import { keychainService } from '../../../src/core/keychain-service.ts'
import { addLogin, changeConfig, findLogin, loadConfig } from '../../../src/data/config.ts'
import type { LoginId, LoginProvider, LoginRef } from '../../../src/data/login-id.ts'
import { codexMergedRecordPath, kurmisHome, loginFolder, loginLockPath } from '../../../src/data/paths.ts'
import { findProgram, ProgramNotFoundError } from '../../../src/platform/programs.ts'
import { runProgram, type RunResult } from '../../../src/platform/run.ts'
import { FAKE_CLAUDE_SCRIPT, readFakeClaudeRecord, writeClaudeCredentials } from '../../fakes/index.ts'
import { claudeRef, codexRef, OWN_CLAUDE, OWN_CODEX, writeTestConfig } from '../../logins.ts'
import { collect, fakeDaemonClient } from '../helpers.ts'
import { canCreateSymlinks, linkFolder } from '../../host.ts'

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

const fakeProgram: LogoutDeps['findProgram'] = (tool) => ({ command: `/fake/bin/${tool}`, args: ['--fake'], source: 'env' })

/** Adds an extra login with this id, provider and alias to config.json, and makes its folder. */
function addWithFolder(id: string, provider: LoginProvider, alias?: string): string {
  changeConfig((config) => addLogin(config, { id: id as LoginId, provider }, alias === undefined ? {} : { alias }))
  const folder = loginFolder(provider === 'claude' ? claudeRef(id) : codexRef(id))
  mkdirSync(folder, { recursive: true })
  return folder
}

const WORK: LoginRef = claudeRef('workclaude')

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
  rmSync(join(home, '.codex'), { recursive: true, force: true, maxRetries: 10 })
  writeTestConfig()
})

describe('kurmis logout', () => {
  it('stops at once, changing nothing, while a kurmis login of the same login runs', async () => {
    const folder = addWithFolder(WORK.id, 'claude', 'work-example')
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

  it('removes a Claude login by alias: config first, then the daemon, then its logout and its folder', async () => {
    const folder = addWithFolder(WORK.id, 'claude', 'work-example')
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

  it('finds the login by id, and by claude: or codex: in front of an alias the providers share', async () => {
    addWithFolder(WORK.id, 'claude', 'work-example')
    addWithFolder('workcodex1', 'codex', 'work-example')
    addWithFolder('sidecodex1', 'codex', 'side-example')
    const logout = createLogoutCommand({ daemon: fakeDaemonClient({ running: false }), findProgram: fakeProgram, runProgram: fakeRun().runProgram })

    const shared = collect()
    expect(await logout.run(['work-example'], shared.context)).toBe(1)
    expect(shared.stderr()).toContain('a Claude login and a Codex login are both called "work-example"; give claude:work-example or codex:work-example')

    expect(await logout.run(['codex:work-example'], collect().context)).toBe(0)
    expect(findLogin(loadConfig(), 'workcodex1')).toBeUndefined()
    expect(findLogin(loadConfig(), WORK.id)).toBeDefined()
    // With the Codex one gone, the alias names one login again.
    expect(await logout.run(['work-example'], collect().context)).toBe(0)
    expect(await logout.run(['sidecodex1'], collect().context)).toBe(0)
    expect(loadConfig().logins.map((login) => login.id)).toEqual([OWN_CLAUDE, OWN_CODEX])
  })

  it('deletes a Codex home with links into ~/.codex and leaves their targets alone', async () => {
    const own = join(home, '.codex')
    mkdirSync(join(own, 'sessions'), { recursive: true })
    writeFileSync(join(own, 'sessions', 'one.jsonl'), 'kept')
    writeFileSync(join(own, 'AGENTS.md'), 'kept')
    const folder = addWithFolder('sidecodex1', 'codex')
    writeFileSync(join(folder, 'auth.json'), '{}')
    linkFolder(join(own, 'sessions'), join(folder, 'sessions'))
    // A symlink to a file needs Developer Mode or an administrator on Windows.
    if (canCreateSymlinks()) symlinkSync(join(own, 'AGENTS.md'), join(folder, 'AGENTS.md'), 'file')
    mkdirSync(join(kurmisHome(), 'codex-merged'), { recursive: true })
    writeFileSync(codexMergedRecordPath(codexRef('sidecodex1')), '{"config":null,"copied":{},"conflicts":[]}\n')
    const run = fakeRun()
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram })
    expect(await logout.run(['sidecodex1'], collect().context)).toBe(0)
    expect(run.runs[0]!.args).toEqual(['--fake', 'logout'])
    expect(run.runs[0]!.env?.CODEX_HOME).toBe(folder)
    expect(existsSync(folder)).toBe(false)
    expect(readFileSync(join(own, 'sessions', 'one.jsonl'), 'utf8')).toBe('kept')
    expect(readFileSync(join(own, 'AGENTS.md'), 'utf8')).toBe('kept')
    // The record of what was merged into the home goes with it.
    expect(existsSync(codexMergedRecordPath(codexRef('sidecodex1')))).toBe(false)
    expect(findLogin(loadConfig(), 'sidecodex1')).toBeUndefined()
  })

  it('goes on when the logout CLI fails, naming the Keychain item on macOS', async () => {
    const folder = addWithFolder(WORK.id, 'claude', 'work-example')
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
    const folder = addWithFolder(WORK.id, 'claude')
    const run = fakeRun({ code: 1 })
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram, platform: 'win32' })
    const out = collect()
    expect(await logout.run([WORK.id], out.context)).toBe(0)
    expect(run.runs[0]!.env?.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBe('1')
    expect(out.stderr()).toContain(`Windows credentials "${keychainService(folder)}/…" may be left`)
    const elsewhere = fakeRun()
    addWithFolder('otherclaude', 'claude')
    await createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: elsewhere.runProgram, platform: 'darwin' })
      .run(['otherclaude'], collect().context)
    expect(elsewhere.runs[0]!.env?.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBeUndefined()
  })

  it('goes on when the CLI is missing or times out, with no Keychain note off macOS', async () => {
    addWithFolder('claudea', 'claude')
    const missing = createLogoutCommand({
      daemon: fakeDaemonClient(),
      findProgram: (tool) => {
        throw new ProgramNotFoundError(tool, 'claude was not found on PATH.')
      },
      runProgram: fakeRun().runProgram,
      platform: 'linux'
    })
    const first = collect()
    expect(await missing.run(['claudea'], first.context)).toBe(0)
    expect(first.stderr()).toContain('claude was not found on PATH.')
    expect(first.stderr()).not.toContain('Keychain')

    addWithFolder('codexb', 'codex')
    const slow = createLogoutCommand({
      daemon: fakeDaemonClient(),
      findProgram: fakeProgram,
      runProgram: fakeRun({ code: null, timedOut: true, error: 'codex did not finish within 30000 ms and was killed' }).runProgram,
      platform: 'darwin'
    })
    const second = collect()
    expect(await slow.run(['codexb'], second.context)).toBe(0)
    expect(second.stderr()).toContain('"codex logout" did not finish (codex did not finish within 30000 ms')
    expect(second.stderr()).not.toContain('Keychain')
  })

  it('refuses the machine\'s own logins and a wrong command line without running anything', async () => {
    const run = fakeRun()
    const daemon = fakeDaemonClient()
    const logout = createLogoutCommand({ daemon, findProgram: fakeProgram, runProgram: run.runProgram })
    for (const [args, message] of [
      [[OWN_CLAUDE], `${OWN_CLAUDE} is this machine's own Claude sign-in and cannot be removed. To sign it out, run "claude auth logout" yourself.`],
      [[`codex:${OWN_CODEX}`], 'run "codex logout" yourself'],
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

  it('answers a login that does not exist', async () => {
    const run = fakeRun()
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram })
    for (const [text, message] of [
      ['none-example', 'there is no login called "none-example"'],
      ['codex:none', 'there is no Codex login called "none"'],
      ['claude:../x', 'there is no Claude login called "../x"'],
      ['other:x', '"other:x" names no login']
    ] as const) {
      const out = collect()
      expect(await logout.run([text], out.context)).toBe(1)
      expect(out.stderr()).toContain(message)
    }
    expect(run.runs).toEqual([])
  })

  it('cleans up a folder left by a removal that stopped half-way, named by its id', async () => {
    const folder = loginFolder(codexRef('leftcodex1'))
    mkdirSync(folder, { recursive: true })
    const run = fakeRun()
    const daemon = fakeDaemonClient()
    const logout = createLogoutCommand({ daemon, findProgram: fakeProgram, runProgram: run.runProgram })
    const out = collect()
    expect(await logout.run(['leftcodex1'], out.context)).toBe(0)
    expect(out.stdout()).toContain('Deleted the folder that leftcodex1 left behind.')
    expect(existsSync(folder)).toBe(false)
    expect(run.runs).toHaveLength(1)
    expect(run.runs[0]!.env?.CODEX_HOME).toBe(folder)
    expect(daemon.calls).toEqual([])
  })

  it('cleans up a Claude folder left behind, also with claude: in front, and signs it out first', async () => {
    const folder = loginFolder(claudeRef('leftclaude'))
    writeClaudeCredentials(folder)
    const run = fakeRun()
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram })
    // The other provider's prefix finds nothing.
    expect(await logout.run(['codex:leftclaude'], collect().context)).toBe(1)
    expect(existsSync(folder)).toBe(true)
    const out = collect()
    expect(await logout.run(['claude:leftclaude'], out.context)).toBe(0)
    expect(run.runs.map((entry) => [entry.args, entry.env?.CLAUDE_CONFIG_DIR])).toEqual([[['--fake', 'auth', 'logout'], folder]])
    expect(existsSync(folder)).toBe(false)
  })

  it('deletes the merged record a failed new login left, when nothing else is left', async () => {
    const record = codexMergedRecordPath(codexRef('leftcodex1'))
    mkdirSync(join(kurmisHome(), 'codex-merged'), { recursive: true })
    writeFileSync(record, '{"config":"","copied":{},"links":{},"conflicts":[]}\n')
    const run = fakeRun()
    const daemon = fakeDaemonClient()
    const logout = createLogoutCommand({ daemon, findProgram: fakeProgram, runProgram: run.runProgram })
    const out = collect()
    expect(await logout.run(['leftcodex1'], out.context)).toBe(0)
    expect(out.stdout()).toContain('which leftcodex1 left behind')
    expect(existsSync(record)).toBe(false)
    expect(run.runs).toEqual([])
    expect(daemon.calls).toEqual([])
  })

  it('runs the fake claude\'s logout on the login\'s folder', async () => {
    const folder = addWithFolder(WORK.id, 'claude', 'work-example')
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
