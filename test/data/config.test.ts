import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addLogin,
  changeConfig,
  ConfigError,
  configStamp,
  DEFAULT_PORT,
  defaultConfig,
  findLogin,
  loadConfig,
  parseConfig,
  removeLogin,
  saveConfig,
  updateLogin
} from '../../src/data/config.ts'
import { readJsonFileSync } from '../../src/data/json-file.ts'
import { configLockPath, configPath } from '../../src/data/paths.ts'

function writeRaw(value: unknown): void {
  saveRawText(JSON.stringify(value))
}
function saveRawText(text: string): void {
  writeFileSync(configPath(), text)
}

beforeEach(() => {
  rmSync(configPath(), { force: true })
  saveConfig(defaultConfig())
  rmSync(configPath(), { force: true })
})

describe('loading', () => {
  it('gives the defaults when there is no file', () => {
    const config = loadConfig()
    expect(config.version).toBe(1)
    expect(config.port).toBe(DEFAULT_PORT)
    expect(config.logins.map((login) => login.id)).toEqual(['claude:default', 'codex:default'])
    expect(config.logins[0]).toEqual({
      id: 'claude:default',
      provider: 'claude',
      label: 'default',
      routing: true,
      fiveHourLimit: 100,
      weeklyLimit: 100,
      useFirst: false
    })
  })

  it('always has the default logins first, keeping settings stored for them', () => {
    writeRaw({
      version: 1,
      logins: [
        { id: 'claude:work', label: 'Work' },
        { id: 'codex:default', weeklyLimit: 80 }
      ]
    })
    const config = loadConfig()
    expect(config.logins.map((login) => login.id)).toEqual(['claude:default', 'codex:default', 'claude:work'])
    expect(findLogin(config, 'codex:default')?.weeklyLimit).toBe(80)
    expect(findLogin(config, 'claude:work')).toMatchObject({ provider: 'claude', label: 'Work', routing: true, fiveHourLimit: 100 })
  })

  it('round-trips through save', () => {
    let config = addLogin(defaultConfig(), 'claude:work', { label: 'Work', useFirst: true })
    config = { ...config, port: 30001 }
    saveConfig(config)
    expect(loadConfig()).toEqual(config)
    expect(readJsonFileSync(configPath())).toMatchObject({ status: 'ok', value: { version: 1, port: 30001 } })
  })

  it('names the file and the field of a wrong value', () => {
    writeRaw({ version: 1, logins: [{ id: 'claude:a' }, { id: 'claude:b', weeklyLimit: 150 }] })
    expect(() => loadConfig()).toThrow(ConfigError)
    expect(() => loadConfig()).toThrow(`${configPath()}: logins[1].weeklyLimit must be a whole number from 1 to 100, not 150`)
  })

  it.each([
    [{ version: 1, port: 80 }, 'port must be a whole number from 1024 to 65535'],
    [{ version: 1, logins: {} }, 'logins must be a list'],
    [{ version: 1, logins: [{ id: 'claude:../x' }] }, 'logins[0].id must be claude:<name>'],
    [{ version: 1, logins: [{ id: 'claude:a', provider: 'codex' }] }, 'logins[0].provider must be "claude"'],
    [{ version: 1, logins: [{ id: 'claude:a', routing: 'yes' }] }, 'logins[0].routing must be true or false, not a string'],
    [{ version: 1, logins: [{ id: 'claude:a', label: '' }] }, 'logins[0].label must be 1 to 64 characters'],
    [{ version: 1, logins: [{ id: 'claude:a' }, { id: 'claude:a' }] }, 'logins[1].id repeats "claude:a"'],
    [{ logins: [] }, 'has no "version" field'],
    [{ version: 0 }, 'version must be a whole number of 1 or more'],
    [[], 'must be an object, not a list']
  ])('refuses %j', (value, message) => {
    expect(() => parseConfig(value, 'config.json')).toThrow(message)
  })

  it('refuses a file from a newer kurmis with a clear message', () => {
    writeRaw({ version: 2, logins: [] })
    expect(() => loadConfig()).toThrow(/written by a newer kurmis \(config version 2\).*Update kurmis/)
  })

  it('reports a file that is not JSON', () => {
    saveRawText('{ "version": 1,')
    expect(() => loadConfig()).toThrow(/config\.json is not valid JSON/)
  })

  it('ignores unknown fields', () => {
    writeRaw({ version: 1, later: true, logins: [{ id: 'claude:a', later: 1 }] })
    expect(findLogin(loadConfig(), 'claude:a')).toBeDefined()
  })
})

describe('changing logins', () => {
  it('adds a login with the defaults: routing on, both limits 100%', () => {
    const config = addLogin(defaultConfig(), 'codex:side')
    expect(findLogin(config, 'codex:side')).toEqual({
      id: 'codex:side',
      provider: 'codex',
      label: 'side',
      routing: true,
      fiveHourLimit: 100,
      weeklyLimit: 100,
      useFirst: false
    })
  })

  it('refuses a taken or invalid id', () => {
    const config = addLogin(defaultConfig(), 'claude:work')
    expect(() => addLogin(config, 'claude:work')).toThrow('There is already a login claude:work.')
    expect(() => addLogin(config, 'claude:default')).toThrow(ConfigError)
    expect(() => addLogin(config, 'claude:../evil')).toThrow(ConfigError)
    expect(() => addLogin(config, 'claude:x', { fiveHourLimit: 0 })).toThrow(/fiveHourLimit must be a whole number from 1 to 100/)
  })

  it('removes an extra login but never a default one', () => {
    const config = addLogin(defaultConfig(), 'claude:work')
    expect(findLogin(removeLogin(config, 'claude:work'), 'claude:work')).toBeUndefined()
    expect(() => removeLogin(config, 'claude:default')).toThrow(/cannot be removed/)
    expect(() => removeLogin(config, 'codex:default')).toThrow(/cannot be removed/)
    expect(() => removeLogin(config, 'claude:none')).toThrow('There is no login claude:none.')
  })

  it('updates settings and checks each one', () => {
    const config = updateLogin(defaultConfig(), 'claude:default', { routing: false, weeklyLimit: 90, label: 'Mine' })
    expect(findLogin(config, 'claude:default')).toMatchObject({ routing: false, weeklyLimit: 90, label: 'Mine' })
    expect(() => updateLogin(config, 'claude:default', { weeklyLimit: 101 })).toThrow(ConfigError)
    expect(() => updateLogin(config, 'claude:none', {})).toThrow('There is no login claude:none.')
  })

  it('changeConfig loads, applies and saves', () => {
    changeConfig((config) => addLogin(config, 'claude:work'))
    changeConfig((config) => updateLogin(config, 'claude:work', { useFirst: true }))
    expect(findLogin(loadConfig(), 'claude:work')?.useFirst).toBe(true)
  })

  it('changeConfig holds the config lock while it changes the file and releases it after', () => {
    changeConfig((config) => {
      expect(existsSync(configLockPath())).toBe(true)
      return addLogin(config, 'claude:work')
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
        changeConfig((config) => addLogin(config, 'claude:work'), configPath(), { timeoutMs: 200 })
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

describe('configStamp', () => {
  it('changes when the contents change and not otherwise', () => {
    expect(configStamp()).toBe('missing')
    saveConfig(defaultConfig())
    const first = configStamp()
    saveConfig(defaultConfig())
    expect(configStamp()).toBe(first)
    changeConfig((config) => addLogin(config, 'claude:work'))
    expect(configStamp()).not.toBe(first)
  })
})
