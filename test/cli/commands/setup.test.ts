import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSetupCommand } from '../../../src/cli/commands/setup.ts'
import { backupPathFor } from '../../../src/cli/global-settings.ts'
import { readKey } from '../../../src/data/daemon-file.ts'
import { registerAutostart, unregisterAutostart, type AutostartOptions, type AutostartResult } from '../../../src/platform/autostart.ts'
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
      const undone = await run(command, ['--undo'])
      expect(undone.stderr).not.toContain('symbolic link')
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
    const warning = 'The logon entry was not written: C:\\Windows\\System32\\wscript.exe does not exist. The next kurmis command starts the daemon anyway.'
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
    const unsupported = 'Starting the daemon at login is not supported on this platform; the next kurmis command starts it.'
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
    // A CLI that reads that file signs in with the login in that folder, not the machine's own Claude login.
    const env = (JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { env: Record<string, string> }).env
    expect(env['ANTHROPIC_CUSTOM_HEADERS']).toMatch(/\nx-kurmis-started-on: none$/)
    expect(result.stdout).toContain('CLAUDE_CONFIG_DIR is set, so a plain claude that reads this file signs in with the login in that folder')
    // Undo takes the line out with the other kurmis headers.
    expect((await run(command, ['--undo'], { CLAUDE_CONFIG_DIR: dir })).code).toBe(0)
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

  it('still undoes with a CLAUDE_CONFIG_DIR that names ~/.claude', async () => {
    expect((await run(setup().command, [])).code).toBe(0)
    const result = await run(setup().command, ['--undo'], { CLAUDE_CONFIG_DIR: join(home, '.claude') })
    expect(result.code).toBe(0)
    expect(readFileSync(settingsPath, 'utf8')).not.toContain('x-kurmis')
  })

  it('without CLAUDE_CONFIG_DIR names no started-on login, so a plain claude counts as on the machine\'s own login', async () => {
    const { command } = setup()
    expect((await run(command, [])).code).toBe(0)
    expect(readFileSync(settingsPath, 'utf8')).not.toContain('x-kurmis-started-on')
  })

  it('rejects an unknown option or argument', async () => {
    const { command } = setup()
    expect((await run(command, ['--force'])).code).toBe(2)
    expect((await run(command, ['now'])).code).toBe(2)
  })

  it('mentions --undo in its help', () => {
    expect(setup().command.usage).toContain('--undo')
  })
})

describe('kurmis setup --undo', () => {
  it('gives back the file as it was, unregisters autostart and leaves the daemon running', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    const original = '{\n\t"model": "opus"\n}\n'
    writeFileSync(settingsPath, original)
    const { client, autostart, command } = setup()
    expect((await run(command, [])).code).toBe(0)
    client.calls.length = 0

    const result = await run(command, ['--undo'])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(readFileSync(settingsPath, 'utf8')).toBe(original)
    expect(autostart.calls).toEqual(['register:darwin', 'unregister:darwin'])
    expect(client.calls).toEqual(['findDaemon'])
    expect(result.stdout).toContain('Removed ANTHROPIC_BASE_URL.')
    expect(result.stdout).toContain('Removed the "env" block, which had nothing else in it.')
    expect(result.stdout).toContain('The daemon no longer starts at login')
    expect(result.stdout).toContain('The daemon keeps running')

    const again = await run(command, ['--undo'])
    expect(again.code).toBe(0)
    expect(again.stdout).toContain('The file has none of kurmis\' settings; nothing to take out.')
    expect(again.stdout).toContain('The daemon was not set to start at login.')
    expect(readFileSync(settingsPath, 'utf8')).toBe(original)
  })

  it('leaves a value the user changed and says so', async () => {
    const { command } = setup()
    await run(command, [])
    const text = readFileSync(settingsPath, 'utf8').replace('"CLAUDE_CODE_MAX_RETRIES": "15"', '"CLAUDE_CODE_MAX_RETRIES": "6"')
    writeFileSync(settingsPath, text)
    const result = await run(command, ['--undo'])
    expect(result.code).toBe(0)
    expect(settings()).toEqual({ env: { CLAUDE_CODE_MAX_RETRIES: '6' } })
    expect(result.stdout).toContain('Left CLAUDE_CODE_MAX_RETRIES as it is: its value (6) is not the one kurmis sets.')
  })

  it('works when there is no settings file and no daemon', async () => {
    const { command } = setup({ running: false })
    const result = await run(command, ['--undo'])
    expect(result.code).toBe(0)
    expect(existsSync(settingsPath)).toBe(false)
    expect(result.stdout).not.toContain('The daemon keeps running')
  })

  it('still undoes with a broken config.json, by the key header', async () => {
    const { command } = setup()
    await run(command, [])
    writeFileSync(join(kurmisHome, 'config.json'), '{')
    const result = await run(command, ['--undo'])
    expect(result.code).toBe(0)
    expect(settings()).toEqual({})
  })

  it('exits 1 when autostart cannot be removed, keeping the settings change', async () => {
    const { command } = setup()
    await run(command, [])
    const failing = createSetupCommand({ daemon: fakeDaemonClient(), ...fakeAutostart({ warning: 'the entry is locked' }), platform: 'win32' })
    const result = await run(failing, ['--undo'])
    expect(result.code).toBe(1)
    expect(settings()).toEqual({})
    expect(result.stderr).toContain('Could not remove the daemon\'s start at login: the entry is locked')
  })
})
