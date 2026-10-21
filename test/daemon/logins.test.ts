import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ClaudeCredentials } from '../../src/core/credentials.ts'
import { loadConfig } from '../../src/data/config.ts'
import { formatLogLine, type LogEvent, type LogFields } from '../../src/data/log.ts'
import { configLockPath, configPath, kurmisHome, statePath } from '../../src/data/paths.ts'
import { MAX_SESSIONS, SESSION_MAX_AGE_MS } from '../../src/data/state.ts'
import { LoginTable, NO_SESSION_KEY } from '../../src/daemon/logins.ts'
import type { TokenSource } from '../../src/daemon/tokens.ts'
import { emptyAccountUsage } from '../../src/core/usage.ts'
import { loginOf, OWN_CLAUDE, OWN_CODEX } from '../logins.ts'
import { freshHome, writeLogins } from './harness.ts'

const WORK = 'workclaude'
const WORK_CODEX = 'workcodex1'

let home = ''
const tokens = new Map<string, ClaudeCredentials>()
const source: TokenSource = {
  keychain: false,
  read: (id) => tokens.get(id) ?? null,
  prime: () => Promise.resolve(),
  invalidate: () => undefined,
  markStale: () => undefined,
  inCredentialManager: () => false,
  clear: () => undefined
}
const events: string[] = []
/** Every log line the tables wrote, as `daemon.log` would hold it. */
const lines: string[] = []
let clock = 1_000_000

function table(): LoginTable {
  const write = (event: LogEvent, fields?: LogFields): void => {
    events.push(event)
    lines.push(formatLogLine(event, fields, clock))
  }
  const created = new LoginTable({ tokens: source, log: { write }, now: () => clock, configCheckMs: 2_000, stateWriteMs: 0 })
  created.load()
  tables.push(created)
  return created
}

/**
 * The tables a test made. They are flushed before the test's home is removed: a state write
 * still waiting would otherwise create the folder again.
 */
const tables: LoginTable[] = []

beforeEach(() => {
  home = freshHome()
  tokens.clear()
  events.length = 0
  lines.length = 0
  clock = 1_000_000
})

afterEach(async () => {
  for (const created of tables.splice(0)) await created.flush()
  rmSync(home, { recursive: true, force: true, maxRetries: 10 })
})

describe('the routing rows', () => {
  test('are built from the settings, the tokens, the usage and the cooldowns of the Claude logins', () => {
    writeLogins({ claude: { [WORK]: { fiveHourLimit: 80, useFirst: true } }, codex: { [WORK_CODEX]: {} } })
    tokens.set(WORK, { accessToken: 't', expiresAt: 5_000_000, hasRefreshToken: true })
    const logins = table()
    logins.setCooldown(WORK, 2_000_000)
    logins.setUsage(WORK, emptyAccountUsage(WORK, clock))
    const rows = logins.routeRows(OWN_CLAUDE, false)
    expect(rows.map((row) => row.id)).toEqual([OWN_CLAUDE, WORK])
    expect(rows[0]).toMatchObject({ loggedIn: false, credentialsReadable: false, tokenExpiresAt: null, usage: null })
    expect(rows[1]).toMatchObject({ loggedIn: true, credentialsReadable: true, tokenExpiresAt: 5_000_000,
      fiveHourLimitPercent: 80, weeklyLimitPercent: 100, useFirst: true, autoRoute: true, cooldownUntil: 2_000_000 })
    expect(rows[1]?.usage?.accountId).toBe(WORK)
  })

  test('count the started-on login as signable only when the request carries its own authorization header', () => {
    writeLogins({ claude: { [WORK]: {} } })
    const logins = table()
    expect(logins.routeRows(WORK, true).map((row) => row.credentialsReadable)).toEqual([false, true])
    expect(logins.routeRows(WORK, false).map((row) => row.credentialsReadable)).toEqual([false, false])
    expect(logins.routeRows(OWN_CLAUDE, true).map((row) => row.credentialsReadable)).toEqual([true, false])
  })

  test('count a login a probe found signed in as logged in, but not as signable', () => {
    writeLogins({})
    const logins = table()
    logins.setSignedIn(OWN_CLAUDE, true)
    expect(logins.routeRows(OWN_CLAUDE, false)[0]).toMatchObject({ loggedIn: true, credentialsReadable: false })
  })

  test('count a login whose token Anthropic refused as signed out, except for the started-on and the pinned login', () => {
    writeLogins({ claude: { [WORK]: {} } })
    tokens.set(OWN_CLAUDE, { accessToken: 'd', expiresAt: null, hasRefreshToken: true })
    tokens.set(WORK, { accessToken: 'w', expiresAt: null, hasRefreshToken: true })
    const logins = table()
    let changes = 0
    logins.onChange(() => { changes++ })
    logins.markRefused(WORK)
    expect(changes).toBe(1)
    expect(logins.routeRows(OWN_CLAUDE, false).map((row) => row.loggedIn)).toEqual([true, false])
    expect(logins.routeRows(WORK, false).map((row) => row.loggedIn)).toEqual([true, true])
    expect(logins.routeRows(OWN_CLAUDE, false, WORK).map((row) => row.loggedIn)).toEqual([true, true])
    logins.clearRefused(WORK)
    expect(logins.isRefused(WORK)).toBe(false)
    expect(logins.routeRows(OWN_CLAUDE, false).map((row) => row.loggedIn)).toEqual([true, true])
  })

  test('drop a cooldown that has run out', () => {
    writeLogins({})
    const logins = table()
    logins.setCooldown(OWN_CLAUDE, clock + 10)
    expect(logins.cooldown(OWN_CLAUDE)).toBe(clock + 10)
    clock += 10
    expect(logins.cooldown(OWN_CLAUDE)).toBeNull()
    logins.setCooldown(OWN_CLAUDE, Infinity)
    expect(logins.routeRows(OWN_CLAUDE, false)[0]?.cooldownUntil).toBe(Infinity)
  })
})

describe('sessions', () => {
  test('a placement says whether the session is new, stayed or moved, and is saved', async () => {
    writeLogins({ claude: { [WORK]: {} } })
    const logins = table()
    expect(logins.placeSession('s-1', OWN_CLAUDE)).toEqual({ kind: 'placed' })
    expect(logins.placeSession('s-1', OWN_CLAUDE)).toEqual({ kind: 'same' })
    expect(logins.placeSession('s-1', WORK)).toEqual({ kind: 'moved', from: OWN_CLAUDE })
    expect(logins.placeSession(NO_SESSION_KEY, WORK)).toEqual({ kind: 'placed' })
    expect(logins.sessionCount(WORK)).toBe(2)
    await logins.flush()
    const saved = JSON.parse(readFileSync(statePath(), 'utf8')) as { sessions: Record<string, unknown> }
    expect(Object.keys(saved.sessions)).toEqual(['s-1', NO_SESSION_KEY])
    expect(table().sessionLogin('s-1')).toBe(WORK)
  })
  test('a hold after a pin-back lasts until it is released', () => {
    writeLogins({})
    const logins = table()
    logins.holdSession('s-1', OWN_CLAUDE)
    expect(logins.heldLogin('s-1')).toBe(OWN_CLAUDE)
    logins.releaseSession('s-1')
    expect(logins.heldLogin('s-1')).toBeNull()
  })

  test('a hold unused for a week has ended when it is read, though no new hold pruned it', () => {
    writeLogins({})
    const logins = table()
    logins.holdSession('s-1', OWN_CLAUDE)
    clock += SESSION_MAX_AGE_MS - 1_000
    expect(logins.heldLogin('s-1')).toBe(OWN_CLAUDE)
    clock += SESSION_MAX_AGE_MS + 1_000
    expect(logins.heldLogin('s-1')).toBeNull()
    expect(logins.heldCount()).toBe(0)
  })

  test('holds are dropped after a week unused, and beyond the 2000 most recently used', () => {
    writeLogins({})
    const logins = table()
    logins.holdSession('old', OWN_CLAUDE)
    logins.holdSession('used', OWN_CLAUDE)
    clock += SESSION_MAX_AGE_MS - 1_000
    expect(logins.heldLogin('used')).toBe(OWN_CLAUDE)
    clock += 2_000
    for (let index = 0; index < MAX_SESSIONS + 5; index++) logins.holdSession(`s-${String(index)}`, OWN_CLAUDE)
    expect(logins.heldCount()).toBe(MAX_SESSIONS)
    expect(logins.heldLogin('old')).toBeNull()
    // The least recently used went first: the one used a moment ago, then the first five new ones.
    expect(logins.heldLogin('used')).toBeNull()
    expect(logins.heldLogin('s-4')).toBeNull()
    expect(logins.heldLogin('s-5')).toBe(OWN_CLAUDE)
  })
})

describe('the config', () => {
  test('is reloaded when its contents change, at most every configCheckMs', () => {
    writeLogins({})
    const logins = table()
    writeLogins({ claude: { [WORK]: {} } })
    logins.checkConfig()
    expect(logins.find(WORK)).toBeUndefined()
    clock += 2_000
    logins.checkConfig()
    expect(logins.find(WORK)).toBeDefined()
  })

  test('that does not read keeps the config the daemon has, and reload says why', () => {
    writeLogins({ claude: { [WORK]: {} } })
    const logins = table()
    writeFileSync(configPath(), '{"version": 2, "logins": [{"id": "Bad Id", "provider": "claude"}]}')
    const result = logins.reloadConfig()
    expect(result.ok).toBe(false)
    expect(logins.find(WORK)).toBeDefined()
    expect(events).toContain('config_invalid')
  })

  test('tells listeners about a change', () => {
    writeLogins({})
    const logins = table()
    let calls = 0
    const stop = logins.onChange(() => { calls++ })
    logins.setCooldown(OWN_CLAUDE, clock + 100)
    stop()
    logins.setCooldown(OWN_CLAUDE, null)
    expect(calls).toBe(1)
  })

  test('a removed login takes its usage and cooldown with it', () => {
    writeLogins({ claude: { [WORK]: {} } })
    const logins = table()
    logins.setCooldown(WORK, clock + 100)
    writeLogins({})
    logins.reloadConfig()
    expect(logins.cooldown(WORK)).toBeNull()
  })
})

describe("the machine's own logins", () => {
  test('are found by provider, whatever their ids', () => {
    writeLogins({ claude: { [WORK]: {} }, codex: { [WORK_CODEX]: {} } })
    const logins = table()
    expect(logins.ownLogin('claude')).toMatchObject({ id: OWN_CLAUDE, provider: 'claude', machineOwn: true })
    expect(logins.ownLogin('codex')).toMatchObject({ id: OWN_CODEX, provider: 'codex', machineOwn: true })
    expect(logins.find(WORK)?.machineOwn).toBe(false)
  })

  test('are added with new ids to a config that has none, and the file keeps them', () => {
    mkdirSync(kurmisHome(), { recursive: true })
    writeFileSync(configPath(), '{"version": 2, "logins": []}')
    const logins = table()
    const own = logins.ownLogin('claude')
    expect(own.machineOwn).toBe(true)
    expect(loadConfig().logins.map((login) => login.id)).toEqual([own.id, logins.ownLogin('codex').id])
  })

  test("leave the machine's own Claude login out of a request whose CLI runs on credentials of its own", () => {
    writeLogins({ claude: { [WORK]: {} } })
    tokens.set(OWN_CLAUDE, { accessToken: 'd', expiresAt: null, hasRefreshToken: true })
    tokens.set(WORK, { accessToken: 'w', expiresAt: null, hasRefreshToken: true })
    const logins = table()
    expect(logins.routeRows(null, true).map((row) => [row.id, row.loggedIn, row.credentialsReadable]))
      .toEqual([[OWN_CLAUDE, false, false], [WORK, true, true]])
  })
})

describe('automatic aliases', () => {
  /** Holds `config.json`'s lock as a running process would, until the returned function is called. */
  const holdConfigLock = (): () => void => {
    writeFileSync(configLockPath(), JSON.stringify({ pid: process.pid, createdAt: Date.now(), token: 'held-by-a-test' }))
    return () => { rmSync(configLockPath(), { force: true }) }
  }

  test('follow the email a probe learned, in the file and in the table', () => {
    writeLogins({ claude: { [WORK]: {} }, codex: { [WORK_CODEX]: {} } })
    const logins = table()
    expect(logins.find(WORK)?.alias).toBe(WORK)
    logins.noteEmail(WORK, 'work.person@example.com')
    logins.noteEmail(OWN_CODEX, 'own.person@example.org')
    expect(logins.find(WORK)).toMatchObject({ alias: 'work-person-example', aliasSetByUser: false })
    expect(loginOf(loadConfig(), WORK).alias).toBe('work-person-example')
    expect(loginOf(loadConfig(), OWN_CODEX).alias).toBe('own-person-example')
    expect(events).toContain('config_loaded')
  })

  test('change when the email changes, and an unchanged email writes nothing', () => {
    writeLogins({})
    const logins = table()
    logins.noteEmail(OWN_CLAUDE, 'first@example.com')
    expect(logins.ownLogin('claude').alias).toBe('first-example')
    const written = readFileSync(configPath(), 'utf8')
    const release = holdConfigLock()
    try {
      // With the lock held a write would fail and be logged; the same email needs none.
      logins.noteEmail(OWN_CLAUDE, 'first@example.com')
      expect(events).not.toContain('config_invalid')
    } finally {
      release()
    }
    expect(readFileSync(configPath(), 'utf8')).toBe(written)
    logins.noteEmail(OWN_CLAUDE, 'second@example.org')
    expect(logins.ownLogin('claude').alias).toBe('second-example')
    expect(loginOf(loadConfig(), OWN_CLAUDE).alias).toBe('second-example')
  })

  test('never replace an alias the person set', () => {
    writeLogins({ claude: { [WORK]: { alias: 'mine' } } })
    const logins = table()
    const written = readFileSync(configPath(), 'utf8')
    logins.noteEmail(WORK, 'someone@example.com')
    expect(logins.find(WORK)).toMatchObject({ alias: 'mine', aliasSetByUser: true })
    expect(readFileSync(configPath(), 'utf8')).toBe(written)
  })

  test('are worked out again from the file inside the lock', () => {
    writeLogins({ claude: { [WORK]: {} } })
    const logins = table()
    // The person sets an alias with the CLI, and the daemon's next look at the file is not due yet.
    writeLogins({ claude: { [WORK]: { alias: 'chosen' } } })
    logins.noteEmail(WORK, 'someone@example.com')
    expect(loginOf(loadConfig(), WORK)).toMatchObject({ alias: 'chosen', aliasSetByUser: true })
  })

  test('that cannot get the lock are logged by id, leave the config as it is, and are written after the next probe', () => {
    writeLogins({ claude: { [WORK]: {} } })
    const logins = table()
    const release = holdConfigLock()
    try {
      const started = Date.now()
      logins.noteEmail(WORK, 'locked.out@example.com')
      expect(Date.now() - started).toBeLessThan(5_000)
    } finally {
      release()
    }
    expect(logins.find(WORK)?.alias).toBe(WORK)
    expect(loginOf(loadConfig(), WORK).alias).toBe(WORK)
    expect(lines.find((line) => line.includes('alias_write_failed'))).toMatch(new RegExp(` alias_write_failed login=${WORK} reason=timeout code=other\\n$`))
    logins.noteEmail(WORK, 'locked.out@example.com')
    expect(logins.find(WORK)?.alias).toBe('locked-out-example')
  })

  test('never put an alias or an email in the log', () => {
    writeLogins({ claude: { [WORK]: {} } })
    const logins = table()
    const release = holdConfigLock()
    try {
      logins.noteEmail(WORK, 'private.person@example.com')
    } finally {
      release()
    }
    logins.noteEmail(WORK, 'private.person@example.com')
    logins.noteEmail(OWN_CLAUDE, 'own.person@example.com')
    expect(logins.find(WORK)?.alias).toBe('private-person-example')
    const text = lines.join('')
    expect(text).toContain(`login=${WORK}`)
    expect(text).not.toMatch(/example|person|@/)
  })

  test('a Codex email is kept in memory for Codex logins only', () => {
    writeLogins({ codex: { [WORK_CODEX]: {} } })
    const logins = table()
    logins.setCodexEmail(WORK_CODEX, 'codex.person@example.com')
    logins.setCodexEmail(OWN_CLAUDE, 'not.codex@example.com')
    expect(logins.codexEmail(WORK_CODEX)).toBe('codex.person@example.com')
    expect(logins.codexEmail(OWN_CLAUDE)).toBeNull()
    expect(readFileSync(configPath(), 'utf8')).not.toContain('example')
  })
})
