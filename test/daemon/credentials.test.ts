import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { CREDENTIALS_FILE_NAME, CredentialsFileReader } from '../../src/daemon/credentials.ts'

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kurmis-credentials-'))
  path = join(dir, CREDENTIALS_FILE_NAME)
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const reader = (): CredentialsFileReader => new CredentialsFileReader({ credentialsDir: () => dir })
const write = (token: string): void => {
  writeFileSync(path, JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt: 123 } }))
}

test('the file is .credentials.json in the login folder', () => {
  expect(CREDENTIALS_FILE_NAME).toBe('.credentials.json')
  const folders: string[] = []
  const tracking = new CredentialsFileReader({ credentialsDir: (id) => { folders.push(id); return dir } })
  write('one')
  expect(tracking.read('claude:work')).toEqual({ accessToken: 'one', expiresAt: 123 })
  expect(folders).toEqual(['claude:work'])
})

test('caches by mtime and size and reloads a changed file', () => {
  const credentials = reader()
  write('one')
  utimesSync(path, 1000, 1000)
  const first = credentials.read('claude:work')
  expect(first).toEqual({ accessToken: 'one', expiresAt: 123 })
  write('two')
  utimesSync(path, 1000, 1000)
  expect(credentials.read('claude:work')).toBe(first)
  utimesSync(path, 2000, 2000)
  expect(credentials.read('claude:work')?.accessToken).toBe('two')
})

test('a file of another size is read again even with the same mtime', () => {
  const credentials = reader()
  write('one')
  utimesSync(path, 1000, 1000)
  expect(credentials.read('claude:work')?.accessToken).toBe('one')
  write('a-longer-token')
  utimesSync(path, 1000, 1000)
  expect(credentials.read('claude:work')?.accessToken).toBe('a-longer-token')
})

test('invalidate and clear make the next read go to the file', () => {
  const credentials = reader()
  write('one')
  utimesSync(path, 1000, 1000)
  const first = credentials.read('claude:work')
  credentials.invalidate('claude:work')
  const second = credentials.read('claude:work')
  expect(second).toEqual(first)
  expect(second).not.toBe(first)
  credentials.clear()
  expect(credentials.read('claude:work')).not.toBe(second)
})

test('a file that goes away reads as no token', () => {
  const credentials = reader()
  write('one')
  expect(credentials.read('claude:work')).not.toBeNull()
  unlinkSync(path)
  expect(credentials.read('claude:work')).toBeNull()
})

test('prime has nothing to do and resolves', async () => {
  await expect(reader().prime(['claude:work'])).resolves.toBeUndefined()
})

test.each([undefined, '{', 'null', '{}', '{"claudeAiOauth":{"accessToken":""}}',
  '{"claudeAiOauth":{"accessToken":12}}'])('unreadable credentials: %s', (body) => {
  if (body !== undefined) writeFileSync(path, body)
  expect(reader().read('claude:work')).toBeNull()
})
