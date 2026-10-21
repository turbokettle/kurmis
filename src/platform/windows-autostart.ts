// The Windows logon entry `kurmis setup` registers, so the daemon starts when the user logs in.
//
// - **Where:** the value `kurmis` under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
//   Explorer runs every value there at logon, for this user only, and writing it needs no admin
//   rights. It also shows up in Task Manager's Startup tab, where the user can turn it off.
// - **No console window:** node.exe is a console program, so running it straight from the Run
//   value would open a console window at every logon. The value runs
//   `wscript.exe //B //Nologo //E:JScript <autostart.js>` instead, and the script starts node with
//   `WScript.Shell.Run(<command>, 0, false)`: window style 0 is hidden, and false means it does
//   not wait. `//B` keeps wscript from showing a dialog when something fails at logon; the next
//   kurmis command starts the daemon anyway.
// - **Why JScript and the Run value.** The script used to be VBScript. Microsoft has deprecated
//   VBScript: since Windows 11 24H2 it is an optional feature, which is to be turned off by
//   default and later removed. JScript runs in the same Windows Script Host (`wscript.exe`) and
//   is not part of that deprecation, so the start stays hidden and needs no admin rights. The
//   other ways were weighed and are worse without admin rights: a shortcut in the Startup folder
//   needs COM to write and still opens node's console window (at best minimized); a Task
//   Scheduler logon task may need elevation to create, depending on policy, and runs node in a
//   visible console unless it runs whether the user is logged on or not, which needs a stored
//   password or elevation. When `wscript.exe` is missing, or Windows Script Host is turned off
//   (`Enabled` = 0 under `Software\Microsoft\Windows Script Host\Settings`), setup writes no
//   entry and says so; the next kurmis command starts the daemon anyway.
// - **REG_SZ with full paths:** the value names `wscript.exe` by its full path, with the
//   Windows folder read from `SystemRoot` when setup runs, rather than `%SystemRoot%` in a
//   REG_EXPAND_SZ value. The Windows folder does not move, and so the value does not depend on
//   whether Explorer expands variables in a Run value of either type.
// - **Writing it:** `reg.exe`, started through `runProgram` with no shell. Node quotes each
//   argument for CreateProcess with the Microsoft C runtime's rules (a quote inside becomes
//   `\"`), and reg.exe reads its command line with the same rules, so the quotes inside the
//   value reach the registry as they are. `reg add /d "\"C:\...\" ..."` is also the form
//   Microsoft documents for a value with quotes.
// - **Reading it back:** reg.exe prints in the console's OEM code page, not UTF-8, so a value
//   with letters outside ASCII does not read back as written: such a letter can come out as a
//   replacement character, a best-fit ASCII letter or `?`, or as two characters in a double-byte
//   code page. The comparison with what setup would write lets each run of such letters match
//   any run of 1 to twice as many characters, while the ASCII parts must be the same
//   (`sameRunData`); a value that still looks different is simply written again.
// - **The script** is UTF-16 with a byte order mark, which wscript reads whatever the system's
//   ANSI code page is, so a user folder with letters outside it still works. A program started
//   at logon gets only the user's environment from Windows, so the kurmis variables the daemon
//   needs (`KURMIS_HOME` as an absolute path, and the test hooks, when set at setup) go on its
//   command line as `--env NAME=VALUE`, which `daemon start` and `daemon run` put into their
//   environment. PATH is that environment's, which is the user's normal one.
// - **A `%` in the command line:** `WshShell.Run` replaces `%NAME%` in its command line with the
//   variable NAME (ExpandEnvironmentStrings, which has no escape), so a path or value with `%`
//   in it could turn into something else at logon. When the command line has a `%`, the script
//   sets the process variable `KURMIS_PERCENT_SIGN` to `%` and writes each `%` as
//   `%KURMIS_PERCENT_SIGN%`. The expansion is done once, left to right, so that gives back the
//   command line as it was. The script checks this with `ExpandEnvironmentStrings` and starts
//   nothing when it does not match; the next kurmis command starts the daemon anyway. A command
//   line without `%` is passed as it is.
//
// `KURMIS_REG_PROGRAM` and `KURMIS_WSCRIPT_PROGRAM` (test hooks) name stand-ins for reg.exe and
// wscript.exe; tests use `test/platform/fake-reg/reg.mjs` and `test/platform/fake-windows/`.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, win32 } from 'node:path'
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

/** The Run value's data: wscript running the script as JScript, hidden and without dialogs. */
export function runValueData(wscript: string, scriptPath: string): string {
  return windowsCommandLine([wscript, '//B', '//Nologo', '//E:JScript', scriptPath])
}

/** Where Windows Script Host is turned on or off, per user and for the machine. */
export const SCRIPT_HOST_SETTINGS_KEYS = [
  'HKCU\\Software\\Microsoft\\Windows Script Host\\Settings',
  'HKLM\\Software\\Microsoft\\Windows Script Host\\Settings'
]

/**
 * Whether `reg query <key> /v Enabled` says Windows Script Host is turned off: `Enabled` is 0,
 * as a REG_DWORD (`0x0`) or a REG_SZ (`0`). A missing value means it is on.
 */
export function scriptHostDisabled(query: RunResult): boolean {
  if (query.code !== 0 || query.error !== null) return false
  const value = parseRegQuery(query.stdout, 'Enabled')
  return value !== null && /^(0x0+|0)$/i.test(value.data.trim())
}

/**
 * Whether the Run value read back from `reg query` is the one setup writes, allowing for reg.exe
 * printing in the console's OEM code page, which Node reads as UTF-8. A character outside ASCII
 * can come out as a replacement character, as the OEM code page's own letter, as a best-fit
 * ASCII letter (`ā` as `a`), as `?`, or in a double-byte code page as two characters, of which
 * the second can be ASCII. So each run of characters outside ASCII in `written` matches any run
 * of 1 to twice as many characters in `read`. The ASCII parts between them must be the same in
 * both, so a value that differs there is always seen as different.
 */
export function sameRunData(read: string, written: string): boolean {
  const pattern = (written.match(/[\u0080-\uffff]+|[^\u0080-\uffff]+/g) ?? []).map((part) => {
    if (part.charCodeAt(0) < 0x80) return part.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&')
    return `[\\s\\S]{1,${String(part.length * 2)}}`
  }).join('')
  return new RegExp(`^${pattern}$`).test(read)
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
 * A JScript string literal: in double quotes, with each backslash and double quote inside
 * escaped. A line break cannot be in one, so text with a line break is refused.
 */
export function jscriptString(text: string): string {
  if (/[\r\n\u2028\u2029]/.test(text)) throw new Error('a value for the logon script has a line break in it')
  return `"${text.replace(/[\\"]/g, (char) => `\\${char}`)}"`
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
  /** Variables the daemon needs, passed on its command line as `--env NAME=VALUE`. */
  environment: Readonly<Record<string, string>>
  /** The folder node starts in: the user's profile folder. */
  cwd: string
}

/** The command line the logon script runs: the program, then `--env NAME=VALUE` for each variable. */
export function autostartCommandLine(script: AutostartScript): string {
  const assignments = Object.entries(script.environment).flatMap(([name, value]) => ['--env', `${name}=${value}`])
  return windowsCommandLine([...script.programArguments, ...assignments])
}

/** The process variable the logon script sets to `%`, so a `%` in the command line survives `WshShell.Run`. */
export const PERCENT_SIGN_VARIABLE = 'KURMIS_PERCENT_SIGN'

/**
 * The text of the logon script, in JScript. Lines end with CRLF. A `%` in the command line is
 * written as `%KURMIS_PERCENT_SIGN%`, as the file's header describes.
 */
export function autostartScript(script: AutostartScript): string {
  const command = autostartCommandLine(script)
  const lines = [
    '// Written by kurmis setup: starts the kurmis daemon at logon without a console window.',
    '// kurmis setup --undo removes it.',
    'var shell = new ActiveXObject("WScript.Shell");',
    `shell.CurrentDirectory = ${jscriptString(script.cwd)};`
  ]
  if (command.includes('%')) {
    const escaped = command.replaceAll('%', `%${PERCENT_SIGN_VARIABLE}%`)
    lines.push(
      `// shell.Run replaces %NAME% with the variable NAME, so each percent sign is written as ${PERCENT_SIGN_VARIABLE}.`,
      `shell.Environment("Process").Item(${jscriptString(PERCENT_SIGN_VARIABLE)}) = "%";`,
      `var command = ${jscriptString(escaped)};`,
      `if (shell.ExpandEnvironmentStrings(command) == ${jscriptString(command)}) shell.Run(command, 0, false);`
    )
  } else {
    lines.push(`shell.Run(${jscriptString(command)}, 0, false);`)
  }
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
 * Why Windows Script Host cannot run the logon script, or null when it can: `wscript.exe` is
 * missing, or Script Host is turned off for the user or the machine.
 */
async function scriptHostProblem(wscript: string, reg: Reg): Promise<string | null> {
  if (!existsSync(wscript)) {
    return `${wscript} does not exist, so Windows Script Host, which starts the daemon at logon without a console window, ` +
      'is not installed or was removed.'
  }
  for (const key of SCRIPT_HOST_SETTINGS_KEYS) {
    if (scriptHostDisabled(await reg(['query', key, '/v', 'Enabled']))) {
      return `Windows Script Host, which starts the daemon at logon without a console window, is turned off ("Enabled" is 0 ` +
        `under ${key}). Turn it on, or ask whoever manages this machine, and run kurmis setup again.`
    }
  }
  return null
}

/** The VBScript logon script an older kurmis wrote next to `scriptPath`, removed. Answers whether there was one. */
function removeOldVbsScript(scriptPath: string): boolean {
  const old = join(dirname(scriptPath), 'autostart.vbs')
  if (old === scriptPath || !existsSync(old)) return false
  rmSync(old, { force: true })
  return true
}

/**
 * Writes the logon script and the Run value, each only when it differs from what is there.
 * The VBScript an older kurmis wrote is removed only once the Run value names the new script
 * (it already did, or `reg add` succeeded). A reg.exe failure is answered as a warning.
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
  const wscript = wscriptPath(options.env)
  const unusable = await scriptHostProblem(wscript, reg)
  if (unusable !== null) {
    return {
      changed: false,
      where: null,
      warning: `The logon entry was not written: ${unusable} The next kurmis command starts the daemon anyway.`,
      noEntryPossible: true
    }
  }
  let changed = false
  if (readScript(scriptPath) !== text) {
    makePrivateDirSync(dirname(scriptPath))
    writeFileSync(scriptPath, encodeScript(text))
    changed = true
  }
  const data = runValueData(wscript, scriptPath)
  const query = await reg(regQueryArgs())
  const current = ok(query) ? parseRegQuery(query.stdout, RUN_VALUE_NAME) : null
  if (current !== null && current.type === 'REG_SZ' && sameRunData(current.data, data)) {
    // The Run value names the new script, so the old VBScript is no longer needed.
    if (removeOldVbsScript(scriptPath)) changed = true
    return { changed, where: RUN_ENTRY_DESCRIPTION }
  }
  const added = await reg(regAddArgs(data))
  if (!ok(added)) {
    // The Run value may still name the old VBScript, which is kept so that logon still starts
    // the daemon.
    return { changed, where: null, warning: `reg.exe could not write the logon entry ${RUN_ENTRY_DESCRIPTION} (${regSaid(added)}).` }
  }
  removeOldVbsScript(scriptPath)
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
  if (removeOldVbsScript(scriptPath)) changed = true
  return warning === undefined ? { changed, where: RUN_ENTRY_DESCRIPTION } : { changed, where: RUN_ENTRY_DESCRIPTION, warning }
}
