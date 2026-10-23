import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkCredentials, hasCredentials, type CredentialCheck, type CredentialCheckDeps } from '../../src/cli/local-credentials.ts'
import { keychainService } from '../../src/core/keychain-service.ts'
import type { LoginRef } from '../../src/data/login-id.ts'
import { kurmisHome, loginFolder } from '../../src/data/paths.ts'
import { runProgram } from '../../src/platform/run.ts'
import type { CredentialRead, FilterAnswer } from '../../src/platform/windows-credentials.ts'
import { FakeKeychain } from '../daemon/fake-security/fake-keychain.ts'
import { writeClaudeCredentials, writeClaudeIdentity } from '../fakes/index.ts'
import { extraRef, OWN_CLAUDE_REF } from '../logins.ts'

const A = extraRef('logina')
const B = extraRef('loginb')
const C = extraRef('loginc')

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
    ({ runProgram, platform, ...(readCredentialNames === undefined ? {} : { readCredentialNames }) })
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

  it('finds a login by a claudeAiOauth record in its .credentials.json, on every platform', async () => {
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
    for (const call of calls) expect(call).not.toContain('-w')
    const lookups = calls.filter((call) => call[0] === 'find-generic-password')
    // B is not found in the search list, and is asked again of the user's keychains.
    expect(lookups.map((call) => call.slice(2).join(' ')).sort()).toEqual([
      keychainService(null), keychainService(loginFolder(A)), keychainService(loginFolder(B)),
      `${keychainService(loginFolder(B))} /Users/example/Library/Keychains/login.keychain-db`
    ].sort())
    // A login whose file has the token needs no Keychain lookup.
    writeClaudeCredentials(loginFolder(B))
    expect(await check([B], 'darwin')).toEqual([true])
    expect(fake.calls()).toHaveLength(calls.length)
  })

  it('finds the item in the user keychain when the search list has only the System keychain, as over ssh', async () => {
    const fake = keychain()
    fake.setItem(keychainService(loginFolder(A)), '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-example"}}')
    fake.setMode('ssh')
    expect(await check([A, B], 'darwin')).toEqual([true, false])
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

  it('lists Windows Credential Manager once for every login without the file', async () => {
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

  it('answers one login through hasCredentials', async () => {
    expect(await hasCredentials(A, process.env, home, deps('linux'))).toBe(false)
    writeClaudeCredentials(loginFolder(A))
    expect(await hasCredentials(A, process.env, home, deps('linux'))).toBe(true)
  })
})
