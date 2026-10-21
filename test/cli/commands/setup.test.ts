import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLoginLogout, createLogoutCommand } from '../../../src/cli/commands/logout.ts'
import { createSetupCommand } from '../../../src/cli/commands/setup.ts'
import { DaemonError } from '../../../src/cli/daemon-client.ts'
import { globalRoutingState } from '../../../src/cli/global-routing.ts'
import { backupPathFor } from '../../../src/cli/global-settings.ts'
import { keychainService } from '../../../src/core/keychain-service.ts'
import { addLogin, findLogin, loadConfig, saveConfig } from '../../../src/data/config.ts'
import type { LoginRef } from '../../../src/data/login-id.ts'
import { readKey } from '../../../src/data/daemon-file.ts'
import { loginFolder, pausedFilePath, setupSettingsRecordPath } from '../../../src/data/paths.ts'
import { ProgramNotFoundError } from '../../../src/platform/programs.ts'
import { registerAutostart, unregisterAutostart, type AutostartOptions, type AutostartResult } from '../../../src/platform/autostart.ts'
import { claudeRef, codexRef, OWN_CLAUDE_REF, writeTestConfig } from '../../logins.ts'
import { collect, FAKE_CONNECTION, fakeDaemonClient, type FakeDaemonOptions } from '../helpers.ts'
import { canCreateSymlinks, linkFolder } from '../../host.ts'

const home = process.env.HOME as string
const kurmisHome = process.env.KURMIS_HOME as string
const settingsPath = join(home, '.claude', 'settings.json')
const PORT = FAKE_CONNECTION.port

interface FakeAutostart {
  calls: string[]
  registerAutostart(options: AutostartOptions): Promise<AutostartResult>
  unregisterAutostart(options: AutostartOptions): Promise<AutostartResult>
}

/** Autostart that keeps its entry in memory, or fails with `warning` / `throws`. */
function fakeAutostart(options: { warning?: string; throws?: string; loadsAtNextLogin?: boolean; noEntryPossible?: boolean } = {}): FakeAutostart {
  let registered = false
  const calls: string[] = []
  const where = '/example/LaunchAgents/kurmis.plist'
  return {
    calls,
    async registerAutostart(given) {
      calls.push(`register:${String(given.platform)}`)
      if (options.throws !== undefined) throw new Error(options.throws)
      if (options.loadsAtNextLogin === true) return { changed: true, where, warning: options.warning ?? '', loadsAtNextLogin: true }
      if (options.noEntryPossible === true) return { changed: false, where: null, warning: options.warning ?? '', noEntryPossible: true }
      if (options.warning !== undefined) return { changed: false, where: null, warning: options.warning }
      const changed = !registered
      registered = true
      return { changed, where }
    },
    async unregisterAutostart(given) {
      calls.push(`unregister:${String(given.platform)}`)
      if (options.throws !== undefined) throw new Error(options.throws)
      if (options.warning !== undefined) return { changed: false, where: null, warning: options.warning }
      const changed = registered
      registered = false
      return { changed, where: changed ? where : null }
    }
  }
}

function setup(daemon: FakeDaemonOptions = {}, autostart = fakeAutostart(), platform: NodeJS.Platform = 'darwin') {
  const client = fakeDaemonClient(daemon)
  const command = createSetupCommand({ daemon: client, ...autostart, platform })
  return { client, autostart, command }
}

async function run(command: ReturnType<typeof createSetupCommand>, args: string[], env: NodeJS.ProcessEnv = {}) {
  const out = collect(env)
  const code = await command.run(args, out.context)
  return { code, stdout: out.stdout(), stderr: out.stderr() }
}

function settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
}

beforeEach(() => {
  rmSync(join(home, '.claude'), { recursive: true, force: true, maxRetries: 10 })
  rmSync(kurmisHome, { recursive: true, force: true, maxRetries: 10 })
  mkdirSync(kurmisHome, { recursive: true })
  writeFileSync(join(kurmisHome, 'config.json'), JSON.stringify({ version: 2, port: PORT }))
})

afterEach(() => {
  rmSync(join(home, '.claude'), { recursive: true, force: true, maxRetries: 10 })
})

describe('kurmis setup', () => {
  it('writes the settings, registers autostart and starts the daemon', async () => {
    const { client, autostart, command } = setup()
    const result = await run(command, [])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    // The key the daemon answered with, which is the key file's.
    const key: string | null = FAKE_CONNECTION.key
    expect(readKey()).not.toBeNull()
    expect(settings()).toEqual({
      env: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(PORT)}`,
        ANTHROPIC_CUSTOM_HEADERS: `x-kurmis-key: ${key!}`,
        ENABLE_TOOL_SEARCH: 'true',
        CLAUDE_CODE_MAX_RETRIES: '15'
      }
    })
    expect(autostart.calls).toEqual(['register:darwin'])
    expect(client.calls).toEqual(['ensureDaemon'])
    expect(result.stdout).toContain(`Claude Code settings: ${settingsPath}`)
    expect(result.stdout).toContain('Created the file, readable only by you.')
    expect(result.stdout).toContain('Added ANTHROPIC_BASE_URL.')
    expect(result.stdout).toContain('The daemon now starts at login (/example/LaunchAgents/kurmis.plist).')
    expect(result.stdout).toContain(`The daemon is running on port ${String(PORT)}.`)
    // The key is a secret and is never printed.
    expect(result.stdout).not.toContain(key!)
  })

  it('keeps the user\'s settings, backs the file up and is idempotent', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    const original = '{\n  "model": "opus",\n  "env": {\n    "FOO": "1"\n  }\n}\n'
    writeFileSync(settingsPath, original)
    const { command } = setup()
    const first = await run(command, [])
    expect(first.code).toBe(0)
    expect(first.stdout).toContain(`Saved a copy of the file as it was to ${backupPathFor(settingsPath)}.`)
    expect(readFileSync(backupPathFor(settingsPath), 'utf8')).toBe(original)
    expect(settings()).toMatchObject({ model: 'opus', env: { FOO: '1' } })

    const text = readFileSync(settingsPath, 'utf8')
    const second = await run(command, [])
    expect(second.code).toBe(0)
    expect(second.stdout).toContain('The file already has kurmis\' settings; nothing to change.')
    expect(second.stdout).toContain('The daemon already starts at login')
    expect(readFileSync(settingsPath, 'utf8')).toBe(text)
  })

  it.skipIf(process.platform === 'win32')('makes the file and its backup readable only by the user and says so', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(settingsPath, '{\n  "model": "opus"\n}\n')
    chmodSync(settingsPath, 0o644)
    const { command } = setup()
    const first = await run(command, [])
    expect(first.code).toBe(0)
    expect(first.stdout).toContain('Made the file readable only by you, because it holds kurmis\' key (its mode was 0644).')
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600)
    expect(statSync(backupPathFor(settingsPath)).mode & 0o777).toBe(0o600)

    chmodSync(backupPathFor(settingsPath), 0o644)
    const second = await run(command, [])
    expect(second.stdout).toContain(`Made ${backupPathFor(settingsPath)} readable only by you (its mode was 0644).`)
    expect(second.stdout).not.toContain('Made the file readable')
    expect(statSync(backupPathFor(settingsPath)).mode & 0o777).toBe(0o600)
  })

  // A symlink to a file needs Developer Mode or an administrator on Windows.
  it.runIf(canCreateSymlinks())('warns that the key goes to the target of a linked settings file', async () => {
    const dotfiles = join(home, 'dotfiles')
    mkdirSync(dotfiles, { recursive: true })
    mkdirSync(join(home, '.claude'), { recursive: true })
    const target = join(dotfiles, 'claude-settings.json')
    writeFileSync(target, '{}\n')
    symlinkSync(target, settingsPath)
    try {
      const { command } = setup()
      const result = await run(command, [])
      expect(result.code).toBe(0)
      expect(result.stderr).toContain(
        `Warning: ${settingsPath} is a symbolic link, so kurmis' key is written to the file it points to, ${realpathSync(target)}.`)
      const paused = await run(command, ['--pause'])
      expect(paused.stderr).not.toContain('symbolic link')
    } finally {
      rmSync(dotfiles, { recursive: true, force: true, maxRetries: 10 })
    }
  })

  it('refuses a file it cannot parse and does nothing else', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(settingsPath, '{ "model": "opus", }')
    const { client, autostart, command } = setup()
    const result = await run(command, [])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`${settingsPath} was not changed: it is not valid JSON`)
    expect(readFileSync(settingsPath, 'utf8')).toBe('{ "model": "opus", }')
    expect(autostart.calls).toEqual([])
    expect(client.calls).toEqual([])
  })

  it('refuses a base URL that is not kurmis\'', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' } }))
    const { command } = setup()
    const result = await run(command, [])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('https://proxy.example.com')
  })

  it('keeps the settings change when autostart fails, and exits 1', async () => {
    const { client, command } = setup({}, fakeAutostart({ warning: 'launchd is not reachable from here' }))
    const result = await run(command, [])
    expect(result.code).toBe(1)
    expect(existsSync(settingsPath)).toBe(true)
    expect(result.stderr).toContain('Could not make the daemon start at login: launchd is not reachable from here')
    expect(result.stderr).toContain('run "kurmis setup" again to finish')
    expect(client.calls).toEqual(['ensureDaemon'])
  })

  it('reports an autostart that throws like a warning', async () => {
    const { command } = setup({}, fakeAutostart({ throws: 'not implemented yet' }))
    const result = await run(command, [])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Could not make the daemon start at login: not implemented yet')
  })

  it('starts the daemon before it writes the settings file', async () => {
    const { client, command } = setup()
    const ensure = client.ensureDaemon.bind(client)
    let fileAtStart: boolean | null = null
    client.ensureDaemon = async (options) => {
      fileAtStart = existsSync(settingsPath)
      return await ensure(options)
    }
    expect((await run(command, [])).code).toBe(0)
    expect(fileAtStart).toBe(false)
    expect(existsSync(settingsPath)).toBe(true)
  })

  it('writes nothing and registers nothing when the daemon cannot start, and exits 1', async () => {
    const { autostart, command } = setup({ ensureFails: 'port 40123 is busy' })
    const result = await run(command, [])
    expect(result.code).toBe(1)
    expect(existsSync(settingsPath)).toBe(false)
    expect(autostart.calls).toEqual([])
    expect(result.stderr).toContain('The daemon could not be started: port 40123 is busy')
    expect(result.stderr).toContain(`${settingsPath} was not changed, so Claude Code does not use kurmis yet.`)
  })

  it('says the file still holds an earlier setup when the daemon cannot start', async () => {
    expect((await run(setup().command, [])).code).toBe(0)
    const text = readFileSync(settingsPath, 'utf8')
    const result = await run(setup({ ensureFails: 'port 40123 is busy' }).command, [])
    expect(result.code).toBe(1)
    expect(readFileSync(settingsPath, 'utf8')).toBe(text)
    expect(result.stderr).toContain(`${settingsPath} was not changed. It still holds kurmis' settings from an earlier setup`)
    expect(result.stderr).not.toContain('does not use kurmis yet')
  })

  it('writes nothing when the daemon runs on another port than config.json names', async () => {
    writeFileSync(join(kurmisHome, 'config.json'), JSON.stringify({ version: 2, port: 30003 }))
    const { command } = setup()
    const result = await run(command, [])
    expect(result.code).toBe(1)
    expect(existsSync(settingsPath)).toBe(false)
    expect(result.stderr).toContain(`The daemon runs on port ${String(PORT)}, but config.json names port 30003.`)
  })

  it('counts a login item that loads only at the next login as done, with a warning', async () => {
    const { command } = setup({}, fakeAutostart({ loadsAtNextLogin: true, warning: 'The login item is written and starts the daemon at your next login, but it could not be loaded now: no GUI session' }))
    const result = await run(command, [])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('Warning: The login item is written and starts the daemon at your next login, but it could not be loaded now: no GUI session\n')
    expect(existsSync(settingsPath)).toBe(true)
  })

  it('counts a machine where no logon entry can be written as done, with a warning', async () => {
    const warning = 'The logon entry was not written: C:\\Windows\\System32\\wscript.exe does not exist. The next "kurmis claude" or "kurmis codex" starts the daemon anyway.'
    const { command } = setup({}, fakeAutostart({ noEntryPossible: true, warning }), 'win32')
    const result = await run(command, [])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe(`Warning: ${warning}\n`)
    expect(result.stderr).not.toContain('run "kurmis setup" again')
    expect(existsSync(settingsPath)).toBe(true)
  })

  it('counts a login item that starts a Node in a temporary folder as done, with a warning', async () => {
    // The real registration, on the fake launchctl, with fnm's per-shell Node.
    const node = '/Users/example/.local/state/fnm_multishells/4242_1/bin/node'
    const register = (given: AutostartOptions): Promise<AutostartResult> =>
      registerAutostart({ ...given, env: process.env, entry: '/opt/example/kurmis/dist/kurmis.cjs', nodePath: node })
    const { command } = setup({}, { calls: [], registerAutostart: register, unregisterAutostart })
    const result = await run(command, [])
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(`Warning: The login item starts Node from ${node}, which is in a temporary folder`)
    expect(result.stderr).not.toContain('Could not make the daemon start at login')
    expect(result.stderr).not.toContain('run "kurmis setup" again to finish')
  })

  it('counts a platform without autostart as done, with a warning', async () => {
    const unsupported = 'Starting the daemon at login is not supported on this platform; the next "kurmis claude" or "kurmis codex" starts it.'
    const { command } = setup({}, fakeAutostart({ warning: unsupported }), 'linux')
    const result = await run(command, [])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe(`Warning: ${unsupported}\n`)
    expect(existsSync(settingsPath)).toBe(true)
  })

  it('fails on a broken config.json before changing anything', async () => {
    writeFileSync(join(kurmisHome, 'config.json'), '{')
    const { autostart, command } = setup()
    const result = await run(command, [])
    expect(result.code).toBe(1)
    expect(existsSync(settingsPath)).toBe(false)
    expect(autostart.calls).toEqual([])
  })

  it('uses settings.json in CLAUDE_CONFIG_DIR when that is set', async () => {
    const dir = join(home, 'other-claude')
    const { command } = setup()
    const result = await run(command, [], { CLAUDE_CONFIG_DIR: dir })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain(`Claude Code settings: ${join(dir, 'settings.json')}`)
    expect(existsSync(join(dir, 'settings.json'))).toBe(true)
    expect(existsSync(settingsPath)).toBe(false)
    // A CLI that reads that file signs in with the login in that folder, not the login plain claude uses.
    const env = (JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { env: Record<string, string> }).env
    expect(env['ANTHROPIC_CUSTOM_HEADERS']).toMatch(/\nx-kurmis-started-on: none$/)
    expect(result.stdout).toContain('CLAUDE_CONFIG_DIR is set, so a claude that reads this file signs in with the login in that folder')
    // A pause takes the line out with the other kurmis headers.
    expect((await run(command, ['--pause'], { CLAUDE_CONFIG_DIR: dir })).code).toBe(0)
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).not.toContain('x-kurmis')
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
  })

  it('refuses a CLAUDE_CONFIG_DIR that names ~/.claude itself on macOS and Windows, and changes nothing', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    for (const [platform, value] of [
      ['darwin', join(home, '.claude')],
      ['darwin', `${join(home, '.claude')}${sep}`],
      // macOS and Windows file systems usually ignore case, and so does the comparison.
      ['darwin', join(home, '.CLAUDE')],
      ['win32', join(home, '.claude')]
    ] as const) {
      const { client, autostart, command } = setup({}, fakeAutostart(), platform)
      const result = await run(command, [], { CLAUDE_CONFIG_DIR: value })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(`CLAUDE_CONFIG_DIR is set to ${value}, which is the default Claude Code folder ${join(home, '.claude')}.`)
      expect(result.stderr).toContain('Unset CLAUDE_CONFIG_DIR and run "kurmis setup" again.')
      expect(existsSync(settingsPath)).toBe(false)
      expect(client.calls).toEqual([])
      expect(autostart.calls).toEqual([])
    }
  })

  it('refuses a CLAUDE_CONFIG_DIR that is a link to ~/.claude', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    const link = join(home, 'claude-link')
    linkFolder(join(home, '.claude'), link)
    try {
      const result = await run(setup().command, [], { CLAUDE_CONFIG_DIR: link })
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('Unset CLAUDE_CONFIG_DIR')
    } finally {
      // Removes the link, not the folder it points to; a junction is removed like a folder.
      if (process.platform === 'win32') rmdirSync(link)
      else unlinkSync(link)
    }
  })

  it.runIf(canCreateSymlinks())('refuses a CLAUDE_CONFIG_DIR whose settings.json is a link to ~/.claude/settings.json', async () => {
    const dir = join(home, '.claude-work')
    mkdirSync(join(home, '.claude'), { recursive: true })
    mkdirSync(dir, { recursive: true })
    try {
      for (const exists of [true, false]) {
        // A link whose target does not exist yet counts too: setup would create that target.
        rmSync(settingsPath, { force: true })
        if (exists) writeFileSync(settingsPath, '{}\n')
        rmSync(join(dir, 'settings.json'), { force: true })
        symlinkSync(join('..', '.claude', 'settings.json'), join(dir, 'settings.json'))
        for (const platform of ['darwin', 'win32', 'linux'] as const) {
          const { client, autostart, command } = setup({}, fakeAutostart(), platform)
          const result = await run(command, [], { CLAUDE_CONFIG_DIR: dir })
          expect(result.code).toBe(1)
          expect(result.stderr).toContain(`${join(dir, 'settings.json')} is a link to the default Claude Code settings file ${settingsPath}.`)
          expect(result.stderr).toContain('Unset CLAUDE_CONFIG_DIR and run "kurmis setup" again')
          expect(client.calls).toEqual([])
          expect(autostart.calls).toEqual([])
          expect(existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : null).toBe(exists ? '{}\n' : null)
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  })

  it('accepts a CLAUDE_CONFIG_DIR that names ~/.claude on Linux, where it reads the same credentials', async () => {
    const { command } = setup({}, fakeAutostart(), 'linux')
    const result = await run(command, [], { CLAUDE_CONFIG_DIR: join(home, '.claude') })
    expect(result.code).toBe(0)
    expect(readFileSync(settingsPath, 'utf8')).not.toContain('x-kurmis-started-on')
  })

  it('still pauses with a CLAUDE_CONFIG_DIR that names ~/.claude', async () => {
    expect((await run(setup().command, [])).code).toBe(0)
    const result = await run(setup().command, ['--pause'], { CLAUDE_CONFIG_DIR: join(home, '.claude') })
    expect(result.code).toBe(0)
    expect(readFileSync(settingsPath, 'utf8')).not.toContain('x-kurmis')
  })

  it('without CLAUDE_CONFIG_DIR names no started-on login, so a plain claude counts as on the login plain claude uses', async () => {
    const { command } = setup()
    expect((await run(command, [])).code).toBe(0)
    expect(readFileSync(settingsPath, 'utf8')).not.toContain('x-kurmis-started-on')
  })

  it('rejects an unknown option or argument', async () => {
    const { command } = setup()
    expect((await run(command, ['--force'])).code).toBe(2)
    expect((await run(command, ['now'])).code).toBe(2)
    expect((await run(command, ['--undo'])).code).toBe(2)
    const yes = await run(command, ['--yes'])
    expect(yes.code).toBe(2)
    expect(yes.stderr).toContain('--yes goes with --uninstall-and-logout')
    expect((await run(command, ['--pause', '--uninstall-and-logout'])).code).toBe(2)
    expect(existsSync(settingsPath)).toBe(false)
  })

  it('names its three modes in its help', () => {
    const { usage } = setup().command
    expect(usage).toContain('Usage: kurmis setup [--pause | --uninstall-and-logout [--yes]]')
    expect(usage).toContain('The logins plain\n                          claude and plain codex use are not signed out')
    expect(usage).toContain('npm uninstall -g kurmis')
  })
})

describe('kurmis setup --pause', () => {
  it('gives back the file as it was, keeps autostart and the daemon, and shows as paused', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    const original = '{\n\t"model": "opus"\n}\n'
    writeFileSync(settingsPath, original)
    const { client, autostart, command } = setup()
    expect((await run(command, [])).code).toBe(0)
    expect(globalRoutingState({})).toBe('on')
    client.calls.length = 0

    const result = await run(command, ['--pause'])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(readFileSync(settingsPath, 'utf8')).toBe(original)
    expect(autostart.calls).toEqual(['register:darwin'])
    expect(client.calls).toEqual(['findDaemon'])
    expect(existsSync(backupPathFor(settingsPath))).toBe(true)
    expect(existsSync(pausedFilePath())).toBe(true)
    expect(globalRoutingState({})).toBe('paused')
    expect(result.stdout).toContain('Removed ANTHROPIC_BASE_URL.')
    expect(result.stdout).toContain('Removed the "env" block, which had nothing else in it.')
    expect(result.stdout).toContain('Paused global routing')
    expect(result.stdout).toContain('"kurmis setup" turns global routing on again.')
    expect(result.stdout).toContain('Claude Code sessions that are already open keep the settings they started with')

    const again = await run(command, ['--pause'])
    expect(again.code).toBe(0)
    expect(again.stdout).toContain('Global routing is already paused.')
    expect(readFileSync(settingsPath, 'utf8')).toBe(original)
  })

  it('is undone by kurmis setup, which replaces the backup with the file as it is then', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(settingsPath, '{\n  "model": "opus"\n}\n')
    const { autostart, command } = setup()
    await run(command, [])
    await run(command, ['--pause'])
    // A change made while paused is part of the file before kurmis from now on.
    const changed = '{\n  "model": "sonnet"\n}\n'
    writeFileSync(settingsPath, changed)

    const result = await run(command, [])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Global routing was paused; it is on again.')
    expect(readFileSync(backupPathFor(settingsPath), 'utf8')).toBe(changed)
    expect(existsSync(pausedFilePath())).toBe(false)
    expect(globalRoutingState({})).toBe('on')
    expect(autostart.calls).toEqual(['register:darwin', 'register:darwin'])
    expect((await run(command, ['--pause'])).code).toBe(0)
    expect(readFileSync(settingsPath, 'utf8')).toBe(changed)
  })

  it('pauses nothing when global routing is not on', async () => {
    const { command } = setup({ running: false })
    const result = await run(command, ['--pause'])
    expect(result.code).toBe(0)
    expect(existsSync(settingsPath)).toBe(false)
    expect(existsSync(pausedFilePath())).toBe(false)
    expect(globalRoutingState({})).toBe('off')
    expect(result.stdout).toContain('Global routing is not on, so there is nothing to pause.')
  })

  it('leaves a value the user changed and says so', async () => {
    const { command } = setup()
    await run(command, [])
    const text = readFileSync(settingsPath, 'utf8').replace('"CLAUDE_CODE_MAX_RETRIES": "15"', '"CLAUDE_CODE_MAX_RETRIES": "6"')
    writeFileSync(settingsPath, text)
    const result = await run(command, ['--pause'])
    expect(result.code).toBe(0)
    expect(settings()).toEqual({ env: { CLAUDE_CODE_MAX_RETRIES: '6' } })
    expect(result.stdout).toContain('Left CLAUDE_CODE_MAX_RETRIES as it is: its value (6) is not the one kurmis sets.')
  })

  it('pauses a file setup wrote without CLAUDE_CONFIG_DIR from a shell that has it set, and the other way round', async () => {
    const dir = join(home, 'other-claude')
    const other = join(dir, 'settings.json')
    try {
      expect((await run(setup().command, [])).code).toBe(0)
      const fromOther = await run(setup().command, ['--pause'], { CLAUDE_CONFIG_DIR: dir })
      expect(fromOther.code).toBe(0)
      expect(readFileSync(settingsPath, 'utf8')).not.toContain('x-kurmis')
      expect(fromOther.stdout).toContain(`Claude Code settings: ${settingsPath}`)
      expect(fromOther.stdout).toContain('Paused global routing')
      expect(globalRoutingState({})).toBe('paused')

      expect((await run(setup().command, [], { CLAUDE_CONFIG_DIR: dir })).code).toBe(0)
      expect(globalRoutingState({})).toBe('on')
      const fromDefault = await run(setup().command, ['--pause'])
      expect(fromDefault.code).toBe(0)
      expect(readFileSync(other, 'utf8')).not.toContain('x-kurmis')
      expect(globalRoutingState({ CLAUDE_CONFIG_DIR: dir })).toBe('paused')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  })

  it('reports a settings file it cannot read as a sentence and exits 1', async () => {
    // A folder where the file should be: EISDIR.
    mkdirSync(settingsPath, { recursive: true })
    for (const args of [[], ['--pause'], ['--uninstall-and-logout', '--yes']]) {
      const result = await run(setup().command, args)
      expect(result.code).toBe(1)
      expect(result.stderr).toMatch(new RegExp(`kurmis setup: ${settingsPath.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')} (was not changed|cannot be read)`))
      expect(result.stderr).toMatch(/EISDIR/)
      expect(result.stderr).not.toContain('    at ')
    }
  })

  it.skipIf(process.platform === 'win32')('says so when paused.json cannot be written after the file was changed, and exits 1', async () => {
    expect((await run(setup().command, [])).code).toBe(0)
    chmodSync(kurmisHome, 0o500)
    try {
      const result = await run(setup().command, ['--pause'])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(`kurmis setup: kurmis' settings were taken out of the file, but ${pausedFilePath()} could not be written`)
      expect(result.stderr).not.toContain('    at ')
      expect(readFileSync(settingsPath, 'utf8')).not.toContain('x-kurmis')
    } finally {
      chmodSync(kurmisHome, 0o700)
    }
  })

  it('still pauses with a broken config.json, by the key header', async () => {
    const { command } = setup()
    await run(command, [])
    writeFileSync(join(kurmisHome, 'config.json'), '{')
    expect(globalRoutingState({})).toBe('on')
    const result = await run(command, ['--pause'])
    expect(result.code).toBe(0)
    expect(settings()).toEqual({})
    expect(globalRoutingState({})).toBe('paused')
  })
})

describe('globalRoutingState', () => {
  it('reads the file a CLAUDE_CONFIG_DIR names, and the default file for one inside the data folder', async () => {
    const dir = join(home, 'other-claude')
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(PORT)}` } }))
      expect(globalRoutingState({ CLAUDE_CONFIG_DIR: dir })).toBe('on')
      expect(globalRoutingState({})).toBe('off')
      expect(globalRoutingState({ CLAUDE_CONFIG_DIR: join(kurmisHome, 'probe', 'claude-default') })).toBe('off')
      mkdirSync(join(home, '.claude'), { recursive: true })
      writeFileSync(settingsPath, 'not json')
      expect(globalRoutingState({})).toBe('off')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  })

  it('reads every settings file setup recorded, whatever CLAUDE_CONFIG_DIR is', async () => {
    const dir = join(home, 'other-claude')
    try {
      expect((await run(setup().command, [], { CLAUDE_CONFIG_DIR: dir })).code).toBe(0)
      expect(JSON.parse(readFileSync(setupSettingsRecordPath(), 'utf8'))).toEqual({ version: 1, files: [join(dir, 'settings.json')] })
      expect(globalRoutingState({ CLAUDE_CONFIG_DIR: dir })).toBe('on')
      expect(globalRoutingState({})).toBe('on')
      // Recorded once, however often setup runs.
      expect((await run(setup().command, [], { CLAUDE_CONFIG_DIR: dir })).code).toBe(0)
      expect((await run(setup().command, [])).code).toBe(0)
      expect(JSON.parse(readFileSync(setupSettingsRecordPath(), 'utf8'))).toEqual({
        version: 1, files: [join(dir, 'settings.json'), settingsPath]
      })
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  })
})

describe('kurmis setup --uninstall-and-logout', () => {
  interface UninstallWorld {
    command: ReturnType<typeof createSetupCommand>
    autostart: FakeAutostart
    /** Every logout CLI run, as `<program> <args>` with the folder it ran on. */
    signOuts: string[]
    stops: number
    questions: string[]
  }

  function uninstaller(options: {
    terminal?: boolean
    answer?: string | null
    running?: boolean
    stopFails?: string
    failSignOutOf?: LoginRef
    /** The logout CLIs are not installed. */
    cliMissing?: boolean
    platform?: NodeJS.Platform
    autostart?: FakeAutostart
  } = {}): UninstallWorld {
    const daemon = fakeDaemonClient({ running: options.running ?? true })
    const world: UninstallWorld = {
      command: null as unknown as ReturnType<typeof createSetupCommand>,
      autostart: options.autostart ?? fakeAutostart(),
      signOuts: [],
      stops: 0,
      questions: []
    }
    const platform = options.platform ?? 'darwin'
    const logOutLogin = createLoginLogout({
      daemon,
      platform,
      findProgram: (tool) => {
        if (options.cliMissing === true) throw new ProgramNotFoundError(tool, `${tool} was not found on PATH.`)
        return { command: `/fake/bin/${tool}`, args: [], source: 'env' }
      },
      async runProgram(program, args, run) {
        const folder = run.env?.['CLAUDE_CONFIG_DIR'] ?? run.env?.['CODEX_HOME'] ?? ''
        world.signOuts.push(`${program} ${args.join(' ')} ${folder}`)
        const failing = options.failSignOutOf !== undefined && folder === loginFolder(options.failSignOutOf)
        return { stdout: '', stderr: '', code: failing ? 1 : 0, timedOut: false, outputTooLarge: false, error: null }
      }
    })
    world.command = createSetupCommand({
      daemon,
      ...world.autostart,
      platform,
      logOutLogin,
      async stopDaemon() {
        world.stops++
        if (options.stopFails !== undefined) throw new DaemonError(options.stopFails)
        return options.running ?? true
      },
      stdinIsTerminal: () => options.terminal ?? false,
      async ask(question) {
        world.questions.push(question)
        return options.answer === undefined ? 'y' : options.answer
      }
    })
    return world
  }

  const WORK = claudeRef('workclaude')
  const SPARE = codexRef('sparecodex')

  function addLoginWithFolder(login: LoginRef, alias: string): string {
    saveConfig(addLogin(loadConfig(), login, { alias }))
    const folder = loginFolder(login)
    mkdirSync(folder, { recursive: true })
    return folder
  }

  /** Turns global routing on with the original file given, and adds two logins. */
  async function installed(original: string | null = '{\n  "model": "opus"\n}\n'): Promise<void> {
    if (original !== null) {
      mkdirSync(join(home, '.claude'), { recursive: true })
      writeFileSync(settingsPath, original)
    }
    expect((await run(setup().command, [])).code).toBe(0)
    addLoginWithFolder(WORK, 'work-example')
    addLoginWithFolder(SPARE, 'spare-example')
  }

  it('lists what it removes, asks, and removes it all, leaving the logins of plain claude and plain codex alone', async () => {
    const original = '{\n  "model": "opus"\n}\n'
    await installed(original)
    const world = uninstaller({ terminal: true, answer: 'yes' })
    const result = await run(world.command, ['--uninstall-and-logout'])
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(world.questions).toEqual(['Remove all of this? [y/N] '])
    expect(result.stdout).toContain(`  - kurmis' settings in ${settingsPath}`)
    expect(result.stdout).toContain(`  - ${backupPathFor(settingsPath)}, the copy of ${settingsPath} that kurmis made`)
    expect(result.stdout).toContain('  - the logins added to kurmis, each signed out first: work-example, spare-example')
    expect(result.stdout).toContain(`  - the running daemon (pid ${String(FAKE_CONNECTION.pid)}), which it stops`)
    expect(result.stdout).toContain(`  - the kurmis data folder ${kurmisHome}`)
    expect(result.stdout).toContain('The logins plain claude and plain codex use are not signed out')

    expect(readFileSync(settingsPath, 'utf8')).toBe(original)
    expect(existsSync(backupPathFor(settingsPath))).toBe(false)
    expect(world.autostart.calls).toEqual(['unregister:darwin'])
    expect(world.stops).toBe(1)
    // One logout CLI per added login, on its own folder; none on the logins of plain claude and plain codex.
    expect(world.signOuts).toEqual([
      `/fake/bin/claude auth logout ${loginFolder(WORK)}`,
      `/fake/bin/codex logout ${loginFolder(SPARE)}`
    ])
    expect(existsSync(kurmisHome)).toBe(false)
    expect(globalRoutingState({})).toBe('off')
    expect(result.stdout).toContain('Removed work-example (id workclaude).')
    expect(result.stdout).toContain(`Deleted the kurmis data folder ${kurmisHome}.`)
    expect(result.stdout.trimEnd().split('\n').at(-1)).toBe('Last step: remove the kurmis program with "npm uninstall -g kurmis".')
  })

  it('signs out a folder a login left behind by its id, and never the login plain claude uses', async () => {
    writeTestConfig({ port: PORT })
    await installed()
    const leftover = claudeRef('leftover01')
    mkdirSync(loginFolder(leftover), { recursive: true })
    // A folder named by the id of the login plain claude uses is not a login kurmis added.
    mkdirSync(join(kurmisHome, 'claude', OWN_CLAUDE_REF.id), { recursive: true })
    const world = uninstaller()
    const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('  - the logins added to kurmis, each signed out first: work-example, spare-example, leftover01')
    expect(result.stdout).toContain('Deleted the folder that leftover01 left behind.')
    expect(world.signOuts).toEqual([
      `/fake/bin/claude auth logout ${loginFolder(WORK)}`,
      `/fake/bin/codex logout ${loginFolder(SPARE)}`,
      `/fake/bin/claude auth logout ${loginFolder(leftover)}`
    ])
    expect(existsSync(kurmisHome)).toBe(false)
  })

  it('refuses without a terminal and without --yes, and removes nothing', async () => {
    await installed()
    const world = uninstaller({ terminal: false })
    const result = await run(world.command, ['--uninstall-and-logout'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('there is no terminal to ask at. Run it again with --yes')
    expect(world.questions).toEqual([])
    expect(world.signOuts).toEqual([])
    expect(world.stops).toBe(0)
    expect(globalRoutingState({})).toBe('on')
    expect(existsSync(loginFolder(WORK))).toBe(true)
  })

  it('removes nothing when the answer is not yes', async () => {
    await installed()
    for (const answer of ['', 'n', null]) {
      const world = uninstaller({ terminal: true, answer })
      const result = await run(world.command, ['--uninstall-and-logout'])
      expect(result.code).toBe(1)
      expect(result.stdout).toContain('Nothing was removed.')
      expect(world.signOuts).toEqual([])
      expect(globalRoutingState({})).toBe('on')
    }
  })

  it('does not ask with --yes', async () => {
    await installed(null)
    const world = uninstaller({ terminal: true })
    const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
    expect(result.code).toBe(0)
    expect(world.questions).toEqual([])
    // Setup created the file, so undo leaves an empty object and there is no backup.
    expect(settings()).toEqual({})
    expect(existsSync(kurmisHome)).toBe(false)
  })

  it('keeps the data folder and the login when a login cannot be signed out, and a second run finishes', async () => {
    await installed()
    const first = uninstaller({ failSignOutOf: WORK })
    const result = await run(first.command, ['--uninstall-and-logout', '--yes'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('kurmis setup: "claude auth logout" did not finish (exit code 1).')
    expect(result.stderr).not.toContain('kurmis logout:')
    expect(result.stderr).toContain(`Its Keychain item "${keychainService(loginFolder(WORK))}" may be left`)
    expect(result.stderr).toContain(`work-example stays in kurmis with its folder ${loginFolder(WORK)}, so that ` +
      '"kurmis setup --uninstall-and-logout" runs it again.')
    expect(result.stderr).toContain('"kurmis logout workclaude" removes work-example and its folder without signing it out')
    expect(result.stderr).toContain('Could not remove work-example; see above.')
    expect(result.stderr).toContain(`Kept the kurmis data folder ${kurmisHome}`)
    expect(result.stdout).not.toContain('npm uninstall')
    expect(existsSync(loginFolder(WORK))).toBe(true)
    expect(existsSync(loginFolder(SPARE))).toBe(false)
    expect(globalRoutingState({})).toBe('off')

    // The login is still in config.json, and the second run finds it there.
    const second = uninstaller({ running: false })
    const again = await run(second.command, ['--uninstall-and-logout', '--yes'])
    expect(again.code).toBe(0)
    expect(again.stdout).toContain('  - the logins added to kurmis, each signed out first: work-example\n')
    expect(second.signOuts).toEqual([`/fake/bin/claude auth logout ${loginFolder(WORK)}`])
    expect(again.stdout).toContain('The daemon was not running.')
    expect(existsSync(kurmisHome)).toBe(false)
  })

  it('names "kurmis logout <id>" as the way out when the logout CLI is missing, which lets a second run finish', async () => {
    await installed()
    const first = uninstaller({ cliMissing: true })
    const result = await run(first.command, ['--uninstall-and-logout', '--yes'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('claude was not found on PATH.')
    expect(result.stderr).toContain('If that cannot work, for example because claude is not installed, "kurmis logout workclaude" ' +
      'removes work-example and its folder without signing it out, which leaves the item named above.')
    expect(result.stderr).toContain('If that cannot work, for example because codex is not installed, "kurmis logout sparecodex" ' +
      'removes spare-example and its folder without signing it out.')
    expect(result.stdout).not.toContain('npm uninstall')
    expect(existsSync(kurmisHome)).toBe(true)

    // The way out, with the CLIs still missing.
    const missing = (tool: 'claude' | 'codex') => {
      throw new ProgramNotFoundError(tool, `${tool} was not found on PATH.`)
    }
    const logout = createLogoutCommand({ daemon: fakeDaemonClient({ running: false }), findProgram: missing, platform: 'darwin' })
    expect(await logout.run(['workclaude'], collect().context)).toBe(0)
    expect(await logout.run(['sparecodex'], collect().context)).toBe(0)
    const second = await run(uninstaller({ cliMissing: true, running: false }).command, ['--uninstall-and-logout', '--yes'])
    expect(second.code).toBe(0)
    expect(existsSync(kurmisHome)).toBe(false)
    expect(second.stdout).toContain('npm uninstall -g kurmis')
  })

  it('counts a failed logout of a Claude login in config.json without a folder as a failure', async () => {
    await installed()
    rmSync(loginFolder(WORK), { recursive: true, force: true })
    const world = uninstaller({ failSignOutOf: WORK })
    const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('work-example stays in kurmis, so that "kurmis setup --uninstall-and-logout" runs it again.')
    expect(result.stdout).not.toContain('npm uninstall')
    expect(existsSync(kurmisHome)).toBe(true)
    expect(findLogin(loadConfig(), WORK.id)).toBeDefined()
  })

  it('takes kurmis\' settings out of a file setup wrote with another CLAUDE_CONFIG_DIR before it deletes the data folder', async () => {
    const dir = join(home, 'other-claude')
    const other = join(dir, 'settings.json')
    try {
      await installed()
      expect((await run(setup().command, [], { CLAUDE_CONFIG_DIR: dir })).code).toBe(0)
      const world = uninstaller()
      const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain(`  - kurmis' settings in ${settingsPath}\n`)
      expect(result.stdout).toContain(`  - kurmis' settings in ${other}\n`)
      expect(result.stdout).toContain(`Claude Code settings: ${other}`)
      expect(readFileSync(other, 'utf8')).not.toContain('x-kurmis')
      expect(readFileSync(settingsPath, 'utf8')).not.toContain('x-kurmis')
      expect(existsSync(kurmisHome)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  })

  it('stops before removing anything when a recorded settings file cannot be changed', async () => {
    const dir = join(home, 'other-claude')
    const other = join(dir, 'settings.json')
    try {
      await installed()
      expect((await run(setup().command, [], { CLAUDE_CONFIG_DIR: dir })).code).toBe(0)
      writeFileSync(other, '{ "env": ')
      const world = uninstaller()
      const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(`${other} cannot be changed`)
      expect(result.stderr).toContain('Nothing was removed.')
      expect(world.signOuts).toEqual([])
      expect(globalRoutingState({})).toBe('on')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  })

  it('lists the entries of the login folders that are no login kurmis added, which go without a logout', async () => {
    writeTestConfig({ port: PORT })
    await installed()
    mkdirSync(join(kurmisHome, 'claude', 'Not-An-Id'), { recursive: true })
    mkdirSync(join(kurmisHome, 'claude', OWN_CLAUDE_REF.id), { recursive: true })
    const world = uninstaller()
    const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('which are deleted without a logout: ' +
      `${join('claude', 'Not-An-Id')}, ${join('claude', OWN_CLAUDE_REF.id)}`)
    expect(existsSync(kurmisHome)).toBe(false)
  })

  it('creates nothing when there is nothing to remove, and lists no logins', async () => {
    rmSync(kurmisHome, { recursive: true, force: true, maxRetries: 10 })
    const world = uninstaller({ running: false })
    const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
    expect(result.code).toBe(0)
    expect(result.stdout).not.toContain('logins added')
    expect(existsSync(kurmisHome)).toBe(false)
  })

  it('keeps the data folder when the daemon cannot be stopped', async () => {
    await installed()
    const world = uninstaller({ stopFails: 'the daemon runs as another user' })
    const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Could not stop the daemon: the daemon runs as another user')
    expect(existsSync(kurmisHome)).toBe(true)
    expect(world.signOuts).toHaveLength(2)
  })

  it('goes on when the start at login cannot be removed, keeps the data folder, and exits 1', async () => {
    await installed()
    const world = uninstaller({ autostart: fakeAutostart({ warning: 'the entry is locked' }), platform: 'win32' })
    const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Could not remove the daemon\'s start at login: the entry is locked')
    // On Windows the logon entry runs autostart.js in the data folder.
    expect(result.stderr).toContain(`Kept the kurmis data folder ${kurmisHome}`)
    expect(existsSync(kurmisHome)).toBe(true)
    expect(world.signOuts).toHaveLength(2)
  })

  it('keeps the data folder when the real logon entry cannot be removed, on the fake reg', async () => {
    await installed()
    const reg = { ...process.env, FAKE_REG_FAIL: 'delete' }
    await registerAutostart({ env: reg, platform: 'win32', entry: 'C:\\kurmis\\dist\\kurmis.cjs', nodePath: 'C:\\node\\node.exe' })
    const autostart: FakeAutostart = {
      calls: [],
      registerAutostart: async (given) => await registerAutostart({ ...given, env: reg }),
      unregisterAutostart: async (given) => await unregisterAutostart({ ...given, env: reg })
    }
    const world = uninstaller({ autostart, platform: 'win32' })
    const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('reg.exe could not remove the logon entry')
    expect(existsSync(join(kurmisHome, 'autostart.js'))).toBe(true)
  })

  it('removes nothing when the settings file cannot be changed', async () => {
    await installed()
    writeFileSync(settingsPath, '{ "env": ')
    const world = uninstaller()
    const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`${settingsPath} cannot be changed`)
    expect(result.stderr).toContain('Nothing was removed.')
    expect(world.signOuts).toEqual([])
    expect(existsSync(loginFolder(WORK))).toBe(true)
  })

  it('leaves files in the data folder that kurmis did not write, and what links in it point to', async () => {
    await installed()
    const codexHome = join(home, '.codex')
    mkdirSync(join(codexHome, 'skills'), { recursive: true })
    writeFileSync(join(codexHome, 'skills', 'one.md'), 'kept')
    linkFolder(join(codexHome, 'skills'), join(loginFolder(SPARE), 'skills'))
    writeFileSync(join(kurmisHome, 'notes.txt'), 'mine')
    try {
      const world = uninstaller()
      const result = await run(world.command, ['--uninstall-and-logout', '--yes'])
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('The folder is left, because it also holds files kurmis did not write: notes.txt.')
      expect(readdirSync(kurmisHome)).toEqual(['notes.txt'])
      expect(readFileSync(join(codexHome, 'skills', 'one.md'), 'utf8')).toBe('kept')
    } finally {
      rmSync(codexHome, { recursive: true, force: true, maxRetries: 10 })
    }
  })
})

