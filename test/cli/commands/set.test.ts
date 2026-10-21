import { rmSync, writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createSetCommand,
  formatLoginSettings,
  parseOnOff,
  parsePercent,
  patchFromOptions,
  resolveLoginArgument
} from '../../../src/cli/commands/set.ts'
import { addLogin, defaultConfig, findLogin, loadConfig, saveConfig } from '../../../src/data/config.ts'
import { configPath, kurmisHome } from '../../../src/data/paths.ts'
import { collect, fakeDaemonClient } from '../helpers.ts'

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
  let config = addLogin(defaultConfig(), 'claude:work', { label: 'Work' })
  config = addLogin(config, 'codex:work')
  config = addLogin(config, 'codex:side')
  saveConfig(config)
})

describe('reading the options', () => {
  it('takes on and off only', () => {
    expect(parseOnOff('on')).toBe(true)
    expect(parseOnOff('off')).toBe(false)
    for (const text of ['yes', 'true', 'ON', '1', '']) expect(parseOnOff(text)).toBeNull()
  })

  it('takes whole numbers from 1 to 100 only', () => {
    expect(parsePercent('1')).toBe(1)
    expect(parsePercent('100')).toBe(100)
    expect(parsePercent('075')).toBe(75)
    for (const text of ['0', '101', '50.5', '-5', ' 5', '5%', '1e2', '', '0x10']) expect(parsePercent(text)).toBeNull()
  })

  it('builds the patch, or names the wrong option', () => {
    expect(patchFromOptions({ auto: 'off', 'five-hour': '90', weekly: '80', 'use-first': 'on', label: '  Mine  ' })).toEqual({
      routing: false, fiveHourLimit: 90, weeklyLimit: 80, useFirst: true, label: 'Mine'
    })
    expect(patchFromOptions({})).toEqual({ error: expect.stringContaining('give at least one of') as unknown })
    expect(patchFromOptions({ auto: 'yes' })).toEqual({ error: '--auto takes on or off, not "yes"' })
    expect(patchFromOptions({ 'use-first': 'true' })).toEqual({ error: '--use-first takes on or off, not "true"' })
    expect(patchFromOptions({ weekly: '0' })).toEqual({ error: '--weekly takes a whole number from 1 to 100, not "0"' })
    expect(patchFromOptions({ 'five-hour': '150' })).toEqual({ error: '--five-hour takes a whole number from 1 to 100, not "150"' })
    expect(patchFromOptions({ label: '   ' })).toEqual({ error: '--label takes 1 to 64 characters' })
    expect(patchFromOptions({ label: 'x'.repeat(65) })).toEqual({ error: '--label takes 1 to 64 characters' })
  })

  it('finds a login by id or by a name only one login has', () => {
    const config = loadConfig()
    expect(resolveLoginArgument('claude:work', config)).toMatchObject({ id: 'claude:work' })
    expect(resolveLoginArgument('side', config)).toMatchObject({ id: 'codex:side' })
    expect(resolveLoginArgument('work', config)).toEqual({ error: '"work" could be claude:work or codex:work; give the full id' })
    expect(resolveLoginArgument('default', config)).toMatchObject({ error: expect.stringContaining('could be claude:default or codex:default') as unknown })
    expect(resolveLoginArgument('claude:none', config)).toMatchObject({ error: expect.stringContaining('there is no login claude:none') as unknown })
    expect(resolveLoginArgument('none', config)).toMatchObject({ error: expect.stringContaining('there is no login named "none"') as unknown })
    expect(resolveLoginArgument('claude:../x', config)).toMatchObject({ error: expect.stringContaining('is not a login id') as unknown })
  })
})

describe('kurmis set', () => {
  it('changes the settings, prints them and reloads the daemon', async () => {
    const daemon = fakeDaemonClient()
    const set = createSetCommand({ daemon })
    const out = collect()
    const code = await set.run(['claude:work', '--auto', 'off', '--five-hour', '90', '--weekly', '80', '--use-first', 'on', '--label', 'Work account'], out.context)
    expect(code).toBe(0)
    expect(findLogin(loadConfig(), 'claude:work')).toMatchObject({
      label: 'Work account', routing: false, fiveHourLimit: 90, weeklyLimit: 80, useFirst: true
    })
    expect(out.stdout()).toBe([
      'claude:work',
      '  label       Work account',
      '  auto        off',
      '  five-hour   90%',
      '  weekly      80%',
      '  use-first   on',
      'The running daemon has read the change.',
      ''
    ].join('\n'))
    expect(daemon.calls).toEqual(['findDaemon', 'requestReload'])
  })

  it('leaves the other settings and logins as they were', async () => {
    const before = loadConfig()
    const set = createSetCommand({ daemon: fakeDaemonClient({ running: false }) })
    const out = collect()
    expect(await set.run(['side', '--weekly', '50'], out.context)).toBe(0)
    const after = loadConfig()
    expect(findLogin(after, 'codex:side')).toEqual({ ...findLogin(before, 'codex:side'), weeklyLimit: 50 })
    expect(after.logins.filter((login) => login.id !== 'codex:side')).toEqual(before.logins.filter((login) => login.id !== 'codex:side'))
    expect(out.stdout()).not.toContain('daemon')
  })

  it('sets the machine\'s own logins too', async () => {
    const set = createSetCommand({ daemon: fakeDaemonClient({ running: false }) })
    expect(await set.run(['codex:default', '--auto', 'off'], collect().context)).toBe(0)
    expect(findLogin(loadConfig(), 'codex:default')?.routing).toBe(false)
  })

  it('says when the daemon could not be told', async () => {
    const set = createSetCommand({ daemon: fakeDaemonClient({ reloadFails: 'connection refused' }) })
    const out = collect()
    expect(await set.run(['claude:work', '--weekly', '70'], out.context)).toBe(0)
    expect(out.stdout()).toContain('The daemon could not be told about the change (connection refused)')
  })

  it.each([
    [[]],
    [['claude:work']],
    [['claude:work', 'codex:side', '--weekly', '5']],
    [['claude:work', '--auto', 'maybe']],
    [['claude:work', '--weekly', '101']],
    [['claude:work', '--nope', '1']],
    [['claude:none', '--weekly', '5']],
    [['work', '--weekly', '5']]
  ])('gives a usage error for %j and changes nothing', async (args) => {
    const before = readConfigText()
    const daemon = fakeDaemonClient()
    const out = collect()
    expect(await createSetCommand({ daemon }).run(args, out.context)).toBe(2)
    expect(out.stderr()).toContain('kurmis set:')
    expect(readConfigText()).toBe(before)
    expect(daemon.calls).toEqual([])
  })

  it('reports a broken config.json', async () => {
    writeFileSync(configPath(), '{"version": 7}')
    const out = collect()
    expect(await createSetCommand({ daemon: fakeDaemonClient() }).run(['claude:work', '--weekly', '5'], out.context)).toBe(1)
    expect(out.stderr()).toContain('newer kurmis')
  })

  it('formats the settings under the option names', () => {
    expect(formatLoginSettings(findLogin(loadConfig(), 'claude:work')!)).toContain('  five-hour   100%')
  })
})

function readConfigText(): string {
  return JSON.stringify(loadConfig())
}
