import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DaemonLog, LogEvent, LogFields } from '../../src/data/log.ts'
import { CredentialManagerReader } from '../../src/daemon/credential-manager.ts'
import { createTokenSource } from '../../src/daemon/tokens.ts'
import { credentialTarget, type CredentialAnswer, type CredentialRead } from '../../src/platform/windows-credentials.ts'

const record = (token: string): string =>
  JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: 'example-refresh', expiresAt: 4_100_000_000_000 } })

/** A Credential Manager in memory; `fail` makes the next reads throw as PowerShell under Constrained Language Mode would. */
function credentials(items: Record<string, string>): { read: CredentialRead; calls: number; fail: boolean } {
  const state = {
    calls: 0,
    fail: false,
    read: (targets: readonly string[]): Promise<CredentialAnswer[]> => {
      state.calls++
      if (state.fail) return Promise.reject(new Error('PowerShell exited with code 1'))
      return Promise.resolve(targets.map((target): CredentialAnswer =>
        target in items ? { kind: 'found', blob: Buffer.from(items[target] ?? '') } : { kind: 'missing' }))
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
    const items = { [credentialTarget(null)]: record('sk-ant-oat01-first') }
    const store = credentials(items)
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => false, read: store.read, now: () => now })
    await reader.prime(['claude:default'])
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-first')
    await reader.prime(['claude:default'])
    expect(store.calls).toBe(1)
    items[credentialTarget(null)] = record('sk-ant-oat01-second')
    now += 61_000
    await reader.prime(['claude:default'])
    // The old answer is used until the background read has finished.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(reader.read('claude:default')?.accessToken).toBe('sk-ant-oat01-second')
    expect(store.calls).toBe(2)
  })

  it('leaves a login whose .credentials.json exists to the file', async () => {
    const store = credentials({ [credentialTarget(null)]: record('sk-ant-oat01-first') })
    const reader = new CredentialManagerReader({ secureStorageDir: () => null, fileExists: () => true, read: store.read })
    await reader.prime(['claude:default'])
    expect(store.calls).toBe(0)
    expect(reader.read('claude:default')).toBeNull()
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
  it('reads Credential Manager for a login without .credentials.json, and the file for one with it', async () => {
    const work = join(home, 'claude-work')
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', '.credentials.json'), record('sk-ant-oat01-from-file'))
    const store = credentials({
      [credentialTarget(null)]: record('sk-ant-oat01-ignored'),
      [credentialTarget(work)]: 'not json'
    })
    const tokens = createTokenSource({ env: {}, platform: 'win32', home: () => home, log, credentialRead: store.read })
    await tokens.prime(['claude:default'])
    expect(tokens.read('claude:default')?.accessToken).toBe('sk-ant-oat01-from-file')
    expect(store.calls).toBe(0)
    rmSync(join(home, '.claude', '.credentials.json'))
    tokens.invalidate('claude:default')
    await tokens.prime(['claude:default'])
    expect(tokens.read('claude:default')?.accessToken).toBe('sk-ant-oat01-ignored')
    expect(tokens.keychain).toBe(false)
  })

  it('logs a record it cannot read as token_read_failed, without its contents', async () => {
    const store = credentials({ [credentialTarget(null)]: 'not json' })
    const tokens = createTokenSource({ env: {}, platform: 'win32', home: () => home, log, credentialRead: store.read })
    await tokens.prime(['claude:default'])
    expect(tokens.read('claude:default')).toBeNull()
    expect(entries).toEqual([{ event: 'token_read_failed', fields: { login: 'claude:default', reason: 'invalid' } }])
  })
})
