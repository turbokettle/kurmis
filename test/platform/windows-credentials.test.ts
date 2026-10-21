import { describe, expect, it } from 'vitest'
import { keychainService } from '../../src/core/keychain-service.ts'
import type { RunResult } from '../../src/platform/run.ts'
import { realSystemProgram } from '../../src/platform/system-programs.ts'
import {
  CHUNK_CHARS,
  chooseAccount,
  credEnumScript,
  credentialBatches,
  credentialFilter,
  holdsStoredRecord,
  MAX_ENCODED_COMMAND_CHARS,
  parseCredEnumOutput,
  powerShellCredentialRead,
  powerShellInvocation,
  powerShellQuote,
  preferredAccounts,
  readStoredRecords,
  type CredentialRead,
  type FilterAnswer
} from '../../src/platform/windows-credentials.ts'

const RECORD = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-example', refreshToken: 'example-refresh', expiresAt: 4_100_000_000_000 } })
const SERVICE = 'Claude Code-credentials'
const ACCOUNTS = ['example-user', 'claude-code-user']

/** A Credential Manager in memory, listed the way `CredEnumerateW` lists a `<prefix>*` filter, recording each call. */
function store(items: Record<string, string>): { read: CredentialRead; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    read: (filters) => {
      calls.push([...filters])
      return Promise.resolve(filters.map((filter): FilterAnswer => {
        const prefix = filter.replace(/\*$/, '').toLowerCase()
        const listed = Object.entries(items).filter(([name]) => name.toLowerCase().startsWith(prefix))
        return { kind: 'items', items: new Map(listed.map(([name, blob]) => [name, Buffer.from(blob, 'utf8')])) }
      }))
    }
  }
}

const encoded = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

describe('Credential Manager names', () => {
  it('are listed with the Keychain service name and /*, whatever the account name is', () => {
    expect(credentialFilter(null)).toBe('Claude Code-credentials/*')
    expect(credentialFilter('C:\\Users\\Example\\.kurmis\\claude\\work'))
      .toBe(`${keychainService('C:\\Users\\Example\\.kurmis\\claude\\work')}/*`)
  })

  it('prefer the account name Claude Code gives on macOS, then claude-code-user', () => {
    expect(preferredAccounts({ USER: 'example' }, () => 'other')).toEqual(['example', 'claude-code-user'])
    expect(preferredAccounts({}, () => 'Example.User')).toEqual(['Example.User', 'claude-code-user'])
    expect(preferredAccounts({}, () => 'Jānis Bērziņš')).toEqual(['claude-code-user'])
    expect(preferredAccounts({}, () => { throw new Error('no user') })).toEqual(['claude-code-user'])
  })

  it('take the preferred account that is there, else the only one, else none', () => {
    expect(chooseAccount(['claude-code-user', 'example-user'], ACCOUNTS)).toBe('example-user')
    expect(chooseAccount(['CLAUDE-CODE-USER'], ACCOUNTS)).toBe('claude-code-user')
    expect(chooseAccount(['someone'], ACCOUNTS)).toBe('someone')
    expect(chooseAccount(['someone', 'another'], ACCOUNTS)).toBeNull()
  })
})

describe('the CredEnumerateW script', () => {
  it('declares CredEnumerateW and quotes every filter for PowerShell', () => {
    const script = credEnumScript(['Claude Code-credentials/*', "it's/*"])
    expect(script).toContain('CredEnumerateW(string filter, int flags, out int count, out IntPtr credentials)')
    expect(script).toContain("$filters=@('Claude Code-credentials/*','it''s/*')")
    expect(script).toContain('[KurmisCredEnum]::List($filters[$i])')
  })

  it('has its answers read back by index, with the count checked', () => {
    const stdout = [
      `1 + ${encoded('a/claude-code-user')} ${encoded(RECORD)}`,
      `1 + ${encoded('a/claude-code-user#m')} `,
      '1 . 2',
      '0 . 0',
      '2 ! 5'
    ].join('\r\n')
    expect(parseCredEnumOutput(stdout, 3)).toEqual([
      { kind: 'items', items: new Map() },
      { kind: 'items', items: new Map([['a/claude-code-user', Buffer.from(RECORD)], ['a/claude-code-user#m', Buffer.alloc(0)]]) },
      { kind: 'error', code: 5 }
    ])
    expect(parseCredEnumOutput('0 . 0\r\n', 2)).toBeNull()
    expect(parseCredEnumOutput(`0 + ${encoded('a/x')} ${encoded('y')}\r\n0 . 2\r\n`, 1)).toBeNull()
    expect(parseCredEnumOutput('', 0)).toEqual([])
  })

  it('is split into runs whose -EncodedCommand stays within the command line limit', () => {
    const filters = Array.from({ length: 600 }, (_, i) => credentialFilter(`C:\\Users\\Example\\.kurmis\\claude\\login-${String(i)}`))
    const batches = credentialBatches(filters)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.flat()).toEqual(filters)
    for (const batch of batches) {
      expect(Buffer.from(credEnumScript(batch), 'utf16le').toString('base64').length).toBeLessThanOrEqual(MAX_ENCODED_COMMAND_CHARS)
    }
    // A hundred logins still fit in one run.
    expect(credentialBatches(filters.slice(0, 100))).toHaveLength(1)
  })
})

describe('readStoredRecords', () => {
  it('reads a record kept whole under any account name, and nothing for a login without one', async () => {
    const { read, calls } = store({ [`${SERVICE}/someone`]: RECORD, [`${keychainService('C:\\other')}/someone`]: 'other login' })
    expect(await readStoredRecords([null, 'C:\\work'], read, ACCOUNTS)).toEqual([{ kind: 'found', text: RECORD }, { kind: 'missing' }])
    expect(calls).toEqual([[credentialFilter(null), credentialFilter('C:\\work')]])
  })

  it('does not take another login\'s record, whose service name only starts the same', async () => {
    const { read } = store({ [`${keychainService('C:\\work')}/claude-code-user`]: RECORD })
    expect(await readStoredRecords([null], read, ACCOUNTS)).toEqual([{ kind: 'missing' }])
  })

  it('takes the preferred account when there are several, and fails when none of them is preferred', async () => {
    const several = store({ [`${SERVICE}/claude-code-user`]: 'older', [`${SERVICE}/example-user`]: RECORD })
    expect(await readStoredRecords([null], several.read, ACCOUNTS)).toEqual([{ kind: 'found', text: RECORD }])
    const unknown = store({ [`${SERVICE}/one`]: RECORD, [`${SERVICE}/two`]: RECORD })
    expect((await readStoredRecords([null], unknown.read, ACCOUNTS))[0]).toMatchObject({ kind: 'failed' })
  })

  it('joins a chunked record the way Claude Code writes it: base64 slices of 2400 characters and a #m count', async () => {
    const big = JSON.stringify({ claudeAiOauth: JSON.parse(RECORD).claudeAiOauth, mcpOAuth: { example: 'x'.repeat(5000) } })
    const base64 = Buffer.from(big, 'utf8').toString('base64')
    const slices = Array.from({ length: Math.ceil(base64.length / CHUNK_CHARS) }, (_, i) => base64.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS))
    const items: Record<string, string> = { [`${SERVICE}/claude-code-user#m`]: JSON.stringify({ n: slices.length, l: base64.length }) }
    slices.forEach((slice, i) => { items[`${SERVICE}/claude-code-user#${String(i)}`] = slice })
    // A whole item left from before is not used while #m is valid.
    items[`${SERVICE}/claude-code-user`] = 'stale'
    const { read, calls } = store(items)
    expect(await readStoredRecords([null], read, ACCOUNTS)).toEqual([{ kind: 'found', text: big }])
    // One run lists the slices too.
    expect(calls).toHaveLength(1)
  })

  it('reads the whole item when #m is not a valid count, and fails a chunked record that does not add up', async () => {
    const user = `${SERVICE}/claude-code-user`
    const invalid = store({ [user]: RECORD, [`${user}#m`]: JSON.stringify({ n: 0, l: 10 }) })
    expect(await readStoredRecords([null], invalid.read, ACCOUNTS)).toEqual([{ kind: 'found', text: RECORD }])
    const short = store({ [`${user}#m`]: JSON.stringify({ n: 2, l: 10 }), [`${user}#0`]: 'abcd' })
    expect((await readStoredRecords([null], short.read, ACCOUNTS))[0]).toMatchObject({ kind: 'failed' })
    const wrongLength = store({ [`${user}#m`]: JSON.stringify({ n: 1, l: 10 }), [`${user}#0`]: 'abcd' })
    expect((await readStoredRecords([null], wrongLength.read, ACCOUNTS))[0]).toMatchObject({ kind: 'failed' })
  })

  it('reports a CredEnumerateW error for the login it belongs to', async () => {
    const read: CredentialRead = (filters) => Promise.resolve(filters.map((): FilterAnswer => ({ kind: 'error', code: 5 })))
    expect(await readStoredRecords([null], read, ACCOUNTS)).toEqual([{ kind: 'failed', reason: 'CredEnumerateW failed with Win32 error 5' }])
  })
})

describe('powerShellCredentialRead', () => {
  const result = (patch: Partial<RunResult>): RunResult => ({ stdout: '', stderr: '', code: 0, timedOut: false, outputTooLarge: false, error: null, ...patch })

  it('runs the script encoded, without a shell, and reads the answers', async () => {
    const calls: Array<{ program: string; args: readonly string[] }> = []
    const read = powerShellCredentialRead({}, (program, args) => {
      calls.push({ program, args })
      return Promise.resolve(result({ stdout: `0 + ${encoded('a/claude-code-user')} ${encoded(RECORD)}\r\n0 . 1\r\n1 . 0\r\n` }))
    })
    expect(await read(['a/*', 'b/*'])).toEqual([
      { kind: 'items', items: new Map([['a/claude-code-user', Buffer.from(RECORD)]]) },
      { kind: 'items', items: new Map() }
    ])
    expect(calls[0]?.program).toBe(process.env.KURMIS_POWERSHELL_PROGRAM)
    expect(calls[0]?.args).toContain('-EncodedCommand')
  })

  it('runs PowerShell once per batch', async () => {
    const filters = Array.from({ length: 600 }, (_, i) => credentialFilter(`C:\\Users\\Example\\.kurmis\\claude\\login-${String(i)}`))
    let runs = 0
    const read = powerShellCredentialRead({}, (_program, args) => {
      runs++
      const script = Buffer.from(args[args.length - 1] ?? '', 'base64').toString('utf16le')
      const count = (/\$filters=@\((.*)\)/.exec(script)?.[1] ?? '').split(',').length
      return Promise.resolve(result({ stdout: Array.from({ length: count }, (_, i) => `${String(i)} . 0`).join('\r\n') }))
    })
    expect(await read(filters)).toHaveLength(600)
    expect(runs).toBe(credentialBatches(filters).length)
  })

  it('throws with what PowerShell said on stderr, never with what it printed on stdout', async () => {
    const read = powerShellCredentialRead({}, () => Promise.resolve(result({
      code: 1, stdout: '0 + c2VjcmV0', stderr: 'Cannot add type. Definition of new types is not supported in this language mode.'
    })))
    const error = await read(['a/*']).then(() => new Error('no error'), (caught: unknown) => caught as Error)
    expect(error.message).toContain('not supported in this language mode')
    expect(error.message).not.toContain('c2VjcmV0')
  })

  it('reaches only the PowerShell stand-in in tests, which fails', async () => {
    await expect(powerShellCredentialRead({})(['a/*'])).rejects.toThrow(/PowerShell exited with code 1/)
  })
})

describe('holdsStoredRecord', () => {
  it('finds a login\'s record on Windows only, and answers false when it cannot read', async () => {
    const held = store({ [`${SERVICE}/claude-code-user`]: RECORD })
    expect(await holdsStoredRecord(null, {}, 'win32', held.read)).toBe(true)
    expect(await holdsStoredRecord('C:\\kurmis\\claude\\other', {}, 'win32', held.read)).toBe(false)
    expect(await holdsStoredRecord(null, {}, 'darwin', held.read)).toBe(false)
    expect(held.calls).toHaveLength(2)
    expect(await holdsStoredRecord(null, {}, 'win32', () => Promise.reject(new Error('PowerShell exited with code 1')))).toBe(false)
  })
})

describe('PowerShell', () => {
  it('doubles every quote character PowerShell ends a single-quoted string at', () => {
    expect(powerShellQuote("it's")).toBe("'it''s'")
    expect(powerShellQuote('a\u2018b\u2019c\u201ad\u201be')).toBe("'a\u2018\u2018b\u2019\u2019c\u201a\u201ad\u201b\u201be'")
    expect(powerShellQuote("O\u2019Brien's")).toBe("'O\u2019\u2019Brien''s'")
  })

  it('runs powershell from the Windows folder with the script encoded', () => {
    const { program, args } = powerShellInvocation('Write-Output 1', { SystemRoot: 'D:\\Windows' })
    // Every test has the stand-in; the real program is in the Windows folder.
    expect(program).toBe(process.env.KURMIS_POWERSHELL_PROGRAM)
    expect(realSystemProgram('powershell', { SystemRoot: 'D:\\Windows' })).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(args.slice(0, 5)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
    expect(Buffer.from(args[5] ?? '', 'base64').toString('utf16le')).toBe('Write-Output 1')
  })
})
