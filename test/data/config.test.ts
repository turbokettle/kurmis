import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addLogin,
  aliasProblem,
  changeConfig,
  CONFIG_VERSION,
  ConfigError,
  configStamp,
  DEFAULT_PORT,
  defaultConfig,
  extraLogins,
  findLogin,
  followEmail,
  isMachineOwn,
  loadConfig,
  loginIds,
  machineOwnLogin,
  newLoginIdFor,
  parseConfig,
  readConfig,
  removeLogin,
  resolveLogin,
  saveConfig,
  updateLogin,
  type KurmisConfig,
  type LoginSettings
} from '../../src/data/config.ts'
import { readJsonFileSync } from '../../src/data/json-file.ts'
import { isLoginId, type LoginId } from '../../src/data/login-id.ts'
import { configLockPath, configPath } from '../../src/data/paths.ts'
import { loginOf, OWN_CLAUDE, OWN_CODEX, testConfig, writeTestConfig } from '../logins.ts'

function writeRaw(value: unknown): void {
  saveRawText(JSON.stringify(value))
}
function saveRawText(text: string): void {
  writeFileSync(configPath(), text)
}

/** A stored login with only the fields a file must have. */
function stored(id: string, provider: 'claude' | 'codex', more: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, provider, ...more }
}

/** The logins of plain claude and plain codex as a version 2 file stores them. */
const OWN_ROWS = [stored(OWN_CLAUDE, 'claude', { machineOwn: true }), stored(OWN_CODEX, 'codex', { machineOwn: true })]

function idsOf(config: KurmisConfig): string[] {
  return config.logins.map((login) => login.id)
}

/** Unwraps a `resolveLogin` answer that must have found a login. */
function resolved(config: KurmisConfig, text: string, provider?: 'claude' | 'codex'): LoginSettings {
  const answer = resolveLogin(config, text, provider)
  if ('error' in answer) throw new Error(`expected a login for ${text}, got: ${answer.error}`)
  return answer.login
}

/** Unwraps a `resolveLogin` answer that must be an error. */
function refused(config: KurmisConfig, text: string, provider?: 'claude' | 'codex'): string {
  const answer = resolveLogin(config, text, provider)
  if ('login' in answer) throw new Error(`expected an error for ${text}, got the login ${answer.login.id}`)
  return answer.error
}

beforeEach(() => {
  // Saving once creates the data folder; the file itself is removed for each test.
  saveConfig(testConfig())
  rmSync(configPath(), { force: true })
})

describe('loading', () => {
  it('reads without writing with readConfig: no file, and a file without the logins of plain claude and plain codex', () => {
    expect(readConfig()).toEqual({ version: CONFIG_VERSION, port: DEFAULT_PORT, logins: [] })
    expect(existsSync(configPath())).toBe(false)
    const text = JSON.stringify({ version: 2, port: 30001, logins: [{ id: 'workclaude', provider: 'claude', alias: 'work-example' }] })
    saveRawText(text)
    expect(readConfig().logins.map((login) => login.id)).toEqual(['workclaude'])
    expect(readFileSync(configPath(), 'utf8')).toBe(text)
    expect(existsSync(configLockPath())).toBe(false)
    saveRawText('{')
    expect(() => readConfig()).toThrow(ConfigError)
  })

  it("creates the logins of plain claude and plain codex with new ids when there is no file, and saves them", () => {
    const config = loadConfig()
    expect(config.version).toBe(CONFIG_VERSION)
    expect(config.port).toBe(DEFAULT_PORT)
    expect(config.logins.map((login) => [login.provider, login.machineOwn])).toEqual([['claude', true], ['codex', true]])
    const [claude, codex] = config.logins
    expect(claude!.id).toMatch(/^[a-z0-9]{10}$/)
    expect(codex!.id).toMatch(/^[a-z0-9]{10}$/)
    expect(claude!.id).not.toBe(codex!.id)
    expect(claude).toEqual({
      id: claude!.id,
      provider: 'claude',
      machineOwn: true,
      alias: claude!.id,
      aliasSetByUser: false,
      routing: true,
      fiveHourLimit: 100,
      weeklyLimit: 100,
      useFirst: false
    })
    expect(existsSync(configPath())).toBe(true)
    expect(existsSync(configLockPath())).toBe(false)
    expect(idsOf(loadConfig())).toEqual(idsOf(config))
    expect(loadConfig()).toEqual(config)
  })

  it("adds the login of plain claude or plain codex that a file leaves out, keeping the other's id", () => {
    writeRaw({ version: 2, logins: [OWN_ROWS[1], stored('workclaude', 'claude')] })
    const config = loadConfig()
    expect(config.logins.map((login) => [login.provider, login.machineOwn])).toEqual([['claude', true], ['codex', true], ['claude', false]])
    expect(machineOwnLogin(config, 'codex').id).toBe(OWN_CODEX)
    const added = machineOwnLogin(config, 'claude').id
    expect(isLoginId(added)).toBe(true)
    expect([OWN_CODEX, 'workclaude']).not.toContain(added)
    expect(machineOwnLogin(loadConfig(), 'claude').id).toBe(added)
  })

  it("leaves a file that has both of the logins of plain claude and plain codex as it is", () => {
    const text = JSON.stringify({ version: 2, logins: [...OWN_ROWS] })
    saveRawText(text)
    loadConfig()
    expect(readFileSync(configPath(), 'utf8')).toBe(text)
  })

  it("puts the login plain claude uses first, then the own Codex login, then the extras in file order", () => {
    writeRaw({
      version: 2,
      logins: [
        stored('sidecodex1', 'codex'),
        OWN_ROWS[1],
        stored('workclaude', 'claude', { alias: 'work', aliasSetByUser: true }),
        OWN_ROWS[0],
        stored('lastclaude', 'claude')
      ]
    })
    const config = loadConfig()
    expect(idsOf(config)).toEqual([OWN_CLAUDE, OWN_CODEX, 'sidecodex1', 'workclaude', 'lastclaude'])
    expect(findLogin(config, 'workclaude')).toMatchObject({ alias: 'work', aliasSetByUser: true, routing: true, fiveHourLimit: 100 })
    expect(findLogin(config, 'lastclaude')).toMatchObject({ alias: 'lastclaude', aliasSetByUser: false, machineOwn: false })
  })

  it('round-trips through save', () => {
    let config = addLogin(testConfig(), { id: 'workclaude' as LoginId, provider: 'claude' }, { alias: 'work', useFirst: true })
    config = updateLogin(config, OWN_CODEX, { weeklyLimit: 80 })
    config = { ...config, port: 30001 }
    saveConfig(config)
    expect(loadConfig()).toEqual(config)
    expect(readJsonFileSync(configPath())).toMatchObject({ status: 'ok', value: { version: 2, port: 30001 } })
  })

  it('refuses a file from an older kurmis and says what to do', () => {
    writeRaw({ version: 1, logins: [{ id: 'claude:work', label: 'Work' }] })
    expect(() => loadConfig()).toThrow(ConfigError)
    expect(() => loadConfig()).toThrow(/written by an older kurmis \(config version 1\).*reads only version 2/)
    expect(() => loadConfig()).toThrow(/Delete the file.*kurmis login claude/)
  })

  it('refuses a file from a newer kurmis with a clear message', () => {
    writeRaw({ version: 3, logins: [] })
    expect(() => loadConfig()).toThrow(/written by a newer kurmis \(config version 3\).*Update kurmis/)
  })

  it('does not rewrite a file it refuses', () => {
    const text = JSON.stringify({ version: 1, logins: [] })
    saveRawText(text)
    expect(() => loadConfig()).toThrow(ConfigError)
    expect(readFileSync(configPath(), 'utf8')).toBe(text)
  })

  it('names the file and the field of a wrong value', () => {
    writeRaw({ version: 2, logins: [stored('alogin', 'claude'), stored('blogin', 'claude', { weeklyLimit: 150 })] })
    expect(() => loadConfig()).toThrow(ConfigError)
    expect(() => loadConfig()).toThrow(`${configPath()}: logins[1].weeklyLimit must be a whole number from 1 to 100, not 150`)
  })

  it.each([
    [{ version: 2, port: 80 }, 'port must be a whole number from 1024 to 65535'],
    [{ version: 2, logins: {} }, 'logins must be a list'],
    [{ version: 2, logins: [{ id: '../x', provider: 'claude' }] }, 'logins[0].id must be 1 to 32 lowercase letters and digits'],
    [{ version: 2, logins: [{ id: 'claude:work', provider: 'claude' }] }, 'logins[0].id must be 1 to 32 lowercase letters and digits'],
    [{ version: 2, logins: [{ id: 'none', provider: 'claude' }] }, 'logins[0].id must be 1 to 32 lowercase letters and digits'],
    [{ version: 2, logins: [{ id: 'alogin' }] }, 'logins[0].provider must be a string'],
    [{ version: 2, logins: [{ id: 'alogin', provider: 'gemini' }] }, 'logins[0].provider must be "claude" or "codex"'],
    [{ version: 2, logins: [{ id: 'alogin', provider: 'claude', machineOwn: 'yes' }] }, 'logins[0].machineOwn must be true or false'],
    [{ version: 2, logins: [{ id: 'alogin', provider: 'claude', routing: 'yes' }] }, 'logins[0].routing must be true or false, not a string'],
    [{ version: 2, logins: [{ id: 'alogin', provider: 'claude', aliasSetByUser: 1 }] }, 'logins[0].aliasSetByUser must be true or false'],
    [{ version: 2, logins: [stored('alogin', 'claude'), stored('alogin', 'codex')] }, 'logins[1].id repeats "alogin"'],
    [
      { version: 2, logins: [stored('alogin', 'claude', { machineOwn: true }), stored('blogin', 'claude', { machineOwn: true })] },
      'logins[1].machineOwn is true for a second claude login'
    ],
    [
      { version: 2, logins: [stored('alogin', 'codex', { alias: 'same' }), stored('blogin', 'codex', { alias: 'same' })] },
      'logins[1].alias repeats "same" of another codex login'
    ],
    [
      { version: 2, logins: [stored('alogin', 'claude'), stored('blogin', 'codex', { alias: 'alogin' })] },
      'logins[1].alias "alogin" and the id "blogin" must not be the id or alias of another login'
    ],
    [
      { version: 2, logins: [stored('alogin', 'claude', { alias: 'blogin' }), stored('blogin', 'codex')] },
      'logins[1].alias "blogin" and the id "blogin" must not be the id or alias of another login'
    ],
    [{ version: 2, logins: [stored('alogin', 'claude', { alias: '' })] }, 'logins[0].alias must be 1 to 32 lowercase letters'],
    [{ version: 2, logins: [stored('alogin', 'claude', { alias: 'Work' })] }, 'logins[0].alias must be 1 to 32 lowercase letters'],
    [{ version: 2, logins: [stored('alogin', 'claude', { alias: 'claude' })] }, 'logins[0].alias must be 1 to 32 lowercase letters'],
    [{ version: 2, logins: [stored('alogin', 'claude', { alias: 'a'.repeat(33) })] }, 'logins[0].alias must be 1 to 32 lowercase letters'],
    [{ version: 2, logins: [stored('alogin', 'claude', { alias: 3 })] }, 'logins[0].alias must be a string'],
    [{ logins: [] }, 'has no "version" field'],
    [{ version: 0 }, 'version must be a whole number of 1 or more'],
    [{ version: '2' }, 'version must be a whole number of 1 or more'],
    [[], 'must be an object, not a list']
  ])('refuses %j', (value, message) => {
    expect(() => parseConfig(value, 'config.json')).toThrow(message)
  })

  it('takes the same alias for a Claude login and a Codex login', () => {
    const config = parseConfig({
      version: 2,
      logins: [stored('alogin', 'claude', { alias: 'same' }), stored('blogin', 'codex', { alias: 'same' })]
    }, 'config.json')
    expect(config.logins.map((login) => login.alias)).toEqual(['same', 'same'])
  })

  it('reports a file that is not JSON', () => {
    saveRawText('{ "version": 2,')
    expect(() => loadConfig()).toThrow(/config\.json is not valid JSON/)
  })

  it('ignores unknown fields', () => {
    writeRaw({ version: 2, later: true, logins: [...OWN_ROWS, stored('alogin', 'claude', { later: 1, label: 'Old', email: 'x@example.com' })] })
    expect(findLogin(loadConfig(), 'alogin')).toBeDefined()
  })
})

describe("the logins of plain claude and plain codex", () => {
  it('are found by provider, and are not extra logins', () => {
    const config = testConfig({ extras: [{ id: 'workclaude', provider: 'claude' }, { id: 'sidecodex1', provider: 'codex' }] })
    expect(machineOwnLogin(config, 'claude').id).toBe(OWN_CLAUDE)
    expect(machineOwnLogin(config, 'codex').id).toBe(OWN_CODEX)
    expect(isMachineOwn(loginOf(config, OWN_CLAUDE))).toBe(true)
    expect(isMachineOwn(loginOf(config, 'workclaude'))).toBe(false)
    expect(extraLogins(config).map((login) => login.id)).toEqual(['workclaude', 'sidecodex1'])
    expect(extraLogins(config, 'claude').map((login) => login.id)).toEqual(['workclaude'])
    expect(extraLogins(config, 'codex').map((login) => login.id)).toEqual(['sidecodex1'])
    expect(loginIds(config)).toEqual([OWN_CLAUDE, OWN_CODEX, 'workclaude', 'sidecodex1'])
  })

  it('a config without one is an error when it is asked for', () => {
    const config: KurmisConfig = { ...testConfig(), logins: [] }
    expect(() => machineOwnLogin(config, 'claude')).toThrow(ConfigError)
  })

  it('defaultConfig makes both with ids that differ each time', () => {
    const one = defaultConfig()
    const two = defaultConfig()
    expect(one.logins.map((login) => login.machineOwn)).toEqual([true, true])
    expect(idsOf(one)).not.toEqual(idsOf(two))
  })
})

describe('a new id for a login', () => {
  it('is none of the ids or aliases of the logins there are', () => {
    const config = testConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work' }] })
    for (let round = 0; round < 50; round++) {
      const id = newLoginIdFor(config)
      expect(isLoginId(id)).toBe(true)
      expect([...loginIds(config), ...config.logins.map((login) => login.alias)]).not.toContain(id)
      expect(() => addLogin(config, { id, provider: 'codex' })).not.toThrow()
    }
  })
})

describe('resolving what a person typed', () => {
  const config = testConfig({
    ownClaude: { alias: 'me' },
    extras: [
      { id: 'workclaude', provider: 'claude', alias: 'work' },
      { id: 'workcodex1', provider: 'codex', alias: 'work' },
      { id: 'sidecodex1', provider: 'codex', alias: 'side' }
    ]
  })

  it('finds a login by its id or its alias', () => {
    expect(resolved(config, 'workclaude').id).toBe('workclaude')
    expect(resolved(config, 'side').id).toBe('sidecodex1')
    expect(resolved(config, 'me').id).toBe(OWN_CLAUDE)
    expect(resolved(config, OWN_CODEX).id).toBe(OWN_CODEX)
    expect(resolved(config, ' Side ').id).toBe('sidecodex1')
    expect(resolved(config, 'Claude:WORK').id).toBe('workclaude')
  })

  it('finds a login by its provider and its alias or id', () => {
    expect(resolved(config, 'claude:work').id).toBe('workclaude')
    expect(resolved(config, 'codex:work').id).toBe('workcodex1')
    expect(resolved(config, 'codex:sidecodex1').id).toBe('sidecodex1')
  })

  it('asks for the prefix when a Claude login and a Codex login share the alias', () => {
    expect(refused(config, 'work')).toBe('a Claude login and a Codex login are both called "work"; give claude:work or codex:work')
  })

  it("looks only at one provider's logins when given the provider", () => {
    expect(resolved(config, 'work', 'claude').id).toBe('workclaude')
    expect(resolved(config, 'work', 'codex').id).toBe('workcodex1')
    expect(resolved(config, 'claude:work', 'claude').id).toBe('workclaude')
  })

  it("says when the login is the other provider's", () => {
    expect(refused(config, 'side', 'claude')).toBe('"side" is a Codex login; this takes a Claude login')
    expect(refused(config, 'workclaude', 'codex')).toBe('"workclaude" is a Claude login; this takes a Codex login')
    expect(refused(config, 'codex:work', 'claude')).toBe('"codex:work" is a Codex login; this takes a Claude login')
  })

  it('says when there is no such login', () => {
    expect(refused(config, 'nobody')).toBe('there is no login called "nobody"')
    expect(refused(config, 'nobody', 'codex')).toBe('there is no Codex login called "nobody"')
    expect(refused(config, 'claude:side')).toBe('there is no Claude login called "side"')
    expect(refused(config, 'gemini:work')).toMatch(/names no login/)
    expect(refused(config, 'claude:')).toBe('there is no Claude login called ""')
  })
})

describe('aliasProblem', () => {
  const config = testConfig({
    extras: [
      { id: 'workclaude', provider: 'claude', alias: 'work' },
      { id: 'sidecodex1', provider: 'codex', alias: 'side' }
    ]
  })
  const own = loginOf(config, OWN_CLAUDE)

  it('takes a free alias, its own alias and its own id', () => {
    expect(aliasProblem(config, own, 'mine')).toBeNull()
    expect(aliasProblem(config, own, 'side')).toBeNull()
    expect(aliasProblem(config, own, OWN_CLAUDE)).toBeNull()
    expect(aliasProblem(config, loginOf(config, 'workclaude'), 'work')).toBeNull()
  })

  it('refuses an alias of another login of the provider, the id of any other login, and a bad alias', () => {
    expect(aliasProblem(config, own, 'work')).toBe('another Claude login is already called "work"')
    expect(aliasProblem(config, own, 'sidecodex1')).toBe('"sidecodex1" is the id of another login')
    expect(aliasProblem(config, own, OWN_CODEX)).toBe(`"${OWN_CODEX}" is the id of another login`)
    for (const bad of ['claude', 'codex', 'Work', 'a b', '', 'a'.repeat(33), 'claude:work']) {
      expect(aliasProblem(config, own, bad)).toMatch(/is not an alias; an alias is 1 to 32/)
    }
  })
})

describe('changing logins', () => {
  it('adds a login with the defaults and its id as its alias', () => {
    const config = addLogin(testConfig(), { id: 'sidecodex1' as LoginId, provider: 'codex' })
    expect(findLogin(config, 'sidecodex1')).toEqual({
      id: 'sidecodex1',
      provider: 'codex',
      machineOwn: false,
      alias: 'sidecodex1',
      aliasSetByUser: false,
      routing: true,
      fiveHourLimit: 100,
      weeklyLimit: 100,
      useFirst: false
    })
    expect(idsOf(config)).toEqual([OWN_CLAUDE, OWN_CODEX, 'sidecodex1'])
  })

  it('adds a login with an alias the person chose', () => {
    const config = addLogin(testConfig(), { id: 'workclaude' as LoginId, provider: 'claude' }, { alias: 'work', routing: false })
    expect(findLogin(config, 'workclaude')).toMatchObject({ alias: 'work', aliasSetByUser: true, routing: false })
  })

  it('refuses a taken or invalid id, a taken alias and a bad setting', () => {
    const config = addLogin(testConfig(), { id: 'workclaude' as LoginId, provider: 'claude' }, { alias: 'work' })
    expect(() => addLogin(config, { id: 'workclaude' as LoginId, provider: 'codex' })).toThrow('There is already a login workclaude.')
    expect(() => addLogin(config, { id: OWN_CLAUDE, provider: 'claude' })).toThrow(ConfigError)
    expect(() => addLogin(config, { id: '../evil' as LoginId, provider: 'claude' })).toThrow(ConfigError)
    expect(() => addLogin(config, { id: 'claude:x' as LoginId, provider: 'claude' })).toThrow(ConfigError)
    expect(() => addLogin(config, { id: 'otherlogin' as LoginId, provider: 'claude' }, { alias: 'work' }))
      .toThrow('Another Claude login is already called "work".')
    expect(() => addLogin(config, { id: 'otherlogin' as LoginId, provider: 'codex' }, { alias: 'workclaude' }))
      .toThrow('"workclaude" is the id of another login.')
    expect(() => addLogin(config, { id: 'otherlogin' as LoginId, provider: 'claude' }, { alias: 'codex' })).toThrow(/alias must be 1 to 32/)
    expect(() => addLogin(config, { id: 'xlogin' as LoginId, provider: 'claude' }, { fiveHourLimit: 0 }))
      .toThrow(/fiveHourLimit must be a whole number from 1 to 100/)
    expect(addLogin(config, { id: 'workcodex1' as LoginId, provider: 'codex' }, { alias: 'work' }).logins).toHaveLength(4)
  })

  it("refuses an id that is another login's alias, which the file could not be read back with", () => {
    const config = addLogin(testConfig(), { id: 'sidecodex1' as LoginId, provider: 'codex' }, { alias: 'abc123' })
    expect(() => addLogin(config, { id: 'abc123' as LoginId, provider: 'claude' })).toThrow(ConfigError)
  })

  it("removes an extra login but never that of plain claude or plain codex", () => {
    const config = addLogin(testConfig({ ownCodex: { alias: 'mycodex' } }), { id: 'workclaude' as LoginId, provider: 'claude' })
    expect(findLogin(removeLogin(config, 'workclaude'), 'workclaude')).toBeUndefined()
    expect(() => removeLogin(config, OWN_CLAUDE)).toThrow(`${OWN_CLAUDE} is the login plain claude uses and cannot be removed.`)
    expect(() => removeLogin(config, OWN_CODEX)).toThrow("mycodex is the login plain codex uses and cannot be removed.")
    expect(() => removeLogin(config, 'nobody')).toThrow('There is no login nobody.')
  })

  it('updates settings and checks each one', () => {
    const config = updateLogin(testConfig(), OWN_CLAUDE, { routing: false, weeklyLimit: 90, useFirst: true })
    expect(findLogin(config, OWN_CLAUDE)).toMatchObject({ routing: false, weeklyLimit: 90, useFirst: true, alias: OWN_CLAUDE, aliasSetByUser: false })
    expect(() => updateLogin(config, OWN_CLAUDE, { weeklyLimit: 101 })).toThrow(ConfigError)
    expect(() => updateLogin(config, 'nobody', {})).toThrow('There is no login nobody.')
  })

  it("sets an alias as the person's choice, and checks it", () => {
    const config = testConfig({ extras: [{ id: 'workclaude', provider: 'claude', alias: 'work' }] })
    const changed = updateLogin(config, OWN_CLAUDE, { alias: 'mine' })
    expect(findLogin(changed, OWN_CLAUDE)).toMatchObject({ alias: 'mine', aliasSetByUser: true })
    expect(() => updateLogin(config, OWN_CLAUDE, { alias: 'work' })).toThrow('Another Claude login is already called "work".')
    expect(() => updateLogin(config, OWN_CLAUDE, { alias: OWN_CODEX })).toThrow(`"${OWN_CODEX}" is the id of another login.`)
    expect(() => updateLogin(config, OWN_CLAUDE, { alias: 'Bad Alias' })).toThrow(ConfigError)
    expect(() => updateLogin(config, OWN_CLAUDE, { alias: 'claude' })).toThrow(ConfigError)
    expect(findLogin(updateLogin(config, OWN_CODEX, { alias: 'work' }), OWN_CODEX)?.alias).toBe('work')
  })

  it('changeConfig loads, applies and saves', () => {
    changeConfig((config) => addLogin(config, { id: 'workclaude' as LoginId, provider: 'claude' }))
    changeConfig((config) => updateLogin(config, 'workclaude', { useFirst: true }))
    const config = loadConfig()
    expect(findLogin(config, 'workclaude')?.useFirst).toBe(true)
    expect(config.logins.filter((login) => login.machineOwn)).toHaveLength(2)
  })

  it('changeConfig holds the config lock while it changes the file and releases it after', () => {
    changeConfig((config) => {
      expect(existsSync(configLockPath())).toBe(true)
      return addLogin(config, { id: 'workclaude' as LoginId, provider: 'claude' })
    })
    expect(existsSync(configLockPath())).toBe(false)
    expect(() => changeConfig(() => {
      throw new ConfigError('refused')
    })).toThrow('refused')
    expect(existsSync(configLockPath())).toBe(false)
  })

  it('changeConfig refuses a change that calls it again instead of waiting for itself', () => {
    expect(() => changeConfig((config) => changeConfig(() => config))).toThrow(/already locked by this process/)
    expect(existsSync(configLockPath())).toBe(false)
  })

  it('changeConfig answers a ConfigError naming the holder when the lock stays taken', () => {
    writeFileSync(configLockPath(), JSON.stringify({ pid: process.ppid, createdAt: Date.now(), token: 'other' }))
    try {
      let caught: unknown
      try {
        changeConfig((config) => addLogin(config, { id: 'workclaude' as LoginId, provider: 'claude' }), configPath(), { timeoutMs: 200 })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(ConfigError)
      expect((caught as Error).message).toContain(`Could not lock ${configLockPath()}`)
      expect((caught as Error).message).toContain(`kurmis process ${String(process.ppid)} has held it`)
    } finally {
      rmSync(configLockPath(), { force: true })
    }
    expect(configStamp()).toBe('missing')
  })
})

describe('following the email', () => {
  const base = testConfig({ extras: [{ id: 'workclaude', provider: 'claude' }, { id: 'workcodex1', provider: 'codex' }] })

  it('gives the login the alias of its email', () => {
    const config = followEmail(base, 'workclaude', 'jo.doe@example.com')
    expect(loginOf(config, 'workclaude')).toMatchObject({ alias: 'jo-doe-example', aliasSetByUser: false })
  })

  it('follows a change of the email', () => {
    const first = followEmail(base, 'workclaude', 'cc1@example.org')
    expect(loginOf(first, 'workclaude').alias).toBe('cc1-example')
    expect(loginOf(followEmail(first, 'workclaude', 'cc2@example.org'), 'workclaude').alias).toBe('cc2-example')
  })

  it("never changes an alias the person set", () => {
    const config = updateLogin(base, 'workclaude', { alias: 'work' })
    expect(followEmail(config, 'workclaude', 'cc1@example.org')).toBe(config)
    expect(followEmail(config, 'workclaude', null)).toBe(config)
  })

  it('numbers the alias when another login of the provider has the same email', () => {
    const one = followEmail(base, OWN_CLAUDE, 'cc1@example.org')
    const two = followEmail(one, 'workclaude', 'cc1@example.org')
    expect(loginOf(two, OWN_CLAUDE).alias).toBe('cc1-example')
    expect(loginOf(two, 'workclaude').alias).toBe('cc1-example-2')
    // The same account in Codex gets the same alias, since aliases are unique per provider.
    expect(loginOf(followEmail(two, 'workcodex1', 'cc1@example.org'), 'workcodex1').alias).toBe('cc1-example')
  })

  it('is stable when it is asked again', () => {
    const one = followEmail(followEmail(base, OWN_CLAUDE, 'cc1@example.org'), 'workclaude', 'cc1@example.org')
    expect(followEmail(one, OWN_CLAUDE, 'cc1@example.org')).toBe(one)
    expect(followEmail(one, 'workclaude', 'cc1@example.org')).toBe(one)
    // With the first login gone, the second keeps its number rather than taking the plain alias.
    const without = { ...one, logins: one.logins.filter((login) => login.id !== OWN_CLAUDE) }
    expect(followEmail(without, 'workclaude', 'cc1@example.org')).toBe(without)
  })

  it('keeps the last alias while no email is known', () => {
    const config = followEmail(base, 'workclaude', 'cc1@example.org')
    expect(followEmail(config, 'workclaude', null)).toBe(config)
    expect(followEmail(base, 'workclaude', null)).toBe(base)
  })

  it('does nothing for a login that is not there', () => {
    expect(followEmail(base, 'nobody', 'cc1@example.org')).toBe(base)
  })

  it('writes no email into the file', () => {
    let config = followEmail(base, 'workclaude', 'cc1@example.org')
    config = followEmail(config, OWN_CLAUDE, 'Private.Person+tag@example.com')
    saveConfig(config)
    const text = readFileSync(configPath(), 'utf8')
    expect(text).not.toContain('@')
    expect(text).not.toContain('example.org')
    expect(text).not.toContain('example.com')
    expect(text).not.toMatch(/email/i)
    expect(loadConfig()).toEqual(config)
  })
})

describe('configStamp', () => {
  it('changes when the contents change and not otherwise', () => {
    expect(configStamp()).toBe('missing')
    const config = writeTestConfig()
    const first = configStamp()
    saveConfig(config)
    expect(configStamp()).toBe(first)
    changeConfig((current) => addLogin(current, { id: 'workclaude' as LoginId, provider: 'claude' }))
    expect(configStamp()).not.toBe(first)
  })
})
