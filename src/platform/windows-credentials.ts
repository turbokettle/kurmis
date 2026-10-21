// Reading a Claude login's credentials record out of Windows Credential Manager.
//
// Newer Claude Code versions on Windows (seen from 2.1.150) can keep the record in Credential
// Manager instead of `.credentials.json`, through Bun's `Bun.secrets`. They do so when
// `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` is set or a server-side feature flag is on; they read
// Credential Manager first and the file when it has nothing, and they delete the file once the
// record is in Credential Manager. Read from the bundled code of Claude Code 2.1.306 for
// Windows (Bun 1.4.4) and Bun's `SecretsWindows.cpp`:
//
// - **The item.** A generic credential (`CRED_TYPE_GENERIC`) whose target name is
//   `<service>/claude-code-user`, where `<service>` is the same name the macOS Keychain item has
//   (`keychainService` in `src/core/keychain-service.ts`). Its blob is the UTF-8 bytes of the
//   same JSON the file holds.
// - **Chunks.** A record longer than 2400 bytes is base64-encoded and split into slices of 2400
//   characters, stored as `<service>/claude-code-user#0`, `#1`, … A credential
//   `<service>/claude-code-user#m` holds `{"n":<slices>,"l":<base64 length>}`. The CLI reads `#m`
//   first; when it is valid (0 < n <= 256 and 0 < l <= n * 2400) it joins the slices, checks the
//   length and decodes them, and otherwise it reads the item without a suffix. This reader does
//   the same.
//
// Node cannot call `CredReadW`, so a short PowerShell script does: it declares `CredReadW` with
// `Add-Type` and prints, for each target name, `<index> + <base64 of the blob>`, `<index> -`
// when there is no such credential, or `<index> ! <Win32 error>`. PowerShell is started through
// `runProgram`, with no shell and the script passed as `-EncodedCommand`. What it prints holds
// the record, so it is kept in memory only, and never logged or stored. `Add-Type` is refused
// under PowerShell's Constrained Language Mode (some managed machines); then nothing can be read
// here and the login's file is the only source.
import { keychainService } from '../core/keychain-service.ts'
import { powerShellInvocation, powerShellQuote } from './detach.ts'
import { runProgram, type RunResult } from './run.ts'

/** The account name Claude Code stores its record under. */
export const CREDENTIAL_USER_NAME = 'claude-code-user'

/** The longest slice of a chunked record, in base64 characters. */
export const CHUNK_CHARS = 2400

/** The most slices the CLI writes. */
export const MAX_CHUNKS = 256

/** How long one PowerShell run may take. Starting PowerShell alone can take a few seconds. */
export const CREDENTIAL_READ_TIMEOUT_MS = 20_000

/** The target name of a login's credential: `<service>/claude-code-user`, with a suffix such as `#m` or `#0`. */
export function credentialTarget(secureStorageDir: string | null, suffix = ''): string {
  return `${keychainService(secureStorageDir)}/${CREDENTIAL_USER_NAME}${suffix}`
}

/** The PowerShell script that reads `targets` with `CredReadW`; see the file's header for what it prints. */
export function credReadScript(targets: readonly string[]): string {
  return [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class KurmisCredRead {',
    '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
    '  private struct CREDENTIAL {',
    '    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;',
    '    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;',
    '    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;',
    '    public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;',
    '  }',
    '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
    '  private static extern bool CredReadW(string target, int type, int flags, out IntPtr credential);',
    '  [DllImport("advapi32.dll")]',
    '  private static extern void CredFree(IntPtr buffer);',
    '  public static string Read(string target) {',
    '    IntPtr p;',
    '    if (!CredReadW(target, 1, 0, out p)) {',
    '      int e = Marshal.GetLastWin32Error();',
    '      return e == 1168 ? "-" : "! " + e;',
    '    }',
    '    try {',
    '      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));',
    '      byte[] b = new byte[c.CredentialBlobSize];',
    '      if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);',
    '      return "+ " + Convert.ToBase64String(b);',
    '    } finally { CredFree(p); }',
    '  }',
    '}',
    "'@",
    `$targets=@(${targets.map(powerShellQuote).join(',')})`,
    'for($i=0;$i -lt $targets.Count;$i++){Write-Output ("$i "+[KurmisCredRead]::Read($targets[$i]))}'
  ].join('\n')
}

/** What one target read gave: its blob, no such credential, or a Win32 error code. */
export type CredentialAnswer = { kind: 'found'; blob: Buffer } | { kind: 'missing' } | { kind: 'error'; code: number }

/** Reads the answers `credReadScript` printed, one per target, in order. Null when the output does not have them all. */
export function parseCredReadOutput(stdout: string, count: number): CredentialAnswer[] | null {
  const answers: Array<CredentialAnswer | undefined> = new Array<CredentialAnswer | undefined>(count)
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\d+) (?:(-)|\+ ([A-Za-z0-9+/=]*)|! (\d+))$/.exec(line.trim())
    if (match === null) continue
    const index = Number(match[1])
    if (index >= count) continue
    if (match[2] !== undefined) answers[index] = { kind: 'missing' }
    else if (match[3] !== undefined) answers[index] = { kind: 'found', blob: Buffer.from(match[3], 'base64') }
    else answers[index] = { kind: 'error', code: Number(match[4]) }
  }
  const all: CredentialAnswer[] = []
  for (let index = 0; index < count; index++) {
    const answer = answers[index]
    if (answer === undefined) return null
    all.push(answer)
  }
  return all
}

/** Reads target names and answers each one, or throws an Error saying why nothing could be read. */
export type CredentialRead = (targets: readonly string[]) => Promise<CredentialAnswer[]>

function failureOf(result: RunResult): string {
  if (result.error !== null) return result.error
  const said = result.stderr.replace(/\s+/g, ' ').trim()
  return `PowerShell exited with code ${String(result.code)}${said === '' ? '' : `: ${said.slice(0, 300)}`}`
}

/** A `CredentialRead` that runs `credReadScript` in the PowerShell `powerShellInvocation` names for `env`. */
export function powerShellCredentialRead(env: NodeJS.ProcessEnv, run: typeof runProgram = runProgram): CredentialRead {
  return async (targets) => {
    if (targets.length === 0) return []
    const { program, args } = powerShellInvocation(credReadScript(targets), env)
    const result = await run(program, args, { timeoutMs: CREDENTIAL_READ_TIMEOUT_MS, env, maxOutputBytes: 16 * 1024 * 1024 })
    // The output holds the records, so it never goes into an error message; stderr does not.
    if (result.code !== 0 || result.error !== null) throw new Error(failureOf(result))
    const answers = parseCredReadOutput(result.stdout, targets.length)
    if (answers === null) throw new Error('PowerShell did not answer for every credential')
    return answers
  }
}

/** What reading one login's record gave: its JSON text, nothing stored, or why it failed. */
export type StoredRecord = { kind: 'found'; text: string } | { kind: 'missing' } | { kind: 'failed'; reason: string }

function chunkCount(blob: Buffer): { n: number; l: number } | null {
  let value: unknown
  try {
    value = JSON.parse(blob.toString('utf8'))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { n, l } = value as { n?: unknown; l?: unknown }
  if (typeof n !== 'number' || typeof l !== 'number' || !Number.isInteger(n) || !Number.isInteger(l)) return null
  return n > 0 && n <= MAX_CHUNKS && l > 0 && l <= n * CHUNK_CHARS ? { n, l } : null
}

/**
 * Reads the record of each login (`secureStorageDirs`, as `keychainService` takes them) from
 * Credential Manager, the way Claude Code reads it: chunks when `#m` is valid, else the item
 * itself. Takes two PowerShell runs at most, the second only for chunked records. Throws when
 * PowerShell could not read at all.
 */
export async function readStoredRecords(secureStorageDirs: ReadonlyArray<string | null>, read: CredentialRead): Promise<StoredRecord[]> {
  const first = secureStorageDirs.flatMap((dir) => [credentialTarget(dir), credentialTarget(dir, '#m')])
  const answers = await read(first)
  const records: StoredRecord[] = []
  const chunked: Array<{ index: number; dir: string | null; n: number; l: number }> = []
  secureStorageDirs.forEach((dir, index) => {
    const plain = answers[index * 2] as CredentialAnswer
    const meta = answers[index * 2 + 1] as CredentialAnswer
    const count = meta.kind === 'found' ? chunkCount(meta.blob) : null
    if (count !== null) {
      chunked.push({ index, dir, ...count })
      records.push({ kind: 'missing' })
    } else if (plain.kind === 'found') records.push({ kind: 'found', text: plain.blob.toString('utf8') })
    else if (plain.kind === 'missing') records.push({ kind: 'missing' })
    else records.push({ kind: 'failed', reason: `CredReadW failed with Win32 error ${String(plain.code)}` })
  })
  if (chunked.length === 0) return records
  const targets = chunked.flatMap(({ dir, n }) => Array.from({ length: n }, (_, i) => credentialTarget(dir, `#${String(i)}`)))
  const slices = await read(targets)
  let at = 0
  for (const { index, n, l } of chunked) {
    const mine = slices.slice(at, at + n)
    at += n
    if (mine.some((slice) => slice.kind !== 'found')) {
      records[index] = { kind: 'failed', reason: 'a slice of the chunked record is missing' }
      continue
    }
    const joined = mine.map((slice) => (slice as { blob: Buffer }).blob.toString('utf8')).join('')
    records[index] = joined.length === l
      ? { kind: 'found', text: Buffer.from(joined, 'base64').toString('utf8') }
      : { kind: 'failed', reason: 'the slices of the chunked record do not add up to its length' }
  }
  return records
}
