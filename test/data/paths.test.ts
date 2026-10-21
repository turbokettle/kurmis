import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isDefaultLoginId,
  isLoginId,
  isValidLoginName,
  loginId,
  parseLoginId,
  toLoginId
} from '../../src/data/login-id.ts'
import {
  configPath,
  daemonFilePath,
  kurmisHome,
  logPath,
  loginFolder,
  previousLogPath,
  statePath
} from '../../src/data/paths.ts'

const testHome = process.env.KURMIS_HOME as string

afterEach(() => {
  process.env.KURMIS_HOME = testHome
})

describe('kurmisHome', () => {
  it('is KURMIS_HOME when set', () => {
    expect(kurmisHome()).toBe(resolve(testHome))
  })

  it('is .kurmis in the home folder when KURMIS_HOME is unset or empty', () => {
    delete process.env.KURMIS_HOME
    expect(kurmisHome()).toBe(join(process.env.HOME as string, '.kurmis'))
    process.env.KURMIS_HOME = ''
    expect(kurmisHome()).toBe(join(process.env.HOME as string, '.kurmis'))
  })

  it('makes a relative KURMIS_HOME absolute', () => {
    process.env.KURMIS_HOME = 'relative-kurmis'
    expect(kurmisHome()).toBe(resolve('relative-kurmis'))
  })
})

describe('file paths', () => {
  it('puts every file in the data folder', () => {
    expect(configPath()).toBe(join(kurmisHome(), 'config.json'))
    expect(statePath()).toBe(join(kurmisHome(), 'state.json'))
    expect(daemonFilePath()).toBe(join(kurmisHome(), 'daemon.json'))
    expect(logPath()).toBe(join(kurmisHome(), 'daemon.log'))
    expect(previousLogPath()).toBe(join(kurmisHome(), 'daemon.log.1'))
  })

  it('names a login folder after the name half of the id', () => {
    expect(loginFolder('claude:work')).toBe(join(kurmisHome(), 'claude', 'work'))
    expect(loginFolder('codex:side-2')).toBe(join(kurmisHome(), 'codex', 'side-2'))
  })

  it('refuses the default logins, which have no folder here', () => {
    expect(() => loginFolder('claude:default')).toThrow(/machine's own login/)
    expect(() => loginFolder('codex:default')).toThrow(/machine's own login/)
  })

  it.each(['claude:../x', 'claude:a/b', 'claude:a\\b', 'claude:..', 'claude:', 'work', 'other:work', 'claude:Work', 'codex:con', 'codex:.hidden'])(
    'refuses %s',
    (id) => {
      expect(() => loginFolder(id)).toThrow(/not a login id/)
    }
  )
})

describe('login ids', () => {
  it('parses provider and name', () => {
    expect(parseLoginId('claude:work')).toEqual({ id: 'claude:work', provider: 'claude', name: 'work' })
    expect(parseLoginId('codex:a_b-1')).toMatchObject({ provider: 'codex', name: 'a_b-1' })
    expect(parseLoginId('claude:work:x')).toBeNull()
    expect(parseLoginId(42)).toBeNull()
  })

  it('limits names to 32 safe characters and no Windows device names', () => {
    expect(isValidLoginName('a'.repeat(32))).toBe(true)
    expect(isValidLoginName('a'.repeat(33))).toBe(false)
    expect(isValidLoginName('-a')).toBe(false)
    expect(isValidLoginName('nul')).toBe(false)
    expect(isValidLoginName('com1')).toBe(false)
    expect(isValidLoginName('console')).toBe(true)
  })

  it('builds and checks ids', () => {
    expect(loginId('codex', 'work')).toBe('codex:work')
    expect(() => toLoginId('claude:A')).toThrow(/not a login id/)
    expect(isLoginId('claude:default')).toBe(true)
    expect(isDefaultLoginId('claude:default')).toBe(true)
    expect(isDefaultLoginId('codex:default')).toBe(true)
    expect(isDefaultLoginId('default')).toBe(false)
    expect(isDefaultLoginId('claude:work')).toBe(false)
  })
})
