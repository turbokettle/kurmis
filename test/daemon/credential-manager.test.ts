import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DaemonLog, LogEvent, LogFields } from '../../src/data/log.ts'
import { CredentialManagerReader } from '../../src/daemon/credential-manager.ts'
import { createTokenSource, probeEnvironment } from '../../src/daemon/tokens.ts'
import type { CredentialRead, FilterAnswer } from '../../src/platform/windows-credentials.ts'
import { keychainService } from '../../src/core/keychain-service.ts'

const record = (token: string): string =>
  JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: 'example-refresh', expiresAt: 4_100_000_000_000 } })

/** The name Claude Code gives a login's credential, under the account name `claude-code-user`. */
const credentialName = (secureStorageDir: string | null): string => `${keychainService(secureStorageDir)}/claude-code-user`

/**
 * A Credential Manager in memory; `fail` makes the next reads throw as PowerShell under
 * Constrained Language Mode would, and `hold` makes them wait until `release` is called. A read
 * answers what `items` held when it started.
 */
function credentials(items: Record<string, string>): {
  read: CredentialRead; calls: number; fail: boolean; filters: string[][]; hold: boolean; release: () => void
} {
  let waiting: Array<() => void> = []
  const state = {
    calls: 0,
    fail: false,
    hold: false,
    filters: [] as string[][],
    release: () => { const now = waiting; waiting = []; for (const go of now) go() },
    read: async (filters: readonly string[]): Promise<FilterAnswer[]> => {
      state.calls++
      state.filters.push([...filters])
      // What the store holds when the read starts, as PowerShell would have listed it.
      const answers = filters.map((filter): FilterAnswer => {
        const prefix = filter.replace(/\*$/, '')
        return { kind: 'items', items: new Map(Object.entries(items).filter(([name]) => name.startsWith(prefix)).map(([name, blob]) => [name, Buffer.from(blob)])) }
      })
      const fail = state.fail
      if (state.hold) await new Promise<void>((resolve) => waiting.push(resolve))
      if (fail) throw new Error('PowerShell exited with code 1')
      return answers
    }
  }
  return state
}

let home: string
let now: number
let entries: Array<{ event: LogEvent; fields: LogFields }>
const log: DaemonLog = { write: (event, fields = {}) => { entries.push({ event, fields }) } }

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'kurmis-credman-'))
  now = 1_000_000
  entries = []
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 10 })
})

describe('CredentialManagerReader', () => {
  it('reads logins without a file in one run, keeps the answer, and refreshes an old one in the background', async () => {
    const items = { [credentialName(null)]: record('sk-ant-oat01-first') }
    const store = credentials(items)
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => false, read: store.read, now: () => now })
    await reader.prime(['claude:default'])
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-first')
    await reader.prime(['claude:default'])
    expect(store.calls).toBe(1)
    items[credentialName(null)] = record('sk-ant-oat01-second')
    now += 61_000
    await reader.prime(['claude:default'])
    // The old answer is used until the background read has finished.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-second')
    expect(store.calls).toBe(2)
  })

  it('reads a login whose .credentials.json exists too, first as Claude Code does, without waiting for it', async () => {
    const store = credentials({ [credentialName(null)]: record('sk-ant-oat01-first') })
    store.hold = true
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => true, read: store.read })
    await reader.prime(['claude:default'])
    // The file answers until the read has ended.
    expect(store.calls).toBe(1)
    expect(reader.read('claude:default')).toBeNull()
    store.release()
    await expect.poll(() => reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-first')
    expect(reader.holds('claude:default')).toBe(true)
  })

  it('does not read a login that has its file and no record here again for 15 minutes, marked stale or not, unless it is invalidated', async () => {
    const store = credentials({})
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => true, read: store.read, now: () => now })
    await reader.prime(['claude:default'])
    await expect.poll(() => store.calls).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 10))
    now += 61_000
    reader.markStale('claude:default')
    await reader.prime(['claude:default'])
    expect(store.calls).toBe(1)
    reader.invalidate('claude:default')
    await reader.prime(['claude:default'])
    await expect.poll(() => store.calls).toBe(2)
  })

  it('reads a login that has its file again after a failed read, with a wait that grows', async () => {
    const items: Record<string, string> = { [credentialName(null)]: record('sk-ant-oat01-current') }
    const store = credentials(items)
    store.fail = true
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => true, read: store.read, now: () => now })
    const settled = async (calls: number): Promise<void> => {
      await expect.poll(() => store.calls).toBe(calls)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await reader.prime(['claude:default'])
    await settled(1)
    now += 61_000
    await reader.prime(['claude:default'])
    await settled(2)
    // Two failures in a row: the next read is two minutes after the last one.
    now += 61_000
    await reader.prime(['claude:default'])
    expect(store.calls).toBe(2)
    store.fail = false
    now += 60_000
    await reader.prime(['claude:default'])
    await settled(3)
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-current')
    expect(reader.holds('claude:default')).toBe(true)
  })

  it('keeps the token and the found record through a failed read', async () => {
    const store = credentials({ [credentialName(null)]: record('sk-ant-oat01-current') })
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => false, read: store.read, now: () => now })
    await reader.prime(['claude:default'])
    store.fail = true
    reader.invalidate('claude:default')
    await reader.prime(['claude:default'])
    expect(store.calls).toBe(2)
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-current')
    expect(reader.holds('claude:default')).toBe(true)
  })

  it('finds a record that appears while the file exists within 15 minutes', async () => {
    const items: Record<string, string> = {}
    const store = credentials(items)
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => true, read: store.read, now: () => now })
    await reader.prime(['claude:default'])
    await expect.poll(() => store.calls).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 10))
    items[credentialName(null)] = record('sk-ant-oat01-moved')
    now += 14 * 60_000
    await reader.prime(['claude:default'])
    expect(store.calls).toBe(1)
    now += 60_000
    await reader.prime(['claude:default'])
    await expect.poll(() => reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-moved')
    expect(store.calls).toBe(2)
  })

  it('still holds a found record after invalidate, and waits for its new read even when the file exists', async () => {
    const items: Record<string, string> = { [credentialName(null)]: record('sk-ant-oat01-first') }
    const store = credentials(items)
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => true, read: store.read, now: () => now })
    await reader.prime(['claude:default'])
    await expect.poll(() => reader.holds('claude:default')).toBe(true)
    items[credentialName(null)] = record('sk-ant-oat01-renewed')
    reader.invalidate('claude:default')
    // A renewal probe started now still gets CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1.
    expect(reader.holds('claude:default')).toBe(true)
    await reader.prime(['claude:default'])
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-renewed')
  })

  it('answers the old token after invalidate until the new read lands', async () => {
    const items: Record<string, string> = { [credentialName(null)]: record('sk-ant-oat01-first') }
    const store = credentials(items)
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => false, read: store.read, now: () => now })
    await reader.prime(['claude:default'])
    items[credentialName(null)] = record('sk-ant-oat01-second')
    store.hold = true
    reader.invalidate('claude:default')
    const primed = reader.prime(['claude:default'])
    await expect.poll(() => store.calls).toBe(2)
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-first')
    store.release()
    await primed
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-second')
  })

  it('does not use a read that started before invalidate', async () => {
    const items: Record<string, string> = { [credentialName(null)]: record('sk-ant-oat01-before') }
    const store = credentials(items)
    store.hold = true
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => false, read: store.read, now: () => now })
    const first = reader.prime(['claude:default'])
    await expect.poll(() => store.calls).toBe(1)
    // The CLI renews the token while the read is going on, and the proxy invalidates the login.
    items[credentialName(null)] = record('sk-ant-oat01-after')
    reader.invalidate('claude:default')
    const second = reader.prime(['claude:default'])
    store.hold = false
    store.release()
    await Promise.all([first, second])
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-after')
    expect(store.calls).toBe(2)
  })

  it('waits until every login it was asked about has been read, also when runs for other logins are going on', async () => {
    const store = credentials({
      [credentialName('C:\\a')]: record('sk-ant-oat01-a'),
      [credentialName('C:\\b')]: record('sk-ant-oat01-b'),
      [credentialName('C:\\c')]: record('sk-ant-oat01-c')
    })
    store.hold = true
    const reader = new CredentialManagerReader({ secureStorageDir: (id) => `C:\\${id.slice('claude:'.length)}`, fileExists: () => false, read: store.read })
    const done: string[] = []
    const primes = ['a', 'b', 'c'].map((name) => reader.prime([`claude:${name}`]).then(() => { done.push(name) }))
    for (let round = 0; round < 5 && done.length < 3; round++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      store.release()
    }
    await Promise.all(primes)
    // Each prime ended only once its own login had been read.
    for (const name of ['a', 'b', 'c']) expect(reader.read(`claude:${name}`)?.accessToken).toBe(`sk-ant-oat01-${name}`)
  })

  it('goes on answering a login marked stale while it is read again', async () => {
    const items = { [credentialName(null)]: record('sk-ant-oat01-first') }
    const store = credentials(items)
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => false, read: store.read })
    await reader.prime(['claude:default'])
    items[credentialName(null)] = record('sk-ant-oat01-second')
    store.hold = true
    reader.markStale('claude:default')
    await reader.prime(['claude:default'])
    expect(store.calls).toBe(2)
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-first')
    store.release()
    await expect.poll(() => reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-second')
  })

  it('reports a failed read once per login, until a read works', async () => {
    const store = credentials({})
    store.fail = true
    const failures: string[] = []
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => false, read: store.read, now: () => now,
      onFailure: (failure) => failures.push(`${failure.id} ${failure.kind}`) })
    await reader.prime(['claude:default'])
    now += 61_000
    reader.invalidate('claude:default')
    await reader.prime(['claude:default'])
    expect(failures).toEqual(['claude:default not_run'])
    expect(reader.read('claude:default')).toBeNull()
  })
})

describe('the token source on Windows', () => {
  it('reads Credential Manager first and the file when Credential Manager has nothing, as Claude Code does', async () => {
    const work = join(home, 'claude-work')
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', '.credentials.json'), record('sk-ant-oat01-left-behind'))
    const store = credentials({ [credentialName(null)]: record('sk-ant-oat01-current'), [credentialName(work)]: 'not json' })
    const tokens = createTokenSource({ env: {}, platform: 'win32', home: () => home, log, credentialRead: store.read })
    // The file answers while the first read runs, Credential Manager once it has ended.
    await tokens.prime(['claude:default'])
    await expect.poll(() => tokens.read('claude:default')?.accessToken).toBe('sk-ant-oat01-current')
    expect(tokens.inCredentialManager('claude:default')).toBe(true)
    const empty = credentials({})
    const fileOnly = createTokenSource({ env: {}, platform: 'win32', home: () => home, log, credentialRead: empty.read })
    await fileOnly.prime(['claude:default'])
    await expect.poll(() => empty.calls).toBe(1)
    expect(fileOnly.read('claude:default')?.accessToken).toBe('sk-ant-oat01-left-behind')
    expect(fileOnly.inCredentialManager('claude:default')).toBe(false)
    expect(tokens.keychain).toBe(false)
  })

  it('gives the probe of a login found in Credential Manager CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1, and others nothing', async () => {
    const store = credentials({ [credentialName(null)]: record('sk-ant-oat01-current') })
    const tokens = createTokenSource({ env: {}, platform: 'win32', home: () => home, log, credentialRead: store.read })
    await tokens.prime(['claude:default', 'claude:work'])
    const env = { PATH: '/bin' }
    expect(probeEnvironment(tokens, 'claude:default', env)).toEqual({ PATH: '/bin', CLAUDE_CODE_FORCE_WINDOWS_CREDMAN: '1' })
    expect(probeEnvironment(tokens, 'claude:work', env)).toBe(env)
    const mac = createTokenSource({ env: {}, platform: 'darwin', home: () => home, log })
    expect(probeEnvironment(mac, 'claude:default', env)).toBe(env)
  })

  it('gives a renewal probe started right after invalidate CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1', async () => {
    const store = credentials({ [credentialName(null)]: record('sk-ant-oat01-refused') })
    const tokens = createTokenSource({ env: {}, platform: 'win32', home: () => home, log, credentialRead: store.read })
    await tokens.prime(['claude:default'])
    // A 401: the proxy invalidates the login and starts the renewal probe with no read between.
    tokens.invalidate('claude:default')
    expect(probeEnvironment(tokens, 'claude:default', {})).toEqual({ CLAUDE_CODE_FORCE_WINDOWS_CREDMAN: '1' })
  })

  it('does not report a failed read of a login that has its file', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', '.credentials.json'), record('sk-ant-oat01-from-file'))
    const store = credentials({})
    store.fail = true
    const tokens = createTokenSource({ env: {}, platform: 'win32', home: () => home, log, credentialRead: store.read })
    await tokens.prime(['claude:default'])
    await expect.poll(() => store.calls).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(tokens.read('claude:default')?.accessToken).toBe('sk-ant-oat01-from-file')
    expect(entries).toEqual([])
  })

  it('logs a record it cannot read as token_read_failed, without its contents', async () => {
    const store = credentials({ [credentialName(null)]: 'not json' })
    const tokens = createTokenSource({ env: {}, platform: 'win32', home: () => home, log, credentialRead: store.read })
    await tokens.prime(['claude:default'])
    expect(tokens.read('claude:default')).toBeNull()
    expect(entries).toEqual([{ event: 'token_read_failed', fields: { login: 'claude:default', reason: 'invalid' } }])
  })
})
