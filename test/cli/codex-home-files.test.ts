// Preparing an extra Codex login's home on real temporary folders: a default home with
// settings, secrets, folders to share and to keep out, and a login home prepared from it and
// refreshed after it changes. HOME, USERPROFILE and KURMIS_HOME point at a fresh temporary
// folder in every test, and CODEX_HOME is only ever set in the `env` passed in.
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { tomlValue } from '../../src/core/codex-account-config.ts'
import { codexSourceHome, prepareCodexHome, writeIfUnchanged } from '../../src/cli/codex-home-files.ts'
import { codexMergedRecordPath, loginFolder } from '../../src/data/paths.ts'
import { normaliseLinkTarget } from '../../src/platform/links.ts'
import { canCreateSymlinks, linkFolder } from '../host.ts'

// Windows has no folder permissions that chmod could change.
const posixOnly = test.skipIf(process.platform === 'win32')
const windows = process.platform === 'win32'

/** A link's target as kurmis reads it back: without the `\\?\` prefix a Windows junction may have. */
function linkTarget(path: string): string {
  return normaliseLinkTarget(readlinkSync(path), process.platform)
}

const SOURCE_CONFIG = `# the default home's settings
model = "gpt-a"
approval_policy = "on-request"

[mcp_servers.demo]
command = "demo-server"

[mcp_servers.demo.env]
API_KEY = "DEFAULT_SECRET_CANARY"

[projects."/work/example"]
trust_level = "trusted"

[projects."/work/other"]
trust_level = "untrusted"

[hooks.state."demo-hook"]
trusted_hash = "sha256:0000"
enabled = true
`

let root: string
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, KURMIS_HOME: process.env.KURMIS_HOME }
  root = mkdtempSync(join(tmpdir(), 'kurmis-codex-home-'))
  process.env.HOME = join(root, 'home')
  process.env.USERPROFILE = join(root, 'home')
  process.env.KURMIS_HOME = join(root, 'home', '.kurmis')
  mkdirSync(join(root, 'home'))
})

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 10 })
})

/** A default home with something of every kind in it. */
function makeSourceHome(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.toml'), SOURCE_CONFIG)
  writeFileSync(join(dir, 'AGENTS.md'), '# house rules\n')
  writeFileSync(join(dir, 'auth.json'), '{"tokens":"AUTH_CANARY"}\n')
  writeFileSync(join(dir, 'history.jsonl'), '{}\n')
  writeFileSync(join(dir, 'state_5.sqlite'), '')
  for (const name of ['sessions', 'skills', 'log', 'tmp', '.tmp', 'secrets']) mkdirSync(join(dir, name))
  writeFileSync(join(dir, 'sessions', 'rollout.jsonl'), 'shared\n')
  writeFileSync(join(dir, 'secrets', 'key'), 'SECRET_DIR_CANARY\n')
  mkdirSync(join(root, 'elsewhere'))
  linkFolder(join(root, 'elsewhere'), join(dir, 'rules'))
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('prepareCodexHome', () => {
  test('answers null for the default login and touches nothing', async () => {
    const prepared = await prepareCodexHome('codex:default', { env: {} })
    expect(prepared).toEqual({ codexHome: null, warnings: [] })
    expect(existsSync(join(root, 'home', '.kurmis'))).toBe(false)
  })

  test('throws for an id that is not a Codex login', async () => {
    await expect(prepareCodexHome('claude:work', { env: {} })).rejects.toThrow(/not a Codex login/)
    await expect(prepareCodexHome('codex:../x', { env: {} })).rejects.toThrow()
  })

  test('throws only when the home cannot be created', async () => {
    writeFileSync(join(root, 'home', '.kurmis'), 'a file where the data folder should be')
    await expect(prepareCodexHome('codex:work', { env: {} })).rejects.toThrow(/Could not create the Codex home of codex:work/)
  })

  test('prepares a login home from ~/.codex: links, AGENTS.md and config.toml, and nothing private', async () => {
    const source = join(root, 'home', '.codex')
    makeSourceHome(source)

    const prepared = await prepareCodexHome('codex:work', { env: {} })
    const home = loginFolder('codex:work')

    expect(prepared.codexHome).toBe(home)
    if (!windows) expect(statSync(home).mode & 0o777).toBe(0o700)
    // rules is a link in the default home that leads to a folder, so it is shared through that link.
    for (const name of ['sessions', 'skills', 'log', 'rules']) {
      expect(lstatSync(join(home, name)).isSymbolicLink(), name).toBe(true)
      expect(linkTarget(join(home, name))).toBe(join(source, name))
    }
    expect(read(join(home, 'sessions', 'rollout.jsonl'))).toBe('shared\n')
    expect(readdirSync(home).sort()).toEqual(['AGENTS.md', 'config.toml', 'log', 'rules', 'sessions', 'skills'])
    expect(read(join(home, 'AGENTS.md'))).toBe('# house rules\n')

    const config = read(join(home, 'config.toml'))
    expect(tomlValue(config)).toMatchObject({ model: 'gpt-a', approval_policy: 'on-request', mcp_servers: { demo: { command: 'demo-server' } } })
    expect(config).not.toContain('DEFAULT_SECRET_CANARY')
    if (!windows) expect(statSync(join(home, 'config.toml')).mode & 0o777).toBe(0o600)

    expect(prepared.warnings).toHaveLength(1)
    expect(prepared.warnings[0]).toMatch(/has a secret/)
    expect(JSON.stringify(prepared)).not.toMatch(/CANARY/)
  })

  test('refreshes the login home after the default home changes, keeping the login\'s own secret and comment', async () => {
    const source = join(root, 'home', '.codex')
    makeSourceHome(source)
    await prepareCodexHome('codex:work', { env: {} })
    const home = loginFolder('codex:work')

    // The login gets its own secret and a comment, and the default home changes.
    const own = read(join(home, 'config.toml'))
      .replace('[mcp_servers.demo]\n', '[mcp_servers.demo]\n# the login\'s own note\n')
      .concat('\n[mcp_servers.demo.env]\nAPI_KEY = "LOGIN_SECRET_CANARY"\n')
    writeFileSync(join(home, 'config.toml'), own)
    writeFileSync(join(source, 'config.toml'), SOURCE_CONFIG.replace('gpt-a', 'gpt-b'))
    writeFileSync(join(source, 'AGENTS.md'), '# new house rules\n')
    mkdirSync(join(source, 'memories'))

    const second = await prepareCodexHome('codex:work', { env: {} })

    const config = read(join(home, 'config.toml'))
    expect(tomlValue(config)).toMatchObject({ model: 'gpt-b', mcp_servers: { demo: { env: { API_KEY: 'LOGIN_SECRET_CANARY' } } } })
    expect(config).toContain("# the login's own note")
    expect(config).not.toContain('DEFAULT_SECRET_CANARY')
    expect(read(join(home, 'AGENTS.md'))).toBe('# new house rules\n')
    expect(linkTarget(join(home, 'memories'))).toBe(join(source, 'memories'))
    expect(second.warnings).toEqual([])
    expect(existsSync(join(home, 'auth.json'))).toBe(false)

    // Nothing changed: neither file is written again.
    const before = { config: statSync(join(home, 'config.toml')).ino, agents: statSync(join(home, 'AGENTS.md')).ino }
    const third = await prepareCodexHome('codex:work', { env: {} })
    expect(third.warnings).toEqual([])
    expect({ config: statSync(join(home, 'config.toml')).ino, agents: statSync(join(home, 'AGENTS.md')).ino }).toEqual(before)
    expect(readdirSync(home).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('leaves a real folder where a link should go alone, with a warning', async () => {
    const source = join(root, 'home', '.codex')
    makeSourceHome(source)
    const home = loginFolder('codex:work')
    mkdirSync(join(home, 'skills'), { recursive: true })
    writeFileSync(join(home, 'skills', 'mine.md'), 'the login\'s own\n')
    linkFolder(join(root, 'elsewhere'), join(home, 'log'))

    const prepared = await prepareCodexHome('codex:work', { env: {} })

    expect(read(join(home, 'skills', 'mine.md'))).toBe('the login\'s own\n')
    expect(lstatSync(join(home, 'skills')).isSymbolicLink()).toBe(false)
    expect(linkTarget(join(home, 'log'))).toBe(join(root, 'elsewhere'))
    expect(linkTarget(join(home, 'sessions'))).toBe(join(source, 'sessions'))
    const conflicts = prepared.warnings.filter((line) => line.includes('left as it is and not linked'))
    expect(conflicts).toHaveLength(2)
    expect(conflicts.some((line) => line.includes(join(home, 'skills')))).toBe(true)
    expect(conflicts.some((line) => line.includes(join(home, 'log')))).toBe(true)
  })

  test('takes CODEX_HOME from the env as the default home instead of ~/.codex', async () => {
    const custom = join(root, 'custom-codex')
    mkdirSync(join(custom, 'sessions'), { recursive: true })
    writeFileSync(join(custom, 'AGENTS.md'), '# custom rules\n')
    mkdirSync(join(root, 'home', '.codex', 'skills'), { recursive: true })

    const prepared = await prepareCodexHome('codex:work', { env: { CODEX_HOME: custom } })
    const home = loginFolder('codex:work')

    expect(prepared.warnings).toEqual([])
    expect(linkTarget(join(home, 'sessions'))).toBe(join(custom, 'sessions'))
    expect(existsSync(join(home, 'skills'))).toBe(false)
    expect(read(join(home, 'AGENTS.md'))).toBe('# custom rules\n')
    // There is no config.toml in either home, so the login gets none.
    expect(existsSync(join(home, 'config.toml'))).toBe(false)
  })

  test('prepares an empty home when there is no default home at all', async () => {
    const prepared = await prepareCodexHome('codex:work', { env: {} })
    expect(prepared).toEqual({ codexHome: loginFolder('codex:work'), warnings: [] })
    expect(readdirSync(loginFolder('codex:work'))).toEqual([])
  })

  test('leaves a login config.toml that is not valid TOML as it is, with a warning that repeats nothing of it', async () => {
    makeSourceHome(join(root, 'home', '.codex'))
    const home = loginFolder('codex:work')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'config.toml'), 'model = [\nLOGIN_BROKEN_CANARY')

    const prepared = await prepareCodexHome('codex:work', { env: {} })

    expect(read(join(home, 'config.toml'))).toBe('model = [\nLOGIN_BROKEN_CANARY')
    expect(prepared.warnings.some((line) => line.startsWith(`Could not refresh ${join(home, 'config.toml')}`))).toBe(true)
    expect(JSON.stringify(prepared)).not.toMatch(/CANARY/)
  })

  posixOnly('turns every failing step into a warning when the home cannot be written', async () => {
    if (process.getuid?.() === 0) return
    makeSourceHome(join(root, 'home', '.codex'))
    const home = loginFolder('codex:work')
    mkdirSync(home, { recursive: true })
    chmodSync(home, 0o500)
    try {
      const prepared = await prepareCodexHome('codex:work', { env: {} })
      expect(prepared.codexHome).toBe(home)
      expect(prepared.warnings.filter((line) => line.startsWith('Could not link'))).toHaveLength(4)
      expect(prepared.warnings.some((line) => line.startsWith('Could not copy'))).toBe(true)
      expect(prepared.warnings.some((line) => line.startsWith('Could not refresh'))).toBe(true)
    } finally {
      chmodSync(home, 0o700)
    }
  })
})

describe('prepareCodexHome over several starts', () => {
  const source = (): string => join(root, 'home', '.codex')
  const home = (): string => loginFolder('codex:work')

  test('keeps what Codex wrote into the login\'s config.toml, and keeps the merged copy outside the home', async () => {
    makeSourceHome(source())
    await prepareCodexHome('codex:work', { env: {} })
    const record = codexMergedRecordPath('codex:work')
    if (!windows) expect(statSync(record).mode & 0o777).toBe(0o600)
    expect(read(record)).not.toMatch(/CANARY/)
    expect(record.startsWith(home())).toBe(false)

    // A session on the login picks a model and dismisses a notice; the default home drops a setting.
    const own = read(join(home(), 'config.toml')).replace('model = "gpt-a"', 'model = "gpt-mini"').concat('\n[notice]\nhide_full_access_warning = true\n')
    writeFileSync(join(home(), 'config.toml'), own)
    writeFileSync(join(source(), 'config.toml'), SOURCE_CONFIG.replace('approval_policy = "on-request"\n', ''))
    await prepareCodexHome('codex:work', { env: {} })

    const config = tomlValue(read(join(home(), 'config.toml')))
    expect(config).toMatchObject({ model: 'gpt-mini', notice: { hide_full_access_warning: true } })
    expect(config).not.toHaveProperty('approval_policy')
  })

  test('copies AGENTS.override.md, and removes the copy once the default home has none', async () => {
    makeSourceHome(source())
    writeFileSync(join(source(), 'AGENTS.override.md'), '# override\n')
    await prepareCodexHome('codex:work', { env: {} })
    expect(read(join(home(), 'AGENTS.override.md'))).toBe('# override\n')

    rmSync(join(source(), 'AGENTS.override.md'))
    const second = await prepareCodexHome('codex:work', { env: {} })
    expect(existsSync(join(home(), 'AGENTS.override.md'))).toBe(false)
    expect(second.warnings).toEqual([expect.stringMatching(/has a secret/)])

    // A file kurmis did not put there stays.
    writeFileSync(join(home(), 'AGENTS.override.md'), '# the login\'s own\n')
    await prepareCodexHome('codex:work', { env: {} })
    expect(read(join(home(), 'AGENTS.override.md'))).toBe('# the login\'s own\n')
  })

  test('removes links it made that lead nowhere or to a folder no longer shared, and leaves other links alone', async () => {
    makeSourceHome(source())
    mkdirSync(join(source(), 'memories'))
    mkdirSync(join(source(), '.sandbox'))
    await prepareCodexHome('codex:work', { env: {} })
    expect(lstatSync(join(home(), 'memories')).isSymbolicLink()).toBe(true)
    // A link an earlier kurmis made to the sandbox folder, which is private now.
    linkFolder(join(source(), '.sandbox'), join(home(), '.sandbox'))
    // A link of the user's own that leads nowhere; a dangling symlink needs Developer Mode or an
    // administrator on Windows.
    const dangling = canCreateSymlinks()
    if (dangling) symlinkSync(join(root, 'nowhere', 'my-notes'), join(home(), 'notes'), 'dir')

    rmSync(join(source(), 'memories'), { recursive: true })
    const prepared = await prepareCodexHome('codex:work', { env: {} })

    expect(existsSync(join(home(), 'memories'))).toBe(false)
    expect(existsSync(join(home(), '.sandbox'))).toBe(false)
    expect(existsSync(join(source(), '.sandbox'))).toBe(true)
    if (dangling) expect(lstatSync(join(home(), 'notes')).isSymbolicLink()).toBe(true)
    expect(prepared.warnings.filter((line) => !line.includes('has a secret'))).toEqual([])
  })

  test('replaces an empty folder Codex made with the link, and warns once about a folder with something in it', async () => {
    makeSourceHome(source())
    mkdirSync(join(home(), 'memories'), { recursive: true })
    mkdirSync(join(home(), 'shell_snapshots'))
    writeFileSync(join(home(), 'shell_snapshots', 'one.sh'), 'echo\n')
    mkdirSync(join(source(), 'memories'))
    mkdirSync(join(source(), 'shell_snapshots'))

    const first = await prepareCodexHome('codex:work', { env: {} })
    expect(linkTarget(join(home(), 'memories'))).toBe(join(source(), 'memories'))
    expect(first.warnings.filter((line) => line.includes('not linked'))).toEqual([expect.stringContaining(join(home(), 'shell_snapshots'))])

    const second = await prepareCodexHome('codex:work', { env: {} })
    expect(second.warnings.filter((line) => line.includes('not linked'))).toEqual([])
    expect(read(join(home(), 'shell_snapshots', 'one.sh'))).toBe('echo\n')
  })

  test('gives no warning when two starts link the same folders at once', async () => {
    makeSourceHome(source())
    const both = await Promise.all([prepareCodexHome('codex:work', { env: {} }), prepareCodexHome('codex:work', { env: {} })])
    for (const prepared of both) expect(prepared.warnings.filter((line) => /link/i.test(line))).toEqual([])
    expect(linkTarget(join(home(), 'sessions'))).toBe(join(source(), 'sessions'))
  })

  test('does not use a record left by an earlier login of the same name', async () => {
    mkdirSync(join(root, 'home', '.kurmis', 'codex-merged'), { recursive: true })
    writeFileSync(codexMergedRecordPath('codex:work'), JSON.stringify({ config: 'model = "stale"\n', copied: {}, conflicts: ['sessions'] }))
    mkdirSync(source(), { recursive: true })
    writeFileSync(join(source(), 'config.toml'), 'model = "gpt-a"\n')
    await prepareCodexHome('codex:work', { env: {} })
    expect(JSON.parse(read(codexMergedRecordPath('codex:work')))).toEqual({ config: 'model = "gpt-a"\n', copied: {}, links: {}, conflicts: [] })
  })
})

describe('codexSourceHome', () => {
  test('is CODEX_HOME when set and not empty, else ~/.codex', () => {
    expect(codexSourceHome({ CODEX_HOME: join(root, 'custom') })).toBe(join(root, 'custom'))
    expect(codexSourceHome({ CODEX_HOME: '' })).toBe(join(root, 'home', '.codex'))
    expect(codexSourceHome({})).toBe(join(root, 'home', '.codex'))
  })

  test("is ~/.codex when CODEX_HOME is an extra login's home, inherited from a session on it", () => {
    expect(codexSourceHome({ CODEX_HOME: loginFolder('codex:work') })).toBe(join(root, 'home', '.codex'))
    expect(codexSourceHome({ CODEX_HOME: join(root, 'home', '.kurmis', 'codex') })).toBe(join(root, 'home', '.codex'))
    expect(codexSourceHome({ CODEX_HOME: join(root, 'home', '.kurmis', 'codex-other') })).toBe(join(root, 'home', '.kurmis', 'codex-other'))
  })
})

describe('writeIfUnchanged', () => {
  test('writes a new file, and decides again when the file changed before the rename', async () => {
    const target = join(root, 'config.toml')
    expect(await writeIfUnchanged(target, () => 'first\n', 0o600)).toBe('written')
    expect(read(target)).toBe('first\n')

    // A Codex process writes the file once while kurmis is writing it.
    const seen: Array<string | null> = []
    const outcome = await writeIfUnchanged(target, (current) => {
      seen.push(current)
      if (seen.length === 1) writeFileSync(target, 'written by codex\n')
      return `${current ?? ''}merged\n`
    }, 0o600)

    expect(outcome).toBe('written')
    expect(seen).toEqual(['first\n', 'written by codex\n'])
    expect(read(target)).toBe('written by codex\nmerged\n')
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('gives up after the last attempt when the file keeps changing, and leaves it as the other writer left it', async () => {
    const target = join(root, 'config.toml')
    writeFileSync(target, 'start\n')
    let calls = 0
    const outcome = await writeIfUnchanged(target, () => {
      calls++
      writeFileSync(target, `codex ${String(calls)}\n`)
      return 'kurmis\n'
    }, 0o600)

    expect(outcome).toBe('changing')
    expect(calls).toBe(3)
    expect(read(target)).toBe('codex 3\n')
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  test('writes nothing when the decision is to keep the file', async () => {
    const target = join(root, 'AGENTS.md')
    expect(await writeIfUnchanged(target, () => null, 0o644)).toBe('unchanged')
    expect(existsSync(target)).toBe(false)
  })
})

describe('prepareCodexHome: what a later start keeps', () => {
  const source = (): string => join(root, 'home', '.codex')
  const home = (): string => loginFolder('codex:work')

  test("keeps the login's own settings when the default home's config.toml appears after the login was made", async () => {
    mkdirSync(join(source(), 'sessions'), { recursive: true })
    await prepareCodexHome('codex:work', { env: {} })
    // Sessions on the login write its own settings, an MCP server with a secret among them.
    const own = 'model = "own"\n[mcp_servers.mine]\ncommand = "mine"\n[mcp_servers.mine.env]\nK = "LOGIN_CANARY"\n'
    writeFileSync(join(home(), 'config.toml'), own)
    await prepareCodexHome('codex:work', { env: {} })
    writeFileSync(join(source(), 'config.toml'), 'approval_policy = "never"\n')

    const prepared = await prepareCodexHome('codex:work', { env: {} })

    expect(tomlValue(read(join(home(), 'config.toml')))).toEqual({
      model: 'own',
      approval_policy: 'never',
      mcp_servers: { mine: { command: 'mine', env: { K: 'LOGIN_CANARY' } } }
    })
    expect(prepared.warnings).toEqual([])
  })

  // A symlink to a file and a dangling symlink need Developer Mode or an administrator on Windows.
  test.runIf(canCreateSymlinks())("leaves the user's own links alone: one to a file in the default home, and one that leads nowhere", async () => {
    makeSourceHome(source())
    writeFileSync(join(source(), 'hooks.json'), '{}\n')
    await prepareCodexHome('codex:work', { env: {} })
    symlinkSync(join(source(), 'hooks.json'), join(home(), 'hooks.json'), 'file')
    // A link into a volume that is not mounted now; its target has the link's own name.
    symlinkSync(join(root, 'unmounted', 'prompts'), join(home(), 'prompts'), 'dir')

    const prepared = await prepareCodexHome('codex:work', { env: {} })

    expect(linkTarget(join(home(), 'hooks.json'))).toBe(join(source(), 'hooks.json'))
    expect(linkTarget(join(home(), 'prompts'))).toBe(join(root, 'unmounted', 'prompts'))
    expect(prepared.warnings.filter((line) => !line.includes('has a secret'))).toEqual([])
  })

  test('removes a link it made into a default home used before, once that home is gone', async () => {
    const old = join(root, 'old-codex')
    mkdirSync(join(old, 'memories'), { recursive: true })
    await prepareCodexHome('codex:work', { env: { CODEX_HOME: old } })
    expect(linkTarget(join(home(), 'memories'))).toBe(join(old, 'memories'))
    rmSync(old, { recursive: true, maxRetries: 10 })
    mkdirSync(join(source(), 'memories'), { recursive: true })

    const prepared = await prepareCodexHome('codex:work', { env: {} })

    expect(linkTarget(join(home(), 'memories'))).toBe(join(source(), 'memories'))
    expect(prepared.warnings).toEqual([])
  })

  test('gives no warning when two starts replace the same empty folders with links at once', async () => {
    makeSourceHome(source())
    for (let round = 0; round < 5; round++) {
      rmSync(home(), { recursive: true, force: true, maxRetries: 10 })
      for (const name of ['sessions', 'skills', 'log']) mkdirSync(join(home(), name), { recursive: true })
      const both = await Promise.all([prepareCodexHome('codex:work', { env: {} }), prepareCodexHome('codex:work', { env: {} })])
      for (const prepared of both) expect(prepared.warnings.filter((line) => /link/i.test(line))).toEqual([])
      expect(linkTarget(join(home(), 'sessions'))).toBe(join(source(), 'sessions'))
    }
  })
})
