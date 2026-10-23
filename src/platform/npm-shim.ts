// Reading the `.cmd` files that npm, pnpm and yarn put on PATH for a package's programs, so that
// kurmis can start the real program without `cmd.exe` (`docs/architecture.md`, "Windows").
//
// A package manager installs a package's `bin` entry on Windows as three files next to each
// other: `<name>.cmd` for cmd.exe, `<name>.ps1` for PowerShell, and `<name>` (no extension) for
// Git Bash and Cygwin. PATHEXT makes `claude` find `claude.cmd`, so the `.cmd` is the one read
// here. Every generator writes the same kind of line at its core: the program, the arguments from
// the target's `#!` line, the quoted target path relative to the shim's own folder, and `%*`
// (the caller's arguments):
//
//   "%dp0%\node.exe"  "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*
//
// The forms read here, each with a fixture in `test/platform/fixtures/`:
//
// - npm's `cmd-shim` 5 and later (npm 8 to 12; the fixtures come from cmd-shim 8.0.0, which
//   npm 11.9.0 bundles, and 9.0.2, which npm 12.2.0 bundles): sets `dp0` to `%~dp0` in a
//   subroutine, sets `_prog` to `%dp0%\node.exe` when that file exists and to `node` otherwise,
//   and ends with `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" <args>
//   "%dp0%\<target>" %*` (9.0.2 puts `set PATHEXT=... &` before `"%_prog%"`). A target with no
//   `#!` line (such as an `.exe`) is started directly: `"%dp0%\<target>"   %*`.
// - npm's `cmd-shim` 4 (npm 7): the same `_prog` choice, with the run line at the start of a line
//   (`"%_prog%"  "%dp0%\<target>" %*`). Written by hand from that version's source.
// - npm's `cmd-shim` 2 and 3 (npm 6), which yarn 1's `@zkochan/cmd-shim` also wrote: an
//   `@IF EXIST "%~dp0\node.exe" ( ... ) ELSE ( ... )` with one run line in each branch, or
//   `@"%~dp0\<target>"   %*` for a target started directly. Written by hand.
// - pnpm's shims (the fixtures come from `@zkochan/cmd-shim` 9.0.8, the generator pnpm 10 and
//   earlier use, and from `@pnpm/bins.cmd-shim` 1100.0.4, the same code pnpm 11.28.6 bundles):
//   the same `IF EXIST` form with `%~dp0`, an `@SET "NODE_PATH=..."` block for global installs,
//   and optionally an absolute Node (`@"C:\Program Files\nodejs\node.exe" ... %*`),
//   `--preserve-symlinks` before the target and extra arguments after it. pnpm 11 writes each
//   `%` of a path or argument as `%%`, and when the shim has a non-ASCII character it switches
//   the console to UTF-8 (`chcp 65001`) at the start and back at the end.
//
// A `%%` is read as `%`. Any variable other than `%~dp0` and `%dp0%` makes the shim unreadable.
// The shim file is read as UTF-8, which is what npm and pnpm write.
//
// What is not taken over from a shim: the `NODE_PATH` that pnpm's shims set (Node finds a
// package's dependencies from the package's real folder without it), and the `@SET NAME=value`
// lines npm writes for a `#!/usr/bin/env -S NAME=value node` line. Claude Code uses neither.
//
// Everything here is pure and works on Windows-shaped paths (`path.win32`) on every OS.
import { win32 } from 'node:path'

/** What a `.cmd` shim starts. Every path is absolute. */
export interface CmdShim {
  /** The file the shim starts, or hands to the interpreter. */
  target: string
  /**
   * The programs the shim starts `target` with, in the order it tries them: absolute paths (used
   * when the file exists) and at most one bare program name, which cmd.exe would look up on
   * PATH. Empty when the shim starts `target` itself.
   */
  interpreters: string[]
  /** Arguments between the interpreter and `target`, such as the ones from the `#!` line. */
  interpreterArgs: string[]
  /** Arguments between `target` and the caller's own arguments. */
  targetArgs: string[]
}

/** The shim's contents, or why they are not a shim kurmis can read. */
export type CmdShimReading = CmdShim | { unreadable: string }

/** One line that ends in `%*`, split into words. */
interface RunLine {
  /** The program the line starts; more than one when it is `%_prog%`, set in both branches of an `IF`. */
  programs: string[]
  /** The words between the program and `%*`; empty when the program is the target itself. */
  rest: string[]
}

/**
 * The text of a shim file, or null when the bytes are not UTF-8. npm and pnpm write their shims
 * as UTF-8 without a byte order mark; a byte order mark, which an editor may add, is dropped.
 */
export function decodeCmdShim(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Reads a `.cmd` shim. `shimPath` is the shim's own absolute Windows path, against whose folder
 * `%~dp0` and `%dp0%` are resolved.
 */
export function parseCmdShim(text: string, shimPath: string): CmdShimReading {
  const folder = win32.dirname(win32.resolve(shimPath))
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const progValues = lines
    .map((line) => /^@?set\s+"_prog=([^"]*)"$/i.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)

  const runLines: RunLine[] = []
  for (const line of lines) {
    if (!/(^|\s)%\*$/.test(line)) continue
    const command = lastCommand(line.replace(/^@/, ''))
    const tokens = tokenize(command)
    if (tokens === null) return { unreadable: `the line ${JSON.stringify(line)} is not a plain command` }
    tokens.pop() // %*
    const [program, ...rest] = tokens
    if (program === undefined) return { unreadable: `the line ${JSON.stringify(line)} names no program` }
    const programs = /^@?%_prog%$/i.test(program) ? progValues : [program.replace(/^@/, '')]
    if (programs.length === 0) return { unreadable: 'the shim starts %_prog% but never sets it' }
    runLines.push({ programs, rest })
  }
  if (runLines.length === 0) return { unreadable: 'no line passes the arguments on (%*)' }

  let shim: CmdShim | null = null
  for (const run of runLines) {
    const reading = readRunLine(run, folder)
    if ('unreadable' in reading) return reading
    if (shim === null) {
      shim = reading
      continue
    }
    if (!sameCall(shim, reading)) return { unreadable: 'its lines start different programs' }
    for (const interpreter of reading.interpreters) {
      if (!shim.interpreters.includes(interpreter)) shim.interpreters.push(interpreter)
    }
  }
  return shim as CmdShim
}

/** The command and arguments that start a shim's target, or why kurmis will not start it. */
export type ShimInvocation = { command: string; args: string[] } | { refused: string }

export interface ShimInvocationOptions {
  /** The Node used when the shim would run its target with a `node` found on PATH. */
  nodePath: string
  /** Whether a file exists, for the interpreters the shim names by absolute path. */
  isFile: (path: string) => boolean
}

/**
 * How kurmis starts what `shim` starts, without cmd.exe. The shim's own choice is kept where
 * kurmis can make it: a `node.exe` next to the shim when there is one, otherwise `nodePath`
 * for a `node` the shim would look up on PATH. A target that is itself a batch file, or that
 * needs any other interpreter, is refused.
 */
export function cmdShimInvocation(shim: CmdShim, options: ShimInvocationOptions): ShimInvocation {
  if (/\.(cmd|bat)$/i.test(shim.target)) {
    return { refused: `${shim.target} is a batch file, which only cmd.exe can start` }
  }
  if (shim.interpreters.length === 0) {
    if (!/\.(exe|com)$/i.test(shim.target)) {
      return { refused: `the shim starts ${shim.target} directly, and that is not an .exe` }
    }
    return { command: shim.target, args: [...shim.targetArgs] }
  }
  for (const interpreter of shim.interpreters) {
    const command = isAbsoluteWindowsPath(interpreter)
      ? (options.isFile(interpreter) ? interpreter : null)
      : (/^node(\.exe)?$/i.test(interpreter) ? options.nodePath : null)
    if (command !== null) {
      return { command, args: [...shim.interpreterArgs, shim.target, ...shim.targetArgs] }
    }
  }
  return { refused: `the shim starts ${shim.target} with ${shim.interpreters.join(' or ')}, which kurmis does not start` }
}

/** True for `C:\...` and `\\server\share\...`, the only paths a shim may name. */
export function isAbsoluteWindowsPath(path: string): boolean {
  return /^[a-z]:\\/i.test(path) || path.startsWith('\\\\')
}

function readRunLine(run: RunLine, folder: string): CmdShim | { unreadable: string } {
  const expanded: string[] = []
  for (const program of run.programs) {
    const value = expand(program, folder)
    if (value === null) return { unreadable: `it starts ${program}, which is neither an absolute path nor a program name` }
    expanded.push(value)
  }
  if (run.rest.length === 0) {
    const [target] = expanded
    if (expanded.length !== 1 || target === undefined || !isAbsoluteWindowsPath(target)) {
      return { unreadable: 'it starts no file by its path' }
    }
    return { target, interpreters: [], interpreterArgs: [], targetArgs: [] }
  }
  const targetIndex = run.rest.findIndex((token) => /%~dp0|%dp0%/i.test(token) || isAbsoluteWindowsPath(token))
  if (targetIndex < 0) return { unreadable: 'it starts no file by its path' }
  const rest: string[] = []
  for (const token of run.rest) {
    const value = expand(token, folder)
    if (value === null) return { unreadable: `it uses ${token}, which kurmis cannot work out` }
    rest.push(value)
  }
  const target = rest[targetIndex] as string
  if (!isAbsoluteWindowsPath(target)) return { unreadable: `its target ${run.rest[targetIndex] as string} is not an absolute path` }
  return {
    target,
    interpreters: expanded,
    interpreterArgs: rest.slice(0, targetIndex),
    targetArgs: rest.slice(targetIndex + 1)
  }
}

/**
 * The token as cmd.exe reads it in a batch file: `%%` becomes `%`, and `%~dp0` and `%dp0%`
 * become the shim's folder (with its trailing backslash, as cmd.exe expands it). The token is
 * read once from left to right, as cmd.exe does, so a `%` in the folder or one written as `%%`
 * is not read again as the start of a variable. A path is normalised. Null when the token uses
 * any other variable, whose value kurmis would have to guess.
 */
function expand(token: string, folder: string): string | null {
  let otherVariable = false
  const replaced = token.replace(/%%|%~dp0|%dp0%|%/gi, (match) => {
    if (match === '%%') return '%'
    if (match === '%') {
      otherVariable = true
      return match
    }
    return `${folder}\\`
  })
  if (otherVariable) return null
  if (isAbsoluteWindowsPath(replaced)) return win32.normalize(replaced)
  // A bare name (`node`) or an option (`--preserve-symlinks`); a relative path would depend on
  // the folder cmd.exe was started in.
  if (replaced.includes('\\') || replaced.includes('/')) return null
  return replaced
}

/** The part of `line` after its last `&` outside quotes: the command cmd.exe runs last. */
function lastCommand(line: string): string {
  let quoted = false
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') quoted = !quoted
    else if (char === '&' && !quoted) start = i + 1
  }
  return line.slice(start).trim()
}

/** The words of a command, quotes removed; null when it uses a pipe, a redirection or `^`. */
function tokenize(command: string): string[] | null {
  const tokens: string[] = []
  for (const match of command.matchAll(/"([^"]*)"|([^\s"]+)/g)) {
    const quoted = match[1]
    const bare = match[2]
    if (bare !== undefined && /[|<>^()]/.test(bare)) return null
    tokens.push(quoted ?? bare ?? '')
  }
  return tokens
}

function sameCall(a: CmdShim, b: CmdShim): boolean {
  return a.target === b.target
    && (a.interpreters.length === 0) === (b.interpreters.length === 0)
    && a.interpreterArgs.join('\0') === b.interpreterArgs.join('\0')
    && a.targetArgs.join('\0') === b.targetArgs.join('\0')
}
