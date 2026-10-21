// The fake reg.exe answers the way the real one does for the calls kurmis makes.
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { regFor } from '../../src/platform/windows-autostart.ts'

const dir = (): string => process.env.FAKE_REG_DIR ?? ''
const reg = regFor()
const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

beforeEach(() => {
  rmSync(dir(), { recursive: true, force: true })
  mkdirSync(dir(), { recursive: true })
})

describe('fake reg', () => {
  it('adds, queries and deletes a value with reg.exe output and exit codes', async () => {
    const missing = await reg(['query', KEY, '/v', 'example'])
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('ERROR: The system was unable to find the specified registry key or value.')
    const added = await reg(['add', KEY, '/v', 'example', '/t', 'REG_SZ', '/d', '"C:\\a b\\x.exe" --flag', '/f'])
    expect(added.code).toBe(0)
    expect(added.stdout).toBe('The operation completed successfully.\r\n')
    const found = await reg(['query', 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'EXAMPLE'])
    expect(found.code).toBe(0)
    expect(found.stdout).toBe('\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n' +
      '    example    REG_SZ    "C:\\a b\\x.exe" --flag\r\n\r\n')
    expect((await reg(['add', KEY, '/v', 'example', '/t', 'REG_SZ', '/d', 'other'])).code).toBe(1)
    expect((await reg(['delete', KEY, '/v', 'example', '/f'])).code).toBe(0)
    expect((await reg(['delete', KEY, '/v', 'example', '/f'])).code).toBe(1)
  })

  it('fails every call on request, and records every call', async () => {
    const failed = await regFor({ ...process.env, FAKE_REG_FAIL: '1' })(['query', KEY, '/v', 'example'])
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('ERROR: Access is denied.')
    expect((await reg(['bogus'])).code).toBe(1)
    const lines = readFileSync(join(dir(), 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as unknown)
    expect(lines).toEqual([['query', KEY, '/v', 'example'], ['bogus']])
  })
})
