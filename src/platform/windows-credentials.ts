// Reading a Claude login's credentials record out of Windows Credential Manager.
//
// Newer Claude Code versions on Windows (seen from 2.1.150) can keep the record in Credential
// Manager instead of `.credentials.json`, through Bun's `Bun.secrets`. What is known, and how:
//
// - **When.** The CLI uses Credential Manager when `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` is set
//   or the server-side feature flag `tengu_windows_credman` is on. The flag is read from the
//   `cachedGrowthBookFeatures` of the CLI's own config file, the one that follows
//   `CLAUDE_CONFIG_DIR`: the older `.config.json` in the config folder when it is there and not
//   empty, else `<CLAUDE_CONFIG_DIR or home>/.claude.json`. Checked in the bundled JavaScript
//   of Claude Code 2.1.306 for macOS, which has this part.
// - **Read order.** The storage is the CLI's generic "primary with a fallback" storage: a read
//   takes the primary (here Credential Manager) and the fallback (`.credentials.json`) only when
//   the primary has nothing. The first write that goes to the primary deletes the fallback file,
//   and later writes go to the primary only. Checked in the same bundle (the macOS Keychain
//   storage is built the same way).
// - **The item.** A generic credential (`CRED_TYPE_GENERIC`) named `<service>/<account>`, where
//   `<service>` is the same name the macOS Keychain item has (`keychainService` in
//   `src/core/keychain-service.ts`). Its blob is the UTF-8 bytes of the same JSON the file
//   holds. The Windows storage code is not in the macOS bundle, so the account name could not be
//   checked: on macOS it is the `USER` variable or the user's name, and `claude-code-user` when
//   that has characters other than letters, digits, `.`, `_` and `-`; an earlier reading of
//   the Windows build (2.1.306) found `claude-code-user`. So this reader does not assume one: it
//   lists every credential whose name starts with `<service>/` (`CredEnumerateW` with the filter
//   `<service>/*`), and takes the account name the macOS rule gives, then `claude-code-user`,
//   then the only account there is (`chooseAccount`).
// - **Chunks.** From the same earlier reading of the Windows build: a record longer than 2400
//   bytes is base64-encoded and split into slices of 2400 characters, stored as
//   `<service>/<account>#0`, `#1`, … A credential `<service>/<account>#m` holds
//   `{"n":<slices>,"l":<base64 length>}`. The CLI reads `#m` first; when it is valid
//   (0 < n <= 256 and 0 < l <= n * 2400) it joins the slices, checks the length and decodes
//   them, and otherwise it reads the item without a suffix. This reader does the same.
//
// Node cannot call `CredEnumerateW`, so a short PowerShell script does: it declares it with
// `Add-Type` and prints, for each filter, one line `<index> + <base64 of the name> <base64 of the
// blob>` per credential and then `<index> . <count>`, or `<index> ! <Win32 error>`. PowerShell is
// started through `runProgram`, with no shell and the script passed as `-EncodedCommand`; a
// command line on Windows is at most 32,767 characters, so many logins are read in several
// runs (`credentialBatches`). What PowerShell prints holds the records, so it is kept in memory
// only, and never logged or stored. `Add-Type` is refused under PowerShell's Constrained
// Language Mode (some managed machines); then nothing can be read here and the login's file is
// the only source.
import { userInfo } from 'node:os'
import { keychainService } from '../core/keychain-service.ts'
import { runProgram, type RunResult } from './run.ts'
import { systemProgram } from './system-programs.ts'

/**
 * A PowerShell single-quoted string. PowerShell ends such a string at any of the single quote
 * characters `'`, `‘`, `’`, `‚` and `‛`, so each of them inside is doubled.
 */
export function powerShellQuote(text: string): string {
  return `'${text.replace(/['\u2018\u2019\u201a\u201b]/g, (quote) => quote + quote)}'`
}

/**
 * `powershell.exe` in the Windows folder (or the stand-in `KURMIS_POWERSHELL_PROGRAM` names), and
 * the arguments that run `script` without a profile.
 */
export function powerShellInvocation(script: string, env: NodeJS.ProcessEnv): { program: string; args: string[] } {
  return {
    program: systemProgram('powershell', env),
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
  }
}

/** The account name Claude Code falls back to when the user's name cannot be used. */
export const CREDENTIAL_USER_NAME = 'claude-code-user'

/** The longest slice of a chunked record, in base64 characters. */
export const CHUNK_CHARS = 2400

/** The most slices the CLI writes. */
export const MAX_CHUNKS = 256

/** How long one PowerShell run may take. Starting PowerShell alone can take a few seconds. */
export const CREDENTIAL_READ_TIMEOUT_MS = 20_000

/**
 * The longest `-EncodedCommand` value one run is given. Windows allows 32,767 characters for the
 * whole command line; the rest is left for the program's path and the other arguments.
 */
export const MAX_ENCODED_COMMAND_CHARS = 30_000

/** The filter that lists a login's credentials: `<service>/*`. */
export function credentialFilter(secureStorageDir: string | null): string {
  return `${keychainService(secureStorageDir)}/*`
}

/** The PowerShell script that lists the credentials of each filter with `CredEnumerateW`; see the file's header for what it prints. */
export function credEnumScript(filters: readonly string[]): string {
  return [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Text;',
    'using System.Runtime.InteropServices;',
    'public static class KurmisCredEnum {',
    '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
    '  private struct CREDENTIAL {',
    '    public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;',
    '    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;',
    '    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;',
    '    public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;',
    '  }',
    '  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
    '  private static extern bool CredEnumerateW(string filter, int flags, out int count, out IntPtr credentials);',
    '  [DllImport("advapi32.dll")]',
    '  private static extern void CredFree(IntPtr buffer);',
    '  public static string[] List(string filter) {',
    '    int count; IntPtr p;',
    '    if (!CredEnumerateW(filter, 0, out count, out p)) {',
    '      int e = Marshal.GetLastWin32Error();',
    '      return new string[] { e == 1168 ? ". 0" : "! " + e };',
    '    }',
    '    try {',
    '      string[] lines = new string[count + 1];',
    '      int found = 0;',
    '      for (int i = 0; i < count; i++) {',
    '        CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(Marshal.ReadIntPtr(p, i * IntPtr.Size), typeof(CREDENTIAL));',
    '        if (c.Type != 1) continue;',
    '        byte[] b = new byte[c.CredentialBlobSize];',
    '        if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, b, 0, c.CredentialBlobSize);',
    '        string name = Marshal.PtrToStringUni(c.TargetName);',
    '        lines[found++] = "+ " + Convert.ToBase64String(Encoding.UTF8.GetBytes(name)) + " " + Convert.ToBase64String(b);',
    '      }',
    '      lines[found] = ". " + found;',
    '      string[] output = new string[found + 1];',
    '      Array.Copy(lines, output, found + 1);',
    '      return output;',
    '    } finally { CredFree(p); }',
    '  }',
    '}',
    "'@",
    `$filters=@(${filters.map(powerShellQuote).join(',')})`,
    'for($i=0;$i -lt $filters.Count;$i++){foreach($line in [KurmisCredEnum]::List($filters[$i])){Write-Output ("$i "+$line)}}'
  ].join('\n')
}

/** What listing one filter gave: the credentials by name, or a Win32 error code. */
export type FilterAnswer = { kind: 'items'; items: ReadonlyMap<string, Buffer> } | { kind: 'error'; code: number }

/** Reads the answers `credEnumScript` printed, one per filter, in order. Null when the output does not have them all. */
export function parseCredEnumOutput(stdout: string, count: number): FilterAnswer[] | null {
  const items = Array.from({ length: count }, () => new Map<string, Buffer>())
  const answers: Array<FilterAnswer | undefined> = new Array<FilterAnswer | undefined>(count)
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\d+) (?:\+ ([A-Za-z0-9+/=]+)(?: ([A-Za-z0-9+/=]*))?|\. (\d+)|! (\d+))$/.exec(line.trim())
    if (match === null) continue
    const index = Number(match[1])
    const mine = items[index]
    if (mine === undefined || answers[index] !== undefined) continue
    if (match[2] !== undefined) mine.set(Buffer.from(match[2], 'base64').toString('utf8'), Buffer.from(match[3] ?? '', 'base64'))
    else if (match[4] !== undefined) answers[index] = Number(match[4]) === mine.size ? { kind: 'items', items: mine } : undefined
    else answers[index] = { kind: 'error', code: Number(match[5]) }
  }
  const all: FilterAnswer[] = []
  for (const answer of answers) {
    if (answer === undefined) return null
    all.push(answer)
  }
  return all.length === count ? all : null
}

/** Lists the credentials of each filter, or throws an Error saying why nothing could be read. */
export type CredentialRead = (filters: readonly string[]) => Promise<FilterAnswer[]>

function encodedLength(filters: readonly string[]): number {
  return Math.ceil((Buffer.byteLength(credEnumScript(filters), 'utf16le')) / 3) * 4
}

/** `filters` split into runs whose `-EncodedCommand` stays within `maxChars`. */
export function credentialBatches(filters: readonly string[], maxChars = MAX_ENCODED_COMMAND_CHARS): string[][] {
  const batches: string[][] = []
  let batch: string[] = []
  for (const filter of filters) {
    if (batch.length > 0 && encodedLength([...batch, filter]) > maxChars) {
      batches.push(batch)
      batch = []
    }
    batch.push(filter)
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

function failureOf(result: RunResult): string {
  if (result.error !== null) return result.error
  const said = result.stderr.replace(/\s+/g, ' ').trim()
  return `PowerShell exited with code ${String(result.code)}${said === '' ? '' : `: ${said.slice(0, 300)}`}`
}

/** A `CredentialRead` that runs `credEnumScript` in the PowerShell `powerShellInvocation` names for `env`, one run per batch. */
export function powerShellCredentialRead(env: NodeJS.ProcessEnv, run: typeof runProgram = runProgram): CredentialRead {
  return async (filters) => {
    const all: FilterAnswer[] = []
    for (const batch of credentialBatches(filters)) {
      const { program, args } = powerShellInvocation(credEnumScript(batch), env)
      const result = await run(program, args, { timeoutMs: CREDENTIAL_READ_TIMEOUT_MS, env, maxOutputBytes: 16 * 1024 * 1024 })
      // The output holds the records, so it never goes into an error message; stderr does not.
      if (result.code !== 0 || result.error !== null) throw new Error(failureOf(result))
      const answers = parseCredEnumOutput(result.stdout, batch.length)
      if (answers === null) throw new Error('PowerShell did not answer for every login')
      all.push(...answers)
    }
    return all
  }
}

/** What reading one login's record gave: its JSON text, nothing stored, or why it failed. */
export type StoredRecord = { kind: 'found'; text: string } | { kind: 'missing' } | { kind: 'failed'; reason: string }

/**
 * The account names to look for, in order: the one Claude Code gives on macOS (`USER`, else the
 * user's name, when it has only letters, digits, `.`, `_` and `-`), then `claude-code-user`.
 */
export function preferredAccounts(env: NodeJS.ProcessEnv = process.env, userName: () => string = () => userInfo().username): string[] {
  let name: string
  try {
    name = env.USER || userName()
  } catch {
    name = CREDENTIAL_USER_NAME
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) name = CREDENTIAL_USER_NAME
  return [...new Set([name, CREDENTIAL_USER_NAME])]
}

/**
 * The credentials listed under `service`, by account name and then by suffix (`''`, `#m`,
 * `#0`, …). Credential Manager compares names without regard to case, and so does this.
 */
function byAccount(service: string, items: ReadonlyMap<string, Buffer>): Map<string, Map<string, Buffer>> {
  const prefix = `${service}/`.toLowerCase()
  const accounts = new Map<string, Map<string, Buffer>>()
  for (const [name, blob] of items) {
    if (!name.toLowerCase().startsWith(prefix)) continue
    const match = /^(.*?)(#m|#\d+)?$/.exec(name.slice(prefix.length))
    const account = (match?.[1] ?? '').toLowerCase()
    const suffix = match?.[2] ?? ''
    let entries = accounts.get(account)
    if (entries === undefined) accounts.set(account, entries = new Map())
    entries.set(suffix, blob)
  }
  return accounts
}

/** The account whose record is read: the first of `preferred` that is there, else the only one. Null when there are several others. */
export function chooseAccount(accounts: readonly string[], preferred: readonly string[]): string | null {
  const lower = accounts.map((account) => account.toLowerCase())
  for (const name of preferred) if (lower.includes(name.toLowerCase())) return name.toLowerCase()
  return lower.length === 1 ? lower[0] ?? null : null
}

function chunkCount(blob: Buffer | undefined): { n: number; l: number } | null {
  if (blob === undefined) return null
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

/** One login's record from what was listed under its service, the way Claude Code reads it. */
export function recordFromItems(service: string, items: ReadonlyMap<string, Buffer>, preferred: readonly string[]): StoredRecord {
  const accounts = byAccount(service, items)
  if (accounts.size === 0) return { kind: 'missing' }
  const account = chooseAccount([...accounts.keys()], preferred)
  if (account === null) return { kind: 'failed', reason: 'Credential Manager has records under several account names, and none is the expected one' }
  const entries = accounts.get(account) ?? new Map<string, Buffer>()
  const count = chunkCount(entries.get('#m'))
  if (count === null) {
    const plain = entries.get('')
    return plain === undefined ? { kind: 'missing' } : { kind: 'found', text: plain.toString('utf8') }
  }
  const slices: string[] = []
  for (let i = 0; i < count.n; i++) {
    const slice = entries.get(`#${String(i)}`)
    if (slice === undefined) return { kind: 'failed', reason: 'a slice of the chunked record is missing' }
    slices.push(slice.toString('utf8'))
  }
  const joined = slices.join('')
  return joined.length === count.l
    ? { kind: 'found', text: Buffer.from(joined, 'base64').toString('utf8') }
    : { kind: 'failed', reason: 'the slices of the chunked record do not add up to its length' }
}

/**
 * Reads the record of each login (`secureStorageDirs`, as `keychainService` takes them) from
 * Credential Manager. One PowerShell run reads up to 247 logins, the most `credentialBatches`
 * fits in one command line, and more take several runs. Throws when PowerShell could not read
 * at all.
 */
export async function readStoredRecords(secureStorageDirs: ReadonlyArray<string | null>, read: CredentialRead,
  preferred: readonly string[] = preferredAccounts()): Promise<StoredRecord[]> {
  const filters = [...new Set(secureStorageDirs.map(credentialFilter))]
  const answers = await read(filters)
  return secureStorageDirs.map((dir): StoredRecord => {
    const answer = answers[filters.indexOf(credentialFilter(dir))]
    if (answer === undefined) return { kind: 'failed', reason: 'PowerShell did not answer for this login' }
    if (answer.kind === 'error') return { kind: 'failed', reason: `CredEnumerateW failed with Win32 error ${String(answer.code)}` }
    return recordFromItems(keychainService(dir), answer.items, preferred)
  })
}

/**
 * Whether Credential Manager holds a Claude record for the login whose CLI names it after
 * `secureStorageDir` (null for the machine's own login). False on other platforms, and when it cannot
 * be read. Runs PowerShell (`powerShellCredentialRead`) unless `read` is given.
 */
export async function holdsStoredRecord(secureStorageDir: string | null, env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform, read: CredentialRead = powerShellCredentialRead(env)): Promise<boolean> {
  if (platform !== 'win32') return false
  try {
    const [record] = await readStoredRecords([secureStorageDir], read)
    return record?.kind === 'found'
  } catch {
    return false
  }
}
