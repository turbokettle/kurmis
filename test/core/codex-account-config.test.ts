// The config.toml an extra Codex login's home gets: the default home's settings, never its
// secrets, and the login's own secrets kept where they were. Copied from the original router's
// `test/unit/claude/codex-account-config.test.ts`.
import { describe, expect, it } from 'vitest'
import { filterAccountTrust, mergeAccountConfig, publicAccountConfig, sameTomlSettings, tomlValue } from '../../src/core/codex-account-config.ts'

/**
 * The settings of a file, with tables that hold nothing left out. A dropped value can leave
 * its `[header]` behind, and an empty table sets nothing for Codex.
 */
function settingsOf(text: string): unknown {
  const prune = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return value
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const kept = prune(child)
      if (kept !== null && typeof kept === 'object' && !Array.isArray(kept) && !(kept instanceof Date) && Object.keys(kept).length === 0) continue
      out[key] = kept
    }
    return out
  }
  return prune(tomlValue(text))
}

describe("an extra Codex login's config.toml", () => {
  it('leaves out the default home\'s secret tables and says a secret is missing', () => {
    const source = '[mcp_servers.demo]\nurl = "https://fixture.invalid"\n[mcp_servers.demo.env]\nCUSTOM = "DO_NOT_COPY"\n'
    expect(publicAccountConfig(source)).not.toContain('DO_NOT_COPY')
    const result = mergeAccountConfig(source, '')
    expect(result.missingSecrets).toBe(true)
    expect(result.content).not.toContain('DO_NOT_COPY')
    expect(tomlValue(result.content)).toMatchObject({ mcp_servers: { demo: { url: 'https://fixture.invalid' } } })
  })

  it('keeps inline env and header arguments of the login without copying the default values', () => {
    const source = 'mcp_servers.demo = { url = "https://new.invalid", env = { CUSTOM = "DEFAULT_CANARY" }, args = ["-H", "X-Custom: DEFAULT_HEADER"] }'
    const target = 'mcp_servers.demo = { url = "https://old.invalid", env = { CUSTOM = "ACCOUNT_CANARY" }, args = ["-H", "X-Custom: ACCOUNT_HEADER"] }'
    const result = mergeAccountConfig(source, target)
    expect(result.content).toContain('https://new.invalid')
    expect(result.content).toContain('ACCOUNT_CANARY')
    expect(result.content).toContain('ACCOUNT_HEADER')
    expect(result.content).not.toMatch(/DEFAULT_CANARY|DEFAULT_HEADER/)
    expect(result.missingSecrets).toBe(false)
    expect(publicAccountConfig(source)).not.toMatch(/DEFAULT_CANARY|DEFAULT_HEADER/)
  })

  it('takes every other setting from the default home', () => {
    const result = mergeAccountConfig('model = "next"\n[features]\nmemories = false\n', 'model = "first"\n[features]\nmemories = true\n')
    expect(tomlValue(result.content)).toEqual({ model: 'next', features: { memories: false } })
  })

  describe('trust', () => {
    // Where Codex keeps it: hooks.state."<hook key>".trusted_hash and
    // projects."<folder>".trust_level.
    const hookKey = 'file:C:\\repo\\secrets-tool\\.codex\\hooks.json:pre_tool_use:0:0'
    const loginOwn = [
      `[hooks.state.${JSON.stringify(hookKey)}]`,
      'trusted_hash = "sha256:login"',
      '',
      "[projects.'e:\\login-only']",
      'trust_level = "untrusted"',
      ''
    ].join('\n')

    it("keeps a folder marked untrusted from the login's own home, and drops its own hook hash", () => {
      const result = mergeAccountConfig('model = "next"\n', loginOwn)
      expect(settingsOf(result.content)).toEqual({
        model: 'next',
        projects: { 'e:\\login-only': { trust_level: 'untrusted' } }
      })
      expect(result.missingSecrets).toBe(false)
    })

    // A session can write its login's home, so trust there may have been written by a model.
    // Only what narrows stays.
    it("drops trust in the login's own file that widens what may run", () => {
      const own = [
        `[hooks.state.${JSON.stringify(hookKey)}]`,
        'trusted_hash = "sha256:own"',
        '[hooks.state."file:/repo/.codex/hooks.json:stop:0:0"]',
        'trusted_hash = "sha256:other"',
        'enabled = true',
        '[hooks.state."file:/repo/.codex/hooks.json:stop:1:0"]',
        'enabled = false',
        "[projects.'e:\\own']",
        'trust_level = "trusted"',
        ''
      ].join('\n')
      const result = mergeAccountConfig('model = "next"\n', own)
      expect(settingsOf(result.content)).toEqual({
        model: 'next',
        hooks: { state: { 'file:/repo/.codex/hooks.json:stop:1:0': { enabled: false } } }
      })
      expect(settingsOf(mergeAccountConfig('', loginOwn).content)).toEqual({ projects: { 'e:\\login-only': { trust_level: 'untrusted' } } })
    })

    it("lets the default home's hook switched off win over the login's enabled = true", () => {
      const key = 'file:/repo/.codex/hooks.json:stop:0:0'
      const result = mergeAccountConfig(
        `[hooks.state.${JSON.stringify(key)}]\nenabled = false\n`,
        `[hooks.state.${JSON.stringify(key)}]\nenabled = true\n`
      )
      expect(tomlValue(result.content)).toEqual({ hooks: { state: { [key]: { enabled: false } } } })
    })

    it("copies the default home's trust in beside the login's own", () => {
      const source = [
        "[projects.'e:\\shared']",
        'trust_level = "trusted"',
        '[hooks.state."file:/repo/.codex/hooks.json:stop:0:0"]',
        'trusted_hash = "sha256:default"',
        'enabled = false',
        ''
      ].join('\n')
      const result = mergeAccountConfig(source, loginOwn)
      expect(settingsOf(result.content)).toEqual({
        hooks: {
          state: {
            'file:/repo/.codex/hooks.json:stop:0:0': { trusted_hash: 'sha256:default', enabled: false }
          }
        },
        projects: { 'e:\\shared': { trust_level: 'trusted' }, 'e:\\login-only': { trust_level: 'untrusted' } }
      })
    })

    it("keeps the login's own narrowing value where both homes name the same hook or folder", () => {
      const source = [
        `[hooks.state.${JSON.stringify(hookKey)}]`,
        'trusted_hash = "sha256:default"',
        'enabled = true',
        '',
        "[projects.'e:\\login-only']",
        'trust_level = "trusted"',
        ''
      ].join('\n')
      const target = [
        `[hooks.state.${JSON.stringify(hookKey)}]`,
        'trusted_hash = "sha256:login"',
        'enabled = false',
        '',
        "[projects.'e:\\login-only']",
        'trust_level = "untrusted"',
        ''
      ].join('\n')
      const result = mergeAccountConfig(source, target)
      expect(tomlValue(result.content)).toEqual({
        hooks: { state: { [hookKey]: { trusted_hash: 'sha256:default', enabled: false } } },
        projects: { 'e:\\login-only': { trust_level: 'untrusted' } }
      })
      // A second refresh changes nothing.
      expect(mergeAccountConfig(source, result.content).content).toBe(result.content)
    })

    it('still removes a setting of the login that the default home dropped', () => {
      const result = mergeAccountConfig('', `model = "old"\n${loginOwn}`)
      expect(tomlValue(result.content)).not.toHaveProperty('model')
      expect(tomlValue(result.content)).toHaveProperty(['projects', 'e:\\login-only', 'trust_level'], 'untrusted')
    })

    // A folder or hook key may look like a secret and is still copied. That exception is for
    // the name of a trust table only. A value placed straight into [projects] or
    // [hooks.state], or a field of a trust table that is not a trust field, is checked like
    // any other value.
    it('does not copy a secret-named value placed straight into [projects] or [hooks.state]', () => {
      const source = [
        '[projects]',
        'password = "DEFAULT_PASSWORD_CANARY"',
        '[hooks.state]',
        'api_key = "DEFAULT_KEY_CANARY"',
        ''
      ].join('\n')
      expect(publicAccountConfig(source)).not.toMatch(/CANARY/)
      const result = mergeAccountConfig(source, '')
      expect(result.content).not.toMatch(/CANARY/)
      expect(result.missingSecrets).toBe(true)
    })

    it('does not copy a secret-named field inside a trust table whose name looks secret', () => {
      const source = [
        "[projects.'e:\\secrets-tool']",
        'trust_level = "trusted"',
        'password = "FOLDER_CANARY"',
        `[hooks.state.${JSON.stringify(hookKey)}]`,
        'trusted_hash = "sha256:default"',
        'api_key = "HOOK_CANARY"',
        'note = "NOTE_CANARY"',
        ''
      ].join('\n')
      const result = mergeAccountConfig(source, '')
      expect(result.content).not.toMatch(/CANARY/)
      expect(tomlValue(result.content)).toEqual({
        hooks: { state: { [hookKey]: { trusted_hash: 'sha256:default' } } },
        projects: { 'e:\\secrets-tool': { trust_level: 'trusted' } }
      })
      expect(result.missingSecrets).toBe(true)
    })

    it("keeps the login's own secret-named value in [projects] where it was", () => {
      const result = mergeAccountConfig('model = "next"\n', '[projects]\npassword = "LOGIN_CANARY"\n')
      expect(tomlValue(result.content)).toEqual({ model: 'next', projects: { password: 'LOGIN_CANARY' } })
      expect(result.missingSecrets).toBe(false)
    })
  })

  // Used when the default home has no config.toml to merge: the login keeps its settings and
  // loses only the trust that widens.
  describe("checking only the login's own trust", () => {
    it('drops widening trust and keeps everything else as it was written', () => {
      const text = [
        '# the login\'s own file',
        'model = "gpt-old"',
        '[hooks.state."k"]',
        'trusted_hash = "sha256:own" # trusted in a terminal',
        'enabled = false',
        "[projects.'e:\\a']",
        'trust_level = "trusted"',
        "[projects.'e:\\b']",
        'trust_level = "untrusted"',
        ''
      ].join('\n')
      const filtered = filterAccountTrust(text)
      expect(settingsOf(filtered)).toEqual({
        model: 'gpt-old',
        hooks: { state: { k: { enabled: false } } },
        projects: { 'e:\\b': { trust_level: 'untrusted' } }
      })
      expect(filtered.startsWith('# the login\'s own file\nmodel = "gpt-old"\n')).toBe(true)
      expect(filterAccountTrust(filtered)).toBe(filtered)
    })

    it('leaves a file without trust byte for byte', () => {
      const text = 'model = "m" # mine\n[mcp_servers.demo.env]\nTOKEN = "LOGIN_CANARY"\n'
      expect(filterAccountTrust(text)).toBe(text)
    })

    it('throws on a file that is not TOML, without repeating it', () => {
      expect(() => filterAccountTrust('hooks = [\nSECRET_CANARY')).toThrow(/^config\.toml is not valid TOML$/)
    })
  })

  // TOML lets a table be written as a [header], as dotted keys, or as an inline table. A
  // table defined by dotted keys or inline cannot be given a [header] later, so a new key
  // has to go where the table already is.
  describe('tables written as dotted keys or inline tables', () => {
    const source = '[hooks.state."k"]\ntrusted_hash = "sha256:default"\n'
    const wanted = { hooks: { state: { k: { trusted_hash: 'sha256:default', enabled: false } } } }

    it.each([
      ['dotted keys at the top', 'hooks.state.k.enabled = false\n'],
      ['dotted keys under [hooks]', '[hooks]\nstate.k.enabled = false\n'],
      ['dotted keys under [hooks.state]', '[hooks.state]\nk.enabled = false\n'],
      ['an inline table for the hook', 'hooks.state.k = { enabled = false }\n'],
      ['an inline table for hooks.state', '[hooks]\nstate = { k = { enabled = false } }\n'],
      ['one inline table for everything', 'hooks = { state = { k = { enabled = false } } }\n']
    ])('keeps a hook switched off with %s and adds the default home\'s hash beside it', (_form, target) => {
      const result = mergeAccountConfig(source, target)
      expect(tomlValue(result.content)).toEqual(wanted)
      // A second refresh changes nothing.
      expect(mergeAccountConfig(source, result.content).content).toBe(result.content)
    })

    it('adds a second hook beside an inline hooks.state', () => {
      const result = mergeAccountConfig(
        '[hooks.state."k2"]\ntrusted_hash = "sha256:two"\n',
        'hooks.state = { k = { enabled = false } }\n'
      )
      expect(tomlValue(result.content)).toEqual({
        hooks: { state: { k: { enabled: false }, k2: { trusted_hash: 'sha256:two' } } }
      })
    })

    it('adds a folder beside folders written as dotted keys', () => {
      const result = mergeAccountConfig(
        "[projects.'e:\\b']\ntrust_level = \"trusted\"\n",
        "projects.'e:\\a'.trust_level = \"untrusted\"\n"
      )
      expect(tomlValue(result.content)).toEqual({
        projects: { 'e:\\a': { trust_level: 'untrusted' }, 'e:\\b': { trust_level: 'trusted' } }
      })
    })

    it('sets, adds and removes settings inside dotted and inline tables', () => {
      const result = mergeAccountConfig(
        '[features]\nmemories = false\nfresh = true\n[tui]\ntheme = "dark"\n',
        'features.memories = true\nfeatures.old = 1\ntui = { theme = "light", old = 2, older = 3 }\n'
      )
      expect(tomlValue(result.content)).toEqual({ features: { memories: false, fresh: true }, tui: { theme: 'dark' } })
      expect(mergeAccountConfig('[features]\nmemories = false\nfresh = true\n[tui]\ntheme = "dark"\n', result.content).content).toBe(result.content)
    })
  })

  // The secret check reads a string as TOML decodes it. Written with escapes, a tab after
  // --token is a tab, so the argument is a token like any other.
  it('does not copy a secret written with TOML escapes', () => {
    for (const source of [
      'command = "run --token\\tDEFAULT_CANARY"\n',
      'args = ["run --token\\tDEFAULT_CANARY"]\n',
      'auth_line = "Bearer\\u0009DEFAULT_CANARY"\n'
    ]) {
      const result = mergeAccountConfig(source, '')
      expect(result.content).not.toContain('CANARY')
      expect(result.missingSecrets).toBe(true)
      expect(publicAccountConfig(source)).not.toContain('CANARY')
    }
  })

  // Tables are read into objects without a prototype, so a key that names a property of
  // Object.prototype is an ordinary key and never reaches the shared prototype.
  describe('keys that are names of JavaScript object properties', () => {
    it.each(['constructor', '__proto__', 'toString'])('copies and keeps a server called %s', (name) => {
      const server = `[mcp_servers.${name}]\ncommand = "node"\n`
      expect(tomlValue(publicAccountConfig(server))).toEqual(tomlValue(server))
      const servers = tomlValue(publicAccountConfig(server))['mcp_servers'] as Record<string, Record<string, unknown>>
      expect(Object.hasOwn(servers, name) ? servers[name]!['command'] : undefined).toBe('node')
      const result = mergeAccountConfig(`model = "b"\n${server}`, `model = "a"\n${server}`)
      expect(result.content).toBe(`model = "b"\n${server}`)
      expect(sameTomlSettings(server, '')).toBe(false)
    })

    it('never changes a shared prototype', () => {
      const source = 'constructor.prototype.leak_one = 1\n[a.__proto__]\nleak_two = 2\n[b.toString]\nleak_three = 3\n'
      expect(sameTomlSettings(publicAccountConfig(source), source)).toBe(true)
      expect(sameTomlSettings(mergeAccountConfig(source, '').content, source)).toBe(true)
      tomlValue(source)
      const probe: Record<string, unknown> = {}
      expect([probe['leak_one'], probe['leak_two'], probe['leak_three']]).toEqual([undefined, undefined, undefined])
      expect((Object as unknown as Record<string, unknown>)['prototype']).toBe(Object.prototype)
      expect(Object.keys(Object.prototype)).toEqual([])
    })
  })

  it('compares settings, not how the file is written', () => {
    expect(sameTomlSettings('model = "a"\n', "model   =   'a'")).toBe(true)
    expect(sameTomlSettings('model = "a"\n', 'model = "b"\n')).toBe(false)
  })

  // "é" and "é" are two keys that a locale sort ranks equal.
  describe('keys that differ only in their Unicode form', () => {
    const composed = '"\\u00e9" = 1\n"e\\u0301" = 2\n'
    const reversed = '"e\\u0301" = 2\n"\\u00e9" = 1\n'

    it('compares the same settings as equal in either order', () => {
      expect(sameTomlSettings(composed, reversed)).toBe(true)
    })

    it('copies both keys', () => {
      expect(sameTomlSettings(publicAccountConfig(composed), composed)).toBe(true)
      expect(sameTomlSettings(publicAccountConfig(reversed), composed)).toBe(true)
    })
  })

  // A plain JavaScript value turns a date into a Date object, 1 and 1.0 into the same
  // number, and rounds an integer past 2^53. The merge compares and writes TOML's own types.
  describe('values JavaScript numbers and objects cannot hold exactly', () => {
    it('keeps a date inside an inline table when another value there changes', () => {
      const result = mergeAccountConfig('x = { date = 2026-10-01, n = 2 }\n', 'x = { date = 2026-10-01, n = 1 }\n')
      expect(result.content).toBe('x = { date = 2026-10-01, n = 2 }\n')
    })

    it('copies dates of every kind', () => {
      const source = 'a = 2026-10-01\nb = 2026-10-01 10:00:00z\nc = 10:00:00\nd = 2026-10-01T10:00:00\n'
      expect(sameTomlSettings(publicAccountConfig(source), source)).toBe(true)
      expect(sameTomlSettings(mergeAccountConfig(source, '').content, source)).toBe(true)
    })

    it('replaces a date with a different date', () => {
      expect(mergeAccountConfig('d = 2026-10-01\n', 'd = 2026-10-02\n').content).toBe('d = 2026-10-01\n')
      expect(sameTomlSettings('d = 2026-10-01\n', 'd = 2026-10-01T00:00:00\n')).toBe(false)
    })

    it('copies an integer past 2^53 exactly', () => {
      expect(publicAccountConfig('n = 9007199254740993\n')).toBe('n = 9007199254740993\n')
      expect(mergeAccountConfig('n = 9007199254740993\n', 'n = 9007199254740992\n').content).toBe('n = 9007199254740993\n')
    })

    it('tells an integer from a float', () => {
      expect(mergeAccountConfig('n = 1.0\n', 'n = 1\n').content).toBe('n = 1.0\n')
      expect(mergeAccountConfig('n = 1\n', 'n = 1.0\n').content).toBe('n = 1\n')
      expect(sameTomlSettings('n = 1\n', 'n = 1.0\n')).toBe(false)
      expect(sameTomlSettings('n = 0x10\n', 'n = 16\n')).toBe(true)
    })
  })

  // An array of tables is one setting, like any other array: it is copied, replaced and
  // removed whole, and one secret anywhere in it keeps the whole list out.
  describe('arrays of tables', () => {
    it('leaves a list the login already has as it is', () => {
      const text = 'model = "m"\n[[agents]]\nname = "a"\n[agents.limits]\nturns = 3\n[[agents]]\nname = "b"\n'
      expect(mergeAccountConfig(text, text).content).toBe(text)
    })

    it('copies a list the login does not have', () => {
      const result = mergeAccountConfig('[[agents]]\nname = "a"\n[[agents]]\nname = "b"\n', 'model = "m"\n')
      expect(tomlValue(result.content)).toEqual({ agents: [{ name: 'a' }, { name: 'b' }] })
      expect(result.content).toContain('[[agents]]')
    })

    it("replaces the login's list with the default home's", () => {
      const source = 'model = "m"\n[[agents]]\nname = "b"\n[[agents]]\nname = "c"\n[agents.limits]\nturns = 1\n'
      const target = 'model = "x"\n[[agents]]\nname = "a"\n[tui]\ntheme = "dark"\n'
      const result = mergeAccountConfig(source, target)
      expect(tomlValue(result.content)).toEqual({ model: 'm', tui: {}, agents: [{ name: 'b' }, { name: 'c', limits: { turns: 1 } }] })
      // A second refresh changes nothing.
      expect(mergeAccountConfig(source, result.content).content).toBe(result.content)
    })

    it('removes a list the default home dropped', () => {
      const result = mergeAccountConfig('model = "m"\n', '[[agents]]\nname = "a"\n[agents.limits]\nturns = 3\n')
      expect(tomlValue(result.content)).toEqual({ model: 'm' })
    })

    it('changes a value in place, keeping the comments and where the list stands', () => {
      const target = '[[agents]] # explanation\n# note\nname = "a"\n\n[tui]\ntheme = "dark"\n'
      const result = mergeAccountConfig('[[agents]]\nname = "b"\n[tui]\ntheme = "dark"\n', target)
      expect(result.content).toBe('[[agents]] # explanation\n# note\nname = "b"\n\n[tui]\ntheme = "dark"\n')
    })

    it('sets, adds and removes values inside elements and their tables in place', () => {
      const source = '[[agents]]\nname = "a"\nturns = 5\n[agents.limits]\nsoft = 2\n[[agents]]\nname = "b"\n'
      const target = '# list\n[[agents]]\nname = "a"\nold = true # gone\n[agents.limits]\nsoft = 1\nhard = 3\n[[agents]]\nname = "b"\n[tui]\ntheme = "dark"\n'
      const result = mergeAccountConfig(`${source}[tui]\ntheme = "dark"\n`, target)
      expect(tomlValue(result.content)).toEqual({
        agents: [{ name: 'a', turns: 5, limits: { soft: 2 } }, { name: 'b' }],
        tui: { theme: 'dark' }
      })
      expect(result.content.startsWith('# list\n[[agents]]\nname = "a"\n')).toBe(true)
      expect(result.content.indexOf('[tui]')).toBeGreaterThan(result.content.lastIndexOf('[[agents]]'))
    })

    it('adds elements after the last one and takes out elements past the new end', () => {
      const target = '[[agents]]\nname = "a" # first\n[tui]\ntheme = "dark"\n'
      const longer = mergeAccountConfig('[[agents]]\nname = "a"\n[[agents]]\nname = "b"\n[tui]\ntheme = "dark"\n', target)
      expect(longer.content).toBe('[[agents]]\nname = "a" # first\n[[agents]]\nname = "b"\n[tui]\ntheme = "dark"\n')
      const shorter = mergeAccountConfig('[[agents]]\nname = "a"\n[tui]\ntheme = "dark"\n', longer.content)
      expect(tomlValue(shorter.content)).toEqual({ agents: [{ name: 'a' }], tui: { theme: 'dark' } })
      expect(shorter.content).toContain('name = "a" # first')
    })

    it('writes CRLF lines into a file that uses them', () => {
      const target = '[[agents]]\r\nname = "a"\r\n[tui]\r\ntheme = "dark"\r\n'
      const result = mergeAccountConfig('[[agents]]\nname = "b"\n[[agents]]\nname = "c"\n[tui]\ntheme = "dark"\nfresh = true\n', target)
      expect(tomlValue(result.content)).toEqual({ agents: [{ name: 'b' }, { name: 'c' }], tui: { theme: 'dark', fresh: true } })
      expect(result.content.replace(/\r\n/g, '')).not.toContain('\n')
    })

    it("keeps the login's list whole when it holds a secret, and does not copy one that does", () => {
      const own = '[[agents]]\nname = "a"\nenv = { K = "LOGIN_CANARY" }\n'
      expect(mergeAccountConfig('[[agents]]\nname = "b"\n', own).content).toBe(own)
      const result = mergeAccountConfig('[[agents]]\nname = "b"\nenv = { K = "DEFAULT_CANARY" }\n', '')
      expect(result.content).not.toContain('CANARY')
      expect(result.missingSecrets).toBe(true)
    })
  })
})
