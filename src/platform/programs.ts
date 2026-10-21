// Finding the real program behind `claude` and `codex`.
//
// The order:
// 1. `KURMIS_CLAUDE_BIN` / `KURMIS_CODEX_BIN` name the program explicitly. This is also how tests
//    point kurmis at the fakes on every OS. A `.js` path runs through Node.
// 2. PATH. On macOS and Linux the first executable file named `claude` or `codex`. It is started
//    as found (a symlink is fine), except that a symlink to a `.js` file runs that file through
//    Node, so a launchd or systemd PATH without `node` on it still works.
//    On Windows each folder is tried with each extension in PATHEXT, in order, as cmd.exe does.
//    An `.exe` or `.com` is started directly. A `.cmd` or `.bat` is never started: it is read as
//    a package manager's shim (`npm-shim.ts`) and its target is started instead. A shim kurmis
//    cannot read is skipped and the search goes on. `.ps1` files and files without an extension
//    (the PowerShell and Git Bash shims) are never used. The current folder is not searched.
// 3. For Claude Code, where its native installer puts it: `~/.local/bin/claude` on macOS and
//    Linux, `%USERPROFILE%\.local\bin\claude.exe` on Windows. The installer does not always put
//    that folder on PATH.
//
// What the two npm packages install (checked against @anthropic-ai/claude-code 2.1.299 and
// @openai/codex 0.163.0):
// - `@anthropic-ai/claude-code` has `"bin": { "claude": "bin/claude.exe" }`. The package ships
//   `bin/claude.exe` as a 500-byte shell script that prints "claude native binary not
//   installed", and its postinstall step (`install.cjs`) replaces that file with the native
//   program from the platform package (`@anthropic-ai/claude-code-win32-x64` and so on). The
//   file has no `#!` line, so npm's shim starts it directly. When the postinstall step did not
//   run (`--ignore-scripts`), the file is still the script, which Windows cannot start: kurmis
//   checks that the file starts like a Windows program ("MZ") and otherwise runs the package's
//   own fallback, `node cli-wrapper.cjs`, which finds the platform package's `claude.exe`.
//   Versions before the native program had `"bin": { "claude": "cli.js" }`, a Node script that
//   the shim runs through Node; that is handled too.
// - `@openai/codex` has `"bin": { "codex": "bin/codex.js" }`, a Node script that starts the
//   platform package's native `codex.exe` and sets `CODEX_MANAGED_BY_NPM` (or `_PNPM`, `_BUN`)
//   for the program's update hints. Kurmis runs `node bin\codex.js` rather than the native
//   program, so those stay right.
//
// The file checks go through `ProgramFiles`, so the Windows branch is tested with made-up
// Windows paths on any OS.
import { accessSync, closeSync, constants, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { cmdShimInvocation, isAbsoluteWindowsPath, parseCmdShim } from './npm-shim.ts'
import { invocationFor } from './run.ts'

export type ToolName = 'claude' | 'codex'

/** How to start a tool: `command` with `args` in front of the caller's own arguments. */
export interface ResolvedProgram {
  command: string
  args: string[]
  /** Where it was found, for messages and `kurmis status`. */
  source: 'env' | 'path' | 'npm-shim' | 'native-installer'
}

export class ProgramNotFoundError extends Error {
  constructor(readonly tool: ToolName, message: string) {
    super(message)
    this.name = 'ProgramNotFoundError'
  }
}

/** The file checks `findProgram` makes. Paths are in the platform's own form. */
export interface ProgramFiles {
  /** True when `path` is a regular file, after following symlinks. */
  isFile(path: string): boolean
  /** True when `path` is a regular file this user may execute (POSIX only). */
  isExecutable(path: string): boolean
  /** The path with every symlink resolved, or null when it cannot be resolved. */
  realPath(path: string): string | null
  /** The first `maxBytes` bytes of the file as Latin-1 text, or null when it cannot be read. */
  read(path: string, maxBytes: number): string | null
}

export interface FindProgramOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** The Node that runs a `.js` entry. Defaults to `process.execPath`. */
  nodePath?: string
  /** The file checks. Defaults to the real file system. */
  files?: ProgramFiles
}

/** The variables that name each tool's program explicitly. */
export const PROGRAM_VARIABLES: Readonly<Record<ToolName, string>> = {
  claude: 'KURMIS_CLAUDE_BIN',
  codex: 'KURMIS_CODEX_BIN'
}

const TOOL_NAMES: Readonly<Record<ToolName, string>> = {
  claude: 'Claude Code',
  codex: 'Codex'
}

/** PATHEXT when the variable is not set, as cmd.exe assumes. */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD'

/** A shim is a few hundred bytes; anything much larger is not one. */
const MAX_SHIM_BYTES = 64 * 1024

/** The program to start for `tool`. Throws `ProgramNotFoundError` with a sentence a person can act on. */
export function findProgram(tool: ToolName, options: FindProgramOptions = {}): ResolvedProgram {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const nodePath = options.nodePath ?? process.execPath
  const files = options.files ?? realFiles

  const variable = PROGRAM_VARIABLES[tool]
  const named = platform === 'win32' ? windowsEnv(env, variable) : env[variable]
  if (named !== undefined && named !== '') {
    const invocation = invocationFor(named, [], nodePath)
    if ('refused' in invocation) throw new ProgramNotFoundError(tool, `${variable}: ${invocation.refused}`)
    return { command: invocation.command, args: invocation.args, source: 'env' }
  }
  return platform === 'win32'
    ? findOnWindows(tool, env, nodePath, files)
    : findOnPosix(tool, env, nodePath, files)
}

function findOnPosix(tool: ToolName, env: NodeJS.ProcessEnv, nodePath: string, files: ProgramFiles): ResolvedProgram {
  const folders = posixPathFolders(env.PATH)
  for (const folder of folders) {
    const candidate = posix.join(folder, tool)
    if (!files.isExecutable(candidate)) continue
    const real = files.realPath(candidate)
    if (real !== null && /\.(js|cjs|mjs)$/i.test(real)) return { command: nodePath, args: [real], source: 'path' }
    return { command: candidate, args: [], source: 'path' }
  }
  const looked = [`the ${countFolders(folders.length)} on PATH`]
  if (tool === 'claude' && env.HOME !== undefined && posix.isAbsolute(env.HOME)) {
    const native = posix.join(env.HOME, '.local', 'bin', 'claude')
    if (files.isExecutable(native)) return { command: native, args: [], source: 'native-installer' }
    looked.push(native)
  }
  throw notFound(tool, looked, [])
}

function findOnWindows(tool: ToolName, env: NodeJS.ProcessEnv, nodePath: string, files: ProgramFiles): ResolvedProgram {
  const folders = windowsPathFolders(windowsEnv(env, 'PATH'))
  const extensions = pathExtensions(windowsEnv(env, 'PATHEXT'))
  const skipped: string[] = []
  for (const folder of folders) {
    for (const extension of extensions) {
      const candidate = win32.join(folder, tool + extension)
      if (!files.isFile(candidate)) continue
      if (extension === '.exe' || extension === '.com') return { command: candidate, args: [], source: 'path' }
      const resolved = resolveShim(tool, candidate, nodePath, files)
      if ('refused' in resolved) skipped.push(`${candidate}: ${resolved.refused}`)
      else return resolved
    }
  }
  const looked = [`the ${countFolders(folders.length)} on PATH (as ${extensions.map((extension) => tool + extension).join(', ')})`]
  const home = windowsEnv(env, 'USERPROFILE')
  if (tool === 'claude' && home !== undefined && isAbsoluteWindowsPath(home)) {
    const native = win32.join(home, '.local', 'bin', 'claude.exe')
    if (files.isFile(native)) return { command: native, args: [], source: 'native-installer' }
    looked.push(native)
  }
  throw notFound(tool, looked, skipped)
}

/** What a `.cmd`/`.bat` shim on PATH starts, or why kurmis will not start it. */
function resolveShim(tool: ToolName, shimPath: string, nodePath: string, files: ProgramFiles): ResolvedProgram | { refused: string } {
  const text = files.read(shimPath, MAX_SHIM_BYTES)
  if (text === null) return { refused: 'it could not be read' }
  const shim = parseCmdShim(text, shimPath)
  if ('unreadable' in shim) return { refused: `it is not a package manager shim kurmis can read (${shim.unreadable})` }
  if (!files.isFile(shim.target)) return { refused: `it starts ${shim.target}, which does not exist` }
  const invocation = cmdShimInvocation(shim, { nodePath, isFile: (path) => files.isFile(path) })
  if ('refused' in invocation) return invocation
  if (invocation.command === shim.target && !startsLikeWindowsProgram(files, shim.target)) {
    // Claude Code's npm package before its postinstall step ran (see the top of this file).
    const wrapper = win32.join(win32.dirname(win32.dirname(shim.target)), 'cli-wrapper.cjs')
    if (tool === 'claude' && files.isFile(wrapper)) {
      return { command: nodePath, args: [wrapper, ...invocation.args], source: 'npm-shim' }
    }
    return {
      refused: `it starts ${shim.target}, which is not a Windows program; if this is the npm package, its install step did not run (reinstall it without --ignore-scripts)`
    }
  }
  return { command: invocation.command, args: invocation.args, source: 'npm-shim' }
}

function startsLikeWindowsProgram(files: ProgramFiles, path: string): boolean {
  return files.read(path, 2) === 'MZ'
}

function notFound(tool: ToolName, looked: string[], skipped: string[]): ProgramNotFoundError {
  const lines = [`${TOOL_NAMES[tool]} (${tool}) was not found. Looked in ${looked.join(' and at ')}.`]
  if (skipped.length > 0) lines.push(`Skipped:\n${skipped.map((line) => `  ${line}`).join('\n')}`)
  lines.push(`Install ${TOOL_NAMES[tool]}, or set ${PROGRAM_VARIABLES[tool]} to the full path of the program.`)
  return new ProgramNotFoundError(tool, lines.join('\n'))
}

function countFolders(count: number): string {
  return count === 1 ? '1 folder' : `${String(count)} folders`
}

/**
 * The folders on a POSIX PATH. Empty and relative entries are left out: a shell resolves them
 * against the current folder, and kurmis does not start programs from there.
 */
export function posixPathFolders(value: string | undefined): string[] {
  return (value ?? '').split(':').filter((folder) => folder !== '' && posix.isAbsolute(folder))
}

/**
 * The folders on a Windows PATH, without the quotes an entry may have. Entries that are not
 * absolute (`C:\...` or `\\server\...`) are left out, for the same reason as on POSIX.
 */
export function windowsPathFolders(value: string | undefined): string[] {
  return (value ?? '')
    .split(';')
    .map((folder) => folder.trim().replace(/^"(.*)"$/, '$1'))
    .filter((folder) => isAbsoluteWindowsPath(folder))
}

/**
 * The extensions PATHEXT lists, lower-case, in order and without repeats, keeping only those
 * kurmis can use: `.com` and `.exe` to start, `.bat` and `.cmd` to read as shims.
 */
export function pathExtensions(value: string | undefined): string[] {
  const listed = (value === undefined || value.trim() === '' ? DEFAULT_PATHEXT : value)
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
  return [...new Set(listed)].filter((extension) => ['.com', '.exe', '.bat', '.cmd'].includes(extension))
}

/**
 * A variable from a Windows environment, whose names are case-insensitive: a copied
 * `process.env` has `Path`, not `PATH`. The first spelling with a non-empty value wins.
 */
export function windowsEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const exact = env[name]
  if (exact !== undefined && exact !== '') return exact
  const upper = name.toUpperCase()
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() === upper && value !== undefined && value !== '') return value
  }
  return exact
}

/**
 * Whether `path` is a regular file. Any error counts as no: a PATH entry may be a file
 * (ENOTDIR) or a folder this user may not open (EACCES), and the search goes on past it.
 */
function regularFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false
  } catch {
    return false
  }
}

const realFiles: ProgramFiles = {
  isFile(path) {
    return regularFile(path)
  },
  isExecutable(path) {
    if (!regularFile(path)) return false
    try {
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  realPath(path) {
    try {
      return realpathSync(path)
    } catch {
      return null
    }
  },
  read(path, maxBytes) {
    let fd: number
    try {
      fd = openSync(path, 'r')
    } catch {
      return null
    }
    try {
      const buffer = Buffer.alloc(maxBytes)
      const length = readSync(fd, buffer, 0, maxBytes, 0)
      return buffer.subarray(0, length).toString('latin1')
    } catch {
      return null
    } finally {
      closeSync(fd)
    }
  }
}
