import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configPath,
  daemonFilePath,
  extraLoginsFolder,
  kurmisHome,
  loginFolder,
  loginLockPath,
  logPath,
  ownClaudeProbeFolder,
  statePath
} from '../../src/data/paths.ts'
import { extraRef, OWN_CLAUDE_REF } from '../logins.ts'

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
    expect(ownClaudeProbeFolder()).toBe(join(kurmisHome(), 'probe', 'claude-own'))
  })

  it("names an extra login's folder after its id, in the folder of the extra logins", () => {
    expect(extraLoginsFolder()).toBe(join(kurmisHome(), 'claude'))
    expect(loginFolder(extraRef('workclaude'))).toBe(join(kurmisHome(), 'claude', 'workclaude'))
  })

  it("refuses the login of plain claude, which has no folder here", () => {
    expect(() => loginFolder(OWN_CLAUDE_REF)).toThrow(/the login plain claude uses/)
  })

  it.each(['../x', 'a/b', 'a\\b', '..', '', 'claude:work', 'Work', 'con', '.hidden', 'side-2', 'a_b', 'a'.repeat(33)])(
    'refuses the id %j',
    (id) => {
      expect(() => loginFolder(extraRef(id))).toThrow(/not a login id/)
    }
  )

  it('puts the lock of one login in locks/, named after its id', () => {
    expect(loginLockPath('workclaude')).toBe(join(kurmisHome(), 'locks', 'workclaude.lock'))
    expect(loginLockPath(OWN_CLAUDE_REF.id)).toBe(join(kurmisHome(), 'locks', `${OWN_CLAUDE_REF.id}.lock`))
    expect(() => loginLockPath('../x')).toThrow(/not a login id/)
    expect(() => loginLockPath('claude:work')).toThrow(/not a login id/)
  })
})
