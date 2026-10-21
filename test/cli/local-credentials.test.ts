import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkCredentials, codexKeepsSignInElsewhere, hasCredentials, type CredentialCheck, type CredentialCheckDeps
} from '../../src/cli/local-credentials.ts'
import { keychainService } from '../../src/core/keychain-service.ts'
import type { LoginRef } from '../../src/data/login-id.ts'
import { kurmisHome, loginFolder } from '../../src/data/paths.ts'
import { findProgram, ProgramNotFoundError } from '../../src/platform/programs.ts'
import { runProgram } from '../../src/platform/run.ts'
import type { CredentialRead, FilterAnswer } from '../../src/platform/windows-credentials.ts'
import { FakeKeychain } from '../daemon/fake-security/fake-keychain.ts'
import { FAKE_CODEX_SCRIPT, readCodexRecord, writeClaudeCredentials, writeClaudeIdentity, writeCodexAuth, writeCodexKeyringAuth } from '../fakes/index.ts'
import { claudeRef, codexRef, OWN_CLAUDE_REF, OWN_CODEX_REF } from '../logins.ts'

const A = claudeRef('logina')
const B = claudeRef('loginb')
const C = claudeRef('loginc')
const SIDE = codexRef('sidecodex1')
const FILE = codexRef('filecodex1')

const home = join(process.env.HOME!, 'credentials-home')

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
  rmSync(home, { recursive: true, force: true, maxRetries: 10 })
  mkdirSync(home, { recursive: true })
})

describe('checkCredentials', () => {
  const keychain = (): FakeKeychain => new FakeKeychain(process.env.FAKE_SECURITY_DIR!)
  /** A Credential Manager in memory, listed by name the way `CredEnumerateW` lists a `<prefix>*` filter. */
  const credentialManager = (names: string[]): CredentialRead => (filters) => Promise.resolve(filters.map((filter): FilterAnswer => {
    const prefix = filter.replace(/\*$/, '').toLowerCase()
    return { kind: 'items', items: new Map(names.filter((name) => name.toLowerCase().startsWith(prefix)).map((name) => [name, Buffer.alloc(0)])) }
  }))
  const deps = (platform: NodeJS.Platform, readCredentialNames?: CredentialRead): CredentialCheckDeps =>
    ({ findProgram, runProgram, platform, ...(readCredentialNames === undefined ? {} : { readCredentialNames }) })
  const check = async (logins: LoginRef[], platform: NodeJS.Platform, read?: CredentialRead): Promise<Array<CredentialCheck | undefined>> => {
    const answers = await checkCredentials(logins, process.env, home, deps(platform, read))
    return logins.map((login) => answers.get(login.id))
  }

  beforeEach(() => {
    rmSync(process.env.FAKE_SECURITY_DIR!, { recursive: true, force: true })
    mkdirSync(process.env.FAKE_SECURITY_DIR!, { recursive: true })
  })

  it('does not count a .claude.json that names an account, which stays after the token is gone', async () => {
    writeClaudeIdentity(join(home, '.claude.json'), { email: 'own@example.com' })
    writeClaudeIdentity(join(loginFolder(B), '.claude.json'), { email: 'b@example.com' })
    expect(await check([OWN_CLAUDE_REF, B], 'darwin')).toEqual([false, false])
    expect(await check([OWN_CLAUDE_REF, B], 'linux')).toEqual([false, false])
    expect(await check([OWN_CLAUDE_REF, B], 'win32', credentialManager([]))).toEqual([false, false])
  })

  it('finds a Claude login by a claudeAiOauth record in its .credentials.json, on every platform', async () => {
    writeClaudeCredentials(loginFolder(A))
    writeClaudeCredentials(join(home, '.claude'))
    mkdirSync(loginFolder(C), { recursive: true })
    writeFileSync(join(loginFolder(C), '.credentials.json'), '{}')
    for (const platform of ['linux', 'darwin'] as const) expect(await check([A, OWN_CLAUDE_REF, C], platform)).toEqual([true, true, false])
    expect(await check([A, OWN_CLAUDE_REF, C], 'win32', credentialManager([]))).toEqual([true, true, false])
    writeFileSync(join(loginFolder(C), '.credentials.json'), 'not json')
    expect(await check([C], 'linux')).toEqual([false])
  })

  it('asks the macOS Keychain whether the item exists, without reading its secret', async () => {
    const fake = keychain()
    fake.setItem(keychainService(null), '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-example"}}')
    fake.setItem(keychainService(loginFolder(A)), '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-example"}}')
    expect(await check([OWN_CLAUDE_REF, A, B], 'darwin')).toEqual([true, true, false])
    const calls = fake.calls()
    expect(calls).toHaveLength(3)
    for (const call of calls) expect(call).not.toContain('-w')
    expect(calls.map((call) => call[call.indexOf('-s') + 1]).sort())
      .toEqual([keychainService(null), keychainService(loginFolder(A)), keychainService(loginFolder(B))].sort())
    // A login whose file has the token needs no Keychain lookup.
    writeClaudeCredentials(loginFolder(B))
    expect(await check([B], 'darwin')).toEqual([true])
    expect(fake.calls()).toHaveLength(3)
  })

  it('answers unknown when the Keychain cannot be asked', async () => {
    keychain().setMode('locked')
    expect(await check([OWN_CLAUDE_REF, A], 'darwin')).toEqual(['unknown', 'unknown'])
    keychain().setMode(null)
    vi.stubEnv('KURMIS_SECURITY_PROGRAM', join(home, 'no-such-security.mjs'))
    try {
      expect(await check([A], 'darwin')).toEqual(['unknown'])
      // The file still answers yes without the Keychain.
      writeClaudeCredentials(loginFolder(A))
      expect(await check([A], 'darwin')).toEqual([true])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('lists Windows Credential Manager once for every Claude login without the file', async () => {
    const filters: string[][] = []
    const names = credentialManager([`${keychainService(null)}/claude-code-user`, `${keychainService(loginFolder(A))}/claude-code-user#m`,
      `${keychainService(loginFolder(A))}/claude-code-user#0`])
    const read: CredentialRead = (asked) => {
      filters.push([...asked])
      return names(asked)
    }
    expect(await check([OWN_CLAUDE_REF, A, B], 'win32', read)).toEqual([true, true, false])
    expect(filters).toHaveLength(1)
  })

  it('lists Credential Manager through PowerShell by name only, and answers unknown when PowerShell fails', async () => {
    const powershell = process.env.FAKE_POWERSHELL_DIR!
    rmSync(powershell, { recursive: true, force: true })
    mkdirSync(join(powershell, 'credentials'), { recursive: true })
    writeFileSync(join(powershell, 'credentials', encodeURIComponent(`${keychainService(loginFolder(A))}/claude-code-user`)), 'a record')
    expect(await check([OWN_CLAUDE_REF, A], 'win32')).toEqual([false, true])
    const calls = readFileSync(join(powershell, 'calls.jsonl'), 'utf8').trim().split('\n')
      .map((line) => JSON.parse(line) as { script: string | null })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.script).toContain('[KurmisCredEnum]::List($filters[$i],$false)')

    // PowerShell that cannot run the script, as in Constrained Language Mode.
    writeFileSync(join(powershell, 'mode'), 'fail')
    expect(await check([OWN_CLAUDE_REF, A], 'win32')).toEqual(['unknown', 'unknown'])
    rmSync(powershell, { recursive: true, force: true })
  })

  it('finds Codex logins by auth.json, in CODEX_HOME or ~/.codex for the login plain codex uses', async () => {
    const one = async (login: LoginRef, env: NodeJS.ProcessEnv = process.env): Promise<CredentialCheck> => await hasCredentials(login, env, home, deps('darwin'))
    expect(await one(SIDE)).toBe(false)
    writeCodexAuth(loginFolder(SIDE))
    expect(await one(SIDE)).toBe(true)

    expect(await one(OWN_CODEX_REF)).toBe(false)
    writeCodexAuth(join(home, '.codex'))
    expect(await one(OWN_CODEX_REF)).toBe(true)
    const elsewhere = join(home, 'codex-elsewhere')
    expect(await one(OWN_CODEX_REF, { ...process.env, CODEX_HOME: elsewhere })).toBe(false)
    writeCodexAuth(elsewhere)
    expect(await one(OWN_CODEX_REF, { ...process.env, CODEX_HOME: elsewhere })).toBe(true)
    // Codex logins never reach the Keychain.
    expect(keychain().calls()).toEqual([])
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

  it('asks for the login plain claude uses in the default home, and starts no codex for a login that keeps auth.json', async () => {
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

  it('answers unknown when codex login status cannot run', async () => {
    keepInKeyring(loginFolder(SIDE))
    const missing = (): never => { throw new ProgramNotFoundError('codex', 'codex is not installed') }
    expect(await hasCredentials(SIDE, fakeEnv(), home, { findProgram: missing, runProgram })).toBe('unknown')
    const slow: typeof runProgram = () => Promise.resolve({ stdout: '', stderr: '', code: null, timedOut: true, outputTooLarge: false,
      error: 'it did not finish within 10 seconds' })
    expect(await hasCredentials(SIDE, fakeEnv(), home, { findProgram, runProgram: slow })).toBe('unknown')
  })
})
