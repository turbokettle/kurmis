import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLogoutCommand, type LogoutDeps } from '../../../src/cli/commands/logout.ts'
import { keychainService } from '../../../src/core/keychain-service.ts'
import { addLogin, defaultConfig, findLogin, loadConfig, saveConfig } from '../../../src/data/config.ts'
import { codexMergedRecordPath, kurmisHome, loginFolder, loginLockPath } from '../../../src/data/paths.ts'
import { findProgram, ProgramNotFoundError } from '../../../src/platform/programs.ts'
import { runProgram, type RunResult } from '../../../src/platform/run.ts'
import { FAKE_CLAUDE_SCRIPT, readFakeClaudeRecord, writeClaudeCredentials } from '../../fakes/index.ts'
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

function addWithFolder(id: string): string {
  saveConfig(addLogin(loadConfig(), id))
  const folder = loginFolder(id)
  mkdirSync(folder, { recursive: true })
  return folder
}

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
  rmSync(join(home, '.codex'), { recursive: true, force: true, maxRetries: 10 })
  saveConfig(defaultConfig())
})

describe('kurmis logout', () => {
  it('stops at once, changing nothing, while a kurmis login of the same login runs', async () => {
    const folder = addWithFolder('claude:work')
    mkdirSync(join(kurmisHome(), 'locks'), { recursive: true })
    writeFileSync(loginLockPath('claude:work'), JSON.stringify({ pid: process.ppid, createdAt: Date.now(), token: 'a-login' }))
    const run = fakeRun()
    const out = collect()
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram, platform: 'linux' })
    expect(await logout.run(['claude:work'], out.context)).toBe(1)
    expect(out.stderr()).toContain('another "kurmis login" or "kurmis logout" of claude:work is running now')
    expect(existsSync(folder)).toBe(true)
    expect(findLogin(loadConfig(), 'claude:work')).toBeDefined()
    expect(run.runs).toEqual([])
  })

  it('removes a Claude login: config first, then the daemon, then its logout and its folder', async () => {
    const folder = addWithFolder('claude:work')
    writeClaudeCredentials(folder)
    const order: string[] = []
    const daemon = fakeDaemonClient()
    const reload = daemon.requestReload.bind(daemon)
    daemon.requestReload = async (connection) => {
      order.push(findLogin(loadConfig(), 'claude:work') === undefined ? 'reload-after-removal' : 'reload-before-removal')
      await reload(connection)
    }
    const run = fakeRun({}, order)
    const logout = createLogoutCommand({ daemon, findProgram: fakeProgram, runProgram: run.runProgram, platform: 'darwin' })
    const out = collect({ PATH: '/usr/bin', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' })
    expect(await logout.run(['claude:work'], out.context)).toBe(0)

    expect(order).toEqual(['reload-after-removal', 'runProgram'])
    expect(run.runs[0]!.program).toBe('/fake/bin/claude')
    expect(run.runs[0]!.args).toEqual(['--fake', 'auth', 'logout'])
    expect(run.runs[0]!.env?.CLAUDE_CONFIG_DIR).toBe(folder)
    expect(run.runs[0]!.env?.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(existsSync(folder)).toBe(false)
    expect(out.stdout()).toContain('Removed claude:work.')
    expect(out.stdout()).toContain('The running daemon has read the change.')
    expect(out.stderr()).toBe('')
  })

  it('deletes a Codex home with links into ~/.codex and leaves their targets alone', async () => {
    const own = join(home, '.codex')
    mkdirSync(join(own, 'sessions'), { recursive: true })
    writeFileSync(join(own, 'sessions', 'one.jsonl'), 'kept')
    writeFileSync(join(own, 'AGENTS.md'), 'kept')
    const folder = addWithFolder('codex:side')
    writeFileSync(join(folder, 'auth.json'), '{}')
    linkFolder(join(own, 'sessions'), join(folder, 'sessions'))
    // A symlink to a file needs Developer Mode or an administrator on Windows.
    if (canCreateSymlinks()) symlinkSync(join(own, 'AGENTS.md'), join(folder, 'AGENTS.md'), 'file')
    mkdirSync(join(kurmisHome(), 'codex-merged'), { recursive: true })
    writeFileSync(codexMergedRecordPath('codex:side'), '{"config":null,"copied":{},"conflicts":[]}\n')
    const run = fakeRun()
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram })
    expect(await logout.run(['codex:side'], collect().context)).toBe(0)
    expect(run.runs[0]!.args).toEqual(['--fake', 'logout'])
    expect(run.runs[0]!.env?.CODEX_HOME).toBe(folder)
    expect(existsSync(folder)).toBe(false)
    expect(readFileSync(join(own, 'sessions', 'one.jsonl'), 'utf8')).toBe('kept')
    expect(readFileSync(join(own, 'AGENTS.md'), 'utf8')).toBe('kept')
    // The record of what was merged into the home goes with it.
    expect(existsSync(codexMergedRecordPath('codex:side'))).toBe(false)
    expect(findLogin(loadConfig(), 'codex:side')).toBeUndefined()
  })

  it('goes on when the logout CLI fails, naming the Keychain item on macOS', async () => {
    const folder = addWithFolder('claude:work')
    const run = fakeRun({ code: 1 })
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram, platform: 'darwin' })
    const out = collect()
    expect(await logout.run(['claude:work'], out.context)).toBe(0)
    expect(out.stderr()).toContain('"claude auth logout" did not finish (exit code 1); the login is removed anyway.')
    expect(out.stderr()).toContain(`Keychain item "${keychainService(folder)}"`)
    expect(existsSync(folder)).toBe(false)
    expect(findLogin(loadConfig(), 'claude:work')).toBeUndefined()
  })

  it('on Windows runs claude auth logout with CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1, and names the credentials it may leave', async () => {
    const folder = addWithFolder('claude:work')
    const run = fakeRun({ code: 1 })
    const logout = createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: run.runProgram, platform: 'win32' })
    const out = collect()
    expect(await logout.run(['claude:work'], out.context)).toBe(0)
    expect(run.runs[0]!.env?.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBe('1')
    expect(out.stderr()).toContain(`Windows credentials "${keychainService(folder)}/…" may be left`)
    const elsewhere = fakeRun()
    addWithFolder('claude:other')
    await createLogoutCommand({ daemon: fakeDaemonClient(), findProgram: fakeProgram, runProgram: elsewhere.runProgram, platform: 'darwin' })
      .run(['claude:other'], collect().context)
    expect(elsewhere.runs[0]!.env?.CLAUDE_CODE_FORCE_WINDOWS_CREDMAN).toBeUndefined()
  })

  it('goes on when the CLI is missing or times out, with no Keychain note off macOS', async () => {
    addWithFolder('claude:a')
    const missing = createLogoutCommand({
      daemon: fakeDaemonClient(),
      findProgram: (tool) => {
        throw new ProgramNotFoundError(tool, 'claude was not found on PATH.')
      },
      runProgram: fakeRun().runProgram,
      platform: 'linux'
    })
    const first = collect()
    expect(await missing.run(['claude:a'], first.context)).toBe(0)
    expect(first.stderr()).toContain('claude was not found on PATH.')
    expect(first.stderr()).not.toContain('Keychain')

    addWithFolder('codex:b')
    const slow = createLogoutCommand({
      daemon: fakeDaemonClient(),
      findProgram: fakeProgram,
      runProgram: fakeRun({ code: null, timedOut: true, error: 'codex did not finish within 30000 ms and was killed' }).runProgram,
      platform: 'darwin'
    })
    const second = collect()
    expect(await slow.run(['codex:b'], second.context)).toBe(0)
    expect(second.stderr()).toContain('"codex logout" did not finish (codex did not finish within 30000 ms')
    expect(second.stderr()).not.toContain('Keychain')
  })

  it('refuses the machine\'s own logins and bad ids without running anything', async () => {
    const run = fakeRun()
    const daemon = fakeDaemonClient()
    const logout = createLogoutCommand({ daemon, findProgram: fakeProgram, runProgram: run.runProgram })
    for (const [args, message] of [
      [['claude:default'], 'claude:default is the machine\'s own login and cannot be removed. To sign it out, run "claude auth logout" yourself.'],
      [['codex:default'], 'run "codex logout" yourself'],
      [['claude:../x'], 'is not a login id'],
      [['work'], 'is not a login id'],
      [[], 'takes one login id']
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
    const out = collect()
    expect(await logout.run(['codex:none'], out.context)).toBe(1)
    expect(out.stderr()).toContain('there is no login codex:none')
    const claude = collect()
    expect(await logout.run(['claude:none'], claude.context)).toBe(1)
    expect(claude.stderr()).toContain('there is no login claude:none')
    expect(run.runs).toEqual([])
  })

  it('cleans up a folder left by a removal that stopped half-way', async () => {
    const folder = loginFolder('codex:left')
    mkdirSync(folder, { recursive: true })
    const run = fakeRun()
    const daemon = fakeDaemonClient()
    const logout = createLogoutCommand({ daemon, findProgram: fakeProgram, runProgram: run.runProgram })
    const out = collect()
    expect(await logout.run(['codex:left'], out.context)).toBe(0)
    expect(out.stdout()).toContain('Deleted the folder that codex:left left behind.')
    expect(existsSync(folder)).toBe(false)
    expect(run.runs).toHaveLength(1)
    expect(daemon.calls).toEqual([])
  })

  it('deletes the merged record a failed new login left, when nothing else is left', async () => {
    mkdirSync(join(kurmisHome(), 'codex-merged'), { recursive: true })
    writeFileSync(codexMergedRecordPath('codex:left'), '{"config":"","copied":{},"links":{},"conflicts":[]}\n')
    const run = fakeRun()
    const daemon = fakeDaemonClient()
    const logout = createLogoutCommand({ daemon, findProgram: fakeProgram, runProgram: run.runProgram })
    const out = collect()
    expect(await logout.run(['codex:left'], out.context)).toBe(0)
    expect(out.stdout()).toContain('codex:left left behind')
    expect(existsSync(codexMergedRecordPath('codex:left'))).toBe(false)
    expect(run.runs).toEqual([])
    expect(daemon.calls).toEqual([])
  })

  it('runs the fake claude\'s logout on the login\'s folder', async () => {
    const folder = addWithFolder('claude:work')
    writeClaudeCredentials(folder)
    const record = join(home, 'logout-record.jsonl')
    const logout = createLogoutCommand({ daemon: fakeDaemonClient({ running: false }), findProgram, runProgram })
    const out = collect({ ...process.env, KURMIS_CLAUDE_BIN: FAKE_CLAUDE_SCRIPT, FAKE_CLAUDE_RECORD: record })
    expect(await logout.run(['claude:work'], out.context)).toBe(0)
    expect(out.stderr()).toBe('')
    expect(readFakeClaudeRecord(record).filter((line) => line.kind === 'logout')).toEqual([
      expect.objectContaining({ credentialsDir: folder })
    ])
    expect(existsSync(folder)).toBe(false)
  })
})
