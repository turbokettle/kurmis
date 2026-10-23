import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { keychainService } from '../../src/core/keychain-service.ts'
import { formatLogLine, type DaemonLog, type LogEvent, type LogFields } from '../../src/data/log.ts'
import { findLogin } from '../../src/data/config.ts'
import { loginFolder } from '../../src/data/paths.ts'
import {
  claudeCredentialsDir,
  claudeSecureStorageDir,
  createTokenSource,
  logReasonOf,
  securityProgramOf,
  type TokenSource,
  type TokenSourceOptions
} from '../../src/daemon/tokens.ts'
import { fakeToken, writeClaudeCredentials } from '../fakes/claude.ts'
import { FAKE_SECURITY, FakeKeychain } from './fake-security/fake-keychain.ts'
import { extraRef, OWN_CLAUDE, OWN_CLAUDE_REF, testConfig } from '../logins.ts'

const DEFAULT = OWN_CLAUDE
const WORK = 'workclaude'
/** An id the config does not have. */
const UNKNOWN = 'unknown01'
/** The config the token source looks logins up in. */
const config = testConfig({ extras: [{ id: WORK }] })
const workFolder = (): string => loginFolder(extraRef(WORK))
const PLAIN = 'Claude Code-credentials'
const record = (token: string, refresh = true): string =>
  JSON.stringify({ claudeAiOauth: { accessToken: token, expiresAt: 4_100_000_000_000, ...(refresh ? { refreshToken: 'fake-refresh' } : {}) } })

let dir: string
let home: string
let keychain: FakeKeychain
let entries: { event: LogEvent; fields: LogFields }[]
const log: DaemonLog = { write: (event, fields = {}) => { entries.push({ event, fields }) } }

function source(options: Partial<TokenSourceOptions> = {}): TokenSource {
  return createTokenSource({
    login: (id) => findLogin(config, id),
    env: { KURMIS_SECURITY_PROGRAM: FAKE_SECURITY },
    platform: 'darwin',
    home: () => home,
    log,
    // Long enough for the Node stand-in to start on a loaded machine; see keychain.test.ts.
    keychainReadTimeoutMs: 10_000,
    ...options
  })
}

const defaultDir = (): string => join(home, '.claude')
const services = (): string[] => keychain.calls().map((argv) => argv.at(-1) ?? '')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kurmis-tokens-'))
  home = join(dir, 'home')
  keychain = new FakeKeychain(join(dir, 'keychain'))
  vi.stubEnv('FAKE_SECURITY_DIR', keychain.dir)
  vi.stubEnv('KURMIS_HOME', join(dir, 'kurmis'))
  entries = []
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
})

test('the security program comes from KURMIS_SECURITY_PROGRAM, else /usr/bin/security', () => {
  expect(securityProgramOf({ KURMIS_SECURITY_PROGRAM: '/tmp/fake-security' })).toBe('/tmp/fake-security')
  expect(securityProgramOf({ KURMIS_SECURITY_PROGRAM: '' }, {})).toBe('/usr/bin/security')
  expect(securityProgramOf({}, {})).toBe('/usr/bin/security')
  // An environment without the hook still gets the stand-in test/setup.ts names.
  expect(securityProgramOf({})).toBe(process.env.KURMIS_SECURITY_PROGRAM)
})

test("an extra login uses its folder for both the item name and the file; the login plain claude uses the plain item and ~/.claude", () => {
  expect(claudeSecureStorageDir(extraRef(WORK))).toBe(join(dir, 'kurmis', 'claude', WORK))
  expect(claudeSecureStorageDir(OWN_CLAUDE_REF)).toBeNull()
  expect(claudeCredentialsDir(extraRef(WORK), home)).toBe(join(dir, 'kurmis', 'claude', WORK))
  expect(claudeCredentialsDir(OWN_CLAUDE_REF, home)).toBe(join(home, '.claude'))
  expect(() => claudeSecureStorageDir(extraRef('../x'))).toThrow()
  expect(() => claudeCredentialsDir(extraRef('../x'), home)).toThrow()
})

test('a login is told apart by its settings in the config, not by its id', async () => {
  // The same id is first an extra login, then, in another daemon, the login plain claude uses,
  // and then, in a third, no login at all.
  writeClaudeCredentials(workFolder(), { accessToken: fakeToken('work-file') })
  writeClaudeCredentials(defaultDir(), { accessToken: fakeToken('default-file') })
  const extra = source({ platform: 'linux' })
  await extra.prime([WORK])
  expect(extra.read(WORK)?.accessToken).toBe(fakeToken('work-file'))
  const plain = source({ platform: 'linux', login: (id) => (id === WORK ? { ...extraRef(WORK), usedByPlainClaude: true } : undefined) })
  await plain.prime([WORK])
  expect(plain.read(WORK)?.accessToken).toBe(fakeToken('default-file'))
  const none = source({ platform: 'linux', login: () => undefined })
  await none.prime([WORK])
  expect(none.read(WORK)).toBeNull()
})

test('macOS: with no item, an extra login is read from its .credentials.json, and nothing is logged', async () => {
  writeClaudeCredentials(workFolder(), { accessToken: fakeToken('work-file') })
  const tokens = source()
  await tokens.prime([WORK])
  expect(services()).toEqual([keychainService(workFolder())])
  expect(tokens.read(WORK)).toEqual({ accessToken: fakeToken('work-file'), expiresAt: expect.any(Number), hasRefreshToken: true })
  expect(entries).toEqual([])
})

test("macOS: with no item, the login plain claude uses is read from ~/.claude/.credentials.json", async () => {
  writeClaudeCredentials(defaultDir(), { accessToken: fakeToken('default-file'), refreshToken: null })
  const tokens = source()
  await tokens.prime([DEFAULT])
  expect(services()).toEqual([PLAIN])
  expect(tokens.read(DEFAULT)).toMatchObject({ accessToken: fakeToken('default-file'), hasRefreshToken: false })
  expect(entries).toEqual([])
})

test('macOS: the Keychain item comes before the file, and the file is used once the item is gone', async () => {
  writeClaudeCredentials(defaultDir(), { accessToken: fakeToken('default-file') })
  writeClaudeCredentials(workFolder(), { accessToken: fakeToken('work-file') })
  keychain.setItem(PLAIN, record(fakeToken('default-item'), false))
  keychain.setItem(keychainService(workFolder()), record(fakeToken('work-item')))
  const tokens = source()

  // `read` never waits: before the first prime only the file is known.
  expect(tokens.read(DEFAULT)?.accessToken).toBe(fakeToken('default-file'))
  expect(keychain.calls()).toEqual([])

  await tokens.prime([DEFAULT, WORK])
  expect(tokens.read(DEFAULT)).toMatchObject({ accessToken: fakeToken('default-item'), hasRefreshToken: false })
  expect(tokens.read(WORK)).toMatchObject({ accessToken: fakeToken('work-item'), hasRefreshToken: true })

  keychain.removeItem(PLAIN)
  tokens.invalidate(DEFAULT)
  await tokens.prime([DEFAULT, WORK])
  expect(tokens.read(DEFAULT)?.accessToken).toBe(fakeToken('default-file'))
  expect(tokens.read(WORK)?.accessToken).toBe(fakeToken('work-item'))
  expect(entries).toEqual([])
})

test('macOS: an item that holds no token falls back to the file and is logged once as invalid', async () => {
  writeClaudeCredentials(workFolder(), { accessToken: fakeToken('work-file') })
  keychain.setItem(keychainService(workFolder()), 'not json')
  let now = 1_000_000
  const tokens = source({ now: () => now })
  await tokens.prime([WORK])
  now += 61_000
  await tokens.prime([WORK])
  expect(keychain.calls()).toHaveLength(2)
  expect(tokens.read(WORK)?.accessToken).toBe(fakeToken('work-file'))
  expect(entries).toEqual([{ event: 'token_read_failed', fields: { login: WORK, reason: 'invalid' } }])
})

test('macOS: a Keychain that may not be used is logged once per login, with fixed fields only', async () => {
  keychain.setMode('locked')
  let now = 1_000_000
  const tokens = source({ now: () => now })
  await tokens.prime([DEFAULT, WORK])
  now += 61_000
  await tokens.prime([DEFAULT, WORK])
  expect(tokens.read(DEFAULT)).toBeNull()
  expect(entries).toHaveLength(2)
  expect(entries).toContainEqual({ event: 'token_read_failed', fields: { login: DEFAULT, reason: 'not_allowed' } })
  expect(entries).toContainEqual({ event: 'token_read_failed', fields: { login: WORK, reason: 'not_allowed' } })
  for (const entry of entries) expect(formatLogLine(entry.event, entry.fields)).not.toContain('[redacted]')
})

test('macOS: a read that does not answer is logged as a timeout and the item is not read again', async () => {
  writeClaudeCredentials(defaultDir(), { accessToken: fakeToken('default-file') })
  keychain.setItem(PLAIN, record(fakeToken('default-item')))
  keychain.setMode('prompt')
  let now = 1_000_000
  // Short, but long enough for the stand-in to start and record its call before it is killed,
  // which takes longer on Windows.
  const tokens = source({ now: () => now, keychainReadTimeoutMs: process.platform === 'win32' ? 3_000 : 500 })
  await tokens.prime([DEFAULT])
  expect(tokens.read(DEFAULT)?.accessToken).toBe(fakeToken('default-file'))
  keychain.setMode(null)
  now += 61_000
  tokens.invalidate(DEFAULT)
  await tokens.prime([DEFAULT])
  expect(services()).toEqual([PLAIN])
  expect(tokens.read(DEFAULT)?.accessToken).toBe(fakeToken('default-file'))
  expect(entries).toEqual([{ event: 'token_read_failed', fields: { login: DEFAULT, reason: 'timeout' } }])
})

test('macOS: a security program that is not there is logged as other, and the file still answers', async () => {
  writeClaudeCredentials(workFolder(), { accessToken: fakeToken('work-file') })
  const tokens = source({ env: { KURMIS_SECURITY_PROGRAM: join(dir, 'no-such-security') } })
  await tokens.prime([WORK])
  expect(tokens.read(WORK)?.accessToken).toBe(fakeToken('work-file'))
  expect(entries).toEqual([{ event: 'token_read_failed', fields: { login: WORK, reason: 'other' } }])
})

test.each(['win32', 'linux'] as const)('%s: only the file is read, never the Keychain', async (platform) => {
  writeClaudeCredentials(defaultDir(), { accessToken: fakeToken('default-file') })
  writeClaudeCredentials(workFolder(), { accessToken: fakeToken('work-file'), refreshToken: null })
  keychain.setItem(PLAIN, record(fakeToken('default-item')))
  const tokens = source({ platform })
  await tokens.prime([DEFAULT, WORK])
  expect(keychain.calls()).toEqual([])
  expect(tokens.read(DEFAULT)).toMatchObject({ accessToken: fakeToken('default-file'), hasRefreshToken: true })
  expect(tokens.read(WORK)).toMatchObject({ accessToken: fakeToken('work-file'), hasRefreshToken: false })
  expect(tokens.read('otherclaude')).toBeNull()
  expect(entries).toEqual([])
})

test('ids that are not logins in the config have no token and never reach the Keychain', async () => {
  const tokens = source()
  await tokens.prime([UNKNOWN, 'nonsense', 'claude:../x'])
  expect(keychain.calls()).toEqual([])
  for (const id of [UNKNOWN, 'nonsense']) {
    expect(tokens.read(id)).toBeNull()
    expect(() => { tokens.invalidate(id) }).not.toThrow()
  }
})

test('invalidate reaches the Keychain answer and the file', async () => {
  const work = workFolder()
  const service = keychainService(work)
  const file = join(work, '.credentials.json')
  // Two tokens of the same length, so the rewritten file has the same size as before.
  writeClaudeCredentials(defaultDir(), { accessToken: fakeToken('file-1') })
  writeClaudeCredentials(work, { accessToken: fakeToken('file-1') })
  utimesSync(file, 1000, 1000)
  keychain.setItem(PLAIN, record(fakeToken('item-1')))
  const tokens = source({ now: () => 1_000_000 })
  await tokens.prime([DEFAULT, WORK])
  expect(tokens.read(DEFAULT)?.accessToken).toBe(fakeToken('item-1'))
  expect(tokens.read(WORK)?.accessToken).toBe(fakeToken('file-1'))

  keychain.setItem(PLAIN, record(fakeToken('item-2')))
  writeClaudeCredentials(work, { accessToken: fakeToken('file-2') })
  utimesSync(file, 1000, 1000)
  await tokens.prime([DEFAULT, WORK])
  expect(tokens.read(DEFAULT)?.accessToken).toBe(fakeToken('item-1'))
  expect(tokens.read(WORK)?.accessToken).toBe(fakeToken('file-1'))

  tokens.invalidate(DEFAULT)
  tokens.invalidate(WORK)
  expect(tokens.read(WORK)?.accessToken).toBe(fakeToken('file-2'))
  await tokens.prime([DEFAULT, WORK])
  expect(tokens.read(DEFAULT)?.accessToken).toBe(fakeToken('item-2'))
  expect(services().filter((name) => name === service)).toHaveLength(2)
})

test('clear reaches the Keychain answers and the file', async () => {
  const work = workFolder()
  const file = join(work, '.credentials.json')
  writeClaudeCredentials(work, { accessToken: fakeToken('file-1') })
  utimesSync(file, 1000, 1000)
  keychain.setItem(PLAIN, record(fakeToken('item-1')))
  const tokens = source({ now: () => 1_000_000 })
  await tokens.prime([DEFAULT, WORK])
  expect(tokens.read(WORK)?.accessToken).toBe(fakeToken('file-1'))

  writeClaudeCredentials(work, { accessToken: fakeToken('file-2') })
  utimesSync(file, 1000, 1000)
  tokens.clear()
  expect(tokens.read(DEFAULT)).toBeNull()
  expect(tokens.read(WORK)?.accessToken).toBe(fakeToken('file-2'))
  await tokens.prime([DEFAULT])
  expect(tokens.read(DEFAULT)?.accessToken).toBe(fakeToken('item-1'))
})

test('every Keychain failure kind maps to a log reason word', () => {
  expect(logReasonOf('timeout')).toBe('timeout')
  expect(logReasonOf('not_allowed')).toBe('not_allowed')
  expect(logReasonOf('empty')).toBe('invalid')
  expect(logReasonOf('not_credentials')).toBe('invalid')
  expect(logReasonOf('too_large')).toBe('invalid')
  expect(logReasonOf('not_run')).toBe('other')
  expect(logReasonOf('failed')).toBe('other')
})
