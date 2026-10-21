// `kurmis login`, `logout`, `set` and `list` end to end: the real bundle runs the fake claude's
// `auth login|logout` and the fake codex's `login|logout`, and writes the world's config.json
// and login folders.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normaliseLinkTarget } from '../../src/platform/links.ts'
import { readClaudeCredentials, writeCodexAuth } from '../fakes/index.ts'
import { createWorld, type World } from './harness.ts'

/** The text of config.json, to check that nothing outside kurmis' settings is in it. */
function configText(world: World): string {
  return readFileSync(join(world.data, 'config.json'), 'utf8')
}

function loginIds(world: World): unknown[] {
  return world.readConfig().logins.map((login) => login.id)
}

describe('kurmis login, set, list and logout', () => {
  it('adds a Claude login with its own folder and config entry, without the email', async () => {
    const world = await createWorld()
    const added = await world.kurmis(['login', 'claude', '--name', 'work', '--label', 'Work'], { env: { FAKE_CLAUDE_EMAIL: 'work@example.com' } })
    expect(added.code, added.stderr).toBe(0)
    expect(added.stdout).toContain('Signed in claude:work as work@example.com.')
    expect(added.stdout).toContain('Added claude:work with the label "Work"')

    // The fake signed in with the login's folder as its config folder.
    const folder = world.loginFolder('claude:work')
    // Windows has no mode bits.
    if (process.platform !== 'win32') expect(statSync(folder).mode & 0o777).toBe(0o700)
    expect(readClaudeCredentials(folder)?.accessToken).toMatch(/^sk-ant-oat01-fake-/)
    expect(world.claudeRecord().filter((line) => line.kind === 'login')).toEqual([expect.objectContaining({ credentialsDir: folder })])
    // ~/.claude stays the machine's own.
    expect(existsSync(join(world.home, '.claude', '.credentials.json'))).toBe(false)

    expect(world.readConfig().logins).toContainEqual({
      id: 'claude:work', provider: 'claude', label: 'Work', routing: true, fiveHourLimit: 100, weeklyLimit: 100, useFirst: false
    })
    expect(configText(world)).not.toContain('example.com')

    // Without --name the first free number is taken, and the label is the name.
    const second = await world.kurmis(['login', 'claude'], { env: { FAKE_CLAUDE_EMAIL: 'second@example.com' } })
    expect(second.code, second.stderr).toBe(0)
    expect(second.stdout).toContain('Added claude:2 with the label "2"')
    expect(loginIds(world)).toEqual(['claude:default', 'codex:default', 'claude:work', 'claude:2'])

    const listed = await world.kurmis(['list', '--json'])
    expect(listed.code, listed.stderr).toBe(0)
    const logins = JSON.parse(listed.stdout) as Array<Record<string, unknown>>
    expect(logins.map((login) => [login.id, login.credentials])).toEqual([
      ['claude:default', false], ['codex:default', false], ['claude:work', true], ['claude:2', true]
    ])
    expect(listed.stdout).not.toContain('example.com')

    const table = await world.kurmis(['list'])
    expect(table.code, table.stderr).toBe(0)
    const lines = table.stdout.trimEnd().split('\n')
    expect(lines[0]!.split(/\s+/)).toEqual(['ID', 'LABEL', 'AUTO', 'FIVE-HOUR', 'WEEKLY', 'USE-FIRST', 'CREDENTIALS'])
    expect(lines.find((line) => line.startsWith('claude:work'))!.split(/\s+/)).toEqual(['claude:work', 'Work', 'on', '100%', '100%', 'off', 'yes'])

    // None of these commands needs or starts the daemon.
    expect(world.daemonInfo()).toBeNull()
  }, 90_000)

  it('refuses a login name that is taken or not a name, and adds nothing', async () => {
    const world = await createWorld()
    await world.addClaudeLogin('work')
    const before = configText(world)

    const taken = await world.kurmis(['login', 'claude', '--name', 'work'])
    expect(taken.code).toBe(2)
    expect(taken.stderr).toContain('there is already a login claude:work')
    const invalid = await world.kurmis(['login', 'claude', '--name', 'Not A Name'])
    expect(invalid.code).toBe(2)
    expect(invalid.stderr).toContain('is not a login name')
    const unknown = await world.kurmis(['login', 'gemini'])
    expect(unknown.code).toBe(2)

    expect(configText(world)).toBe(before)
    // Only the one successful sign-in ran the fake.
    expect(world.claudeRecord().filter((line) => line.kind === 'login')).toHaveLength(1)
  }, 90_000)

  it('adds nothing and leaves no folder when the sign-in fails', async () => {
    const world = await createWorld()
    const before = configText(world)
    const result = await world.kurmis(['login', 'claude', '--name', 'broken'], { env: { FAKE_CLAUDE_LOGIN: 'fail' } })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('claude:broken was not added')
    expect(existsSync(world.loginFolder('claude:broken'))).toBe(false)
    expect(configText(world)).toBe(before)
  }, 60_000)

  it('keeps an existing login, its folder and its credentials when signing it in again fails', async () => {
    const world = await createWorld()
    const token = await world.addClaudeLogin('work', { label: 'Work' })
    const before = configText(world)
    const result = await world.kurmis(['login', 'claude:work'], { env: { FAKE_CLAUDE_LOGIN: 'fail' } })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('"claude auth login" failed (exit code 1).')
    expect(result.stderr).not.toContain('was not added')
    expect(readClaudeCredentials(world.loginFolder('claude:work'))?.accessToken).toBe(token)
    expect(configText(world)).toBe(before)

    // Signing in again with a new label keeps the other settings and changes the label.
    expect((await world.kurmis(['set', 'claude:work', '--five-hour', '70'])).code).toBe(0)
    const again = await world.kurmis(['login', 'claude:work', '--label', 'Work again'], { env: { FAKE_CLAUDE_EMAIL: 'work-again@example.com' } })
    expect(again.code, again.stderr).toBe(0)
    expect(again.stdout).toContain('Signed in claude:work as work-again@example.com.')
    expect(world.readConfig().logins).toContainEqual(expect.objectContaining({ id: 'claude:work', label: 'Work again', fiveHourLimit: 70 }))
    expect(readClaudeCredentials(world.loginFolder('claude:work'))?.accessToken).not.toBe(token)
    expect(configText(world)).not.toContain('example.com')
  }, 90_000)

  it('signs the machine\'s own claude:default in again in ~/.claude, without a folder of its own', async () => {
    const world = await createWorld()
    const before = configText(world)
    const result = await world.kurmis(['login', 'claude:default'], { env: { FAKE_CLAUDE_EMAIL: 'own@example.com' } })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('Signed in claude:default as own@example.com.')
    expect(result.stdout).not.toContain('Added')
    expect(world.claudeRecord().filter((line) => line.kind === 'login')).toEqual([expect.objectContaining({ credentialsDir: join(world.home, '.claude') })])
    expect(readFileSync(join(world.home, '.claude.json'), 'utf8')).toContain('own@example.com')
    expect(existsSync(join(world.data, 'claude', 'default'))).toBe(false)
    // The default login is always there, so nothing is written.
    expect(configText(world)).toBe(before)
    const listed = JSON.parse((await world.kurmis(['list', '--json'])).stdout) as Array<{ id: string; credentials: boolean }>
    expect(listed.find((login) => login.id === 'claude:default')?.credentials).toBe(true)
  }, 60_000)

  it('changes settings with set and refuses wrong options without changing config.json', async () => {
    const world = await createWorld()
    await world.addClaudeLogin('work')

    const changed = await world.kurmis(['set', 'work', '--auto', 'off', '--five-hour', '80', '--weekly', '90', '--use-first', 'on', '--label', '  Work two  '])
    expect(changed.code, changed.stderr).toBe(0)
    expect(changed.stdout.split('\n').map((line) => line.trim().split(/\s+/).join(' '))).toEqual(expect.arrayContaining([
      'claude:work', 'label Work two', 'auto off', 'five-hour 80%', 'weekly 90%', 'use-first on'
    ]))
    expect(world.readConfig().logins).toContainEqual({
      id: 'claude:work', provider: 'claude', label: 'Work two', routing: false, fiveHourLimit: 80, weeklyLimit: 90, useFirst: true
    })
    // The default logins can be set too.
    expect((await world.kurmis(['set', 'claude:default', '--weekly', '50'])).code).toBe(0)
    expect(world.readConfig().logins).toContainEqual(expect.objectContaining({ id: 'claude:default', weeklyLimit: 50 }))

    const before = configText(world)
    const refusals: Array<[string[], string]> = [
      [['set', 'claude:work'], 'give at least one of'],
      [['set', 'claude:work', '--five-hour', '0'], '--five-hour takes a whole number from 1 to 100, not "0"'],
      [['set', 'claude:work', '--five-hour', '101'], 'not "101"'],
      [['set', 'claude:work', '--weekly', '5.5'], '--weekly takes a whole number from 1 to 100, not "5.5"'],
      [['set', 'claude:work', '--weekly', 'lots'], 'not "lots"'],
      [['set', 'claude:work', '--auto', 'maybe'], '--auto takes on or off, not "maybe"'],
      [['set', 'claude:work', '--use-first', 'yes'], '--use-first takes on or off'],
      [['set', 'claude:work', '--label', '   '], '--label takes 1 to 64 characters'],
      [['set', 'claude:work', '--label', 'x'.repeat(65)], '--label takes 1 to 64 characters'],
      [['set', 'claude:nobody', '--auto', 'on'], 'there is no login claude:nobody'],
      [['set', 'nobody', '--auto', 'on'], 'there is no login named "nobody"'],
      [['set', 'claude:Bad', '--auto', 'on'], 'is not a login id'],
      [['set', '--auto', 'on'], 'takes one login id'],
      [['set', 'claude:work', '--colour', 'blue'], '--colour']
    ]
    // None of them writes anything, so they can run at once.
    const results = await Promise.all(refusals.map(async ([args]) => world.kurmis(args)))
    refusals.forEach(([args, message], index) => {
      expect({ args, code: results[index]!.code }).toEqual({ args, code: 2 })
      expect(results[index]!.stderr).toContain(message)
    })
    expect(configText(world)).toBe(before)
  }, 120_000)

  it('asks for the full id when a name belongs to a Claude and a Codex login', async () => {
    const world = await createWorld({ config: { logins: [{ id: 'claude:work' }, { id: 'codex:work' }] } })
    const result = await world.kurmis(['set', 'work', '--auto', 'off'])
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('"work" could be claude:work or codex:work; give the full id')
    expect((await world.kurmis(['set', 'codex:work', '--auto', 'off'])).code).toBe(0)
    expect(world.readConfig().logins).toContainEqual(expect.objectContaining({ id: 'codex:work', routing: false }))
    expect(world.readConfig().logins).toContainEqual(expect.objectContaining({ id: 'claude:work', routing: true }))
  }, 60_000)

  it('logs a Claude login out: signs it out, removes its folder and config entry, and a running daemon drops it', async () => {
    const world = await createWorld()
    world.signInDefaultClaude()
    await world.addClaudeLogin('work')
    const folder = world.loginFolder('claude:work')
    const started = await world.kurmis(['daemon', 'start'])
    expect(started.code, started.stderr).toBe(0)
    expect((await world.status()).logins.map((login) => login.id)).toContain('claude:work')

    const result = await world.kurmis(['logout', 'claude:work'])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('Removed claude:work.')
    expect(world.claudeRecord().filter((line) => line.kind === 'logout')).toEqual([expect.objectContaining({ credentialsDir: folder })])
    expect(existsSync(folder)).toBe(false)
    expect(loginIds(world)).toEqual(['claude:default', 'codex:default'])
    // The daemon was told to reload, so it no longer lists the login.
    expect((await world.status()).logins.map((login) => login.id)).not.toContain('claude:work')
    // The machine's own login is untouched.
    expect(existsSync(join(world.home, '.claude', '.credentials.json'))).toBe(true)

    const again = await world.kurmis(['logout', 'claude:work'])
    expect(again.code).toBe(1)
    expect(again.stderr).toContain('there is no login claude:work')
    for (const id of ['claude:default', 'codex:default']) {
      const refused = await world.kurmis(['logout', id])
      expect(refused.code).toBe(2)
      expect(refused.stderr).toContain(`${id} is the machine's own login and cannot be removed`)
    }
    expect((await world.kurmis(['logout', 'not-an-id'])).code).toBe(2)
  }, 120_000)

  it('deletes the folder a removal left behind when the login is no longer in config.json', async () => {
    const world = await createWorld()
    await world.addClaudeLogin('work')
    const config = world.readConfig()
    writeFileSync(join(world.data, 'config.json'), JSON.stringify({ ...config, logins: config.logins.filter((login) => login.id !== 'claude:work') }))
    const result = await world.kurmis(['logout', 'claude:work'])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('Deleted the folder that claude:work left behind.')
    expect(existsSync(world.loginFolder('claude:work'))).toBe(false)
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

describe('Codex logins and the folders they link to', () => {
  it('logs a Codex login out without deleting what its links point to', async () => {
    const world = await createWorld()
    const codexHome = writeDefaultCodexHome(world)
    const before = filesBelow(codexHome)
    // The fake codex's `login` writes nothing, so the login's own sign-in is put there first, as
    // `codex login` would have left it.
    const folder = world.loginFolder('codex:work')
    writeCodexAuth(folder, { email: 'work-codex@example.com' })

    const added = await world.kurmis(['login', 'codex:work'])
    expect(added.code, added.stderr).toBe(0)
    expect(added.stdout).toContain('Signed in codex:work.')
    expect(configText(world)).not.toContain('example.com')
    const loginRun = world.codexRecord().find((line) => line.event === 'start' && line.argv[0] === 'login')
    expect(loginRun).toMatchObject({ codexHome: folder, authFile: true })
    // The home was prepared before the sign-in.
    expect(lstatSync(join(folder, 'sessions')).isSymbolicLink()).toBe(true)
    expect(normaliseLinkTarget(readlinkSync(join(folder, 'sessions')), process.platform)).toBe(join(codexHome, 'sessions'))
    expect(lstatSync(join(folder, 'skills')).isSymbolicLink()).toBe(true)

    // A session on the login writes its rollout into the shared folder.
    writeFileSync(join(folder, 'sessions', '2026', '10', 'rollout-2.jsonl'), '{"made":"up too"}\n')

    const removed = await world.kurmis(['logout', 'codex:work'])
    expect(removed.code, removed.stderr).toBe(0)
    expect(removed.stdout).toContain('Removed codex:work.')
    expect(world.codexRecord().find((line) => line.event === 'start' && line.argv[0] === 'logout')).toMatchObject({ codexHome: folder })
    expect(existsSync(folder)).toBe(false)
    expect(loginIds(world)).toEqual(['claude:default', 'codex:default'])
    expect(filesBelow(codexHome)).toEqual({ ...before, 'sessions/2026/10/rollout-2.jsonl': '{"made":"up too"}\n' })
  }, 90_000)

  it('removes the home a failed Codex sign-in prepared without deleting what its links point to', async () => {
    const world = await createWorld()
    const codexHome = writeDefaultCodexHome(world)
    const before = filesBelow(codexHome)
    const configBefore = configText(world)

    // The fake codex's `login` exits 0 without writing auth.json: signed in to nothing.
    const result = await world.kurmis(['login', 'codex'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('"codex login" ended, but codex:2 has no credentials. codex:2 was not added.')
    expect(world.codexRecord().find((line) => line.event === 'start' && line.argv[0] === 'login')).toMatchObject({ codexHome: world.loginFolder('codex:2') })
    expect(existsSync(world.loginFolder('codex:2'))).toBe(false)
    expect(configText(world)).toBe(configBefore)
    expect(filesBelow(codexHome)).toEqual(before)

    // A sign-in that fails outright cleans up the same way.
    const failed = await world.kurmis(['login', 'codex:other'], { env: { FAKE_CODEX_EXIT_CODE: '1' } })
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('"codex login" failed (exit code 1). codex:other was not added.')
    expect(existsSync(world.loginFolder('codex:other'))).toBe(false)
    expect(filesBelow(codexHome)).toEqual(before)
  }, 90_000)
})
