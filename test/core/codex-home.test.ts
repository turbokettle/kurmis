// What preparing an extra Codex login's home decides: which entries of ~/.codex are linked,
// merged, copied or left out, whether a link is in place, and what the login's config.toml
// and AGENTS.md become. The cases follow the original router's tests of the same rules in
// `test/unit/claude-main/codex-accounts.test.ts` and `codex-home-files.test.ts`; the file
// work those tests also cover is not here.
import { describe, expect, test } from 'vitest'
import { tomlValue } from '../../src/core/codex-account-config.ts'
import {
  codexAgentsCopy,
  codexConfigRefresh,
  codexHomeEntryAction,
  codexLinkAction,
  codexPrivateName,
  type CodexConfigRefresh
} from '../../src/core/codex-home.ts'

describe('which entries of the default home a login gets', () => {
  test('links the shared folders, merges config.toml, copies AGENTS.md and never touches auth.json', () => {
    const home: Array<[string, Parameters<typeof codexHomeEntryAction>[1]]> = [
      ['config.toml', 'file'],
      ['AGENTS.md', 'file'],
      ['auth.json', 'file'],
      ['history.jsonl', 'file'],
      ['state_5.sqlite', 'file'],
      ['sessions', 'directory'],
      ['skills', 'directory'],
      ['log', 'directory'],
      ['.tmp', 'directory'],
      ['tmp', 'directory'],
      ['secrets', 'directory']
    ]

    expect(Object.fromEntries(home.map(([name, kind]) => [name, codexHomeEntryAction(name, kind)]))).toEqual({
      'config.toml': 'merge',
      'AGENTS.md': 'copy',
      'auth.json': 'skip',
      'history.jsonl': 'skip',
      'state_5.sqlite': 'skip',
      sessions: 'link',
      skills: 'link',
      log: 'link',
      // Scratch space stays the login's own: two app-servers must not share the lock in it.
      '.tmp': 'skip',
      tmp: 'skip',
      // A folder whose name says it holds credentials is never shared.
      secrets: 'skip'
    })
  })

  test('does not follow a link in the default home, and skips what is neither file nor folder', () => {
    expect(codexHomeEntryAction('rules', 'symlink')).toBe('skip')
    expect(codexHomeEntryAction('config.toml', 'symlink')).toBe('skip')
    expect(codexHomeEntryAction('socket', 'other')).toBe('skip')
  })

  test('matches the two copied files by their exact names', () => {
    expect(codexHomeEntryAction('agents.md', 'file')).toBe('skip')
    expect(codexHomeEntryAction('config.toml.bak', 'file')).toBe('skip')
  })

  test('takes a name as private when it says it holds a credential or a database, in any case', () => {
    for (const name of ['auth.json', 'AUTH.JSON', '.credentials.json', 'secrets.d', '.env', '.env.local', 'vault',
      'my-keychain', 'keyring', 'java.keystore', 'credentials', 'oauth', 'oauth_cache', 'tokens', 'mcp-token.d',
      'state.db', 'cache.sqlite3', 'cert.p12', 'cert.pfx']) {
      expect(codexPrivateName(name), name).toBe(true)
      expect(codexHomeEntryAction(name, 'directory'), name).toBe('skip')
    }
    for (const name of ['sessions', 'skills', 'tokenizer', 'memories', 'rules', 'prompts']) {
      expect(codexPrivateName(name), name).toBe(false)
    }
  })
})

describe('a link in the login home', () => {
  const source = '/home/someone/.codex/sessions'

  test('is created where nothing is', () => {
    expect(codexLinkAction({ kind: 'missing' }, source)).toBe('create')
  })

  test('is left as it is when it already points at the folder, whatever the trailing slash or dots', () => {
    expect(codexLinkAction({ kind: 'link', target: source }, source, 'darwin')).toBe('linked')
    expect(codexLinkAction({ kind: 'link', target: '/home/someone/.codex/sessions/' }, source, 'linux')).toBe('linked')
    expect(codexLinkAction({ kind: 'link', target: '/home/someone/x/../.codex/sessions' }, source, 'darwin')).toBe('linked')
  })

  test('compares paths exactly on macOS and Linux', () => {
    expect(codexLinkAction({ kind: 'link', target: '/HOME/someone/.codex/sessions' }, source, 'darwin')).toBe('conflict')
    expect(codexLinkAction({ kind: 'link', target: '/HOME/someone/.codex/sessions' }, source, 'linux')).toBe('conflict')
  })

  test('compares Windows paths ignoring case, slashes and a trailing separator', () => {
    const windows = 'C:\\Users\\someone\\.codex\\sessions'
    expect(codexLinkAction({ kind: 'link', target: windows }, windows, 'win32')).toBe('linked')
    expect(codexLinkAction({ kind: 'link', target: 'c:\\users\\SOMEONE\\.Codex\\Sessions\\' }, windows, 'win32')).toBe('linked')
    expect(codexLinkAction({ kind: 'link', target: 'C:/Users/someone/.codex/sessions' }, windows, 'win32')).toBe('linked')
    expect(codexLinkAction({ kind: 'link', target: 'D:\\Users\\someone\\.codex\\sessions' }, windows, 'win32')).toBe('conflict')
    expect(codexLinkAction({ kind: 'link', target: '\\\\server\\share\\sessions' }, '\\\\SERVER\\Share\\sessions', 'win32'))
      .toBe('linked')
  })

  test('is a conflict, never replaced, where a real folder or a link elsewhere is', () => {
    expect(codexLinkAction({ kind: 'other' }, source)).toBe('conflict')
    expect(codexLinkAction({ kind: 'link', target: '/somewhere/else' }, source)).toBe('conflict')
    expect(codexLinkAction({ kind: 'other' }, 'C:\\x', 'win32')).toBe('conflict')
  })
})

describe("the login's AGENTS.md", () => {
  test('is copied when the login has none or a different one', () => {
    expect(codexAgentsCopy('# house rules\n', null)).toBe('# house rules\n')
    expect(codexAgentsCopy('# house rules\n', '# edited by hand\n')).toBe('# house rules\n')
  })

  test('is left as it is when it is the same, or the default home has none', () => {
    expect(codexAgentsCopy('# house rules\n', '# house rules\n')).toBeNull()
    expect(codexAgentsCopy(null, '# the login\'s own\n')).toBeNull()
    expect(codexAgentsCopy(null, null)).toBeNull()
  })
})

describe("the login's config.toml", () => {
  const hook = '[hooks.state."k"]\ntrusted_hash = "sha256:own"\n'

  function written(refresh: CodexConfigRefresh): Record<string, unknown> {
    if (refresh.action !== 'write' || refresh.content === null) throw new Error(`expected a write, got ${refresh.action}`)
    return tomlValue(refresh.content)
  }

  test('is copied from the default home when the login has none', () => {
    const refresh = codexConfigRefresh('model = "gpt-a"\n', null)
    expect(refresh).toEqual({ action: 'write', content: 'model = "gpt-a"\n', missingSecrets: false, mergeFailure: null })
  })

  test('takes a setting the default home has since changed, and replaces a hand edit', () => {
    expect(written(codexConfigRefresh('model = "gpt-b"\n', 'model = "edited by hand"\n'))).toEqual({ model: 'gpt-b' })
  })

  test("keeps the login's own secrets, never copies the default home's, and says one is missing", () => {
    const source = 'model = "gpt-b"\n[mcp_servers.demo]\nurl = "https://new.invalid"\n[mcp_servers.demo.env]\nCUSTOM = "DEFAULT_CANARY"\n'
    const own = 'model = "old"\n[mcp_servers.demo]\nurl = "https://old.invalid"\n[mcp_servers.demo.env]\nCUSTOM = "ACCOUNT_CANARY"\n'

    const kept = codexConfigRefresh(source, own)
    expect(kept.action === 'write' && kept.content).toContain('ACCOUNT_CANARY')
    expect(kept.action === 'write' && kept.content).not.toContain('DEFAULT_CANARY')
    expect(kept).toMatchObject({ missingSecrets: false })

    const fresh = codexConfigRefresh(source, null)
    expect(fresh.action === 'write' && fresh.content).not.toContain('DEFAULT_CANARY')
    expect(fresh).toMatchObject({ action: 'write', missingSecrets: true })
  })

  test('is not rewritten when it holds the same settings in another layout', () => {
    expect(codexConfigRefresh('model = "gpt-a"\n', "model   =   'gpt-a'\n"))
      .toEqual({ action: 'keep', content: null, missingSecrets: false, mergeFailure: null })
  })

  // The login's own trust is kept, so with nothing to merge in the file is not touched.
  test('is left as it is, trust included, when the default home has no config.toml', () => {
    const own = `model = "gpt-old"\n${hook}[projects.'e:\\a']\ntrust_level = "trusted"\n`
    expect(codexConfigRefresh(null, own)).toEqual({ action: 'keep', content: null, missingSecrets: false, mergeFailure: null })
    expect(codexConfigRefresh(null, null)).toEqual({ action: 'keep', content: null, missingSecrets: false, mergeFailure: null })
  })

  test("keeps the login's own hook trust when the default home has a file", () => {
    expect(written(codexConfigRefresh('model = "gpt-b"\n', `model = "gpt-a"\n${hook}`)))
      .toEqual({ model: 'gpt-b', hooks: { state: { k: { trusted_hash: 'sha256:own' } } } })
  })

  test('leaves the login file as it is, and says why, when the default home cannot be merged', () => {
    expect(codexConfigRefresh('model = [\n', hook)).toEqual({
      action: 'keep',
      content: null,
      missingSecrets: false,
      mergeFailure: "the default home's config.toml could not be merged in: config.toml is not valid TOML"
    })
  })

  test('leaves a login file that is not TOML as it is, without repeating it', () => {
    const refresh = codexConfigRefresh('model = "gpt-a"\n', 'hooks = [\nSECRET_CANARY')
    expect(refresh).toMatchObject({ action: 'keep', content: null, mergeFailure: expect.stringMatching(/login's config\.toml is not valid TOML/) })
    expect(JSON.stringify(refresh)).not.toContain('CANARY')
    expect(codexConfigRefresh(null, 'hooks = [\n')).toMatchObject({ action: 'keep', mergeFailure: null })
  })
})
