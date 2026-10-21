// The config.toml an extra Codex login's home gets: the default home's settings, never its
// secrets, and the login's own secrets kept where they were. Copied from the original router's
// `test/unit/claude/codex-account-config.test.ts`.
import { describe, expect, it } from 'vitest'
import { mergeAccountConfig, publicAccountConfig, sameTomlSettings, tomlValue, validToml } from '../../src/core/codex-account-config.ts'

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

/** A merge with no last merged copy: the first merge, or the one after kurmis was updated. */
function merge(source: string, target: string): ReturnType<typeof mergeAccountConfig> {
  return mergeAccountConfig(source, target, null)
}

describe("an extra Codex login's config.toml", () => {
  it('leaves out the default home\'s secret tables and says a secret is missing', () => {
    const source = '[mcp_servers.demo]\nurl = "https://fixture.invalid"\n[mcp_servers.demo.env]\nCUSTOM = "DO_NOT_COPY"\n'
    expect(publicAccountConfig(source)).not.toContain('DO_NOT_COPY')
    const result = merge(source, '')
    expect(result.missingSecrets).toBe(true)
    expect(result.content).not.toContain('DO_NOT_COPY')
    expect(tomlValue(result.content)).toMatchObject({ mcp_servers: { demo: { url: 'https://fixture.invalid' } } })
  })

  it('keeps inline env and header arguments of the login without copying the default values', () => {
    const source = 'mcp_servers.demo = { url = "https://new.invalid", env = { CUSTOM = "DEFAULT_CANARY" }, args = ["-H", "X-Custom: DEFAULT_HEADER"] }'
    const target = 'mcp_servers.demo = { url = "https://old.invalid", env = { CUSTOM = "ACCOUNT_CANARY" }, args = ["-H", "X-Custom: ACCOUNT_HEADER"] }'
    const result = merge(source, target)
    expect(result.content).toContain('https://new.invalid')
    expect(result.content).toContain('ACCOUNT_CANARY')
    expect(result.content).toContain('ACCOUNT_HEADER')
    expect(result.content).not.toMatch(/DEFAULT_CANARY|DEFAULT_HEADER/)
    expect(result.missingSecrets).toBe(false)
    expect(publicAccountConfig(source)).not.toMatch(/DEFAULT_CANARY|DEFAULT_HEADER/)
  })

  it('takes every other setting from the default home', () => {
    const result = merge('model = "next"\n[features]\nmemories = false\n', 'model = "first"\n[features]\nmemories = true\n')
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

    it("keeps the login's own folder and hook trust when the default home has none", () => {
      const result = merge('model = "next"\n', loginOwn)
      expect(settingsOf(result.content)).toEqual({
        model: 'next',
        hooks: { state: { [hookKey]: { trusted_hash: 'sha256:login' } } },
        projects: { 'e:\\login-only': { trust_level: 'untrusted' } }
      })
      expect(result.missingSecrets).toBe(false)
    })

    // A session on the login asks for trust and writes it into the login's own file. Kurmis
    // keeps it, unlike the original router, which drops whatever widens.
    it("keeps trust in the login's own file that widens what may run", () => {
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
      const result = merge('model = "next"\n', own)
      expect(settingsOf(result.content)).toEqual({
        model: 'next',
        hooks: {
          state: {
            [hookKey]: { trusted_hash: 'sha256:own' },
            'file:/repo/.codex/hooks.json:stop:0:0': { trusted_hash: 'sha256:other', enabled: true },
            'file:/repo/.codex/hooks.json:stop:1:0': { enabled: false }
          }
        },
        projects: { 'e:\\own': { trust_level: 'trusted' } }
      })
      // A second refresh changes nothing.
      expect(merge('model = "next"\n', result.content).content).toBe(result.content)
    })

    it("lets the default home's hook switched off win over the login's enabled = true", () => {
      const key = 'file:/repo/.codex/hooks.json:stop:0:0'
      const result = merge(
        `[hooks.state.${JSON.stringify(key)}]\nenabled = false\n`,
        `[hooks.state.${JSON.stringify(key)}]\nenabled = true\n`
      )
      expect(tomlValue(result.content)).toEqual({ hooks: { state: { [key]: { enabled: false } } } })
    })

    it("lets the login's hook switched off win over the default home's enabled = true", () => {
      const key = 'file:/repo/.codex/hooks.json:stop:0:0'
      const result = merge(
        `[hooks.state.${JSON.stringify(key)}]\nenabled = true\n`,
        `[hooks.state.${JSON.stringify(key)}]\nenabled = false\n`
      )
      expect(tomlValue(result.content)).toEqual({ hooks: { state: { [key]: { enabled: false } } } })
    })

    it("lets a folder the default home marks untrusted win over the login's trusted", () => {
      const result = merge(
        "[projects.'e:\\shared']\ntrust_level = \"untrusted\"\n",
        "[projects.'e:\\shared']\ntrust_level = \"trusted\"\n"
      )
      expect(tomlValue(result.content)).toEqual({ projects: { 'e:\\shared': { trust_level: 'untrusted' } } })
    })

    it("keeps the login's own hash where the two homes trust different versions of a hook", () => {
      const result = merge(
        `[hooks.state.${JSON.stringify(hookKey)}]\ntrusted_hash = "sha256:default"\n`,
        `[hooks.state.${JSON.stringify(hookKey)}]\ntrusted_hash = "sha256:login"\n`
      )
      expect(tomlValue(result.content)).toEqual({ hooks: { state: { [hookKey]: { trusted_hash: 'sha256:login' } } } })
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
      const result = merge(source, loginOwn)
      expect(settingsOf(result.content)).toEqual({
        hooks: {
          state: {
            [hookKey]: { trusted_hash: 'sha256:login' },
            'file:/repo/.codex/hooks.json:stop:0:0': { trusted_hash: 'sha256:default', enabled: false }
          }
        },
        projects: { 'e:\\shared': { trust_level: 'trusted' }, 'e:\\login-only': { trust_level: 'untrusted' } }
      })
    })

    it("fills in a trust field of the default home that the login's entry for the same hook lacks", () => {
      const result = merge(
        `[hooks.state.${JSON.stringify(hookKey)}]\ntrusted_hash = "sha256:default"\nenabled = true\n`,
        `[hooks.state.${JSON.stringify(hookKey)}]\nenabled = false\n`
      )
      expect(tomlValue(result.content)).toEqual({ hooks: { state: { [hookKey]: { trusted_hash: 'sha256:default', enabled: false } } } })
    })

    it('takes the more restrictive value where both homes name the same hook or folder', () => {
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
      const result = merge(source, target)
      expect(tomlValue(result.content)).toEqual({
        hooks: { state: { [hookKey]: { trusted_hash: 'sha256:login', enabled: false } } },
        projects: { 'e:\\login-only': { trust_level: 'untrusted' } }
      })
      // A second refresh changes nothing.
      expect(merge(source, result.content).content).toBe(result.content)
    })

    // The login's own values are kept, so a restrictive value stays even after the default
    // home trusts the folder again.
    it("keeps the login's untrusted folder after the default home trusts it again", () => {
      const first = merge("[projects.'e:\\a']\ntrust_level = \"untrusted\"\n", '').content
      const second = merge("[projects.'e:\\a']\ntrust_level = \"trusted\"\n", first).content
      expect(tomlValue(second)).toEqual({ projects: { 'e:\\a': { trust_level: 'untrusted' } } })
    })

    it('still removes a setting of the login that the default home dropped', () => {
      const result = merge('', `model = "old"\n${loginOwn}`)
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
      const result = merge(source, '')
      expect(result.content).not.toMatch(/CANARY/)
      expect(result.missingSecrets).toBe(true)
    })

    // The folder or hook key is never read as a secret name; the fields below it are judged
    // by their own names.
    it('does not copy a secret-named field inside a trust table whose name looks secret', () => {
      const source = [
        "[projects.'e:\\deploy-token']",
        'trust_level = "trusted"',
        'password = "FOLDER_CANARY"',
        `[hooks.state.${JSON.stringify(hookKey)}]`,
        'trusted_hash = "sha256:default"',
        'api_key = "HOOK_CANARY"',
        'note = "plain note"',
        ''
      ].join('\n')
      const result = merge(source, '')
      expect(result.content).not.toMatch(/CANARY/)
      expect(tomlValue(result.content)).toEqual({
        hooks: { state: { [hookKey]: { trusted_hash: 'sha256:default', note: 'plain note' } } },
        projects: { 'e:\\deploy-token': { trust_level: 'trusted' } }
      })
      expect(result.missingSecrets).toBe(true)
    })

    it("keeps the login's own secret-named value in [projects] where it was", () => {
      const result = merge('model = "next"\n', '[projects]\npassword = "LOGIN_CANARY"\n')
      expect(tomlValue(result.content)).toEqual({ model: 'next', projects: { password: 'LOGIN_CANARY' } })
      expect(result.missingSecrets).toBe(false)
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
      const result = merge(source, target)
      expect(tomlValue(result.content)).toEqual(wanted)
      // A second refresh changes nothing.
      expect(merge(source, result.content).content).toBe(result.content)
    })

    it('adds a second hook beside an inline hooks.state', () => {
      const result = merge(
        '[hooks.state."k2"]\ntrusted_hash = "sha256:two"\n',
        'hooks.state = { k = { enabled = false } }\n'
      )
      expect(tomlValue(result.content)).toEqual({
        hooks: { state: { k: { enabled: false }, k2: { trusted_hash: 'sha256:two' } } }
      })
    })

    it('adds a folder beside folders written as dotted keys', () => {
      const result = merge(
        "[projects.'e:\\b']\ntrust_level = \"trusted\"\n",
        "projects.'e:\\a'.trust_level = \"untrusted\"\n"
      )
      expect(tomlValue(result.content)).toEqual({
        projects: { 'e:\\a': { trust_level: 'untrusted' }, 'e:\\b': { trust_level: 'trusted' } }
      })
    })

    it('sets, adds and removes settings inside dotted and inline tables', () => {
      const result = merge(
        '[features]\nmemories = false\nfresh = true\n[tui]\ntheme = "dark"\n',
        'features.memories = true\nfeatures.old = 1\ntui = { theme = "light", old = 2, older = 3 }\n'
      )
      expect(tomlValue(result.content)).toEqual({ features: { memories: false, fresh: true }, tui: { theme: 'dark' } })
      expect(merge('[features]\nmemories = false\nfresh = true\n[tui]\ntheme = "dark"\n', result.content).content).toBe(result.content)
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
      const result = merge(source, '')
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
      const result = merge(`model = "b"\n${server}`, `model = "a"\n${server}`)
      expect(result.content).toBe(`model = "b"\n${server}`)
      expect(sameTomlSettings(server, '')).toBe(false)
    })

    it('never changes a shared prototype', () => {
      const source = 'constructor.prototype.leak_one = 1\n[a.__proto__]\nleak_two = 2\n[b.toString]\nleak_three = 3\n'
      expect(sameTomlSettings(publicAccountConfig(source), source)).toBe(true)
      expect(sameTomlSettings(merge(source, '').content, source)).toBe(true)
      tomlValue(source)
      const probe: Record<string, unknown> = {}
      expect([probe['leak_one'], probe['leak_two'], probe['leak_three']]).toEqual([undefined, undefined, undefined])
      expect((Object as unknown as Record<string, unknown>)['prototype']).toBe(Object.prototype)
      expect(Object.keys(Object.prototype)).toEqual([])
    })
  })

  it('tells valid TOML from text that is not', () => {
    expect(validToml('model = "m"\n')).toBe(true)
    expect(validToml('')).toBe(true)
    expect(validToml('hooks = [\n')).toBe(false)
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
      const result = merge('x = { date = 2030-01-01, n = 2 }\n', 'x = { date = 2030-01-01, n = 1 }\n')
      expect(result.content).toBe('x = { date = 2030-01-01, n = 2 }\n')
    })

    it('copies dates of every kind', () => {
      const source = 'a = 2030-01-01\nb = 2030-01-01 10:00:00z\nc = 10:00:00\nd = 2030-01-01T10:00:00\n'
      expect(sameTomlSettings(publicAccountConfig(source), source)).toBe(true)
      expect(sameTomlSettings(merge(source, '').content, source)).toBe(true)
    })

    it('replaces a date with a different date', () => {
      expect(merge('d = 2030-01-01\n', 'd = 2030-01-02\n').content).toBe('d = 2030-01-01\n')
      expect(sameTomlSettings('d = 2030-01-01\n', 'd = 2030-01-01T00:00:00\n')).toBe(false)
    })

    it('copies an integer past 2^53 exactly', () => {
      expect(publicAccountConfig('n = 9007199254740993\n')).toBe('n = 9007199254740993\n')
      expect(merge('n = 9007199254740993\n', 'n = 9007199254740992\n').content).toBe('n = 9007199254740993\n')
    })

    it('tells an integer from a float', () => {
      expect(merge('n = 1.0\n', 'n = 1\n').content).toBe('n = 1.0\n')
      expect(merge('n = 1\n', 'n = 1.0\n').content).toBe('n = 1\n')
      expect(sameTomlSettings('n = 1\n', 'n = 1.0\n')).toBe(false)
      expect(sameTomlSettings('n = 0x10\n', 'n = 16\n')).toBe(true)
    })
  })

  // An array of tables is one setting, like any other array: it is copied, replaced and
  // removed whole, and one secret anywhere in it keeps the whole list out.
  describe('arrays of tables', () => {
    it('leaves a list the login already has as it is', () => {
      const text = 'model = "m"\n[[agents]]\nname = "a"\n[agents.limits]\nturns = 3\n[[agents]]\nname = "b"\n'
      expect(merge(text, text).content).toBe(text)
    })

    it('copies a list the login does not have', () => {
      const result = merge('[[agents]]\nname = "a"\n[[agents]]\nname = "b"\n', 'model = "m"\n')
      expect(tomlValue(result.content)).toEqual({ agents: [{ name: 'a' }, { name: 'b' }] })
      expect(result.content).toContain('[[agents]]')
    })

    it("replaces the login's list with the default home's", () => {
      const source = 'model = "m"\n[[agents]]\nname = "b"\n[[agents]]\nname = "c"\n[agents.limits]\nturns = 1\n'
      const target = 'model = "x"\n[[agents]]\nname = "a"\n[tui]\ntheme = "dark"\n'
      const result = merge(source, target)
      // [tui] lost its last setting, so its header went too.
      expect(tomlValue(result.content)).toEqual({ model: 'm', agents: [{ name: 'b' }, { name: 'c', limits: { turns: 1 } }] })
      expect(result.content).not.toContain('[tui]')
      // A second refresh changes nothing.
      expect(merge(source, result.content).content).toBe(result.content)
    })

    it('removes a list the default home dropped', () => {
      const result = merge('model = "m"\n', '[[agents]]\nname = "a"\n[agents.limits]\nturns = 3\n')
      expect(tomlValue(result.content)).toEqual({ model: 'm' })
    })

    it('changes a value in place, keeping the comments and where the list stands', () => {
      const target = '[[agents]] # explanation\n# note\nname = "a"\n\n[tui]\ntheme = "dark"\n'
      const result = merge('[[agents]]\nname = "b"\n[tui]\ntheme = "dark"\n', target)
      expect(result.content).toBe('[[agents]] # explanation\n# note\nname = "b"\n\n[tui]\ntheme = "dark"\n')
    })

    it('sets, adds and removes values inside elements and their tables in place', () => {
      const source = '[[agents]]\nname = "a"\nturns = 5\n[agents.limits]\nsoft = 2\n[[agents]]\nname = "b"\n'
      const target = '# list\n[[agents]]\nname = "a"\nold = true # gone\n[agents.limits]\nsoft = 1\nhard = 3\n[[agents]]\nname = "b"\n[tui]\ntheme = "dark"\n'
      const result = merge(`${source}[tui]\ntheme = "dark"\n`, target)
      expect(tomlValue(result.content)).toEqual({
        agents: [{ name: 'a', turns: 5, limits: { soft: 2 } }, { name: 'b' }],
        tui: { theme: 'dark' }
      })
      expect(result.content.startsWith('# list\n[[agents]]\nname = "a"\n')).toBe(true)
      expect(result.content.indexOf('[tui]')).toBeGreaterThan(result.content.lastIndexOf('[[agents]]'))
    })

    it('adds elements after the last one and takes out elements past the new end', () => {
      const target = '[[agents]]\nname = "a" # first\n[tui]\ntheme = "dark"\n'
      const longer = merge('[[agents]]\nname = "a"\n[[agents]]\nname = "b"\n[tui]\ntheme = "dark"\n', target)
      expect(longer.content).toBe('[[agents]]\nname = "a" # first\n[[agents]]\nname = "b"\n[tui]\ntheme = "dark"\n')
      const shorter = merge('[[agents]]\nname = "a"\n[tui]\ntheme = "dark"\n', longer.content)
      expect(tomlValue(shorter.content)).toEqual({ agents: [{ name: 'a' }], tui: { theme: 'dark' } })
      expect(shorter.content).toContain('name = "a" # first')
    })

    it('writes CRLF lines into a file that uses them', () => {
      const target = '[[agents]]\r\nname = "a"\r\n[tui]\r\ntheme = "dark"\r\n'
      const result = merge('[[agents]]\nname = "b"\n[[agents]]\nname = "c"\n[tui]\ntheme = "dark"\nfresh = true\n', target)
      expect(tomlValue(result.content)).toEqual({ agents: [{ name: 'b' }, { name: 'c' }], tui: { theme: 'dark', fresh: true } })
      expect(result.content.replace(/\r\n/g, '')).not.toContain('\n')
    })

    it("keeps the login's list whole when it holds a secret, and does not copy one that does", () => {
      const own = '[[agents]]\nname = "a"\nenv = { K = "LOGIN_CANARY" }\n'
      expect(merge('[[agents]]\nname = "b"\n', own).content).toBe(own)
      const result = merge('[[agents]]\nname = "b"\nenv = { K = "DEFAULT_CANARY" }\n', '')
      expect(result.content).not.toContain('CANARY')
      expect(result.missingSecrets).toBe(true)
    })
  })
})

// The merge with the last merged copy: which settings of the login's file came from the
// default home, and which Codex or the user wrote there themselves.
describe('the three-way merge', () => {
  /** Merges twice: once to get the last merged copy, then again after the changes. */
  function refresh(firstSource: string, login: (merged: string) => string, nextSource: string): ReturnType<typeof mergeAccountConfig> {
    const first = merge(firstSource, '')
    return mergeAccountConfig(nextSource, login(first.content), first.merged)
  }

  it('keeps what Codex wrote into the login\'s file itself', () => {
    const source = 'model = "gpt-a"\n[features]\nmemories = true\n'
    const result = refresh(source, (content) => `${content}[notice]\nhide_full_access_warning = true\n[plugins."demo"]\nenabled = true\n`, source)
    expect(tomlValue(result.content)).toEqual({
      model: 'gpt-a',
      features: { memories: true },
      notice: { hide_full_access_warning: true },
      plugins: { demo: { enabled: true } }
    })
  })

  it("keeps the login's own /model choice until the default home changes its model", () => {
    const source = 'model = "gpt-a"\n'
    const chosen = refresh(source, (content) => content.replace('gpt-a', 'gpt-mini'), source)
    expect(tomlValue(chosen.content)).toEqual({ model: 'gpt-mini' })
    const changed = mergeAccountConfig('model = "gpt-b"\n', chosen.content, chosen.merged)
    expect(tomlValue(changed.content)).toEqual({ model: 'gpt-b' })
  })

  it('removes a setting the default home dropped, and keeps one it never had', () => {
    const result = refresh('model = "a"\nold = 1\n', (content) => `${content}own = 2\n`, 'model = "a"\n')
    expect(tomlValue(result.content)).toEqual({ model: 'a', own: 2 })
  })

  it('takes a table out whole, with its secrets, when its last ordinary setting goes', () => {
    const source = 'model = "a"\n[mcp_servers.demo]\nurl = "https://fixture.invalid"\n'
    const result = refresh(source, (content) => `${content}[mcp_servers.demo.env]\nAPI_KEY = "LOGIN_CANARY"\n`, 'model = "a"\n')
    expect(tomlValue(result.content)).toEqual({ model: 'a' })
    expect(result.content).not.toContain('mcp_servers')
  })

  it('takes such a table out on the first merge as well', () => {
    const result = merge('model = "a"\n', 'model = "a"\n[mcp_servers.demo]\ncommand = "x"\n[mcp_servers.demo.env]\nK = "LOGIN_CANARY"\n')
    expect(result.content).toBe('model = "a"\n')
  })

  it("keeps a table that only ever held the login's own secrets", () => {
    const own = '[shell_environment_policy.set]\nTOKEN = "LOGIN_CANARY"\n'
    expect(refresh('model = "a"\n', (content) => content + own, 'model = "b"\n').content).toContain('LOGIN_CANARY')
  })

  it('lets trust from the default home follow it, and keeps the login\'s own', () => {
    const untrusted = "[projects.'/w/a']\ntrust_level = \"untrusted\"\n"
    // The untrusted mark came from the default home, so trusting the folder there reaches the login.
    const again = refresh(untrusted, (content) => content, "[projects.'/w/a']\ntrust_level = \"trusted\"\n")
    expect(tomlValue(again.content)).toEqual({ projects: { '/w/a': { trust_level: 'trusted' } } })
    // The login's own mark stays when the default home trusts the folder.
    const own = refresh('model = "a"\n', (content) => content + untrusted, "model = \"a\"\n[projects.'/w/a']\ntrust_level = \"trusted\"\n")
    expect(tomlValue(own.content)).toEqual({ model: 'a', projects: { '/w/a': { trust_level: 'untrusted' } } })
    // Trust the default home gave and then dropped goes; the login's own stays.
    const dropped = refresh("[projects.'/w/b']\ntrust_level = \"trusted\"\n", (content) => content + untrusted, '')
    expect(tomlValue(dropped.content)).toEqual({ projects: { '/w/a': { trust_level: 'untrusted' } } })
  })

  it('stores the last merged copy without secrets', () => {
    const result = merge('model = "a"\nexperimental_bearer_token = "DEFAULT_CANARY"\n[mcp_servers.demo.env]\nK = "DEFAULT_CANARY"\n', '')
    expect(result.merged).toBe('model = "a"\n')
  })

  it('treats a last merged copy that is not TOML as none', () => {
    const result = mergeAccountConfig('model = "a"\n', 'model = "a"\nold = 1\n', 'model = [\n')
    expect(tomlValue(result.content)).toEqual({ model: 'a' })
  })

  it('is stable: a second merge with nothing changed gives the same file', () => {
    const source = 'model = "a"\n[projects."/w"]\ntrust_level = "trusted"\n[[agents]]\nname = "x"\n'
    const first = merge(source, '')
    const second = mergeAccountConfig(source, first.content, first.merged)
    expect(second.content).toBe(first.content)
    expect(second.merged).toBe(first.merged)
  })
})

describe('which keys hold secrets', () => {
  it.each([
    ['model_providers.p.experimental_bearer_token = "DEFAULT_CANARY"\n'],
    ['features.multi_agent_v2.message_board_remote.bearer_token = "DEFAULT_CANARY"\n'],
    ['mcp_servers.m.bearer_token = "DEFAULT_CANARY"\n'],
    ['mcp_servers.m.oauth.client_secret = "DEFAULT_CANARY"\n'],
    ['model_providers.p.query_params = { sig = "DEFAULT_CANARY" }\n'],
    ['otel.exporter.otlp-http.headers = { "x-api-key" = "DEFAULT_CANARY" }\n'],
    ['access_token = "DEFAULT_CANARY"\n'],
    ['api_key = "DEFAULT_CANARY"\n'],
    ['apiKey = "DEFAULT_CANARY"\n'],
    ['db_password = "DEFAULT_CANARY"\n']
  ])('never copies %s', (source) => {
    const result = merge(source, '')
    expect(result.content).not.toContain('CANARY')
    expect(result.merged).not.toContain('CANARY')
    expect(result.missingSecrets).toBe(true)
  })

  it('copies settings whose names only look like secrets, and warns about none of them', () => {
    const source = [
      'cli_auth_credentials_store = "keyring"',
      'mcp_oauth_credentials_store = "file"',
      'mcp_oauth_callback_port = 4321',
      'model_auto_compact_token_limit = 200000',
      'tool_output_token_limit = 9000',
      '[features]',
      'secret_auth_storage = true',
      '[mcp_servers.m]',
      'url = "https://fixture.invalid"',
      'bearer_token_env_var = "DEMO_TOKEN"',
      'env_vars = ["HOME"]',
      'env_http_headers = { "X-Demo" = "DEMO_HEADER" }',
      'auth = "oauth"',
      '[model_providers.p]',
      'env_key = "DEMO_API_KEY"',
      '[otel.exporter.otlp-http.tls]',
      'client-private-key = "/keys/client.pem"',
      ''
    ].join('\n')
    const result = merge(source, '')
    expect(sameTomlSettings(result.content, source)).toBe(true)
    expect(result.missingSecrets).toBe(false)
    expect(result.heldBack).toEqual([])
  })

  it("keeps the login's own bearer token where the default home has another", () => {
    const result = merge('[model_providers.p]\nbase_url = "https://b.invalid"\nexperimental_bearer_token = "DEFAULT_CANARY"\n',
      '[model_providers.p]\nbase_url = "https://a.invalid"\nexperimental_bearer_token = "LOGIN_TOKEN"\n')
    expect(tomlValue(result.content)).toEqual({ model_providers: { p: { base_url: 'https://b.invalid', experimental_bearer_token: 'LOGIN_TOKEN' } } })
    expect(result.content).not.toContain('DEFAULT_CANARY')
    expect(result.missingSecrets).toBe(false)
  })
})

describe('files the merge used to fail on', () => {
  it('reads a default home config.toml that starts with a byte order mark', () => {
    const result = merge('﻿model = "a"\n', '﻿model = "b"\n')
    expect(result.content).toBe('model = "a"\n')
    expect(publicAccountConfig('﻿model = "a"\n')).toBe('model = "a"\n')
    expect(sameTomlSettings('﻿model = "a"\n', 'model = "a"\n')).toBe(true)
  })

  it('follows a key that changes between a value and a table, both ways', () => {
    const toTable = merge('[tools]\nweb_search = true\n', 'tools = "all"\n')
    expect(tomlValue(toTable.content)).toEqual({ tools: { web_search: true } })
    const toValue = merge('tools = "all"\n', '[tools]\nweb_search = true\n')
    expect(tomlValue(toValue.content)).toEqual({ tools: 'all' })
  })

  it('copies folder and hook names that contain text such as secret:', () => {
    const source = '[projects."/w/secret:x"]\ntrust_level = "trusted"\n[hooks.state."file:/w/password=1/hooks.json:stop:0:0"]\ntrusted_hash = "sha256:a"\n'
    const result = merge(source, '')
    expect(sameTomlSettings(result.content, source)).toBe(true)
  })

  it('keeps a multi-line string multi-line, as the default home wrote it', () => {
    const source = 'developer_instructions = """\nline one\nline two\n"""\nn = 0x10\n'
    expect(merge(source, '').content).toBe(source)
  })

  // The two-way merge parsed the file again for every setting and took 5 to 7 seconds for
  // 1000 folders; this merge is linear and takes about 0.2 seconds for 2000 on an idle machine.
  it('merges a file with two thousand folders in a few seconds at most', () => {
    const folders = Array.from({ length: 2000 }, (_, index) => `[projects."/w/p${String(index)}"]\ntrust_level = "trusted"\n`).join('')
    const started = Date.now()
    const first = merge(`model = "a"\n${folders}`, '')
    const second = mergeAccountConfig(`model = "b"\n${folders}`, `${first.content}[notice]\nseen = true\n`, first.merged)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(Object.keys(tomlValue(second.content)['projects'] as object)).toHaveLength(2000)
    expect(tomlValue(second.content)).toMatchObject({ model: 'b', notice: { seen: true } })
  })
})

describe('settings held back by a secret', () => {
  it('names a list of tables whose new element was not copied because the list holds a secret', () => {
    const own = '[[agents]]\nname = "a"\nenv = { K = "LOGIN_CANARY" }\n'
    const source = '[[agents]]\nname = "a"\nenv = { K = "DEFAULT_CANARY" }\n[[agents]]\nname = "b"\n'
    const result = merge(source, own)
    expect(result.content).toBe(own)
    expect(result.heldBack).toEqual(['agents'])
    expect(JSON.stringify(result)).not.toContain('DEFAULT_CANARY')
    // The same list apart from its secrets is not named.
    expect(merge('[[agents]]\nname = "a"\nenv = { K = "DEFAULT_CANARY" }\n', own).heldBack).toEqual([])
  })

  it("names a setting the login's secret value stands in the way of", () => {
    const result = merge('[mcp_servers.m]\ncommand = "run"\n', '[mcp_servers.m]\ncommand = "run --token LOGIN_CANARY"\n')
    expect(result.content).toContain('LOGIN_CANARY')
    expect(result.heldBack).toEqual(['mcp_servers.m.command'])
  })
})

describe("a setting of the default home that gains a secret", () => {
  it("keeps the login's list of tables and names it, after the last merged copy had it", () => {
    const first = merge('[[agents]]\nname = "a"\n', '')
    const result = mergeAccountConfig('[[agents]]\nname = "a"\nenv = { K = "DEFAULT_CANARY" }\n', first.content, first.merged)
    expect(tomlValue(result.content)).toEqual({ agents: [{ name: 'a' }] })
    expect(result.heldBack).toEqual(['agents'])
    expect(JSON.stringify(result)).not.toContain('DEFAULT_CANARY')
  })

  it("keeps the login's list of tables on the first merge as well", () => {
    const result = merge('[[agents]]\nname = "a"\nenv = { K = "DEFAULT_CANARY" }\n', '[[agents]]\nname = "a"\n')
    expect(tomlValue(result.content)).toEqual({ agents: [{ name: 'a' }] })
    expect(result.heldBack).toEqual(['agents'])
  })

  it("keeps the login's plain value where the default home's now holds a password", () => {
    const first = merge('[model_providers.p]\nname = "P"\nbase_url = "https://p.invalid"\n', '')
    const result = mergeAccountConfig('[model_providers.p]\nname = "P"\nbase_url = "https://user:DEFAULT_CANARY@p.invalid"\n', first.content, first.merged)
    expect(tomlValue(result.content)).toEqual({ model_providers: { p: { name: 'P', base_url: 'https://p.invalid' } } })
    expect(result.heldBack).toEqual(['model_providers.p.base_url'])
    expect(JSON.stringify(result)).not.toContain('DEFAULT_CANARY')
  })
})

describe('an MCP server or model provider as one setting', () => {
  function refresh(firstSource: string, login: (merged: string) => string, nextSource: string): ReturnType<typeof mergeAccountConfig> {
    const first = merge(firstSource, '')
    return mergeAccountConfig(nextSource, login(first.content), first.merged)
  }

  it("removes an MCP server the default home dropped, with the login's own keys in it", () => {
    const source = 'model = "a"\n[mcp_servers.demo]\ncommand = "demo"\nargs = ["--fast"]\n'
    const result = refresh(source, (content) => `${content}[mcp_servers.demo.tools.search]\napproval_mode = "approve"\n`, 'model = "a"\n')
    expect(tomlValue(result.content)).toEqual({ model: 'a' })
    const disabled = refresh(source, (content) => content.replace('args =', 'enabled = false\nargs ='), 'model = "a"\n')
    expect(tomlValue(disabled.content)).toEqual({ model: 'a' })
  })

  it("removes a model provider the default home dropped, with the login's own keys in it", () => {
    const source = 'model = "a"\n[model_providers.p]\nname = "P"\nbase_url = "https://p.invalid"\n'
    const result = refresh(source, (content) => `${content}request_max_retries = 2\n`, 'model = "a"\n')
    expect(tomlValue(result.content)).toEqual({ model: 'a' })
  })

  it("keeps the login's own MCP server, which the default home never had", () => {
    const own = '[mcp_servers.mine]\ncommand = "mine"\nenabled = false\n'
    const result = refresh('model = "a"\n', (content) => content + own, 'model = "b"\n')
    expect(tomlValue(result.content)).toEqual({ model: 'b', mcp_servers: { mine: { command: 'mine', enabled: false } } })
  })
})

describe("a setting deleted from the login's file", () => {
  function refresh(firstSource: string, login: (merged: string) => string, nextSource: string): ReturnType<typeof mergeAccountConfig> {
    const first = merge(firstSource, '')
    return mergeAccountConfig(nextSource, login(first.content), first.merged)
  }

  it('stays out until the default home changes it', () => {
    const source = 'model = "a"\nmodel_reasoning_effort = "high"\n'
    const kept = refresh(source, (content) => content.replace('model_reasoning_effort = "high"\n', ''), source)
    expect(tomlValue(kept.content)).toEqual({ model: 'a' })
    const changed = mergeAccountConfig('model = "a"\nmodel_reasoning_effort = "low"\n', kept.content, kept.merged)
    expect(tomlValue(changed.content)).toEqual({ model: 'a', model_reasoning_effort: 'low' })
  })

  it('keeps a whole MCP server out, and brings it back whole once the default home changes any of it', () => {
    const source = 'model = "a"\n[mcp_servers.demo]\ncommand = "demo"\nargs = ["--fast"]\n'
    const kept = refresh(source, () => 'model = "a"\n', source)
    expect(tomlValue(kept.content)).toEqual({ model: 'a' })
    const changed = mergeAccountConfig(source.replace('--fast', '--slow'), kept.content, kept.merged)
    expect(tomlValue(changed.content)).toEqual({ model: 'a', mcp_servers: { demo: { command: 'demo', args: ['--slow'] } } })
  })

  it('stays out when it was a trust field', () => {
    const source = "[projects.'/w/a']\ntrust_level = \"trusted\"\n[notice]\nseen = true\n"
    const kept = refresh(source, (content) => content.replace(/\[projects[^\n]*\ntrust_level[^\n]*\n/, ''), source)
    expect(tomlValue(kept.content)).toEqual({ notice: { seen: true } })
  })

  it("keeps the login's table where the default home's value is the one last merged in", () => {
    const kept = refresh('tools = "all"\n', () => '[tools]\nweb_search = true\n', 'tools = "all"\n')
    expect(tomlValue(kept.content)).toEqual({ tools: { web_search: true } })
  })
})
