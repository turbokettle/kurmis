import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { keychainService } from '../../src/core/keychain-service.ts'
import {
  KEYCHAIN_CACHE_MS,
  KEYCHAIN_READ_TIMEOUT_MS,
  KeychainCredentialsReader,
  KeychainReadError,
  SECURITY_PROGRAM,
  keychainHoldsSecret,
  probeLoginKeychain,
  readKeychainItem,
  type KeychainReaderOptions,
  type KeychainReadFailure
} from '../../src/daemon/keychain.ts'
import { FAKE_SECURITY, FakeKeychain } from './fake-security/fake-keychain.ts'

const DEFAULT = 'claude:default'
const WORK = 'claude:work'
const PLAIN = 'Claude Code-credentials'
const SECRET = JSON.stringify({ claudeAiOauth: { accessToken: 'fake-token', expiresAt: 4_100_000_000_000 } })
/** Short, so the tests of a `security` that never answers do not wait three seconds each. */
const TIMEOUT_MS = 500

let dir: string
let keychain: FakeKeychain
let workService: string
let directories: Record<string, string | null>

const accounts = { secureStorageDir: (id: string): string | null => directories[id] ?? null }

function reader(options: Partial<KeychainReaderOptions> = {}): KeychainCredentialsReader {
  return new KeychainCredentialsReader({ accounts, securityProgram: FAKE_SECURITY, readTimeoutMs: TIMEOUT_MS, ...options })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kurmis-keychain-'))
  keychain = new FakeKeychain(join(dir, 'keychain'))
  vi.stubEnv('FAKE_SECURITY_DIR', keychain.dir)
  directories = { [DEFAULT]: null, [WORK]: join(dir, 'kurmis', 'claude', 'work') }
  workService = keychainService(directories[WORK] ?? null)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

test('the daemon constants', () => {
  expect(SECURITY_PROGRAM).toBe('/usr/bin/security')
  expect(KEYCHAIN_CACHE_MS).toBe(60_000)
  expect(KEYCHAIN_READ_TIMEOUT_MS).toBe(3_000)
})

test('reads a login token through security and asks for that login item', async () => {
  keychain.setItem(workService, SECRET)
  const credentials = reader()
  expect(credentials.read(WORK)).toBeNull()
  await credentials.prime([WORK])
  expect(credentials.read(WORK)).toEqual({ accessToken: 'fake-token', expiresAt: 4_100_000_000_000, hasRefreshToken: false })
  expect(keychain.calls()).toEqual([['find-generic-password', '-w', '-s', workService]])
})

test('the machine own login is read from the plain item', async () => {
  keychain.setItem(PLAIN, SECRET)
  const credentials = reader()
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)?.accessToken).toBe('fake-token')
  expect(keychain.calls()).toEqual([['find-generic-password', '-w', '-s', PLAIN]])
})

test('keeps an answer for a minute, then asks again', async () => {
  keychain.setItem(PLAIN, SECRET)
  let now = 1_000_000
  const credentials = reader({ now: () => now })
  await credentials.prime([DEFAULT])
  await credentials.prime([DEFAULT])
  now += 59_000
  await credentials.prime([DEFAULT])
  expect(keychain.calls()).toHaveLength(1)
  now += 2_000
  await credentials.prime([DEFAULT])
  expect(keychain.calls()).toHaveLength(2)
  expect(credentials.read(DEFAULT)?.accessToken).toBe('fake-token')
})

test('invalidate and clear make the next prime ask again', async () => {
  let runs = 0
  const credentials = reader({ run: () => { runs += 1; return Promise.resolve(SECRET) } })
  await credentials.prime([DEFAULT])
  credentials.invalidate(DEFAULT)
  await credentials.prime([DEFAULT])
  expect(runs).toBe(2)
  expect(credentials.read(DEFAULT)).not.toBeNull()
  credentials.clear()
  expect(credentials.read(DEFAULT)).toBeNull()
})

test('two primes for one login share the run that is already going', async () => {
  let runs = 0
  let answer: (secret: string) => void = () => undefined
  const credentials = reader({ run: () => {
    runs += 1
    return new Promise<string>((done) => { answer = done })
  } })
  const both = Promise.all([credentials.prime([DEFAULT, DEFAULT]), credentials.prime([DEFAULT])])
  answer(SECRET)
  await both
  expect(runs).toBe(1)
  expect(credentials.read(DEFAULT)?.accessToken).toBe('fake-token')
})

// Each of these is a login the proxy holds no token for.
test('an item that is not in the Keychain reads as no token', async () => {
  const credentials = reader()
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)).toBeNull()
})

test('a locked Keychain reads as no token', async () => {
  keychain.setItem(PLAIN, SECRET)
  keychain.setMode('locked')
  const credentials = reader()
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)).toBeNull()
})

test('an item holding something that is not a credentials record reads as no token', async () => {
  keychain.setItem(PLAIN, 'not json')
  const lines: string[] = []
  const credentials = reader({ log: (line) => lines.push(line) })
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)).toBeNull()
  expect(lines).toEqual([`reading login ${DEFAULT} from the Keychain item "${PLAIN}" failed, so the proxy holds no token for it ` +
    '(the item holds no OAuth token)'])
})

test('a failed read is logged once per login with the exit code, and again after one that worked', async () => {
  keychain.setMode('locked')
  let now = 1_000_000
  const lines: string[] = []
  const credentials = reader({ now: () => now, log: (line) => lines.push(line) })
  await credentials.prime([DEFAULT, WORK])
  now += 61_000
  await credentials.prime([DEFAULT, WORK])
  // The two logins are read by two `security` processes at once, so their lines come in
  // whichever order the processes finish.
  expect(lines).toHaveLength(2)
  expect(lines).toContain(`reading login ${DEFAULT} from the Keychain item "${PLAIN}" failed, so the proxy holds no token for it ` +
    '(exit 36: security: SecKeychainSearchCopyNext: User interaction is not allowed.)')
  expect(lines.filter((line) => line.startsWith(`reading login ${WORK} from the Keychain item "${workService}"`))).toHaveLength(1)

  keychain.setMode(null)
  keychain.setItem(PLAIN, SECRET)
  now += 61_000
  await credentials.prime([DEFAULT])
  expect(lines).toHaveLength(2)
  keychain.setItem(PLAIN, 'not json')
  now += 61_000
  await credentials.prime([DEFAULT])
  expect(lines).toHaveLength(3)
  expect(lines[2]).toContain('(the item holds no OAuth token)')
})

// On macOS a login whose CLI keeps its record in `.credentials.json`, or that is signed out, has
// no item, so exit 44 is an answer rather than a failure. It also counts as a read that worked.
test('an item that is not there is not reported, and counts as a read that worked', async () => {
  let now = 1_000_000
  const lines: string[] = []
  const failures: KeychainReadFailure[] = []
  const credentials = reader({ now: () => now, log: (line) => lines.push(line), onFailure: (failure) => failures.push(failure) })
  await credentials.prime([DEFAULT, WORK])
  expect(credentials.read(DEFAULT)).toBeNull()
  expect(lines).toEqual([])
  expect(failures).toEqual([])

  keychain.setMode('locked')
  now += 61_000
  await credentials.prime([DEFAULT])
  keychain.setMode(null)
  now += 61_000
  await credentials.prime([DEFAULT])
  keychain.setMode('locked')
  now += 61_000
  await credentials.prime([DEFAULT])
  expect(failures).toEqual([{ id: DEFAULT, kind: 'not_allowed', code: 36 }, { id: DEFAULT, kind: 'not_allowed', code: 36 }])
  expect(lines).toHaveLength(2)
})

test('onFailure gets each kind of failure as fixed values, once per login', async () => {
  const failures: KeychainReadFailure[] = []
  const onFailure = (failure: KeychainReadFailure): void => { failures.push(failure) }

  keychain.setItem(PLAIN, '')
  keychain.setItem(workService, 'not json')
  const first = reader({ onFailure })
  await first.prime([DEFAULT, WORK])
  first.invalidate(DEFAULT)
  first.invalidate(WORK)
  await first.prime([DEFAULT, WORK])
  expect(failures).toHaveLength(2)
  expect(failures).toContainEqual({ id: DEFAULT, kind: 'empty', code: null })
  expect(failures).toContainEqual({ id: WORK, kind: 'not_credentials', code: null })

  failures.length = 0
  keychain.setMode('oversize')
  await reader({ onFailure }).prime([DEFAULT])
  keychain.setMode(null)
  await reader({ onFailure, securityProgram: join(dir, 'no-such-security') }).prime([DEFAULT])
  await reader({ onFailure, run: () => Promise.reject(new Error('no security here')) }).prime([DEFAULT])
  await reader({ onFailure, run: () => Promise.reject(new KeychainReadError('exit 51', 51)) }).prime([DEFAULT])
  expect(failures).toEqual([
    { id: DEFAULT, kind: 'too_large', code: null },
    { id: DEFAULT, kind: 'not_run', code: null },
    { id: DEFAULT, kind: 'failed', code: null },
    { id: DEFAULT, kind: 'failed', code: 51 }
  ])
})

test('onFailure hears of a read that did not answer once, as a timeout', async () => {
  keychain.setItem(PLAIN, SECRET)
  keychain.setMode('prompt')
  let now = 1_000_000
  const failures: KeychainReadFailure[] = []
  const credentials = reader({ now: () => now, onFailure: (failure) => failures.push(failure) })
  await credentials.prime([DEFAULT])
  now += 61_000
  await credentials.prime([DEFAULT])
  expect(failures).toEqual([{ id: DEFAULT, kind: 'timeout', code: null }])
})

test('no log line holds the token', async () => {
  keychain.setItem(PLAIN, JSON.stringify({ claudeAiOauth: { accessToken: '', note: 'fake-secret-text' } }))
  keychain.setItem(workService, SECRET)
  const lines: string[] = []
  await reader({ log: (line) => lines.push(line) }).prime([DEFAULT, WORK])
  keychain.setMode('oversize')
  await reader({ log: (line) => lines.push(line) }).prime([WORK])
  expect(lines).toHaveLength(2)
  for (const line of lines) {
    expect(line).not.toContain('fake-token')
    expect(line).not.toContain('fake-secret-text')
    expect(line).not.toContain('xxxx')
  }
})

test('a read that throws reads as no token', async () => {
  const lines: string[] = []
  const credentials = reader({ run: () => Promise.reject(new Error('no security here')), log: (line) => lines.push(line) })
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)).toBeNull()
  expect(lines[0]).toContain('(it threw: no security here)')
})

test('an empty item reads as no token', async () => {
  keychain.setItem(PLAIN, '')
  const lines: string[] = []
  const credentials = reader({ log: (line) => lines.push(line) })
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)).toBeNull()
  expect(lines[0]).toContain('(the item is empty)')
})

// A Keychain dialog waiting for the person looks exactly like this from outside: a `security`
// that never answers. The read is killed at its deadline rather than the request waiting.
test('a security that never answers is killed and reads as no token', async () => {
  keychain.setItem(PLAIN, SECRET)
  keychain.setMode('prompt')
  const credentials = reader()
  const started = Date.now()
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)).toBeNull()
  expect(Date.now() - started).toBeLessThan(5_000)
})

// The dialog that read was waiting on may still be on the screen of a Mac nobody is sitting
// at. Reading the item again a minute later, or after the proxy invalidated it, would put up
// another one, so the reader never runs `security` for that item again. Other items are still
// read.
test('an item whose read did not answer is never read again, so it puts up at most one dialog', async () => {
  keychain.setItem(PLAIN, SECRET)
  keychain.setMode('prompt')
  let now = 1_000_000
  const lines: string[] = []
  const credentials = reader({ now: () => now, log: (line) => lines.push(line) })
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)).toBeNull()

  keychain.setMode(null)
  now += 61_000
  await credentials.prime([DEFAULT])
  credentials.invalidate(DEFAULT)
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)).toBeNull()
  const services = (): string[] => keychain.calls().map((argv) => argv.at(-1) ?? '')
  expect(services()).toEqual([PLAIN])
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain(`reading login ${DEFAULT} from the Keychain item "${PLAIN}" did not answer within 0.5 seconds`)
  expect(lines[0]).toContain('will not read that item again until it restarts')

  keychain.setItem(workService, SECRET)
  await credentials.prime([WORK])
  expect(credentials.read(WORK)?.accessToken).toBe('fake-token')
  expect(services()).toEqual([PLAIN, workService])
})

test('clear does not undo the mark on an item whose read did not answer', async () => {
  let runs = 0
  const credentials = reader({ run: () => {
    runs += 1
    if (runs === 1) return Promise.reject(new KeychainReadError('it did not answer within 3 seconds', null, true))
    return Promise.resolve(SECRET)
  } })
  await credentials.prime([DEFAULT])
  credentials.clear()
  await credentials.prime([DEFAULT])
  expect(runs).toBe(1)
  expect(credentials.read(DEFAULT)).toBeNull()
})

// A `security` that printed more than the reader accepts is killed, but it did answer, so no
// dialog was waiting and the item is read again on the next prime.
test('an item too large to be a credentials record reads as no token and is read again', async () => {
  keychain.setItem(PLAIN, SECRET)
  keychain.setMode('oversize')
  const lines: string[] = []
  const credentials = reader({ log: (line) => lines.push(line) })
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)).toBeNull()
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain('failed, so the proxy holds no token for it (no exit code: it printed more than 262144 bytes')
  expect(lines[0]).not.toContain('will not read that item again')

  keychain.setMode(null)
  credentials.invalidate(DEFAULT)
  await credentials.prime([DEFAULT])
  expect(credentials.read(DEFAULT)?.accessToken).toBe('fake-token')
})

test('a security program that is not there reads as no token, and is tried again', async () => {
  const lines: string[] = []
  const missing = reader({ securityProgram: join(dir, 'no-such-security'), log: (line) => lines.push(line) })
  await missing.prime([DEFAULT])
  expect(missing.read(DEFAULT)).toBeNull()
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain('(no exit code: ')
  expect(lines[0]).toContain('could not be started')
  expect(lines[0]).not.toContain('will not read that item again')
})

test('readKeychainItem answers the item, null for an empty one, and throws with the exit code', async () => {
  keychain.setItem(PLAIN, SECRET)
  keychain.setItem(workService, '')
  expect(await readKeychainItem(FAKE_SECURITY, PLAIN)).toBe(`${SECRET}\n`)
  expect(await readKeychainItem(FAKE_SECURITY, workService)).toBeNull()
  const error = await readKeychainItem(FAKE_SECURITY, 'Claude Code-credentials-00000000').catch((thrown: unknown) => thrown)
  expect(error).toBeInstanceOf(KeychainReadError)
  expect(error).toMatchObject({ code: 44, timedOut: false })
})

// A daemon started from an ssh session cannot read the login Keychain. `show-keychain-info` is
// the question, because it shows no dialog whichever way it answers.
test('the probe finds a readable login Keychain readable', async () => {
  expect(await probeLoginKeychain(FAKE_SECURITY)).toEqual({ readable: true })
  expect(keychain.calls()).toEqual([['show-keychain-info', 'login.keychain']])
})

test('the probe says why a login Keychain cannot be read', async () => {
  keychain.setMode('locked')
  expect(await probeLoginKeychain(FAKE_SECURITY)).toEqual({ readable: false, reason: expect.stringContaining('User interaction is not allowed') })
})

test('a probe that never answers counts as unreadable', async () => {
  keychain.setMode('prompt')
  expect(await probeLoginKeychain(FAKE_SECURITY, TIMEOUT_MS)).toEqual({ readable: false, reason: expect.stringContaining('did not answer') })
})

test('the Keychain holds the secret on macOS only', () => {
  expect(keychainHoldsSecret('darwin')).toBe(true)
  expect(keychainHoldsSecret('win32')).toBe(false)
  expect(keychainHoldsSecret('linux')).toBe(false)
  expect(keychainHoldsSecret()).toBe(process.platform === 'darwin')
})
