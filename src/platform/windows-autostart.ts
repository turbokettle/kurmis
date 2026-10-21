// The Windows logon entry `kurmis setup` registers, so the daemon starts when the user logs in.
//
// - **Where:** the value `kurmis` under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
//   Explorer runs every value there at logon, for this user only, and writing it needs no admin
//   rights. It also shows up in Task Manager's Startup tab, where the user can turn it off.
//   A Task Scheduler task could do the same but needs `schtasks.exe` XML and, for some
//   settings, elevation; a shortcut in the Startup folder needs COM to write.
// - **No console window:** node.exe is a console program, so running it straight from the Run
//   value would open a console window at every logon. The value runs
//   `wscript.exe //B //Nologo <autostart.vbs>` instead, and the script starts node with
//   `WScript.Shell.Run <command>, 0, False`: window style 0 is hidden, and False means it does
//   not wait. `//B` keeps wscript from showing a dialog when something fails at logon; the next
//   kurmis command starts the daemon anyway.
// - **REG_SZ with full paths:** the value names `wscript.exe` by its full path, with the
//   Windows folder read from `SystemRoot` when setup runs, rather than `%SystemRoot%` in a
//   REG_EXPAND_SZ value. The Windows folder does not move, and so the value does not depend on
//   whether Explorer expands variables in a Run value of either type.
// - **Writing it:** `reg.exe`, started through `runProgram` with no shell. Node quotes each
//   argument for CreateProcess with the Microsoft C runtime's rules (a quote inside becomes
//   `\"`), and reg.exe reads its command line with the same rules, so the quotes inside the
//   value reach the registry as they are. `reg add /d "\"C:\...\" ..."` is also the form
//   Microsoft documents for a value with quotes.
// - **The script** is UTF-16 with a byte order mark, which wscript reads whatever the system's
//   ANSI code page is, so a user folder with letters outside it still works. It sets the
//   kurmis variables the daemon needs (`KURMIS_HOME` as an absolute path, and the test hooks,
//   when set at setup) in its own environment before it starts node, since a program started at
//   logon gets only the user's environment from Windows. PATH is that environment's, which is the
//   user's normal one.
//
// `KURMIS_REG_PROGRAM` (a test hook) names a stand-in for reg.exe; tests use
// `test/platform/fake-reg/reg.mjs`.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, win32 } from 'node:path'
import { windowsAutostartScriptPath } from '../data/paths.ts'
import { makePrivateDirSync } from './files.ts'
import { windowsCommandLine } from './detach.ts'
import { DAEMON_JOB_VARIABLES } from './launchd.ts'
import { runProgram, type RunResult } from './run.ts'
import { inheritedTestHooks, SYSTEM_PROGRAM_VARIABLES, systemProgram, systemRoot } from './system-programs.ts'
import type { AutostartResult } from './autostart.ts'

/** The registry key whose values Explorer runs at the user's logon. */
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'

/** The name of kurmis' value under `RUN_KEY`. */
export const RUN_VALUE_NAME = 'kurmis'

/** The test hook naming a stand-in for `reg.exe`. */
export const REG_VARIABLE = SYSTEM_PROGRAM_VARIABLES.reg

const REG_TIMEOUT_MS = 30_000

/** Where the entry is, for the person to see. */
export const RUN_ENTRY_DESCRIPTION = `${RUN_KEY} (value "${RUN_VALUE_NAME}")`

export { systemRoot }

/** `KURMIS_REG_PROGRAM` (from `env`, else this process's environment), otherwise `<SystemRoot>\System32\reg.exe`. */
export function regProgram(env: NodeJS.ProcessEnv = process.env, processEnv: NodeJS.ProcessEnv = process.env): string {
  return systemProgram('reg', env, processEnv)
}

/** `KURMIS_WSCRIPT_PROGRAM` (as for `regProgram`), otherwise `<SystemRoot>\System32\wscript.exe`. */
export function wscriptPath(env: NodeJS.ProcessEnv = process.env, processEnv: NodeJS.ProcessEnv = process.env): string {
  return systemProgram('wscript', env, processEnv)
}

/** Runs `reg.exe` with these arguments and answers what happened. Never rejects. */
export type Reg = (args: readonly string[]) => Promise<RunResult>

export function regFor(env: NodeJS.ProcessEnv = process.env): Reg {
  const program = regProgram(env)
  return (args) => runProgram(program, args, { timeoutMs: REG_TIMEOUT_MS, env })
}

/** The Run value's data: wscript running the script, hidden and without dialogs. */
export function runValueData(wscript: string, scriptPath: string): string {
  return windowsCommandLine([wscript, '//B', '//Nologo', scriptPath])
}

export function regAddArgs(data: string): string[] {
  return ['add', RUN_KEY, '/v', RUN_VALUE_NAME, '/t', 'REG_SZ', '/d', data, '/f']
}

export function regQueryArgs(): string[] {
  return ['query', RUN_KEY, '/v', RUN_VALUE_NAME]
}

export function regDeleteArgs(): string[] {
  return ['delete', RUN_KEY, '/v', RUN_VALUE_NAME, '/f']
}

/**
 * The value `name` in what `reg query <key> /v <name>` printed: the lines are the key, then
 * `    <name>    <type>    <data>` with four spaces between the parts. Null when it is not there.
 */
export function parseRegQuery(stdout: string, name: string): { type: string; data: string } | null {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line)
    if (match !== null && (match[1] ?? '').toLowerCase() === name.toLowerCase()) {
      return { type: match[2] ?? '', data: match[3] ?? '' }
    }
  }
  return null
}

/**
 * A VBScript string literal: in quotes, with each quote inside doubled. A line break cannot be
 * in one, so text with a line break is refused.
 */
export function vbsString(text: string): string {
  if (/[\r\n]/.test(text)) throw new Error('a value for the logon script has a line break in it')
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * The kurmis variables a daemon started on Windows outside this process's environment needs:
 * the ones the logon script sets before it starts the daemon, and the ones a start through WMI
 * passes on the command line. `KURMIS_HOME` is made absolute (Windows path rules, from the
 * current folder), since the daemon starts in another folder.
 */
export function windowsAutostartEnvironment(env: NodeJS.ProcessEnv = process.env, processEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  const hooks = inheritedTestHooks(env, processEnv)
  for (const name of DAEMON_JOB_VARIABLES) {
    const value = env[name] || hooks[name]
    if (value !== undefined && value !== '') out[name] = name === 'KURMIS_HOME' ? win32.resolve(value) : value
  }
  return out
}

export interface AutostartScript {
  /** `[node, bundle, 'daemon', 'start', '--no-launchd']`. */
  programArguments: readonly string[]
  /** Variables set in the script's environment, which node inherits. */
  environment: Readonly<Record<string, string>>
  /** The folder node starts in: the user's profile folder. */
  cwd: string
}

/** The text of the logon script. Lines end with CRLF. */
export function autostartScript(script: AutostartScript): string {
  const lines = [
    "' Written by kurmis setup: starts the kurmis daemon at logon without a console window.",
    "' kurmis setup --undo removes it.",
    'Set shell = CreateObject("WScript.Shell")',
    ...Object.entries(script.environment).map(([name, value]) => `shell.Environment("Process")(${vbsString(name)}) = ${vbsString(value)}`),
    `shell.CurrentDirectory = ${vbsString(script.cwd)}`,
    `shell.Run ${vbsString(windowsCommandLine(script.programArguments))}, 0, False`
  ]
  return `${lines.join('\r\n')}\r\n`
}

const UTF16_BOM = Buffer.from([0xff, 0xfe])

/** The script as written to disk: UTF-16 little-endian with a byte order mark. */
export function encodeScript(text: string): Buffer {
  return Buffer.concat([UTF16_BOM, Buffer.from(text, 'utf16le')])
}

function readScript(path: string): string | null {
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch {
    return null
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  return bytes.toString('utf8')
}

function regSaid(result: RunResult): string {
  if (result.error !== null) return result.error
  const said = `${result.stderr}\n${result.stdout}`.replace(/\s+/g, ' ').trim()
  return said === '' ? `exit ${String(result.code)}` : `exit ${String(result.code)}: ${said}`
}

const ok = (result: RunResult): boolean => result.code === 0 && result.error === null

export interface WindowsAutostartOptions {
  env: NodeJS.ProcessEnv
  /** `[node, bundle, 'daemon', 'start', '--no-launchd']`. Needed to register. */
  programArguments?: readonly string[]
  /** Where the logon script is. `windowsAutostartScriptPath()` by default. */
  scriptPath?: string
  reg?: Reg
}

function userProfile(env: NodeJS.ProcessEnv): string {
  return env.USERPROFILE ?? env.HOME ?? dirname(windowsAutostartScriptPath())
}

/**
 * Writes the logon script and the Run value, each only when it differs from what is there.
 * A reg.exe failure is answered as a warning.
 */
export async function registerWindowsAutostart(options: WindowsAutostartOptions): Promise<AutostartResult> {
  const reg = options.reg ?? regFor(options.env)
  const scriptPath = options.scriptPath ?? windowsAutostartScriptPath()
  if (options.programArguments === undefined) throw new Error('registerWindowsAutostart needs programArguments')
  let text: string
  try {
    text = autostartScript({
      programArguments: options.programArguments,
      environment: windowsAutostartEnvironment(options.env),
      cwd: userProfile(options.env)
    })
  } catch (error) {
    return { changed: false, where: null, warning: `The logon entry was not written: ${(error as Error).message}.` }
  }
  let changed = false
  if (readScript(scriptPath) !== text) {
    makePrivateDirSync(dirname(scriptPath))
    writeFileSync(scriptPath, encodeScript(text))
    changed = true
  }
  const data = runValueData(wscriptPath(options.env), scriptPath)
  const query = await reg(regQueryArgs())
  const current = ok(query) ? parseRegQuery(query.stdout, RUN_VALUE_NAME) : null
  if (current !== null && current.type === 'REG_SZ' && current.data === data) {
    return { changed, where: RUN_ENTRY_DESCRIPTION }
  }
  const added = await reg(regAddArgs(data))
  if (!ok(added)) {
    return { changed, where: null, warning: `reg.exe could not write the logon entry ${RUN_ENTRY_DESCRIPTION} (${regSaid(added)}).` }
  }
  return { changed: true, where: RUN_ENTRY_DESCRIPTION }
}

/**
 * Removes the Run value and the logon script. A missing value or script is not an error.
 * Whether the value is there is asked with `reg query` first, because reg.exe's messages are in
 * the system's language and its exit code is 1 for every failure.
 */
export async function unregisterWindowsAutostart(options: WindowsAutostartOptions): Promise<AutostartResult> {
  const reg = options.reg ?? regFor(options.env)
  const scriptPath = options.scriptPath ?? windowsAutostartScriptPath()
  let changed = false
  let warning: string | undefined
  const query = await reg(regQueryArgs())
  if (ok(query) && parseRegQuery(query.stdout, RUN_VALUE_NAME) !== null) {
    const deleted = await reg(regDeleteArgs())
    if (ok(deleted)) changed = true
    else warning = `reg.exe could not remove the logon entry ${RUN_ENTRY_DESCRIPTION} (${regSaid(deleted)}).`
  }
  if (readScript(scriptPath) !== null) {
    rmSync(scriptPath, { force: true })
    changed = true
  }
  return warning === undefined ? { changed, where: RUN_ENTRY_DESCRIPTION } : { changed, where: RUN_ENTRY_DESCRIPTION, warning }
}
