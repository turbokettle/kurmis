import { rmSync, writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { createSetCommand, formatLoginSettings, parseOnOff, parsePercent, patchFromOptions } from '../../../src/cli/commands/set.ts'
import { changeConfig, findLogin, followEmail, loadConfig } from '../../../src/data/config.ts'
import { configPath, kurmisHome } from '../../../src/data/paths.ts'
import { OWN_CLAUDE, OWN_CODEX, writeTestConfig } from '../../logins.ts'
import { collect, fakeDaemonClient } from '../helpers.ts'

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
  writeTestConfig({
    extras: [
      { id: 'workclaude', provider: 'claude', alias: 'work-example' },
      { id: 'workcodex1', provider: 'codex', alias: 'work-example' },
      { id: 'sidecodex1', provider: 'codex', alias: 'side-example' }
    ]
  })
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
    expect(patchFromOptions({ auto: 'off', 'five-hour': '90', weekly: '80', 'use-first': 'on', alias: 'mine' })).toEqual({
      routing: false, fiveHourLimit: 90, weeklyLimit: 80, useFirst: true, alias: 'mine'
    })
    expect(patchFromOptions({})).toEqual({ error: expect.stringContaining('give at least one of') as unknown })
    expect(patchFromOptions({ auto: 'yes' })).toEqual({ error: '--auto takes on or off, not "yes"' })
    expect(patchFromOptions({ 'use-first': 'true' })).toEqual({ error: '--use-first takes on or off, not "true"' })
    expect(patchFromOptions({ weekly: '0' })).toEqual({ error: '--weekly takes a whole number from 1 to 100, not "0"' })
    expect(patchFromOptions({ 'five-hour': '150' })).toEqual({ error: '--five-hour takes a whole number from 1 to 100, not "150"' })
  })
})

describe('kurmis set', () => {
  it('changes the settings, prints them and reloads the daemon', async () => {
    const daemon = fakeDaemonClient()
    const set = createSetCommand({ daemon })
    const out = collect()
    const code = await set.run(['claude:work-example', '--auto', 'off', '--five-hour', '90', '--weekly', '80', '--use-first', 'on'], out.context)
    expect(code).toBe(0)
    expect(findLogin(loadConfig(), 'workclaude')).toMatchObject({ routing: false, fiveHourLimit: 90, weeklyLimit: 80, useFirst: true })
    expect(out.stdout()).toBe([
      'work-example (Claude, id workclaude)',
      '  alias       work-example (set by you)',
      '  auto        off',
      '  five-hour   90%',
      '  weekly      80%',
      '  use-first   on',
      'The running daemon has read the change.',
      ''
    ].join('\n'))
    expect(daemon.calls).toEqual(['findDaemon', 'requestReload'])
  })

  it('finds a login by its alias, its id, or either after claude: or codex:', async () => {
    const set = createSetCommand({ daemon: fakeDaemonClient({ running: false }) })
    for (const [text, id] of [['side-example', 'sidecodex1'], ['sidecodex1', 'sidecodex1'], ['codex:side-example', 'sidecodex1'],
      ['workclaude', 'workclaude'], ['codex:work-example', 'workcodex1'], ['claude:workclaude', 'workclaude']] as const) {
      const weekly = String(10 + text.length)
      expect(await set.run([text, '--weekly', weekly], collect().context)).toBe(0)
      expect(findLogin(loadConfig(), id)?.weeklyLimit).toBe(Number(weekly))
    }
  })

  it('needs claude: or codex: in front of an alias a Claude and a Codex login share', async () => {
    const before = readConfigText()
    const out = collect()
    expect(await createSetCommand({ daemon: fakeDaemonClient() }).run(['work-example', '--weekly', '5'], out.context)).toBe(2)
    expect(out.stderr()).toContain('a Claude login and a Codex login are both called "work-example"; give claude:work-example or codex:work-example')
    expect(readConfigText()).toBe(before)
  })

  it('leaves the other settings and logins as they were', async () => {
    const before = loadConfig()
    const set = createSetCommand({ daemon: fakeDaemonClient({ running: false }) })
    const out = collect()
    expect(await set.run(['side-example', '--weekly', '50'], out.context)).toBe(0)
    const after = loadConfig()
    expect(findLogin(after, 'sidecodex1')).toEqual({ ...findLogin(before, 'sidecodex1'), weeklyLimit: 50 })
    expect(after.logins.filter((login) => login.id !== 'sidecodex1')).toEqual(before.logins.filter((login) => login.id !== 'sidecodex1'))
    expect(out.stdout()).not.toContain('daemon')
  })

  it('sets the machine\'s own logins too, and marks them', async () => {
    const set = createSetCommand({ daemon: fakeDaemonClient({ running: false }) })
    const out = collect()
    expect(await set.run([OWN_CODEX, '--auto', 'off'], out.context)).toBe(0)
    expect(findLogin(loadConfig(), OWN_CODEX)?.routing).toBe(false)
    expect(out.stdout()).toContain(`${OWN_CODEX} (Codex, id ${OWN_CODEX})\n  this machine's own Codex sign-in\n`)
    expect(out.stdout()).toContain(`  alias       ${OWN_CODEX} (the id, while kurmis knows no email for the login)`)
  })

  it('sets an alias the person chose, which an email no longer replaces', async () => {
    changeConfig((config) => followEmail(config, OWN_CLAUDE, 'own@example.com'))
    expect(findLogin(loadConfig(), OWN_CLAUDE)?.alias).toBe('own-example')
    const set = createSetCommand({ daemon: fakeDaemonClient({ running: false }) })
    const out = collect()
    expect(await set.run(['own-example', '--alias', 'home'], out.context)).toBe(0)
    expect(out.stdout()).toContain('  alias       home (set by you)')
    expect(findLogin(loadConfig(), OWN_CLAUDE)).toMatchObject({ alias: 'home', aliasSetByUser: true })
    changeConfig((config) => followEmail(config, OWN_CLAUDE, 'other@example.com'))
    expect(findLogin(loadConfig(), OWN_CLAUDE)?.alias).toBe('home')
  })

  it('takes an alias another provider\'s login has', async () => {
    const set = createSetCommand({ daemon: fakeDaemonClient({ running: false }) })
    expect(await set.run(['side-example', '--alias', 'workclaude-x'], collect().context)).toBe(0)
    expect(await set.run(['codex:workclaude-x', '--alias', 'side_2'], collect().context)).toBe(0)
    expect(findLogin(loadConfig(), 'sidecodex1')?.alias).toBe('side_2')
  })

  it.each([
    [['side-example', '--alias', 'work-example'], 'another Codex login is already called "work-example"'],
    [['side-example', '--alias', 'workclaude'], '"workclaude" is the id of another login'],
    [['side-example', '--alias', 'Work'], '"Work" is not an alias'],
    [['side-example', '--alias', 'codex'], '"codex" is not an alias'],
    [['side-example', '--alias', 'a'.repeat(33)], 'is not an alias'],
    [['side-example', '--alias', ''], '"" is not an alias'],
    [['side-example', '--alias=_side'], '"_side" is not an alias']
  ])('refuses the alias in %j', async (args, message) => {
    const before = readConfigText()
    const out = collect()
    expect(await createSetCommand({ daemon: fakeDaemonClient() }).run(args, out.context)).toBe(2)
    expect(out.stderr()).toContain(message)
    expect(readConfigText()).toBe(before)
  })

  it('says when the daemon could not be told', async () => {
    const set = createSetCommand({ daemon: fakeDaemonClient({ reloadFails: 'connection refused' }) })
    const out = collect()
    expect(await set.run(['workclaude', '--weekly', '70'], out.context)).toBe(0)
    expect(out.stdout()).toContain('The daemon could not be told about the change (connection refused)')
  })

  it.each([
    [[]],
    [['workclaude']],
    [['workclaude', 'sidecodex1', '--weekly', '5']],
    [['workclaude', '--auto', 'maybe']],
    [['workclaude', '--weekly', '101']],
    [['workclaude', '--nope', '1']],
    [['workclaude', '--label', 'Work']],
    [['none-example', '--weekly', '5']],
    [['claude:side-example', '--weekly', '5']],
    [['work-example', '--weekly', '5']]
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
    expect(await createSetCommand({ daemon: fakeDaemonClient() }).run(['workclaude', '--weekly', '5'], out.context)).toBe(1)
    expect(out.stderr()).toContain('newer kurmis')
  })

  it('formats the settings under the option names', () => {
    expect(formatLoginSettings(findLogin(loadConfig(), 'workclaude')!)).toContain('  five-hour   100%')
  })
})

function readConfigText(): string {
  return JSON.stringify(loadConfig())
}
