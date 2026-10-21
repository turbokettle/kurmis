import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { codexKeepsSignInElsewhere, createListCommand, hasCredentials, hasLocalCredentials } from '../../../src/cli/commands/list.ts'
import { kurmisHome, loginFolder } from '../../../src/data/paths.ts'
import { findProgram } from '../../../src/platform/programs.ts'
import { runProgram } from '../../../src/platform/run.ts'
import { FAKE_CODEX_SCRIPT, readCodexRecord, writeClaudeCredentials, writeClaudeIdentity, writeCodexAuth, writeCodexKeyringAuth } from '../../fakes/index.ts'
import { claudeRef, codexRef, OWN_CLAUDE, OWN_CLAUDE_REF, OWN_CODEX, OWN_CODEX_REF, writeTestConfig } from '../../logins.ts'
import { collect } from '../helpers.ts'

const A = claudeRef('logina')
const B = claudeRef('loginb')
const C = claudeRef('loginc')
const SIDE = codexRef('sidecodex1')
const FILE = codexRef('filecodex1')

const home = join(process.env.HOME!, 'list-home')

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
  rmSync(home, { recursive: true, force: true, maxRetries: 10 })
  mkdirSync(home, { recursive: true })
})

describe('hasLocalCredentials', () => {
  it('finds an extra Claude login by its credentials file or by the account in its .claude.json', () => {
    expect(hasLocalCredentials(A, {}, home)).toBe(false)
    writeClaudeCredentials(loginFolder(A))
    expect(hasLocalCredentials(A, {}, home)).toBe(true)

    // macOS: the secret is in the Keychain, and only the account in .claude.json is in the folder.
    writeClaudeIdentity(join(loginFolder(B), '.claude.json'), { email: 'b@example.com' })
    expect(hasLocalCredentials(B, {}, home)).toBe(true)

    mkdirSync(loginFolder(C), { recursive: true })
    writeFileSync(join(loginFolder(C), '.claude.json'), '{"numStartups": 3}')
    expect(hasLocalCredentials(C, {}, home)).toBe(false)
    writeFileSync(join(loginFolder(C), '.claude.json'), 'not json')
    expect(hasLocalCredentials(C, {}, home)).toBe(false)
  })

  it('finds the machine\'s own Claude login in ~/.claude/.credentials.json or ~/.claude.json', () => {
    expect(hasLocalCredentials(OWN_CLAUDE_REF, {}, home)).toBe(false)
    writeClaudeIdentity(join(home, '.claude.json'), { email: 'own@example.com' })
    expect(hasLocalCredentials(OWN_CLAUDE_REF, {}, home)).toBe(true)
    rmSync(join(home, '.claude.json'))
    writeClaudeCredentials(join(home, '.claude'))
    expect(hasLocalCredentials(OWN_CLAUDE_REF, {}, home)).toBe(true)
  })

  it('finds Codex logins by auth.json, in CODEX_HOME or ~/.codex for the machine\'s own login', () => {
    expect(hasLocalCredentials(SIDE, {}, home)).toBe(false)
    writeCodexAuth(loginFolder(SIDE))
    expect(hasLocalCredentials(SIDE, {}, home)).toBe(true)

    expect(hasLocalCredentials(OWN_CODEX_REF, {}, home)).toBe(false)
    writeCodexAuth(join(home, '.codex'))
    expect(hasLocalCredentials(OWN_CODEX_REF, {}, home)).toBe(true)
    const elsewhere = join(home, 'codex-elsewhere')
    expect(hasLocalCredentials(OWN_CODEX_REF, { CODEX_HOME: elsewhere }, home)).toBe(false)
    writeCodexAuth(elsewhere)
    expect(hasLocalCredentials(OWN_CODEX_REF, { CODEX_HOME: elsewhere }, home)).toBe(true)
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
    keepInKeyring(loginFolder(SIDE))
    expect(await hasCredentials(SIDE, fakeEnv(), home, deps)).toBe(false)
    writeCodexKeyringAuth(keyring(), loginFolder(SIDE))
    expect(await hasCredentials(SIDE, fakeEnv(), home, deps)).toBe(true)
    const runs = readCodexRecord(record()).filter((line) => line.event === 'start')
    expect(runs.map((line) => [line.event === 'start' && line.mode, line.event === 'start' && line.codexHome]))
      .toEqual([['login-status', loginFolder(SIDE)], ['login-status', loginFolder(SIDE)]])
  })

  it('asks for the machine\'s own login in the default home, and starts no codex for a login that keeps auth.json', async () => {
    keepInKeyring(join(home, '.codex'))
    writeCodexKeyringAuth(keyring(), join(home, '.codex'))
    expect(await hasCredentials(OWN_CODEX_REF, fakeEnv(), home, deps)).toBe(true)
    // An extra login's home inherited from a session on it is not the default home.
    const inherited = { ...fakeEnv(), CODEX_HOME: loginFolder(SIDE) }
    expect(await hasCredentials(OWN_CODEX_REF, inherited, home, deps)).toBe(true)

    rmSync(record(), { force: true })
    mkdirSync(loginFolder(FILE), { recursive: true })
    expect(await hasCredentials(FILE, fakeEnv(), home, deps)).toBe(false)
    writeCodexAuth(loginFolder(FILE))
    expect(await hasCredentials(FILE, fakeEnv(), home, deps)).toBe(true)
    expect(readCodexRecord(record())).toEqual([])
  })

  it('shows such a login with credentials in kurmis list', async () => {
    writeTestConfig({ extras: [{ id: SIDE.id, provider: 'codex' }] })
    keepInKeyring(loginFolder(SIDE))
    writeCodexKeyringAuth(keyring(), loginFolder(SIDE))
    const out = collect(fakeEnv())
    expect(await createListCommand({ home: () => home }).run(['--json'], out.context)).toBe(0)
    const listed = JSON.parse(out.stdout()) as Array<{ id: string; credentials: boolean }>
    expect(listed.find((login) => login.id === SIDE.id)?.credentials).toBe(true)
  })
})

describe('kurmis list', () => {
  it('shows the provider, alias, id, the settings under the names of the set options, and the credentials', async () => {
    writeTestConfig({
      extras: [
        { id: 'workclaude', provider: 'claude', alias: 'work-example', fiveHourLimit: 90, useFirst: true },
        { id: SIDE.id, provider: 'codex', routing: false }
      ],
      ownClaude: { weeklyLimit: 75 },
      ownCodex: { alias: 'work-example' }
    })
    writeClaudeIdentity(join(loginFolder(claudeRef('workclaude')), '.claude.json'), { email: 'work@example.com' })
    writeCodexAuth(join(home, '.codex'))

    const out = collect({})
    expect(await createListCommand({ home: () => home }).run([], out.context)).toBe(0)
    expect(out.stdout()).toBe([
      'PROVIDER  ALIAS         ID          AUTO  FIVE-HOUR  WEEKLY  USE-FIRST  CREDENTIALS',
      `claude    ${OWN_CLAUDE}    ${OWN_CLAUDE}  on    100%       75%     off        no`,
      `codex     work-example  ${OWN_CODEX}  on    100%       100%    off        yes`,
      'claude    work-example  workclaude  on    90%        100%    on         yes',
      'codex     sidecodex1    sidecodex1  off   100%       100%    off        no',
      '',
      `${OWN_CLAUDE} is this machine's own Claude sign-in: the account a plain "claude" is signed in to.`,
      'work-example is this machine\'s own Codex sign-in: the account a plain "codex" is signed in to.',
      ''
    ].join('\n'))
    expect(out.stdout()).not.toContain('example.com')
  })

  it('prints the settings, alias, id, machineOwn and a credentials field as JSON', async () => {
    const config = writeTestConfig({ extras: [{ id: 'workclaude', provider: 'claude' }] })
    writeClaudeCredentials(loginFolder(claudeRef('workclaude')))
    const out = collect({})
    expect(await createListCommand({ home: () => home }).run(['--json'], out.context)).toBe(0)
    const listed = JSON.parse(out.stdout()) as Array<Record<string, unknown>>
    expect(listed).toEqual(config.logins.map((login) => ({ ...login, credentials: login.id === 'workclaude' })))
    expect(listed.map((login) => [login.id, login.alias, login.provider, login.machineOwn])).toEqual([
      [OWN_CLAUDE, OWN_CLAUDE, 'claude', true], [OWN_CODEX, OWN_CODEX, 'codex', true], ['workclaude', 'workclaude', 'claude', false]
    ])
    expect(listed[0]).not.toHaveProperty('label')
  })
})

