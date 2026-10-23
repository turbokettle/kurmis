// `kurmis login`, `logout`, `set` and `status` end to end: the real bundle runs the fake
// claude's `auth login` and `auth logout`, and writes the world's config.json and login folders.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readClaudeCredentials, writeClaudeIdentity } from '../fakes/index.ts'
import { createWorld, OWN_CLAUDE, type StatusJson, type World } from './harness.ts'

/** A new login's id: 10 lowercase letters and digits. */
const NEW_ID = /^[a-z0-9]{10}$/

/** The text of config.json, to check that nothing outside kurmis' settings is in it. */
function configText(world: World): string {
  return readFileSync(join(world.data, 'config.json'), 'utf8')
}

function loginIds(world: World): string[] {
  return world.readConfig().logins.map((login) => login.id)
}

/** The folders in the data folder's `claude/`, which holds one folder per extra login. */
function loginFolders(world: World): string[] {
  const parent = join(world.data, 'claude')
  return existsSync(parent) ? readdirSync(parent) : []
}

/** The folders the fake claude's `auth login` runs signed in to, in order. */
function claudeLoginDirs(world: World): Array<string | null> {
  return world.claudeRecord().flatMap((line) => (line.kind === 'login' ? [line.credentialsDir] : []))
}

describe('kurmis login, set, status and logout', () => {
  it('adds a login in a folder named by its new id, with an alias made from the email, and keeps the email out of config.json', async () => {
    const world = await createWorld()
    const added = await world.kurmis(['login'], { env: { FAKE_CLAUDE_EMAIL: 'work@example.com' } })
    expect(added.code, added.stderr).toBe(0)
    const id = /a new login \(id ([a-z0-9]+)\)/.exec(added.stdout)?.[1]
    expect(id).toMatch(NEW_ID)
    expect(added.stdout).toContain('Signed in as work@example.com.')
    expect(added.stdout).toContain(`Added work-example (id ${id!}), a login with Auto routing on and both limits at 100%.`)

    // The fake signed in with the login's folder, named by the id, as its config folder.
    const folder = world.loginFolder(id!)
    // Windows has no mode bits.
    if (process.platform !== 'win32') expect(statSync(folder).mode & 0o777).toBe(0o700)
    expect(readClaudeCredentials(folder)?.accessToken).toMatch(/^sk-ant-oat01-fake-/)
    expect(claudeLoginDirs(world)).toEqual([folder])
    expect(loginFolders(world)).toEqual([id])
    // ~/.claude stays as it was.
    expect(existsSync(join(world.home, '.claude', '.credentials.json'))).toBe(false)

    expect(world.configLogin(id!)).toEqual({
      id, usedByPlainClaude: false, alias: 'work-example', aliasSetByUser: false,
      routing: true, fiveHourLimit: 100, weeklyLimit: 100, useFirst: false
    })
    expect(configText(world)).not.toContain('example.com')

    // --alias sets the alias in place of the one the email gives.
    const second = await world.addClaudeLogin('second@example.com', { alias: 'spare' })
    expect(second.id).toMatch(NEW_ID)
    expect(second.id).not.toBe(id)
    expect(second.stdout).toContain(`Added spare (id ${second.id})`)
    expect(world.configLogin(second.id)).toMatchObject({ alias: 'spare', aliasSetByUser: true })
    expect(loginIds(world)).toEqual([OWN_CLAUDE, id, second.id])

    const listed = await world.kurmis(['status', '--json'])
    expect(listed.code, listed.stderr).toBe(0)
    const status = JSON.parse(listed.stdout) as StatusJson
    expect(status).toMatchObject({ daemon: null, source: 'files' })
    expect(status.logins.map((login) => [login.alias, login.id, login.usedByPlainClaude, login.credentials, login.email])).toEqual([
      [OWN_CLAUDE, OWN_CLAUDE, true, false, null],
      ['work-example', id, false, true, 'work@example.com'],
      ['spare', second.id, false, true, 'second@example.com']
    ])

    const text = await world.kurmis(['status'])
    expect(text.code, text.stderr).toBe(0)
    expect(text.stdout).toContain(`work-example (id ${id!})  work@example.com\n  credentials on this machine, routing on`)
    expect(text.stdout).toContain(`${OWN_CLAUDE}\n  the login plain claude uses\n  no credentials on this machine`)

    // None of these commands needs or starts the daemon.
    expect(world.daemonInfo()).toBeNull()
  }, 90_000)

  it('adds nothing and leaves no folder when an account that is already a login signs in again', async () => {
    const world = await createWorld()
    const work = await world.addClaudeLogin('work@example.com')
    const before = configText(world)

    // The emails are compared without regard to case.
    const again = await world.kurmis(['login'], { env: { FAKE_CLAUDE_EMAIL: 'WORK@example.com' } })
    expect(again.code, again.stderr).toBe(0)
    expect(again.stdout).toContain(`WORK@example.com is already a kurmis login: work-example (id ${work.id}). ` +
      'No login was added, and the new sign-in was signed out again.')
    expect(again.stdout).toContain('"kurmis login work-example" signs work-example in again.')
    const duplicate = claudeLoginDirs(world)[1]!
    expect(duplicate).not.toBe(work.folder)
    expect(world.claudeRecord().filter((line) => line.kind === 'logout')).toEqual([expect.objectContaining({ credentialsDir: duplicate })])
    expect(existsSync(duplicate)).toBe(false)
    expect(loginFolders(world)).toEqual([work.id])
    expect(configText(world)).toBe(before)

    // The account of the login plain claude uses is found too.
    writeClaudeIdentity(join(world.home, '.claude.json'), { email: 'own@example.com' })
    const own = await world.kurmis(['login'], { env: { FAKE_CLAUDE_EMAIL: 'own@example.com' } })
    expect(own.code, own.stderr).toBe(0)
    expect(own.stdout).toContain(`own@example.com is already a kurmis login: ${OWN_CLAUDE}, the login plain claude uses (id ${OWN_CLAUDE}).`)
    expect(loginFolders(world)).toEqual([work.id])
    expect(configText(world)).toBe(before)
  }, 90_000)

  it('refuses an alias that is taken or is not an alias, and adds nothing', async () => {
    const world = await createWorld()
    const work = await world.addClaudeLogin('work@example.com')
    const before = configText(world)

    const refusals: Array<[string[], string]> = [
      [['login', '--alias', 'work-example'], 'another login is already called "work-example"'],
      [['login', '--alias', 'Not An Alias'], '"Not An Alias" is not an alias'],
      [['login', '--alias', OWN_CLAUDE], `"${OWN_CLAUDE}" is the id of another login`],
      [['login', '--name', 'work'], '--name'],
      [['login', 'gemini'], 'there is no login called "gemini"']
    ]
    for (const [args, message] of refusals) {
      const result = await world.kurmis(args)
      expect({ args, code: result.code }).toEqual({ args, code: 2 })
      expect(result.stderr).toContain(message)
    }

    expect(configText(world)).toBe(before)
    expect(loginFolders(world)).toEqual([work.id])
    // Only the one successful sign-in ran the fake.
    expect(claudeLoginDirs(world)).toHaveLength(1)
  }, 90_000)

  it('adds nothing and leaves no folder when the sign-in fails', async () => {
    const world = await createWorld()
    const before = configText(world)
    const result = await world.kurmis(['login'], { env: { FAKE_CLAUDE_LOGIN: 'fail' } })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('"claude auth login" failed (exit code 1). No login was added.')
    const id = /a new login \(id ([a-z0-9]+)\)/.exec(result.stdout)?.[1]
    expect(id).toMatch(NEW_ID)
    expect(world.claudeRecord().filter((line) => line.kind === 'start' && line.argv[0] === 'auth'))
      .toEqual([expect.objectContaining({ credentialsDir: world.loginFolder(id!) })])
    expect(loginFolders(world)).toEqual([])
    expect(configText(world)).toBe(before)
  }, 60_000)

  it('keeps an existing login, its folder and its credentials when signing it in again fails', async () => {
    const world = await createWorld()
    const work = await world.addClaudeLogin('work@example.com')
    const before = configText(world)
    const result = await world.kurmis(['login', 'work-example'], { env: { FAKE_CLAUDE_LOGIN: 'fail' } })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('"claude auth login" failed (exit code 1).')
    expect(result.stderr).not.toContain('No login was added')
    expect(readClaudeCredentials(work.folder)?.accessToken).toBe(work.token)
    expect(configText(world)).toBe(before)

    // Signed in again to another account, the login keeps its id, folder and settings, and its
    // automatic alias follows the new email.
    expect((await world.kurmis(['set', 'work-example', '--five-hour', '70'])).code).toBe(0)
    const again = await world.kurmis(['login', 'work-example'], { env: { FAKE_CLAUDE_EMAIL: 'work-again@example.com' } })
    expect(again.code, again.stderr).toBe(0)
    expect(again.stdout).toContain('Signed in as work-again@example.com.')
    expect(again.stdout).toContain('work-example is now called work-again-example.')
    expect(world.configLogin(work.id)).toMatchObject({ alias: 'work-again-example', aliasSetByUser: false, fiveHourLimit: 70 })
    expect(claudeLoginDirs(world).at(-1)).toBe(work.folder)
    expect(readClaudeCredentials(work.folder)?.accessToken).not.toBe(work.token)

    // An alias given with --alias is kept when the email changes later.
    expect((await world.kurmis(['login', work.id, '--alias', 'work'], { env: { FAKE_CLAUDE_EMAIL: 'work-again@example.com' } })).code).toBe(0)
    const third = await world.kurmis(['login', 'work'], { env: { FAKE_CLAUDE_EMAIL: 'work-third@example.com' } })
    expect(third.code, third.stderr).toBe(0)
    expect(world.configLogin(work.id)).toMatchObject({ alias: 'work', aliasSetByUser: true, fiveHourLimit: 70 })
    expect(loginIds(world)).toEqual([OWN_CLAUDE, work.id])
    expect(configText(world)).not.toContain('example.com')
  }, 120_000)

  it("signs the login plain claude uses in again in ~/.claude, without a folder of its own, and gives it an alias from the email", async () => {
    const world = await createWorld()
    const result = await world.kurmis(['login', OWN_CLAUDE], { env: { FAKE_CLAUDE_EMAIL: 'own@example.com' } })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('Signed in as own@example.com.')
    expect(result.stdout).toContain(`${OWN_CLAUDE} is now called own-example.`)
    expect(result.stdout).not.toContain('Added')
    expect(claudeLoginDirs(world)).toEqual([join(world.home, '.claude')])
    expect(readFileSync(join(world.home, '.claude.json'), 'utf8')).toContain('own@example.com')
    expect(loginFolders(world)).toEqual([])
    expect(world.configLogin(OWN_CLAUDE)).toMatchObject({ usedByPlainClaude: true, alias: 'own-example', aliasSetByUser: false })
    expect(loginIds(world)).toEqual([OWN_CLAUDE])
    expect(configText(world)).not.toContain('example.com')
    const listed = await world.status()
    expect(listed.logins.find((login) => login.id === OWN_CLAUDE)).toMatchObject({ alias: 'own-example', credentials: true })
  }, 60_000)

  it("gives the login of plain claude a new id when config.json has none, and refuses a config.json of an older version", async () => {
    const world = await createWorld({ ownLogins: false })
    // Status reads config.json the way every command does, so it gives the login an id.
    const logins = (await world.status()).logins
    expect(logins.map((login) => login.usedByPlainClaude)).toEqual([true])
    expect(logins[0]!.id).toMatch(NEW_ID)
    expect(logins[0]!.alias).toBe(logins[0]!.id)
    // The id was saved, so every later command sees the same one.
    expect(world.readConfig()).toMatchObject({ version: 3, port: world.port })
    expect(loginIds(world)).toEqual([logins[0]!.id])
    const again = (await world.status()).logins
    expect(again.map((login) => login.id)).toEqual([logins[0]!.id])

    const olderFiles: Array<[number, string]> = [
      [1, '{"version":1,"logins":[{"id":"claude:work"}]}'],
      [2, '{"version":2,"port":4100,"logins":[{"id":"claudework","provider":"claude","usedByPlainCli":false,"alias":"work"}]}']
    ]
    for (const [version, old] of olderFiles) {
      writeFileSync(join(world.data, 'config.json'), old)
      const refused = await world.kurmis(['status'])
      expect(refused.code).toBe(1)
      expect(refused.stderr).toContain(`was written by an older kurmis (config version ${String(version)})`)
      expect(configText(world)).toBe(old)
    }
  }, 60_000)

  it('changes settings with set and refuses wrong options without changing config.json', async () => {
    const world = await createWorld()
    const work = await world.addClaudeLogin('work@example.com')

    const changed = await world.kurmis(['set', 'work-example', '--auto', 'off', '--five-hour', '80', '--weekly', '90', '--use-first', 'on', '--alias', 'work'])
    expect(changed.code, changed.stderr).toBe(0)
    expect(changed.stdout.split('\n').map((line) => line.trim().split(/\s+/).join(' '))).toEqual(expect.arrayContaining([
      `work (id ${work.id})`, 'alias work (set by you)', 'auto off', 'five-hour 80%', 'weekly 90%', 'use-first on'
    ]))
    expect(world.configLogin(work.id)).toEqual({
      id: work.id, usedByPlainClaude: false, alias: 'work', aliasSetByUser: true,
      routing: false, fiveHourLimit: 80, weeklyLimit: 90, useFirst: true
    })
    // The login of plain claude can be set too, by its id.
    const own = await world.kurmis(['set', OWN_CLAUDE, '--weekly', '50'])
    expect(own.code, own.stderr).toBe(0)
    expect(own.stdout).toContain("the login plain claude uses")
    expect(world.configLogin(OWN_CLAUDE)).toMatchObject({ weeklyLimit: 50, usedByPlainClaude: true })

    const before = configText(world)
    const refusals: Array<[string[], string]> = [
      [['set', 'work'], 'give at least one of'],
      [['set', 'work', '--five-hour', '0'], '--five-hour takes a whole number from 1 to 100, not "0"'],
      [['set', 'work', '--five-hour', '101'], 'not "101"'],
      [['set', 'work', '--weekly', '5.5'], '--weekly takes a whole number from 1 to 100, not "5.5"'],
      [['set', 'work', '--weekly', 'lots'], 'not "lots"'],
      [['set', 'work', '--auto', 'maybe'], '--auto takes on or off, not "maybe"'],
      [['set', 'work', '--use-first', 'yes'], '--use-first takes on or off'],
      [['set', 'work', '--alias', 'Not An Alias'], '"Not An Alias" is not an alias'],
      [['set', 'work', '--alias', OWN_CLAUDE], `"${OWN_CLAUDE}" is the id of another login`],
      [['set', 'nobody', '--auto', 'on'], 'there is no login called "nobody"'],
      // A "claude:" in front is part of the name, and no login has that name.
      [['set', 'claude:work', '--auto', 'on'], 'there is no login called "claude:work"'],
      [['set', '--auto', 'on'], 'takes one login, by its alias or id'],
      [['set', 'work', '--label', 'Work'], '--label'],
      [['set', 'work', '--colour', 'blue'], '--colour']
    ]
    // None of them writes anything, so they can run at once.
    const results = await Promise.all(refusals.map(async ([args]) => world.kurmis(args)))
    refusals.forEach(([args, message], index) => {
      expect({ args, code: results[index]!.code }).toEqual({ args, code: 2 })
      expect(results[index]!.stderr).toContain(message)
    })
    expect(configText(world)).toBe(before)

    // "claude" may be an alias, and then "kurmis login claude" signs that login in again
    // instead of adding one.
    expect((await world.kurmis(['set', 'work', '--alias', 'claude'])).code).toBe(0)
    expect(world.configLogin(work.id)).toMatchObject({ alias: 'claude', aliasSetByUser: true })
    const again = await world.kurmis(['login', 'claude'], { env: { FAKE_CLAUDE_EMAIL: 'work@example.com' } })
    expect(again.code, again.stderr).toBe(0)
    expect(again.stdout).not.toContain('Added')
    expect(claudeLoginDirs(world).at(-1)).toBe(work.folder)
    expect(loginIds(world)).toEqual([OWN_CLAUDE, work.id])
  }, 120_000)

  it('logs a login out: signs it out, removes its folder and config entry, and a running daemon drops it', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    const work = await world.addClaudeLogin('work@example.com')
    const started = await world.kurmis(['daemon', 'start'])
    expect(started.code, started.stderr).toBe(0)
    expect((await world.status()).logins.map((login) => login.id)).toContain(work.id)

    const result = await world.kurmis(['logout', 'work-example'])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(`Removed work-example (id ${work.id}).`)
    expect(world.claudeRecord().filter((line) => line.kind === 'logout')).toEqual([expect.objectContaining({ credentialsDir: work.folder })])
    expect(existsSync(work.folder)).toBe(false)
    expect(loginIds(world)).toEqual([OWN_CLAUDE])
    // The daemon was told to reload, so it no longer lists the login.
    expect((await world.status()).logins.map((login) => login.id)).not.toContain(work.id)
    // The login plain claude uses is untouched.
    expect(existsSync(join(world.home, '.claude', '.credentials.json'))).toBe(true)

    const again = await world.kurmis(['logout', 'work-example'])
    expect(again.code).toBe(1)
    expect(again.stderr).toContain('there is no login called "work-example"')
    // The daemon may have given the login of plain claude an alias from its email by now.
    const ownAlias = world.configLogin(OWN_CLAUDE).alias
    const refused = await world.kurmis(['logout', OWN_CLAUDE])
    expect(refused.code).toBe(2)
    expect(refused.stderr).toContain(`${ownAlias} is the login plain claude uses and cannot be removed`)
    expect((await world.kurmis(['logout', 'not-a-login'])).code).toBe(1)
  }, 120_000)

  it('deletes the folder a removal left behind when the login is no longer in config.json', async () => {
    const world = await createWorld()
    const work = await world.addClaudeLogin('work@example.com')
    const config = world.readConfig()
    writeFileSync(join(world.data, 'config.json'), JSON.stringify({ ...config, logins: config.logins.filter((login) => login.id !== work.id) }))
    const result = await world.kurmis(['logout', work.id])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain(`Deleted the folder that ${work.id} left behind.`)
    expect(existsSync(work.folder)).toBe(false)
  }, 60_000)
})
