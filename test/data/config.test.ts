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
  loadConfig,
  loginIds,
  plainClaudeLogin,
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
import { isLoginId } from '../../src/data/login-id.ts'
import { configPath } from '../../src/data/paths.ts'
import { loginOf, OWN_CLAUDE, testConfig, writeTestConfig } from '../logins.ts'

/** The lock file `changeConfig` takes around `config.json`. */
const configLockPath = (): string => `${configPath()}.lock`

function writeRaw(value: unknown): void {
  saveRawText(JSON.stringify(value))
}
function saveRawText(text: string): void {
  writeFileSync(configPath(), text)
}

/** A stored login with only the fields a file must have. */
function stored(id: string, more: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, ...more }
}

/** The login of plain claude as a version 3 file stores it. */
const OWN_ROW = stored(OWN_CLAUDE, { usedByPlainClaude: true })

function idsOf(config: KurmisConfig): string[] {
  return config.logins.map((login) => login.id)
}

/** Unwraps a `resolveLogin` answer that must have found a login. */
function resolved(config: KurmisConfig, text: string): LoginSettings {
  const answer = resolveLogin(config, text)
  if ('error' in answer) throw new Error(`expected a login for ${text}, got: ${answer.error}`)
  return answer.login
}

/** Unwraps a `resolveLogin` answer that must be an error. */
function refused(config: KurmisConfig, text: string): string {
  const answer = resolveLogin(config, text)
  if ('login' in answer) throw new Error(`expected an error for ${text}, got the login ${answer.login.id}`)
  return answer.error
}

beforeEach(() => {
  // Saving once creates the data folder; the file itself is removed for each test.
  saveConfig(testConfig())
  rmSync(configPath(), { force: true })
})

describe('loading', () => {
  it('reads without writing with readConfig: no file, and a file without the login of plain claude', () => {
    expect(readConfig()).toEqual({ version: CONFIG_VERSION, port: DEFAULT_PORT, logins: [] })
    expect(existsSync(configPath())).toBe(false)
    const text = JSON.stringify({ version: 3, port: 30001, logins: [{ id: 'workclaude', alias: 'work-example' }] })
    saveRawText(text)
    expect(readConfig().logins.map((login) => login.id)).toEqual(['workclaude'])
    expect(readFileSync(configPath(), 'utf8')).toBe(text)
    expect(existsSync(configLockPath())).toBe(false)
    saveRawText('{')
    expect(() => readConfig()).toThrow(ConfigError)
  })

  it("creates the login of plain claude with a new id when there is no file, and saves it", () => {
    const config = loadConfig()
    expect(config.version).toBe(CONFIG_VERSION)
    expect(config.port).toBe(DEFAULT_PORT)
    expect(config.logins.map((login) => login.usedByPlainClaude)).toEqual([true])
    const [claude] = config.logins
    expect(claude!.id).toMatch(/^[a-z0-9]{10}$/)
    expect(claude).toEqual({
      id: claude!.id,
      usedByPlainClaude: true,
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

  it("adds the login of plain claude that a file leaves out, keeping the extra logins' ids", () => {
    writeRaw({ version: 3, logins: [stored('workclaude')] })
    const config = loadConfig()
    expect(config.logins.map((login) => login.usedByPlainClaude)).toEqual([true, false])
    expect(idsOf(config)[1]).toBe('workclaude')
    const added = plainClaudeLogin(config).id
    expect(isLoginId(added)).toBe(true)
    expect(added).not.toBe('workclaude')
    expect(plainClaudeLogin(loadConfig()).id).toBe(added)
  })

  it("leaves a file that has the login of plain claude as it is", () => {
    const text = JSON.stringify({ version: 3, logins: [OWN_ROW] })
    saveRawText(text)
    loadConfig()
    expect(readFileSync(configPath(), 'utf8')).toBe(text)
  })

  it("puts the login plain claude uses first, then the extras in file order", () => {
    writeRaw({
      version: 3,
      logins: [
        stored('sideclaude1'),
        stored('workclaude', { alias: 'work', aliasSetByUser: true }),
        OWN_ROW,
        stored('lastclaude')
      ]
    })
    const config = loadConfig()
    expect(idsOf(config)).toEqual([OWN_CLAUDE, 'sideclaude1', 'workclaude', 'lastclaude'])
    expect(findLogin(config, 'workclaude')).toMatchObject({ alias: 'work', aliasSetByUser: true, routing: true, fiveHourLimit: 100 })
    expect(findLogin(config, 'lastclaude')).toMatchObject({ alias: 'lastclaude', aliasSetByUser: false, usedByPlainClaude: false })
  })

  it('round-trips through save', () => {
    let config = addLogin(testConfig(), 'workclaude', { alias: 'work', useFirst: true })
    config = updateLogin(config, OWN_CLAUDE, { weeklyLimit: 80 })
    config = { ...config, port: 30001 }
    saveConfig(config)
    expect(loadConfig()).toEqual(config)
    expect(readJsonFileSync(configPath())).toMatchObject({ status: 'ok', value: { version: 3, port: 30001 } })
  })

  it('refuses a file from an older kurmis and says what to do', () => {
    writeRaw({ version: 2, logins: [{ id: 'workclaude', provider: 'claude', usedByPlainCli: true }] })
    expect(() => loadConfig()).toThrow(ConfigError)
    expect(() => loadConfig()).toThrow(/written by an older kurmis \(config version 2\).*reads only version 3/)
    expect(() => loadConfig()).toThrow(/Delete the file, then add the extra logins again with "kurmis login"/)
    writeRaw({ version: 1, logins: [{ id: 'claude:work', label: 'Work' }] })
    expect(() => loadConfig()).toThrow(/written by an older kurmis \(config version 1\).*reads only version 3/)
  })

  it('refuses a file from a newer kurmis with a clear message', () => {
    writeRaw({ version: 4, logins: [] })
    expect(() => loadConfig()).toThrow(/written by a newer kurmis \(config version 4\).*Update kurmis/)
  })

  it('does not rewrite a file it refuses', () => {
    const text = JSON.stringify({ version: 2, logins: [] })
    saveRawText(text)
    expect(() => loadConfig()).toThrow(ConfigError)
    expect(readFileSync(configPath(), 'utf8')).toBe(text)
  })

  it('names the file and the field of a wrong value', () => {
    writeRaw({ version: 3, logins: [stored('alogin'), stored('blogin', { weeklyLimit: 150 })] })
    expect(() => loadConfig()).toThrow(ConfigError)
    expect(() => loadConfig()).toThrow(`${configPath()}: logins[1].weeklyLimit must be a whole number from 1 to 100, not 150`)
  })

  it.each([
    [{ version: 3, port: 80 }, 'port must be a whole number from 1024 to 65535'],
    [{ version: 3, logins: {} }, 'logins must be a list'],
    [{ version: 3, logins: [{ id: '../x' }] }, 'logins[0].id must be 1 to 32 lowercase letters and digits'],
    [{ version: 3, logins: [{ id: 'claude:work' }] }, 'logins[0].id must be 1 to 32 lowercase letters and digits'],
    [{ version: 3, logins: [{ id: 'none' }] }, 'logins[0].id must be 1 to 32 lowercase letters and digits, and not con, prn, aux, nul'],
    [{ version: 3, logins: [{}] }, 'logins[0].id must be a string'],
    [{ version: 3, logins: [{ id: 'alogin', usedByPlainClaude: 'yes' }] }, 'logins[0].usedByPlainClaude must be true or false'],
    [{ version: 3, logins: [{ id: 'alogin', routing: 'yes' }] }, 'logins[0].routing must be true or false, not a string'],
    [{ version: 3, logins: [{ id: 'alogin', aliasSetByUser: 1 }] }, 'logins[0].aliasSetByUser must be true or false'],
    [{ version: 3, logins: [stored('alogin'), stored('alogin')] }, 'logins[1].id repeats "alogin"'],
    [
      { version: 3, logins: [stored('alogin', { usedByPlainClaude: true }), stored('blogin', { usedByPlainClaude: true })] },
      'logins[1].usedByPlainClaude is true for a second login; only one login can be the one plain claude uses'
    ],
    [
      { version: 3, logins: [stored('alogin', { alias: 'same' }), stored('blogin', { alias: 'same' })] },
      'logins[1].alias repeats "same" of another login'
    ],
    [
      { version: 3, logins: [stored('alogin', { alias: 'first' }), stored('blogin', { alias: 'alogin' })] },
      'logins[1].alias "alogin" and the id "blogin" must not be the id or alias of another login'
    ],
    [
      { version: 3, logins: [stored('alogin', { alias: 'blogin' }), stored('blogin', { alias: 'second' })] },
      'logins[1].alias "second" and the id "blogin" must not be the id or alias of another login'
    ],
    [
      { version: 3, logins: [stored('alogin', { alias: 'blogin' }), stored('blogin')] },
      'logins[1].alias repeats "blogin" of another login'
    ],
    [{ version: 3, logins: [stored('alogin', { alias: '' })] }, 'logins[0].alias must be 1 to 32 lowercase letters'],
    [{ version: 3, logins: [stored('alogin', { alias: 'Work' })] }, 'logins[0].alias must be 1 to 32 lowercase letters'],
    [{ version: 3, logins: [stored('alogin', { alias: 'a'.repeat(33) })] }, 'logins[0].alias must be 1 to 32 lowercase letters'],
    [{ version: 3, logins: [stored('alogin', { alias: 3 })] }, 'logins[0].alias must be a string'],
    [{ logins: [] }, 'has no "version" field'],
    [{ version: 0 }, 'version must be a whole number of 1 or more'],
    [{ version: '3' }, 'version must be a whole number of 1 or more'],
    [[], 'must be an object, not a list']
  ])('refuses %j', (value, message) => {
    expect(() => parseConfig(value, 'config.json')).toThrow(message)
  })

  it('takes "claude" as an id and an alias like any other word', () => {
    const config = parseConfig({
      version: 3,
      logins: [stored('claude', { alias: 'claude' }), stored('worklogin', { alias: 'claude-2' })]
    }, 'config.json')
    expect(config.logins.map((login) => [login.id, login.alias])).toEqual([['claude', 'claude'], ['worklogin', 'claude-2']])
  })

  it('reports a file that is not JSON', () => {
    saveRawText('{ "version": 3,')
    expect(() => loadConfig()).toThrow(/config\.json is not valid JSON/)
  })

  it('ignores unknown fields', () => {
    writeRaw({ version: 3, later: true, logins: [OWN_ROW, stored('alogin', { later: 1, label: 'Old', email: 'x@example.com', provider: 'claude' })] })
    expect(findLogin(loadConfig(), 'alogin')).toBeDefined()
  })
})

describe("the login of plain claude", () => {
  it('is found by its setting, and is not an extra login', () => {
    const config = testConfig({ extras: [{ id: 'workclaude' }, { id: 'sideclaude1' }] })
    expect(plainClaudeLogin(config).id).toBe(OWN_CLAUDE)
    expect(loginOf(config, OWN_CLAUDE).usedByPlainClaude).toBe(true)
    expect(loginOf(config, 'workclaude').usedByPlainClaude).toBe(false)
    expect(extraLogins(config).map((login) => login.id)).toEqual(['workclaude', 'sideclaude1'])
    expect(loginIds(config)).toEqual([OWN_CLAUDE, 'workclaude', 'sideclaude1'])
  })

  it('a config without one is an error when it is asked for', () => {
    const config: KurmisConfig = { ...testConfig(), logins: [] }
    expect(() => plainClaudeLogin(config)).toThrow(ConfigError)
  })

  it('defaultConfig makes it with an id that differs each time', () => {
    const one = defaultConfig()
    const two = defaultConfig()
    expect(one.logins.map((login) => login.usedByPlainClaude)).toEqual([true])
    expect(idsOf(one)).not.toEqual(idsOf(two))
  })
})

describe('a new id for a login', () => {
  it('is none of the ids or aliases of the logins there are', () => {
    const config = testConfig({ extras: [{ id: 'workclaude', alias: 'work' }] })
    for (let round = 0; round < 50; round++) {
      const id = newLoginIdFor(config)
      expect(isLoginId(id)).toBe(true)
      expect([...loginIds(config), ...config.logins.map((login) => login.alias)]).not.toContain(id)
      expect(() => addLogin(config, id)).not.toThrow()
    }
  })
})

describe('resolving what a person typed', () => {
  const config = testConfig({
    ownClaude: { alias: 'me' },
    extras: [
      { id: 'workclaude', alias: 'work' },
      { id: 'sideclaude1', alias: 'side' }
    ]
  })

  it('finds a login by its id or its alias', () => {
    expect(resolved(config, 'workclaude').id).toBe('workclaude')
    expect(resolved(config, 'work').id).toBe('workclaude')
    expect(resolved(config, 'side').id).toBe('sideclaude1')
    expect(resolved(config, 'me').id).toBe(OWN_CLAUDE)
    expect(resolved(config, OWN_CLAUDE).id).toBe(OWN_CLAUDE)
    expect(resolved(config, ' Side ').id).toBe('sideclaude1')
    expect(resolved(config, 'WORK').id).toBe('workclaude')
  })

  it('says when there is no such login', () => {
    expect(refused(config, 'nobody')).toBe('there is no login called "nobody"')
    expect(refused(config, 'claude:work')).toBe('there is no login called "claude:work"')
    expect(refused(config, '')).toBe('there is no login called ""')
  })
})

describe('aliasProblem', () => {
  const config = testConfig({
    extras: [
      { id: 'workclaude', alias: 'work' },
      { id: 'sideclaude1', alias: 'side' }
    ]
  })
  const own = loginOf(config, OWN_CLAUDE)

  it('takes a free alias, its own alias and its own id', () => {
    expect(aliasProblem(config, own, 'mine')).toBeNull()
    expect(aliasProblem(config, own, 'claude')).toBeNull()
    expect(aliasProblem(config, own, OWN_CLAUDE)).toBeNull()
    expect(aliasProblem(config, loginOf(config, 'workclaude'), 'work')).toBeNull()
  })

  it('refuses the alias or the id of any other login, and a bad alias', () => {
    expect(aliasProblem(config, own, 'work')).toBe('another login is already called "work"')
    expect(aliasProblem(config, own, 'side')).toBe('another login is already called "side"')
    expect(aliasProblem(config, own, 'sideclaude1')).toBe('"sideclaude1" is the id of another login')
    for (const bad of ['Work', 'a b', '', 'a'.repeat(33), 'claude:work']) {
      expect(aliasProblem(config, own, bad)).toMatch(/is not an alias; an alias is 1 to 32/)
    }
  })
})

describe('changing logins', () => {
  it('adds a login with the defaults and its id as its alias', () => {
    const config = addLogin(testConfig(), 'sideclaude1')
    expect(findLogin(config, 'sideclaude1')).toEqual({
      id: 'sideclaude1',
      usedByPlainClaude: false,
      alias: 'sideclaude1',
      aliasSetByUser: false,
      routing: true,
      fiveHourLimit: 100,
      weeklyLimit: 100,
      useFirst: false
    })
    expect(idsOf(config)).toEqual([OWN_CLAUDE, 'sideclaude1'])
  })

  it('adds a login with an alias the person chose', () => {
    const config = addLogin(testConfig(), 'workclaude', { alias: 'work', routing: false })
    expect(findLogin(config, 'workclaude')).toMatchObject({ alias: 'work', aliasSetByUser: true, routing: false })
  })

  it('refuses a taken or invalid id, a taken alias and a bad setting', () => {
    const config = addLogin(testConfig(), 'workclaude', { alias: 'work' })
    expect(() => addLogin(config, 'workclaude')).toThrow('There is already a login workclaude.')
    expect(() => addLogin(config, OWN_CLAUDE)).toThrow(ConfigError)
    expect(() => addLogin(config, '../evil')).toThrow(ConfigError)
    expect(() => addLogin(config, 'claude:x')).toThrow(ConfigError)
    expect(() => addLogin(config, 'otherlogin', { alias: 'work' }))
      .toThrow('Another login is already called "work".')
    expect(() => addLogin(config, 'otherlogin', { alias: 'workclaude' }))
      .toThrow('"workclaude" is the id of another login.')
    expect(() => addLogin(config, 'otherlogin', { alias: 'Side' })).toThrow(/alias must be 1 to 32/)
    expect(() => addLogin(config, 'xlogin', { fiveHourLimit: 0 }))
      .toThrow(/fiveHourLimit must be a whole number from 1 to 100/)
    expect(addLogin(config, 'sideclaude1', { alias: 'side' }).logins).toHaveLength(3)
  })

  it("refuses an id that is another login's alias, which the file could not be read back with", () => {
    const config = addLogin(testConfig(), 'sideclaude1', { alias: 'abc123' })
    expect(() => addLogin(config, 'abc123')).toThrow(ConfigError)
  })

  it("removes an extra login but never that of plain claude", () => {
    const config = addLogin(testConfig({ ownClaude: { alias: 'mine' } }), 'workclaude')
    expect(findLogin(removeLogin(config, 'workclaude'), 'workclaude')).toBeUndefined()
    expect(() => removeLogin(config, OWN_CLAUDE)).toThrow('mine is the login plain claude uses and cannot be removed.')
    expect(() => removeLogin(config, 'nobody')).toThrow('There is no login nobody.')
  })

  it('updates settings and checks each one', () => {
    const config = updateLogin(testConfig(), OWN_CLAUDE, { routing: false, weeklyLimit: 90, useFirst: true })
    expect(findLogin(config, OWN_CLAUDE)).toMatchObject({ routing: false, weeklyLimit: 90, useFirst: true, alias: OWN_CLAUDE, aliasSetByUser: false })
    expect(() => updateLogin(config, OWN_CLAUDE, { weeklyLimit: 101 })).toThrow(ConfigError)
    expect(() => updateLogin(config, 'nobody', {})).toThrow('There is no login nobody.')
  })

  it("sets an alias as the person's choice, and checks it", () => {
    const config = testConfig({ extras: [{ id: 'workclaude', alias: 'work' }] })
    const changed = updateLogin(config, OWN_CLAUDE, { alias: 'mine' })
    expect(findLogin(changed, OWN_CLAUDE)).toMatchObject({ alias: 'mine', aliasSetByUser: true })
    expect(() => updateLogin(config, OWN_CLAUDE, { alias: 'work' })).toThrow('Another login is already called "work".')
    expect(() => updateLogin(config, OWN_CLAUDE, { alias: 'workclaude' })).toThrow('"workclaude" is the id of another login.')
    expect(() => updateLogin(config, OWN_CLAUDE, { alias: 'Bad Alias' })).toThrow(ConfigError)
    expect(findLogin(updateLogin(config, OWN_CLAUDE, { alias: 'claude' }), OWN_CLAUDE)?.alias).toBe('claude')
  })

  it('changeConfig loads, applies and saves', () => {
    changeConfig((config) => addLogin(config, 'workclaude'))
    changeConfig((config) => updateLogin(config, 'workclaude', { useFirst: true }))
    const config = loadConfig()
    expect(findLogin(config, 'workclaude')?.useFirst).toBe(true)
    expect(config.logins.filter((login) => login.usedByPlainClaude)).toHaveLength(1)
  })

  it('changeConfig holds the config lock while it changes the file and releases it after', () => {
    changeConfig((config) => {
      expect(existsSync(configLockPath())).toBe(true)
      return addLogin(config, 'workclaude')
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
        changeConfig((config) => addLogin(config, 'workclaude'), configPath(), { timeoutMs: 200 })
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
  const base = testConfig({ extras: [{ id: 'workclaude' }, { id: 'sideclaude1' }] })

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

  it('numbers the alias when another login has the same email', () => {
    const one = followEmail(base, OWN_CLAUDE, 'cc1@example.org')
    const two = followEmail(one, 'workclaude', 'cc1@example.org')
    expect(loginOf(two, OWN_CLAUDE).alias).toBe('cc1-example')
    expect(loginOf(two, 'workclaude').alias).toBe('cc1-example-2')
    expect(loginOf(followEmail(two, 'sideclaude1', 'cc1@example.org'), 'sideclaude1').alias).toBe('cc1-example-3')
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
    changeConfig((current) => addLogin(current, 'workclaude'))
    expect(configStamp()).not.toBe(first)
  })
})
