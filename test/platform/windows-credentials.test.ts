import { describe, expect, it } from 'vitest'
import { keychainService } from '../../src/core/keychain-service.ts'
import type { RunResult } from '../../src/platform/run.ts'
import {
  CHUNK_CHARS,
  credReadScript,
  credentialTarget,
  parseCredReadOutput,
  powerShellCredentialRead,
  readStoredRecords,
  type CredentialAnswer,
  type CredentialRead
} from '../../src/platform/windows-credentials.ts'

const RECORD = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-example', refreshToken: 'example-refresh', expiresAt: 4_100_000_000_000 } })

const found = (text: string): CredentialAnswer => ({ kind: 'found', blob: Buffer.from(text, 'utf8') })
const missing: CredentialAnswer = { kind: 'missing' }

/** A `CredentialRead` over a map of target names, recording each batch it was asked for. */
function store(items: Record<string, string>): { read: CredentialRead; batches: string[][] } {
  const batches: string[][] = []
  return {
    batches,
    read: (targets) => {
      batches.push([...targets])
      return Promise.resolve(targets.map((target) => (target in items ? found(items[target] ?? '') : missing)))
    }
  }
}

describe('Credential Manager target names', () => {
  it('are the Keychain service name with /claude-code-user, as Claude Code names them through Bun.secrets', () => {
    expect(credentialTarget(null)).toBe('Claude Code-credentials/claude-code-user')
    expect(credentialTarget('C:\\Users\\Example\\.kurmis\\claude\\work', '#m'))
      .toBe(`${keychainService('C:\\Users\\Example\\.kurmis\\claude\\work')}/claude-code-user#m`)
    expect(credentialTarget('C:\\x')).toMatch(/^Claude Code-credentials-[0-9a-f]{8}\/claude-code-user$/)
  })
})

describe('the CredReadW script', () => {
  it('declares CredReadW and quotes every target name for PowerShell', () => {
    const script = credReadScript(["Claude Code-credentials/claude-code-user", "it's/claude-code-user#0"])
    expect(script).toContain('CredReadW(string target, int type, int flags, out IntPtr credential)')
    expect(script).toContain("$targets=@('Claude Code-credentials/claude-code-user','it''s/claude-code-user#0')")
    expect(script).toContain('[KurmisCredRead]::Read($targets[$i])')
  })

  it('has its answers read back by index', () => {
    const blob = Buffer.from(RECORD).toString('base64')
    expect(parseCredReadOutput(`1 -\r\n0 + ${blob}\r\n2 ! 5\r\n`, 3)).toEqual([
      { kind: 'found', blob: Buffer.from(RECORD) }, { kind: 'missing' }, { kind: 'error', code: 5 }
    ])
    expect(parseCredReadOutput('0 -\r\n', 2)).toBeNull()
    expect(parseCredReadOutput('', 0)).toEqual([])
  })
})

describe('readStoredRecords', () => {
  it('reads a record kept whole, and nothing for a login without one', async () => {
    const { read, batches } = store({ [credentialTarget(null)]: RECORD })
    expect(await readStoredRecords([null, 'C:\\work'], read)).toEqual([{ kind: 'found', text: RECORD }, { kind: 'missing' }])
    expect(batches).toEqual([[credentialTarget(null), credentialTarget(null, '#m'), credentialTarget('C:\\work'), credentialTarget('C:\\work', '#m')]])
  })

  it('joins a chunked record the way Claude Code writes it: base64 slices of 2400 characters and a #m count', async () => {
    const big = JSON.stringify({ claudeAiOauth: JSON.parse(RECORD).claudeAiOauth, mcpOAuth: { example: 'x'.repeat(5000) } })
    const encoded = Buffer.from(big, 'utf8').toString('base64')
    const slices = Array.from({ length: Math.ceil(encoded.length / CHUNK_CHARS) }, (_, i) => encoded.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS))
    const items: Record<string, string> = { [credentialTarget(null, '#m')]: JSON.stringify({ n: slices.length, l: encoded.length }) }
    slices.forEach((slice, i) => { items[credentialTarget(null, `#${String(i)}`)] = slice })
    // A whole item left from before is not used while #m is valid.
    items[credentialTarget(null)] = 'stale'
    const { read, batches } = store(items)
    expect(await readStoredRecords([null], read)).toEqual([{ kind: 'found', text: big }])
    expect(batches[1]).toEqual(slices.map((_, i) => credentialTarget(null, `#${String(i)}`)))
  })

  it('reads the whole item when #m is not a valid count, and fails a chunked record that does not add up', async () => {
    const invalid = store({ [credentialTarget(null)]: RECORD, [credentialTarget(null, '#m')]: JSON.stringify({ n: 0, l: 10 }) })
    expect(await readStoredRecords([null], invalid.read)).toEqual([{ kind: 'found', text: RECORD }])
    const short = store({ [credentialTarget(null, '#m')]: JSON.stringify({ n: 2, l: 10 }), [credentialTarget(null, '#0')]: 'abcd' })
    expect((await readStoredRecords([null], short.read))[0]).toMatchObject({ kind: 'failed' })
    const wrongLength = store({ [credentialTarget(null, '#m')]: JSON.stringify({ n: 1, l: 10 }), [credentialTarget(null, '#0')]: 'abcd' })
    expect((await readStoredRecords([null], wrongLength.read))[0]).toMatchObject({ kind: 'failed' })
  })
})

describe('powerShellCredentialRead', () => {
  const result = (patch: Partial<RunResult>): RunResult => ({ stdout: '', stderr: '', code: 0, timedOut: false, outputTooLarge: false, error: null, ...patch })

  it('runs the script encoded, without a shell, and reads the answers', async () => {
    const calls: Array<{ program: string; args: readonly string[] }> = []
    const read = powerShellCredentialRead({}, (program, args) => {
      calls.push({ program, args })
      return Promise.resolve(result({ stdout: `0 + ${Buffer.from(RECORD).toString('base64')}\r\n1 -\r\n` }))
    })
    expect(await read(['a/claude-code-user', 'a/claude-code-user#m'])).toEqual([found(RECORD), missing])
    expect(calls[0]?.program).toBe(process.env.KURMIS_POWERSHELL_PROGRAM)
    expect(calls[0]?.args).toContain('-EncodedCommand')
  })

  it('throws with what PowerShell said on stderr, never with what it printed on stdout', async () => {
    const read = powerShellCredentialRead({}, () => Promise.resolve(result({
      code: 1, stdout: '0 + c2VjcmV0', stderr: 'Cannot add type. Definition of new types is not supported in this language mode.'
    })))
    const error = await read(['a']).then(() => new Error('no error'), (caught: unknown) => caught as Error)
    expect(error.message).toContain('not supported in this language mode')
    expect(error.message).not.toContain('c2VjcmV0')
  })

  it('reaches only the PowerShell stand-in in tests, which fails', async () => {
    await expect(powerShellCredentialRead({})(['a/claude-code-user'])).rejects.toThrow(/PowerShell exited with code 1/)
  })
})
