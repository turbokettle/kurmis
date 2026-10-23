// Finding the real Claude Code program behind `claude`.
//
// The order:
// 1. `KURMIS_CLAUDE_BIN` names the program explicitly. This is also how tests point kurmis at
//    the fake on every OS. A `.js` path runs through Node. In the tests, an environment without
//    it gets the one of this process (`namedProgram`).
// 2. PATH. On macOS and Linux the first executable file named `claude`. It is started as found
//    (a symlink is fine), except that a symlink to a `.js` file runs that file through Node, so a
//    launchd or systemd PATH without `node` on it still works. Claude Code npm packages before
//    the native program installed `claude` as such a link to `cli.js`.
//    On Windows each folder is tried with each extension in PATHEXT, in order, as cmd.exe does.
//    An `.exe` or `.com` is started directly. A `.cmd` or `.bat` is never started: it is read as
//    a package manager's shim (`npm-shim.ts`) and its target is started instead. A shim kurmis
//    cannot read is skipped and the search goes on. `.ps1` files and files without an extension
//    (the PowerShell and Git Bash shims) are never used. The current folder is not searched.
//    On every OS a PATH hit that is kurmis itself (a link to kurmis' bundle, or a shim that runs
//    it) is skipped: started as `claude`, it would not be Claude Code. A script on PATH that runs
//    `kurmis claude` cannot be told apart this way; the wrapper refuses to start itself again
//    instead (`wrapperLoop` in `src/cli/wrapper.ts`).
// 3. Where Claude Code's native installer puts it: `~/.local/bin/claude` on macOS and Linux,
//    `%USERPROFILE%\.local\bin\claude.exe` on Windows. The installer does not always put that
//    folder on PATH.
//
// What the npm package installs (checked against @anthropic-ai/claude-code 2.1.299):
// `"bin": { "claude": "bin/claude.exe" }`. The package ships `bin/claude.exe` as a 500-byte
// shell script that prints "claude native binary not installed", and its postinstall step
// (`install.cjs`) replaces that file with the native program from the platform package
// (`@anthropic-ai/claude-code-win32-x64` and so on). The file has no `#!` line, so npm's shim
// starts it directly. When the postinstall step did not run (`--ignore-scripts`), the file is
// still the script, which Windows cannot start: kurmis checks that the file starts like a Windows
// program ("MZ") and otherwise runs the package's own fallback, `node cli-wrapper.cjs`, which
// finds the platform package's `claude.exe`. Versions before the native program had
// `"bin": { "claude": "cli.js" }`, a Node script that the shim runs through Node; that is
// handled too.
//
// The file checks go through `ProgramFiles`, so the Windows branch is tested with made-up
// Windows paths on any OS.
import { accessSync, closeSync, constants, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { kurmisEntry } from './detach.ts'
import { cmdShimInvocation, decodeCmdShim, isAbsoluteWindowsPath, parseCmdShim } from './npm-shim.ts'
import { invocationFor } from './run.ts'
import { guardOn, hasVariable } from './system-program-guard.ts'

export type ToolName = 'claude'

/** How to start the program: `command` with `args` in front of the caller's own arguments. */
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
  /** The first `maxBytes` bytes of the file, or null when it cannot be read. */
  read(path: string, maxBytes: number): Uint8Array | null
}

export interface FindProgramOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** The Node that runs a `.js` entry. Defaults to `process.execPath`. */
  nodePath?: string
  /** The file checks. Defaults to the real file system. */
  files?: ProgramFiles
  /**
   * Kurmis' own bundle, whose PATH hits are skipped. Defaults to `kurmisEntry`, the running
   * bundle with its links resolved; null skips nothing.
   */
  ownEntry?: string | null
}

/** The variable that names the program explicitly. */
export const PROGRAM_VARIABLE = 'KURMIS_CLAUDE_BIN'

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

  const named = namedProgram(env, PROGRAM_VARIABLE, platform)
  if (named !== undefined) {
    const invocation = invocationFor(named, [], nodePath)
    if ('refused' in invocation) throw new ProgramNotFoundError(tool, `${PROGRAM_VARIABLE}: ${invocation.refused}`)
    return { command: invocation.command, args: invocation.args, source: 'env' }
  }
  const ownEntry = options.ownEntry === undefined ? kurmisEntry({ env }) : options.ownEntry
  const own = ownEntry === null ? null : files.realPath(ownEntry) ?? ownEntry
  return platform === 'win32'
    ? findOnWindows(tool, env, nodePath, files, own)
    : findOnPosix(tool, env, nodePath, files, own)
}

/**
 * The program `variable` names in `env`. While the test guard is on (`system-program-guard.ts`),
 * an `env` without the variable gets the one of this process's environment, so a test that
 * hands kurmis an environment of its own gets the fake or failing program `test/setup.ts` names
 * rather than a search of PATH that could find the real one. An empty value in `env` still means
 * that PATH is searched; the tests of the search use that.
 */
function namedProgram(env: NodeJS.ProcessEnv, variable: string, platform: NodeJS.Platform): string | undefined {
  const own = platform === 'win32' ? windowsEnv(env, variable) : env[variable]
  if (own !== undefined && own !== '') return own
  if (!guardOn(env) || hasVariable(env, variable)) return undefined
  const inherited = process.env[variable]
  return inherited === undefined || inherited === '' ? undefined : inherited
}

const OWN_BUNDLE = 'it is kurmis itself, not the real program'

function findOnPosix(tool: ToolName, env: NodeJS.ProcessEnv, nodePath: string, files: ProgramFiles, own: string | null): ResolvedProgram {
  const folders = posixPathFolders(env.PATH)
  const skipped: string[] = []
  for (const folder of folders) {
    const candidate = posix.join(folder, tool)
    if (!files.isExecutable(candidate)) continue
    const real = files.realPath(candidate)
    if (own !== null && real === own) {
      skipped.push(`${candidate}: ${OWN_BUNDLE}`)
      continue
    }
    if (real !== null && /\.(js|cjs|mjs)$/i.test(real)) return { command: nodePath, args: [real], source: 'path' }
    return { command: candidate, args: [], source: 'path' }
  }
  const looked = [`the ${countFolders(folders.length)} on PATH`]
  if (env.HOME !== undefined && posix.isAbsolute(env.HOME)) {
    const native = posix.join(env.HOME, '.local', 'bin', 'claude')
    if (files.isExecutable(native) && (own === null || files.realPath(native) !== own)) {
      return { command: native, args: [], source: 'native-installer' }
    }
    looked.push(native)
  }
  throw notFound(tool, looked, skipped)
}

function findOnWindows(tool: ToolName, env: NodeJS.ProcessEnv, nodePath: string, files: ProgramFiles, own: string | null): ResolvedProgram {
  const folders = windowsPathFolders(windowsEnv(env, 'PATH'))
  const extensions = pathExtensions(windowsEnv(env, 'PATHEXT'))
  const skipped: string[] = []
  const isOwn = (path: string): boolean => own !== null &&
    (files.realPath(path) ?? path).toLowerCase() === own.toLowerCase()
  for (const folder of folders) {
    for (const extension of extensions) {
      const candidate = win32.join(folder, tool + extension)
      if (!files.isFile(candidate)) continue
      if (extension === '.exe' || extension === '.com') return { command: candidate, args: [], source: 'path' }
      const resolved = resolveShim(candidate, nodePath, files, isOwn)
      if ('refused' in resolved) skipped.push(`${candidate}: ${resolved.refused}`)
      else return resolved
    }
  }
  const looked = [`the ${countFolders(folders.length)} on PATH (as ${extensions.map((extension) => tool + extension).join(', ')})`]
  const home = windowsEnv(env, 'USERPROFILE')
  if (home !== undefined && isAbsoluteWindowsPath(home)) {
    const native = win32.join(home, '.local', 'bin', 'claude.exe')
    if (files.isFile(native)) return { command: native, args: [], source: 'native-installer' }
    looked.push(native)
  }
  throw notFound(tool, looked, skipped)
}

/**
 * What a `.cmd`/`.bat` shim on PATH starts, or why kurmis will not start it. `isOwn` is checked
 * on the shim's target, not on the arguments, where Node options can come before the target.
 */
function resolveShim(shimPath: string, nodePath: string, files: ProgramFiles, isOwn: (path: string) => boolean): ResolvedProgram | { refused: string } {
  const bytes = files.read(shimPath, MAX_SHIM_BYTES)
  if (bytes === null) return { refused: 'it could not be read' }
  const text = decodeCmdShim(bytes)
  if (text === null) return { refused: 'it is not a package manager shim kurmis can read (it is not UTF-8 text)' }
  const shim = parseCmdShim(text, shimPath)
  if ('unreadable' in shim) return { refused: `it is not a package manager shim kurmis can read (${shim.unreadable})` }
  if (!files.isFile(shim.target)) return { refused: `it starts ${shim.target}, which does not exist` }
  if (isOwn(shim.target)) return { refused: OWN_BUNDLE }
  const invocation = cmdShimInvocation(shim, { nodePath, isFile: (path) => files.isFile(path) })
  if ('refused' in invocation) return invocation
  if (invocation.command === shim.target && !startsLikeWindowsProgram(files, shim.target)) {
    // Claude Code's npm package before its postinstall step ran (see the top of this file).
    const wrapper = win32.join(win32.dirname(win32.dirname(shim.target)), 'cli-wrapper.cjs')
    if (files.isFile(wrapper)) {
      return { command: nodePath, args: [wrapper, ...invocation.args], source: 'npm-shim' }
    }
    return {
      refused: `it starts ${shim.target}, which is not a Windows program; if this is the npm package, its install step did not run (reinstall it without --ignore-scripts)`
    }
  }
  return { command: invocation.command, args: invocation.args, source: 'npm-shim' }
}

function startsLikeWindowsProgram(files: ProgramFiles, path: string): boolean {
  const head = files.read(path, 2)
  return head !== null && head[0] === 0x4d && head[1] === 0x5a // "MZ"
}

function notFound(tool: ToolName, looked: string[], skipped: string[]): ProgramNotFoundError {
  const lines = [`Claude Code (${tool}) was not found. Looked in ${looked.join(' and at ')}.`]
  if (skipped.length > 0) lines.push(`Skipped:\n${skipped.map((line) => `  ${line}`).join('\n')}`)
  lines.push(`Install Claude Code, or set ${PROGRAM_VARIABLE} to the full path of the program.`)
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
      return buffer.subarray(0, length)
    } catch {
      return null
    } finally {
      closeSync(fd)
    }
  }
}
