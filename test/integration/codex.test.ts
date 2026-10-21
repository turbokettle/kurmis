// `kurmis codex` end to end: the real bundle prepares an extra login's CODEX_HOME from the world's
// ~/.codex and starts the fake codex with it, and on Auto picks the login by the usage the
// daemon read with the fake `codex app-server`.
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normaliseLinkTarget } from '../../src/platform/links.ts'
import { writeCodexAuth, writeCodexScenario, type FakeCodexRecord } from '../fakes/index.ts'
import { createWorld, OWN_CLAUDE, OWN_CODEX, waitUntil, type World } from './harness.ts'

const DEFAULT_CONFIG = `# The settings in ~/.codex
model = "gpt-5"
approval_policy = "on-request"

[mcp_servers.docs]
command = "docs-server"
args = ["--port", "4000"]

[mcp_servers.docs.env]
DOCS_API_KEY = "sk-fake-docs-0123456789abcdef"

[projects."/work/shared"]
trust_level = "trusted"
`

/** The id of the extra Codex login of these tests, whose alias is `work`. */
const WORK = 'codexwork1'
const WORK_LOGIN = { id: WORK, provider: 'codex', alias: 'work' } as const

/** The world's ~/.codex: folders to link, folders that stay private, the two files, and a sign-in. */
function writeDefaultCodexHome(world: World): string {
  const codexHome = join(world.home, '.codex')
  for (const folder of ['sessions', 'skills', 'tmp', '.tmp', 'secrets', 'log']) mkdirSync(join(codexHome, folder), { recursive: true })
  writeFileSync(join(codexHome, 'sessions', 'rollout-1.jsonl'), '{"made":"up"}\n')
  writeFileSync(join(codexHome, 'history.jsonl'), '{"made":"up"}\n')
  writeFileSync(join(codexHome, 'AGENTS.md'), '# Shared instructions\n')
  writeFileSync(join(codexHome, 'config.toml'), DEFAULT_CONFIG)
  writeCodexAuth(codexHome, { email: 'default-codex@example.com' })
  return codexHome
}

/** The start lines of the fake codex runs that were not usage probes. */
function sessionStarts(world: World): Array<Extract<FakeCodexRecord, { event: 'start' }>> {
  return world.codexRecord().filter((line): line is Extract<FakeCodexRecord, { event: 'start' }> => line.event === 'start' && line.mode === 'other')
}

describe('kurmis codex', () => {
  it('prepares the home of an extra Codex login from ~/.codex and starts codex with it', async () => {
    const world = await createWorld({ config: { extras: [WORK_LOGIN] } })
    const codexHome = writeDefaultCodexHome(world)
    const home = world.loginFolder('codex', WORK)

    const result = await world.kurmis(['codex', '--login', 'codex:work', 'exec', '--json', 'hello'], { env: { FAKE_CODEX_EXIT_CODE: '3' } })
    expect(result.code, result.stderr).toBe(3)
    expect(result.stdout).toContain('fake-codex:')

    const starts = sessionStarts(world)
    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ argv: ['exec', '--json', 'hello'], codexHome: home, authFile: false })
    expect(starts[0]!.envNames).toContain('CODEX_HOME')
    expect(starts[0]!.envNames.filter((name) => name.startsWith('ANTHROPIC_'))).toEqual([])

    // Windows has no mode bits.
    if (process.platform !== 'win32') expect(statSync(home).mode & 0o777).toBe(0o700)
    // The real folders are linked, except scratch folders and a name that says it holds secrets.
    for (const folder of ['sessions', 'skills', 'log']) {
      expect(lstatSync(join(home, folder)).isSymbolicLink(), folder).toBe(true)
      expect(normaliseLinkTarget(readlinkSync(join(home, folder)), process.platform)).toBe(join(codexHome, folder))
    }
    for (const name of ['tmp', '.tmp', 'secrets', 'auth.json', 'history.jsonl', 'fake-codex-scenario.json']) {
      expect(existsSync(join(home, name)), name).toBe(false)
    }
    expect(readFileSync(join(home, 'sessions', 'rollout-1.jsonl'), 'utf8')).toBe('{"made":"up"}\n')

    // AGENTS.md is a copy, config.toml a merge without the secret.
    expect(lstatSync(join(home, 'AGENTS.md')).isFile()).toBe(true)
    expect(readFileSync(join(home, 'AGENTS.md'), 'utf8')).toBe('# Shared instructions\n')
    const merged = readFileSync(join(home, 'config.toml'), 'utf8')
    if (process.platform !== 'win32') expect(statSync(join(home, 'config.toml')).mode & 0o777).toBe(0o600)
    expect(merged).toContain('model = "gpt-5"')
    expect(merged).toContain('approval_policy = "on-request"')
    expect(merged).toContain('command = "docs-server"')
    expect(merged).toContain('[projects."/work/shared"]')
    expect(merged).not.toContain('sk-fake-docs')
    expect(merged).not.toContain('DOCS_API_KEY')
    expect(result.stderr).toContain('has a secret, such as an MCP server\'s env table')
    // ~/.codex is as it was.
    expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toBe(DEFAULT_CONFIG)

    // --login needs no daemon.
    expect(world.daemonInfo()).toBeNull()
  }, 90_000)

  it("keeps the login's own trust and secrets when it prepares the home again", async () => {
    const world = await createWorld({ config: { extras: [WORK_LOGIN] } })
    writeDefaultCodexHome(world)
    const home = world.loginFolder('codex', WORK)
    expect((await world.kurmis(['codex', '--login', 'work', 'resume', '--last'])).code).toBe(0)

    // A session on the login marked the folder untrusted and gave the MCP server its own key.
    const own = readFileSync(join(home, 'config.toml'), 'utf8')
      .replace(/(\[projects\."\/work\/shared"\]\s*\ntrust_level = )"trusted"/, '$1"untrusted"') +
      '\n[mcp_servers.docs.env]\nDOCS_API_KEY = "sk-fake-work-0123456789abcdef"\n'
    expect(own).toContain('trust_level = "untrusted"')
    writeFileSync(join(home, 'config.toml'), own)
    // And ~/.codex changed its model.
    const defaultConfig = join(world.home, '.codex', 'config.toml')
    writeFileSync(defaultConfig, readFileSync(defaultConfig, 'utf8').replace('model = "gpt-5"', 'model = "gpt-5.1"'))

    const again = await world.kurmis(['codex', '--login', 'codex:work', 'resume', '--last'])
    expect(again.code, again.stderr).toBe(0)
    const merged = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(merged).toContain('model = "gpt-5.1"')
    expect(merged).toContain('trust_level = "untrusted"')
    expect(merged).not.toContain('trust_level = "trusted"')
    expect(merged).toContain('DOCS_API_KEY = "sk-fake-work-0123456789abcdef"')
    expect(merged).not.toContain('sk-fake-docs')
    expect(again.stderr).not.toContain('has a secret')
    expect(sessionStarts(world).map((start) => start.codexHome)).toEqual([home, home])
  }, 90_000)

  it("starts the login plain codex uses with CODEX_HOME as inherited, dropping one that is a login home of kurmis", async () => {
    const world = await createWorld({ config: { extras: [WORK_LOGIN] } })
    writeDefaultCodexHome(world)
    const own = join(world.root, 'own-codex-home')
    mkdirSync(own)

    const plain = await world.kurmis(['codex', '--login', OWN_CODEX, 'exec', 'one'])
    const inherited = await world.kurmis(['codex', '--login', `codex:${OWN_CODEX}`, 'exec', 'two'], { env: { CODEX_HOME: own } })
    const nested = await world.kurmis(['codex', '--login', OWN_CODEX, 'exec', 'three'], { env: { CODEX_HOME: world.loginFolder('codex', WORK) } })
    for (const result of [plain, inherited, nested]) expect(result.code, result.stderr).toBe(0)
    expect(sessionStarts(world).map((start) => [start.argv.at(-1), start.codexHome])).toEqual([['one', null], ['two', own], ['three', null]])
    // The login plain codex uses has no home of its own to prepare.
    expect(existsSync(join(world.data, 'codex', OWN_CODEX))).toBe(false)
  }, 90_000)

  it('refuses a --login that is not a Codex login in config.json', async () => {
    const world = await createWorld()
    const missing = await world.kurmis(['codex', '--login', 'codex:nobody', 'exec', 'hi'])
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('there is no Codex login called "nobody"')
    const claude = await world.kurmis(['codex', '--login', OWN_CLAUDE, 'exec', 'hi'])
    expect(claude.code).toBe(1)
    expect(claude.stderr).toContain(`"${OWN_CLAUDE}" is a Claude login; this takes a Codex login`)
    expect(sessionStarts(world)).toEqual([])
    expect(existsSync(world.loginFolder('codex', 'nobody'))).toBe(false)
  }, 60_000)

  it('on Auto starts on the login the daemon reads room on', async () => {
    const world = await createWorld({ config: { extras: [WORK_LOGIN] } })
    const codexHome = writeDefaultCodexHome(world)
    const work = world.loginFolder('codex', WORK)
    writeCodexAuth(work, { email: 'work-codex@example.com' })
    // The login plain codex uses is at its five-hour limit; the extra login has room.
    writeCodexScenario(codexHome, { primary: { usedPercent: 100, resetsInSeconds: 600 }, secondary: { usedPercent: 20 } })
    writeCodexScenario(work, { primary: { usedPercent: 10, resetsInSeconds: 3 * 3600 }, secondary: { usedPercent: 5 } })

    // `kurmis codex` itself waits only 5 s for the probes it asks for, which a loaded machine
    // can miss; the daemon's own first probes are awaited here instead.
    expect((await world.kurmis(['daemon', 'start'])).code).toBe(0)
    await waitUntil(async () => (await world.status()).logins.filter((login) => login.provider === 'codex' && login.usage !== null).length === 2,
      30_000, 'the daemon to probe both Codex logins')

    const first = await world.kurmis(['codex', 'exec', 'first'])
    expect(first.code, first.stderr).toBe(0)
    expect(first.stderr).toContain('starting on work.')
    expect(sessionStarts(world).at(-1)).toMatchObject({ argv: ['exec', 'first'], codexHome: work, authFile: true })
    // The daemon probed both logins, each with its own home.
    const probes = world.codexRecord().filter((line) => line.event === 'start' && line.mode === 'app-server')
    expect(new Set(probes.map((line) => line.event === 'start' ? line.codexHome : 'none'))).toEqual(new Set([null, work]))

    const status = await world.status()
    const usageOf = (id: string): number | undefined => status.logins.find((login) => login.id === id)?.usage?.windows.find((window) => window.key === 'codex:primary')?.utilization
    expect([usageOf(OWN_CODEX), usageOf(WORK)]).toEqual([100, 10])
    expect(status.codexStart).toEqual({ login: WORK, alias: 'work', note: null })

    // With the extra login's limit at 5%, both are out: it starts on the one whose usage is back first.
    expect((await world.kurmis(['set', 'codex:work', '--five-hour', '5'])).code).toBe(0)
    // set told the running daemon to reload.
    expect((await world.status()).logins.find((login) => login.id === WORK)?.fiveHourLimit).toBe(5)
    const second = await world.kurmis(['codex', 'exec', 'second'])
    expect(second.code, second.stderr).toBe(0)
    expect(second.stderr).toMatch(/Every Codex login is at its limit; starting on default-codex-example, whose usage comes back first \(in \d+m\)/)
    expect(sessionStarts(world).at(-1)).toMatchObject({ argv: ['exec', 'second'], codexHome: null })

    // With its limit back, the extra login has room again (and is marked use-first).
    expect((await world.kurmis(['set', 'codex:work', '--five-hour', '100', '--use-first', 'on'])).code).toBe(0)
    const third = await world.kurmis(['codex', 'exec', 'third'])
    expect(third.code, third.stderr).toBe(0)
    expect(sessionStarts(world).at(-1)).toMatchObject({ argv: ['exec', 'third'], codexHome: work })
  }, 120_000)
})
