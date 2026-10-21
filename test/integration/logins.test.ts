// `kurmis login`, `logout`, `set` and `list` end to end: the real bundle runs the fake claude's
// `auth login|logout` and the fake codex's `login|logout`, and writes the world's config.json
// and login folders.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normaliseLinkTarget } from '../../src/platform/links.ts'
import { readClaudeCredentials, writeClaudeIdentity, writeCodexAuth } from '../fakes/index.ts'
import { createWorld, OWN_CLAUDE, OWN_CODEX, type World } from './harness.ts'

/** A new login's id: 10 lowercase letters and digits. */
const NEW_ID = /^[a-z0-9]{10}$/

/** The text of config.json, to check that nothing outside kurmis' settings is in it. */
function configText(world: World): string {
  return readFileSync(join(world.data, 'config.json'), 'utf8')
}

function loginIds(world: World): string[] {
  return world.readConfig().logins.map((login) => login.id)
}

/** The folders in the data folder's `claude/` or `codex/`, which hold one folder per extra login. */
function loginFolders(world: World, provider: 'claude' | 'codex'): string[] {
  const parent = join(world.data, provider)
  return existsSync(parent) ? readdirSync(parent) : []
}

/** The folders the fake claude's `auth login` runs signed in to, in order. */
function claudeLoginDirs(world: World): Array<string | null> {
  return world.claudeRecord().flatMap((line) => (line.kind === 'login' ? [line.credentialsDir] : []))
}

describe('kurmis login, set, list and logout', () => {
  it('adds a Claude login in a folder named by its new id, with an alias made from the email, and keeps the email out of config.json', async () => {
    const world = await createWorld()
    const added = await world.kurmis(['login', 'claude'], { env: { FAKE_CLAUDE_EMAIL: 'work@example.com' } })
    expect(added.code, added.stderr).toBe(0)
    const id = /a new Claude login \(id ([a-z0-9]+)\)/.exec(added.stdout)?.[1]
    expect(id).toMatch(NEW_ID)
    expect(added.stdout).toContain('Signed in as work@example.com.')
    expect(added.stdout).toContain(`Added work-example (id ${id!}), a Claude login with Auto routing on and both limits at 100%.`)

    // The fake signed in with the login's folder, named by the id, as its config folder.
    const folder = world.loginFolder('claude', id!)
    // Windows has no mode bits.
    if (process.platform !== 'win32') expect(statSync(folder).mode & 0o777).toBe(0o700)
    expect(readClaudeCredentials(folder)?.accessToken).toMatch(/^sk-ant-oat01-fake-/)
    expect(claudeLoginDirs(world)).toEqual([folder])
    expect(loginFolders(world, 'claude')).toEqual([id])
    // ~/.claude stays the machine's own.
    expect(existsSync(join(world.home, '.claude', '.credentials.json'))).toBe(false)

    expect(world.configLogin(id!)).toEqual({
      id, provider: 'claude', machineOwn: false, alias: 'work-example', aliasSetByUser: false,
      routing: true, fiveHourLimit: 100, weeklyLimit: 100, useFirst: false
    })
    expect(configText(world)).not.toContain('example.com')

    // --alias sets the alias in place of the one the email gives.
    const second = await world.addClaudeLogin('second@example.com', { alias: 'spare' })
    expect(second.id).toMatch(NEW_ID)
    expect(second.id).not.toBe(id)
    expect(second.stdout).toContain(`Added spare (id ${second.id})`)
    expect(world.configLogin(second.id)).toMatchObject({ alias: 'spare', aliasSetByUser: true })
    expect(loginIds(world)).toEqual([OWN_CLAUDE, OWN_CODEX, id, second.id])

    const listed = await world.kurmis(['list', '--json'])
    expect(listed.code, listed.stderr).toBe(0)
    const logins = JSON.parse(listed.stdout) as Array<Record<string, unknown>>
    expect(logins.map((login) => [login.alias, login.id, login.machineOwn, login.credentials])).toEqual([
      [OWN_CLAUDE, OWN_CLAUDE, true, false],
      [OWN_CODEX, OWN_CODEX, true, false],
      ['work-example', id, false, true],
      ['spare', second.id, false, true]
    ])
    expect(listed.stdout).not.toContain('example.com')

    const table = await world.kurmis(['list'])
    expect(table.code, table.stderr).toBe(0)
    const lines = table.stdout.trimEnd().split('\n')
    expect(lines[0]!.split(/\s+/)).toEqual(['PROVIDER', 'ALIAS', 'ID', 'AUTO', 'FIVE-HOUR', 'WEEKLY', 'USE-FIRST', 'CREDENTIALS'])
    expect(lines.find((line) => line.includes(id!))!.split(/\s+/)).toEqual(['claude', 'work-example', id, 'on', '100%', '100%', 'off', 'yes'])
    // The lines under the table mark the machine's own logins.
    expect(lines).toContain(`${OWN_CLAUDE} is this machine's own Claude sign-in: the account a plain "claude" is signed in to.`)
    expect(lines).toContain(`${OWN_CODEX} is this machine's own Codex sign-in: the account a plain "codex" is signed in to.`)

    // None of these commands needs or starts the daemon.
    expect(world.daemonInfo()).toBeNull()
  }, 90_000)

  it('adds nothing and leaves no folder when an account that is already a login signs in again', async () => {
    const world = await createWorld()
    const work = await world.addClaudeLogin('work@example.com')
    const before = configText(world)

    // The emails are compared without regard to case.
    const again = await world.kurmis(['login', 'claude'], { env: { FAKE_CLAUDE_EMAIL: 'WORK@example.com' } })
    expect(again.code, again.stderr).toBe(0)
    expect(again.stdout).toContain(`WORK@example.com is already a kurmis Claude login: work-example (id ${work.id}). ` +
      'No login was added, and the new sign-in was signed out again.')
    expect(again.stdout).toContain('"kurmis login work-example" signs work-example in again.')
    const duplicate = claudeLoginDirs(world)[1]!
    expect(duplicate).not.toBe(work.folder)
    expect(world.claudeRecord().filter((line) => line.kind === 'logout')).toEqual([expect.objectContaining({ credentialsDir: duplicate })])
    expect(existsSync(duplicate)).toBe(false)
    expect(loginFolders(world, 'claude')).toEqual([work.id])
    expect(configText(world)).toBe(before)

    // The account of the machine's own login is found too.
    writeClaudeIdentity(join(world.home, '.claude.json'), { email: 'own@example.com' })
    const own = await world.kurmis(['login', 'claude'], { env: { FAKE_CLAUDE_EMAIL: 'own@example.com' } })
    expect(own.code, own.stderr).toBe(0)
    expect(own.stdout).toContain(`own@example.com is already a kurmis Claude login: ${OWN_CLAUDE}, this machine's own Claude sign-in (id ${OWN_CLAUDE}).`)
    expect(loginFolders(world, 'claude')).toEqual([work.id])
    expect(configText(world)).toBe(before)
  }, 90_000)

  it('refuses an alias that is taken or is not an alias, and adds nothing', async () => {
    const world = await createWorld()
    const work = await world.addClaudeLogin('work@example.com')
    const before = configText(world)

    const refusals: Array<[string[], string]> = [
      [['login', 'claude', '--alias', 'work-example'], 'another Claude login is already called "work-example"'],
      [['login', 'claude', '--alias', 'Not An Alias'], '"Not An Alias" is not an alias'],
      [['login', 'claude', '--alias', 'codex'], '"codex" is not an alias'],
      [['login', 'claude', '--alias', OWN_CODEX], `"${OWN_CODEX}" is the id of another login`],
      [['login', 'claude', '--name', 'work'], '--name'],
      [['login', 'gemini'], 'there is no login called "gemini"']
    ]
    for (const [args, message] of refusals) {
      const result = await world.kurmis(args)
      expect({ args, code: result.code }).toEqual({ args, code: 2 })
      expect(result.stderr).toContain(message)
    }

    expect(configText(world)).toBe(before)
    expect(loginFolders(world, 'claude')).toEqual([work.id])
    // Only the one successful sign-in ran the fake.
    expect(claudeLoginDirs(world)).toHaveLength(1)
  }, 90_000)

  it('adds nothing and leaves no folder when the sign-in fails', async () => {
    const world = await createWorld()
    const before = configText(world)
    const result = await world.kurmis(['login', 'claude'], { env: { FAKE_CLAUDE_LOGIN: 'fail' } })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('"claude auth login" failed (exit code 1). No login was added.')
    const id = /a new Claude login \(id ([a-z0-9]+)\)/.exec(result.stdout)?.[1]
    expect(id).toMatch(NEW_ID)
    expect(world.claudeRecord().filter((line) => line.kind === 'start' && line.argv[0] === 'auth'))
      .toEqual([expect.objectContaining({ credentialsDir: world.loginFolder('claude', id!) })])
    expect(loginFolders(world, 'claude')).toEqual([])
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
    expect(loginIds(world)).toEqual([OWN_CLAUDE, OWN_CODEX, work.id])
    expect(configText(world)).not.toContain('example.com')
  }, 120_000)

  it("signs the machine's own Claude login in again in ~/.claude, without a folder of its own, and gives it an alias from the email", async () => {
    const world = await createWorld()
    const result = await world.kurmis(['login', OWN_CLAUDE], { env: { FAKE_CLAUDE_EMAIL: 'own@example.com' } })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('Signed in as own@example.com.')
    expect(result.stdout).toContain(`${OWN_CLAUDE} is now called own-example.`)
    expect(result.stdout).not.toContain('Added')
    expect(claudeLoginDirs(world)).toEqual([join(world.home, '.claude')])
    expect(readFileSync(join(world.home, '.claude.json'), 'utf8')).toContain('own@example.com')
    expect(loginFolders(world, 'claude')).toEqual([])
    expect(world.configLogin(OWN_CLAUDE)).toMatchObject({ machineOwn: true, alias: 'own-example', aliasSetByUser: false })
    expect(loginIds(world)).toEqual([OWN_CLAUDE, OWN_CODEX])
    expect(configText(world)).not.toContain('example.com')
    const listed = JSON.parse((await world.kurmis(['list', '--json'])).stdout) as Array<{ id: string; alias: string; credentials: boolean }>
    expect(listed.find((login) => login.id === OWN_CLAUDE)).toMatchObject({ alias: 'own-example', credentials: true })
  }, 60_000)

  it("gives the machine's own logins new ids when config.json has none, and refuses a config.json of an older version", async () => {
    const world = await createWorld({ ownLogins: false })
    const listed = await world.kurmis(['list', '--json'])
    expect(listed.code, listed.stderr).toBe(0)
    const logins = JSON.parse(listed.stdout) as Array<{ id: string; alias: string; provider: string; machineOwn: boolean }>
    expect(logins.map((login) => [login.provider, login.machineOwn])).toEqual([['claude', true], ['codex', true]])
    for (const login of logins) {
      expect(login.id).toMatch(NEW_ID)
      expect(login.alias).toBe(login.id)
    }
    expect(logins[0]!.id).not.toBe(logins[1]!.id)
    // The ids were saved, so every later command sees the same ones.
    expect(world.readConfig()).toMatchObject({ version: 2, port: world.port })
    expect(loginIds(world)).toEqual(logins.map((login) => login.id))
    const again = JSON.parse((await world.kurmis(['list', '--json'])).stdout) as Array<{ id: string }>
    expect(again.map((login) => login.id)).toEqual(logins.map((login) => login.id))

    const old = '{"version":1,"logins":[{"id":"claude:work"}]}'
    writeFileSync(join(world.data, 'config.json'), old)
    const refused = await world.kurmis(['list'])
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('was written by an older kurmis (config version 1)')
    expect(configText(world)).toBe(old)
  }, 60_000)

  it('changes settings with set and refuses wrong options without changing config.json', async () => {
    const world = await createWorld()
    const work = await world.addClaudeLogin('work@example.com')

    const changed = await world.kurmis(['set', 'work-example', '--auto', 'off', '--five-hour', '80', '--weekly', '90', '--use-first', 'on', '--alias', 'work'])
    expect(changed.code, changed.stderr).toBe(0)
    expect(changed.stdout.split('\n').map((line) => line.trim().split(/\s+/).join(' '))).toEqual(expect.arrayContaining([
      `work (Claude, id ${work.id})`, 'alias work (set by you)', 'auto off', 'five-hour 80%', 'weekly 90%', 'use-first on'
    ]))
    expect(world.configLogin(work.id)).toEqual({
      id: work.id, provider: 'claude', machineOwn: false, alias: 'work', aliasSetByUser: true,
      routing: false, fiveHourLimit: 80, weeklyLimit: 90, useFirst: true
    })
    // The machine's own logins can be set too, by their id.
    const own = await world.kurmis(['set', OWN_CLAUDE, '--weekly', '50'])
    expect(own.code, own.stderr).toBe(0)
    expect(own.stdout).toContain("this machine's own Claude sign-in")
    expect(world.configLogin(OWN_CLAUDE)).toMatchObject({ weeklyLimit: 50, machineOwn: true })

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
      [['set', 'work', '--alias', OWN_CODEX], `"${OWN_CODEX}" is the id of another login`],
      [['set', 'claude:nobody', '--auto', 'on'], 'there is no Claude login called "nobody"'],
      [['set', 'nobody', '--auto', 'on'], 'there is no login called "nobody"'],
      [['set', 'gemini:work', '--auto', 'on'], '"gemini:work" names no login'],
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
  }, 120_000)

  it('asks for claude: or codex: in front when a Claude and a Codex login have the same alias', async () => {
    const world = await createWorld({ config: { extras: [
      { id: 'claudework', provider: 'claude', alias: 'work' },
      { id: 'codexwork1', provider: 'codex', alias: 'work' }
    ] } })
    const result = await world.kurmis(['set', 'work', '--auto', 'off'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('a Claude login and a Codex login are both called "work"; give claude:work or codex:work')
    expect((await world.kurmis(['set', 'codex:work', '--auto', 'off'])).code).toBe(0)
    // An id names one login on its own.
    expect((await world.kurmis(['set', 'claudework', '--use-first', 'on'])).code).toBe(0)
    expect(world.configLogin('codexwork1')).toMatchObject({ routing: false, useFirst: false })
    expect(world.configLogin('claudework')).toMatchObject({ routing: true, useFirst: true })
  }, 60_000)

  it('logs a Claude login out: signs it out, removes its folder and config entry, and a running daemon drops it', async () => {
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
    expect(loginIds(world)).toEqual([OWN_CLAUDE, OWN_CODEX])
    // The daemon was told to reload, so it no longer lists the login.
    expect((await world.status()).logins.map((login) => login.id)).not.toContain(work.id)
    // The machine's own login is untouched.
    expect(existsSync(join(world.home, '.claude', '.credentials.json'))).toBe(true)

    const again = await world.kurmis(['logout', 'work-example'])
    expect(again.code).toBe(1)
    expect(again.stderr).toContain('there is no login called "work-example"')
    for (const [id, product] of [[OWN_CLAUDE, 'Claude'], [OWN_CODEX, 'Codex']] as const) {
      // The daemon may have given the login an alias from its email by now.
      const alias = world.configLogin(id).alias
      const refused = await world.kurmis(['logout', id])
      expect(refused.code).toBe(2)
      expect(refused.stderr).toContain(`${alias} is this machine's own ${product} sign-in and cannot be removed`)
    }
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

/** A `~/.codex` with folders to link, the two files to copy and merge, and its own sign-in. */
function writeDefaultCodexHome(world: World): string {
  const codexHome = join(world.home, '.codex')
  mkdirSync(join(codexHome, 'sessions', '2026', '10'), { recursive: true })
  writeFileSync(join(codexHome, 'sessions', '2026', '10', 'rollout-1.jsonl'), '{"made":"up"}\n')
  mkdirSync(join(codexHome, 'skills', 'review'), { recursive: true })
  writeFileSync(join(codexHome, 'skills', 'review', 'SKILL.md'), '# Review\n')
  writeFileSync(join(codexHome, 'AGENTS.md'), '# Shared instructions\n')
  writeFileSync(join(codexHome, 'config.toml'), 'model = "gpt-5"\n')
  writeCodexAuth(codexHome, { email: 'default-codex@example.com' })
  return codexHome
}

/** Every file below `folder`, through links, as paths relative to it, with their contents. */
function filesBelow(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`)
      else files[`${prefix}${name}`] = readFileSync(path, 'utf8')
    }
  }
  walk(folder, '')
  return files
}

/** The Codex homes the fake codex's runs of `codex <command>` had, in order. */
function codexHomesOf(world: World, command: string): Array<string | null> {
  return world.codexRecord().flatMap((line) => (line.event === 'start' && line.argv[0] === command && line.argv[1] !== 'status' ? [line.codexHome] : []))
}

describe('Codex logins and the folders they link to', () => {
  it('adds a Codex login with an alias from its email, drops a second sign-in of an account that is already a login, and logs it out without deleting what its links point to', async () => {
    const world = await createWorld()
    const codexHome = writeDefaultCodexHome(world)
    const before = filesBelow(codexHome)

    const work = await world.addCodexLogin({ email: 'work-codex@example.com' })
    expect(work.id).toMatch(NEW_ID)
    expect(work.alias).toBe('work-codex-example')
    expect(work.stdout).toContain('Signed in as work-codex@example.com.')
    expect(work.stdout).toContain(`Added work-codex-example (id ${work.id}), a Codex login`)
    expect(configText(world)).not.toContain('example.com')
    const loginRun = world.codexRecord().find((line) => line.event === 'start' && line.argv[0] === 'login' && line.argv[1] !== 'status')
    expect(loginRun).toMatchObject({ codexHome: work.folder, authFile: true })
    // The home was prepared before the sign-in.
    expect(lstatSync(join(work.folder, 'sessions')).isSymbolicLink()).toBe(true)
    expect(normaliseLinkTarget(readlinkSync(join(work.folder, 'sessions')), process.platform)).toBe(join(codexHome, 'sessions'))
    expect(lstatSync(join(work.folder, 'skills')).isSymbolicLink()).toBe(true)

    // A new sign-in of the machine's own Codex account is signed out again and deleted.
    const signIn = join(world.root, 'own-codex-sign-in')
    const auth = writeCodexAuth(signIn, { email: 'default-codex@example.com' })
    const duplicate = await world.kurmis(['login', 'codex'], { env: { KURMIS_CODEX_BIN: world.codexSignInScript, TEST_CODEX_SIGN_IN: auth } })
    expect(duplicate.code, duplicate.stderr).toBe(0)
    expect(duplicate.stdout).toContain(`default-codex@example.com is already a kurmis Codex login: ${OWN_CODEX}, this machine's own Codex sign-in (id ${OWN_CODEX}).`)
    const dropped = codexHomesOf(world, 'login')[1]!
    expect(dropped).not.toBe(work.folder)
    expect(codexHomesOf(world, 'logout')).toEqual([dropped])
    expect(existsSync(dropped)).toBe(false)
    expect(existsSync(join(world.data, 'codex-merged', `${basename(dropped)}.json`))).toBe(false)
    expect(loginFolders(world, 'codex')).toEqual([work.id])
    expect(loginIds(world)).toEqual([OWN_CLAUDE, OWN_CODEX, work.id])
    expect(filesBelow(codexHome)).toEqual(before)

    // A session on the login writes its rollout into the shared folder.
    writeFileSync(join(work.folder, 'sessions', '2026', '10', 'rollout-2.jsonl'), '{"made":"up too"}\n')

    const removed = await world.kurmis(['logout', 'work-codex-example'])
    expect(removed.code, removed.stderr).toBe(0)
    expect(removed.stdout).toContain(`Removed work-codex-example (id ${work.id}).`)
    expect(codexHomesOf(world, 'logout')).toEqual([dropped, work.folder])
    expect(existsSync(work.folder)).toBe(false)
    expect(loginIds(world)).toEqual([OWN_CLAUDE, OWN_CODEX])
    expect(filesBelow(codexHome)).toEqual({ ...before, 'sessions/2026/10/rollout-2.jsonl': '{"made":"up too"}\n' })
  }, 120_000)

  it('removes the home a failed Codex sign-in prepared without deleting what its links point to', async () => {
    const world = await createWorld()
    const codexHome = writeDefaultCodexHome(world)
    const before = filesBelow(codexHome)
    const configBefore = configText(world)

    // The fake codex's `login` exits 0 without writing auth.json: signed in to nothing.
    const result = await world.kurmis(['login', 'codex'])
    expect(result.code).toBe(1)
    const id = /"codex login" ended, but ([a-z0-9]+) has no credentials\. No login was added\./.exec(result.stderr)?.[1]
    expect(id, result.stderr).toMatch(NEW_ID)
    expect(codexHomesOf(world, 'login')).toEqual([world.loginFolder('codex', id!)])
    expect(loginFolders(world, 'codex')).toEqual([])
    expect(existsSync(join(world.data, 'codex-merged', `${id!}.json`))).toBe(false)
    expect(configText(world)).toBe(configBefore)
    expect(filesBelow(codexHome)).toEqual(before)

    // A sign-in that fails outright cleans up the same way.
    const failed = await world.kurmis(['login', 'codex'], { env: { FAKE_CODEX_EXIT_CODE: '1' } })
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('"codex login" failed (exit code 1). No login was added.')
    expect(codexHomesOf(world, 'login')).toHaveLength(2)
    expect(loginFolders(world, 'codex')).toEqual([])
    expect(configText(world)).toBe(configBefore)
    expect(filesBelow(codexHome)).toEqual(before)
  }, 90_000)
})
