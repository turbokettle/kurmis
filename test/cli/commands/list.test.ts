import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { codexKeepsSignInElsewhere, createListCommand, hasCredentials, hasLocalCredentials } from '../../../src/cli/commands/list.ts'
import { addLogin, defaultConfig, saveConfig, updateLogin } from '../../../src/data/config.ts'
import { kurmisHome, loginFolder } from '../../../src/data/paths.ts'
import { findProgram } from '../../../src/platform/programs.ts'
import { runProgram } from '../../../src/platform/run.ts'
import { FAKE_CODEX_SCRIPT, readCodexRecord, writeClaudeCredentials, writeClaudeIdentity, writeCodexAuth, writeCodexKeyringAuth } from '../../fakes/index.ts'
import { collect } from '../helpers.ts'

const home = join(process.env.HOME!, 'list-home')

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
  rmSync(home, { recursive: true, force: true, maxRetries: 10 })
  mkdirSync(home, { recursive: true })
})

describe('hasLocalCredentials', () => {
  it('finds an extra Claude login by its credentials file or by the account in its .claude.json', () => {
    expect(hasLocalCredentials('claude:a', {}, home)).toBe(false)
    writeClaudeCredentials(loginFolder('claude:a'))
    expect(hasLocalCredentials('claude:a', {}, home)).toBe(true)

    // macOS: the secret is in the Keychain, and only the account in .claude.json is in the folder.
    writeClaudeIdentity(join(loginFolder('claude:b'), '.claude.json'), { email: 'b@example.com' })
    expect(hasLocalCredentials('claude:b', {}, home)).toBe(true)

    mkdirSync(loginFolder('claude:c'), { recursive: true })
    writeFileSync(join(loginFolder('claude:c'), '.claude.json'), '{"numStartups": 3}')
    expect(hasLocalCredentials('claude:c', {}, home)).toBe(false)
    writeFileSync(join(loginFolder('claude:c'), '.claude.json'), 'not json')
    expect(hasLocalCredentials('claude:c', {}, home)).toBe(false)
  })

  it('finds claude:default in ~/.claude/.credentials.json or ~/.claude.json', () => {
    expect(hasLocalCredentials('claude:default', {}, home)).toBe(false)
    writeClaudeIdentity(join(home, '.claude.json'), { email: 'own@example.com' })
    expect(hasLocalCredentials('claude:default', {}, home)).toBe(true)
    rmSync(join(home, '.claude.json'))
    writeClaudeCredentials(join(home, '.claude'))
    expect(hasLocalCredentials('claude:default', {}, home)).toBe(true)
  })

  it('finds Codex logins by auth.json, in CODEX_HOME or ~/.codex for codex:default', () => {
    expect(hasLocalCredentials('codex:side', {}, home)).toBe(false)
    writeCodexAuth(loginFolder('codex:side'))
    expect(hasLocalCredentials('codex:side', {}, home)).toBe(true)

    expect(hasLocalCredentials('codex:default', {}, home)).toBe(false)
    writeCodexAuth(join(home, '.codex'))
    expect(hasLocalCredentials('codex:default', {}, home)).toBe(true)
    const elsewhere = join(home, 'codex-elsewhere')
    expect(hasLocalCredentials('codex:default', { CODEX_HOME: elsewhere }, home)).toBe(false)
    writeCodexAuth(elsewhere)
    expect(hasLocalCredentials('codex:default', { CODEX_HOME: elsewhere }, home)).toBe(true)
  })
})

describe('a Codex login that keeps its sign-in in the keyring', () => {
  const deps = { findProgram, runProgram }
  const keyring = (): string => join(home, 'keyring')
  const record = (): string => join(home, 'codex-record.jsonl')
  /** The environment that makes kurmis find the fake codex, with its stand-in keyring, and `home` as the home folder. */
  const fakeEnv = (): NodeJS.ProcessEnv => ({
    HOME: home,
    USERPROFILE: home,
    KURMIS_CODEX_BIN: FAKE_CODEX_SCRIPT,
    FAKE_CODEX_KEYRING_DIR: keyring(),
    FAKE_CODEX_RECORD: record()
  })
  const keepInKeyring = (codexHome: string, store = 'keyring'): void => {
    mkdirSync(codexHome, { recursive: true })
    writeFileSync(join(codexHome, 'config.toml'), `model = "a"\ncli_auth_credentials_store = "${store}"\n`)
  }

  it('reads cli_auth_credentials_store from config.toml', () => {
    const codexHome = join(home, 'codex-home')
    expect(codexKeepsSignInElsewhere(codexHome)).toBe(false)
    mkdirSync(codexHome)
    writeFileSync(join(codexHome, 'config.toml'), 'model = "a"\n')
    expect(codexKeepsSignInElsewhere(codexHome)).toBe(false)
    writeFileSync(join(codexHome, 'config.toml'), 'cli_auth_credentials_store = "file"\n')
    expect(codexKeepsSignInElsewhere(codexHome)).toBe(false)
    for (const store of ['keyring', 'auto']) {
      keepInKeyring(codexHome, store)
      expect(codexKeepsSignInElsewhere(codexHome)).toBe(true)
    }
    writeFileSync(join(codexHome, 'config.toml'), 'model = \n')
    expect(codexKeepsSignInElsewhere(codexHome)).toBe(true)
  })

  it('asks codex login status in the login\'s home', async () => {
    keepInKeyring(loginFolder('codex:side'))
    expect(await hasCredentials('codex:side', fakeEnv(), home, deps)).toBe(false)
    writeCodexKeyringAuth(keyring(), loginFolder('codex:side'))
    expect(await hasCredentials('codex:side', fakeEnv(), home, deps)).toBe(true)
    const runs = readCodexRecord(record()).filter((line) => line.event === 'start')
    expect(runs.map((line) => [line.event === 'start' && line.mode, line.event === 'start' && line.codexHome]))
      .toEqual([['login-status', loginFolder('codex:side')], ['login-status', loginFolder('codex:side')]])
  })

  it('asks for codex:default in the default home, and starts no codex for a login that keeps auth.json', async () => {
    keepInKeyring(join(home, '.codex'))
    writeCodexKeyringAuth(keyring(), join(home, '.codex'))
    expect(await hasCredentials('codex:default', fakeEnv(), home, deps)).toBe(true)
    // An extra login's home inherited from a session on it is not the default home.
    const inherited = { ...fakeEnv(), CODEX_HOME: loginFolder('codex:side') }
    expect(await hasCredentials('codex:default', inherited, home, deps)).toBe(true)

    rmSync(record(), { force: true })
    mkdirSync(loginFolder('codex:file'), { recursive: true })
    expect(await hasCredentials('codex:file', fakeEnv(), home, deps)).toBe(false)
    writeCodexAuth(loginFolder('codex:file'))
    expect(await hasCredentials('codex:file', fakeEnv(), home, deps)).toBe(true)
    expect(readCodexRecord(record())).toEqual([])
  })

  it('shows such a login with credentials in kurmis list', async () => {
    saveConfig(addLogin(defaultConfig(), 'codex:side'))
    keepInKeyring(loginFolder('codex:side'))
    writeCodexKeyringAuth(keyring(), loginFolder('codex:side'))
    const out = collect(fakeEnv())
    expect(await createListCommand({ home: () => home }).run(['--json'], out.context)).toBe(0)
    const listed = JSON.parse(out.stdout()) as Array<{ id: string; credentials: boolean }>
    expect(listed.find((login) => login.id === 'codex:side')?.credentials).toBe(true)
  })
})

describe('kurmis list', () => {
  it('shows the settings under the names of the set options, and the credentials', async () => {
    let config = addLogin(defaultConfig(), 'claude:work', { label: 'Work', fiveHourLimit: 90, useFirst: true })
    config = addLogin(config, 'codex:side', { routing: false })
    config = updateLogin(config, 'claude:default', { weeklyLimit: 75 })
    saveConfig(config)
    writeClaudeIdentity(join(loginFolder('claude:work'), '.claude.json'), { email: 'work@example.com' })
    writeCodexAuth(join(home, '.codex'))

    const out = collect({})
    expect(await createListCommand({ home: () => home }).run([], out.context)).toBe(0)
    expect(out.stdout()).toBe([
      'ID              LABEL    AUTO  FIVE-HOUR  WEEKLY  USE-FIRST  CREDENTIALS',
      'claude:default  default  on    100%       75%     off        no',
      'codex:default   default  on    100%       100%    off        yes',
      'claude:work     Work     on    90%        100%    on         yes',
      'codex:side      side     off   100%       100%    off        no',
      ''
    ].join('\n'))
    expect(out.stdout()).not.toContain('example.com')
  })

  it('prints the settings and a credentials field as JSON', async () => {
    const config = addLogin(defaultConfig(), 'claude:work')
    saveConfig(config)
    writeClaudeCredentials(loginFolder('claude:work'))
    const out = collect({})
    expect(await createListCommand({ home: () => home }).run(['--json'], out.context)).toBe(0)
    expect(JSON.parse(out.stdout())).toEqual(config.logins.map((login) => ({ ...login, credentials: login.id === 'claude:work' })))
  })
})
