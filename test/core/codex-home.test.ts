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
  codexStaleLink,
  type CodexHomeLink,
  type CodexLinkEnd,
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

  // The sandbox's setup marker is valid only with the passwords beside it, and Codex's sandbox
  // service refuses a home whose sandbox folders are links.
  test('keeps every folder of the Windows sandbox private', () => {
    for (const name of ['.sandbox', '.sandbox-bin', '.sandbox-secrets', '.Sandbox', '.sandbox_cache']) {
      expect(codexHomeEntryAction(name, 'directory'), name).toBe('skip')
      expect(codexHomeEntryAction(name, 'directory-link'), name).toBe('skip')
    }
    expect(codexHomeEntryAction('sandboxes', 'directory')).toBe('link')
  })

  test('links a link in the default home that leads to a folder', () => {
    expect(codexHomeEntryAction('skills', 'directory-link')).toBe('link')
    expect(codexHomeEntryAction('secrets', 'directory-link')).toBe('skip')
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

describe("the login's AGENTS.md and AGENTS.override.md", () => {
  test('are copied when the login has none or a different one', () => {
    expect(codexAgentsCopy('# house rules\n', null, false)).toEqual({ action: 'write', content: '# house rules\n' })
    expect(codexAgentsCopy('# house rules\n', '# edited by hand\n', false)).toEqual({ action: 'write', content: '# house rules\n' })
  })

  test('are left as they are when they are the same, or the default home has none and kurmis did not copy them', () => {
    expect(codexAgentsCopy('# house rules\n', '# house rules\n', true)).toBeNull()
    expect(codexAgentsCopy(null, '# the login\'s own\n', false)).toBeNull()
    expect(codexAgentsCopy(null, null, false)).toBeNull()
  })

  // Codex reads AGENTS.override.md first, so a stale copy would keep overriding.
  test('are removed when the default home no longer has the file and the copy is the one kurmis made', () => {
    expect(codexAgentsCopy(null, '# old override\n', true)).toEqual({ action: 'remove' })
  })

  test('include AGENTS.override.md', () => {
    expect(codexHomeEntryAction('AGENTS.override.md', 'file')).toBe('copy')
  })
})

describe('a stale link in the login home', () => {
  const source = '/home/someone/.codex'
  const link = (name: string, target: string, end: CodexLinkEnd, recorded: string | null = null): CodexHomeLink => ({ name, target, end, recorded })

  test('is one to a folder of the default home no longer shared, or to its place that leads nowhere', () => {
    expect(codexStaleLink(link('memories', '/home/someone/.codex/memories', 'folder'), source, false, 'darwin')).toBe(true)
    expect(codexStaleLink(link('memories', '/home/someone/.codex/memories', 'nothing'), source, false, 'darwin')).toBe(true)
    expect(codexStaleLink(link('memories', '/home/someone/.codex/memories', 'folder'), source, true, 'darwin')).toBe(false)
  })

  test('is one kurmis recorded that leads nowhere: a link into a default home used before', () => {
    expect(codexStaleLink(link('memories', '/old/codex/memories', 'nothing', '/old/codex/memories'), source, true, 'darwin')).toBe(true)
    expect(codexStaleLink(link('memories', '/old/codex/memories', 'folder', '/old/codex/memories'), source, true, 'darwin')).toBe(false)
  })

  test("is never a link of the user's own: to a file of the default home, or one that leads nowhere", () => {
    expect(codexStaleLink(link('hooks.json', '/home/someone/.codex/hooks.json', 'other'), source, false, 'darwin')).toBe(false)
    expect(codexStaleLink(link('memories', '/elsewhere/notes', 'nothing'), source, true, 'darwin')).toBe(false)
    // Its target has the link's own name, but kurmis did not record it.
    expect(codexStaleLink(link('memories', '/unmounted/memories', 'nothing'), source, true, 'darwin')).toBe(false)
    expect(codexStaleLink(link('memories', '/unmounted/memories', 'nothing', '/old/codex/memories'), source, true, 'darwin')).toBe(false)
  })

  test('is one to a file of the default home when kurmis recorded it, from when that place was a folder', () => {
    expect(codexStaleLink(link('memories', '/home/someone/.codex/memories', 'other', '/home/someone/.codex/memories'), source, false, 'darwin')).toBe(true)
  })

  test('compares Windows paths ignoring case', () => {
    expect(codexStaleLink(link('Memories', 'C:\\Users\\Someone\\.codex\\memories', 'folder'), 'c:\\users\\someone\\.codex', false, 'win32')).toBe(true)
    expect(codexStaleLink(link('memories', 'D:\\old\\MEMORIES', 'nothing', 'd:\\old\\memories'), 'c:\\users\\someone\\.codex', true, 'win32')).toBe(true)
  })
})

describe("the login's config.toml", () => {
  const hook = '[hooks.state."k"]\ntrusted_hash = "sha256:own"\n'

  function written(refresh: CodexConfigRefresh): Record<string, unknown> {
    if (refresh.action !== 'write' || refresh.content === null) throw new Error(`expected a write, got ${refresh.action}`)
    return tomlValue(refresh.content)
  }

  test('is copied from the default home when the login has none', () => {
    const refresh = codexConfigRefresh('model = "gpt-a"\n', null, null)
    expect(refresh).toEqual({ action: 'write', content: 'model = "gpt-a"\n', merged: 'model = "gpt-a"\n', missingSecrets: false, heldBack: [], mergeFailure: null })
  })

  test('takes a setting the default home has since changed, and replaces a hand edit', () => {
    expect(written(codexConfigRefresh('model = "gpt-b"\n', 'model = "edited by hand"\n', null))).toEqual({ model: 'gpt-b' })
  })

  test("keeps the login's own secrets, never copies the default home's, and says one is missing", () => {
    const source = 'model = "gpt-b"\n[mcp_servers.demo]\nurl = "https://new.invalid"\n[mcp_servers.demo.env]\nCUSTOM = "DEFAULT_CANARY"\n'
    const own = 'model = "old"\n[mcp_servers.demo]\nurl = "https://old.invalid"\n[mcp_servers.demo.env]\nCUSTOM = "ACCOUNT_CANARY"\n'

    const kept = codexConfigRefresh(source, own, null)
    expect(kept.action === 'write' && kept.content).toContain('ACCOUNT_CANARY')
    expect(kept.action === 'write' && kept.content).not.toContain('DEFAULT_CANARY')
    expect(kept).toMatchObject({ missingSecrets: false })

    const fresh = codexConfigRefresh(source, null, null)
    expect(fresh.action === 'write' && fresh.content).not.toContain('DEFAULT_CANARY')
    expect(fresh).toMatchObject({ action: 'write', missingSecrets: true })
  })

  test('is not rewritten when it holds the same settings in another layout', () => {
    expect(codexConfigRefresh('model = "gpt-a"\n', "model   =   'gpt-a'\n", null))
      .toEqual({ action: 'keep', content: null, merged: 'model = "gpt-a"\n', missingSecrets: false, heldBack: [], mergeFailure: null })
  })

  // The login's own trust is kept, so with nothing to merge in the file is not touched.
  test('is left as it is, trust included, when the default home has no config.toml', () => {
    const own = `model = "gpt-old"\n${hook}[projects.'e:\\a']\ntrust_level = "trusted"\n`
    expect(codexConfigRefresh(null, own, 'model = "gpt-old"\n')).toEqual({ action: 'keep', content: null, merged: null, missingSecrets: false, heldBack: [], mergeFailure: null })
    expect(codexConfigRefresh(null, own, null)).toMatchObject({ action: 'keep', content: null })
  })

  // A new login made before the user had a config.toml: Codex writes the login's own settings
  // into its file, and none of them may count as merged in once the default home's file appears.
  test('records an empty merged copy when the default home has no config.toml and none was recorded yet', () => {
    expect(codexConfigRefresh(null, null, null)).toEqual({ action: 'keep', content: null, merged: '', missingSecrets: false, heldBack: [], mergeFailure: null })
    const own = 'model = "own"\n[mcp_servers.mine]\ncommand = "mine"\n[mcp_servers.mine.env]\nK = "LOGIN_CANARY"\n'
    const first = codexConfigRefresh(null, own, null)
    expect(first.merged).toBe('')
    expect(written(codexConfigRefresh('approval_policy = "never"\n', own, first.merged))).toEqual({
      model: 'own',
      approval_policy: 'never',
      mcp_servers: { mine: { command: 'mine', env: { K: 'LOGIN_CANARY' } } }
    })
  })

  test("keeps the login's own hook trust when the default home has a file", () => {
    expect(written(codexConfigRefresh('model = "gpt-b"\n', `model = "gpt-a"\n${hook}`, null)))
      .toEqual({ model: 'gpt-b', hooks: { state: { k: { trusted_hash: 'sha256:own' } } } })
  })

  test('leaves the login file as it is, and says why, when the default home cannot be merged', () => {
    expect(codexConfigRefresh('model = [\n', hook, null)).toEqual({
      action: 'keep',
      content: null,
      merged: null,
      missingSecrets: false,
      heldBack: [],
      mergeFailure: "the default home's config.toml could not be merged in: config.toml is not valid TOML"
    })
  })

  test('leaves a login file that is not TOML as it is, without repeating it', () => {
    const refresh = codexConfigRefresh('model = "gpt-a"\n', 'hooks = [\nSECRET_CANARY', null)
    expect(refresh).toMatchObject({ action: 'keep', content: null, mergeFailure: expect.stringMatching(/login's config\.toml is not valid TOML/) })
    expect(JSON.stringify(refresh)).not.toContain('CANARY')
    expect(codexConfigRefresh(null, 'hooks = [\n', null)).toMatchObject({ action: 'keep', mergeFailure: null })
  })
})

describe("the login's config.toml with a last merged copy", () => {
  test('keeps a setting Codex wrote into the login and removes one the default home dropped', () => {
    const first = codexConfigRefresh('model = "gpt-a"\nold = 1\n', null, null)
    const own = `${first.content ?? ''}[notice]\nhide_full_access_warning = true\n`
    const second = codexConfigRefresh('model = "gpt-a"\n', own, first.merged)
    expect(second.action).toBe('write')
    expect(tomlValue(second.content ?? '')).toEqual({ model: 'gpt-a', notice: { hide_full_access_warning: true } })
    expect(second.merged).toBe('model = "gpt-a"\n')
  })

  test('answers no new merged copy when the default home has no config.toml', () => {
    expect(codexConfigRefresh(null, 'model = "a"\n', 'model = "a"\n')).toMatchObject({ action: 'keep', merged: null })
  })
})
