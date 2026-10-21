// Every test passes its own `env` with a PATH of temporary or made-up folders, so no test can
// find the real claude or codex on this machine. The Windows tests use a made-up file system.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import {
  findProgram,
  pathExtensions,
  posixPathFolders,
  ProgramNotFoundError,
  windowsEnv,
  windowsPathFolders
} from '../../src/platform/programs.ts'
import type { FindProgramOptions, ProgramFiles, ToolName } from '../../src/platform/programs.ts'

const fixture = (name: string): string => readFileSync(resolve('test/platform/fixtures', name), 'utf8')

function notFound(tool: ToolName, options: FindProgramOptions): ProgramNotFoundError {
  try {
    findProgram(tool, options)
  } catch (error) {
    if (error instanceof ProgramNotFoundError) return error
    throw error
  }
  throw new Error('findProgram found a program')
}

describe('the explicit variables', () => {
  test('KURMIS_CLAUDE_BIN and KURMIS_CODEX_BIN win over PATH, and a .js runs through Node', () => {
    const env = { KURMIS_CLAUDE_BIN: '/opt/fake/claude', KURMIS_CODEX_BIN: '/opt/fake/codex.mjs', PATH: '/usr/bin' }
    expect(findProgram('claude', { env, platform: 'darwin', nodePath: '/node' })).toEqual({ command: '/opt/fake/claude', args: [], source: 'env' })
    expect(findProgram('codex', { env, platform: 'linux', nodePath: '/node' })).toEqual({ command: '/node', args: ['/opt/fake/codex.mjs'], source: 'env' })
  })

  test('a batch file is refused', () => {
    const error = notFound('claude', { env: { KURMIS_CLAUDE_BIN: 'C:\\npm\\claude.cmd' }, platform: 'win32', files: windowsFiles({}) })
    expect(error.message).toContain('KURMIS_CLAUDE_BIN')
    expect(error.message).toContain('batch file')
    expect(error.tool).toBe('claude')
  })

  test('on Windows the variable name is case-insensitive', () => {
    const found = findProgram('codex', { env: { kurmis_codex_bin: 'C:\\x\\codex.exe' }, platform: 'win32', files: windowsFiles({}) })
    expect(found).toEqual({ command: 'C:\\x\\codex.exe', args: [], source: 'env' })
  })

  test('an empty variable counts as unset', () => {
    const error = notFound('codex', { env: { KURMIS_CODEX_BIN: '', PATH: '' }, platform: 'linux' })
    expect(error.message).toContain('the 0 folders on PATH')
  })
})

describe.skipIf(process.platform === 'win32')('PATH on macOS and Linux', () => {
  const root = mkdtempSync(join(tmpdir(), 'kurmis-programs-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const folder = (name: string): string => {
    const path = join(root, name)
    mkdirSync(path, { recursive: true })
    return path
  }
  const program = (path: string, mode = 0o755): string => {
    writeFileSync(path, '#!/bin/sh\nexit 0\n')
    chmodSync(path, mode)
    return path
  }

  test('the first executable file named after the tool, skipping files that are not executable and folders', () => {
    const notExecutable = folder('a')
    program(join(notExecutable, 'claude'), 0o644)
    const aFolder = folder('b')
    mkdirSync(join(aFolder, 'claude'))
    const found = folder('c')
    const claude = program(join(found, 'claude'))
    const later = folder('d')
    program(join(later, 'claude'))
    const env = { PATH: ['', 'relative/bin', notExecutable, aFolder, found, later].join(':') }
    expect(findProgram('claude', { env, platform: 'darwin', nodePath: '/node' })).toEqual({ command: claude, args: [], source: 'path' })
  })

  test('goes on past a PATH entry that is a file or a folder it may not open', () => {
    const aFile = program(join(folder('e'), 'not-a-folder'))
    const closed = folder('f')
    program(join(closed, 'codex'))
    chmodSync(closed, 0o000)
    try {
      const found = folder('g')
      const codex = program(join(found, 'codex'))
      const env = { PATH: [aFile, closed, found].join(':') }
      expect(findProgram('codex', { env, platform: 'darwin', nodePath: '/node' })).toEqual({ command: codex, args: [], source: 'path' })
    } finally {
      chmodSync(closed, 0o755)
    }
  })

  test('a symlink to a native program is started as it is', () => {
    const versions = folder('versions')
    const real = program(join(versions, '2.1.0'))
    const bin = folder('local-bin')
    symlinkSync(real, join(bin, 'claude'))
    expect(findProgram('claude', { env: { PATH: bin }, platform: 'linux', nodePath: '/node' }))
      .toEqual({ command: join(bin, 'claude'), args: [], source: 'path' })
  })

  test('a symlink to a .js file runs the real file through Node', () => {
    const packageBin = folder('lib/node_modules/@openai/codex/bin')
    const entry = program(join(packageBin, 'codex.js'))
    const bin = folder('prefix-bin')
    symlinkSync('../lib/node_modules/@openai/codex/bin/codex.js', join(bin, 'codex'))
    const found = findProgram('codex', { env: { PATH: bin }, platform: 'darwin', nodePath: '/node' })
    expect(found).toEqual({ command: '/node', args: [expect.stringMatching(/codex\.js$/)], source: 'path' })
    expect(readFileSync(found.args[0] as string, 'utf8')).toBe(readFileSync(entry, 'utf8'))
  })

  test('a PATH hit that is kurmis\' own bundle is skipped, and the search goes on', () => {
    const bundle = program(join(folder('kurmis/dist'), 'kurmis.cjs'))
    const linked = folder('linked-bin')
    symlinkSync(bundle, join(linked, 'claude'))
    const real = program(join(folder('real-bin'), 'claude'))
    const env = { PATH: [linked, join(root, 'real-bin')].join(':') }
    expect(findProgram('claude', { env, platform: 'darwin', nodePath: '/node', ownEntry: bundle }))
      .toEqual({ command: real, args: [], source: 'path' })
    // Without anything else on PATH the skipped hit is named in the message.
    const error = notFound('claude', { env: { PATH: linked }, platform: 'darwin', nodePath: '/node', ownEntry: bundle })
    expect(error.message).toContain(`${join(linked, 'claude')}: it is kurmis itself, not the real program`)
    // Not knowing its own bundle, kurmis would run it through Node.
    expect(findProgram('claude', { env: { PATH: linked }, platform: 'darwin', nodePath: '/node', ownEntry: null }).command).toBe('/node')
  })

  test('Claude Code from its native installer when it is not on PATH', () => {
    const home = folder('home')
    const native = program(join(folder('home/.local/bin'), 'claude'))
    expect(findProgram('claude', { env: { PATH: folder('empty'), HOME: home }, platform: 'darwin' }))
      .toEqual({ command: native, args: [], source: 'native-installer' })
    // Codex has no such place.
    expect(notFound('codex', { env: { PATH: folder('empty'), HOME: home }, platform: 'darwin' }).message).not.toContain('.local')
  })

  test('the message says what was searched and how to name the program', () => {
    const home = folder('home-without-claude')
    const error = notFound('claude', { env: { PATH: `${folder('x')}:${folder('y')}`, HOME: home }, platform: 'linux' })
    expect(error.message).toBe([
      `Claude Code (claude) was not found. Looked in the 2 folders on PATH and at ${join(home, '.local/bin/claude')}.`,
      'Install Claude Code, or set KURMIS_CLAUDE_BIN to the full path of the program.'
    ].join('\n'))
    expect(notFound('codex', { env: { PATH: folder('x') }, platform: 'linux' }).message).toBe([
      'Codex (codex) was not found. Looked in the 1 folder on PATH.',
      'Install Codex, or set KURMIS_CODEX_BIN to the full path of the program.'
    ].join('\n'))
  })

  test('without PATH and HOME nothing is found', () => {
    expect(notFound('claude', { env: {}, platform: 'linux' }).message).toContain('the 0 folders on PATH.')
  })
})

/**
 * A made-up Windows file system: paths (case-insensitive) to their contents, as bytes or as text
 * stored as UTF-8.
 */
function windowsFiles(contents: Record<string, string | Uint8Array>): ProgramFiles {
  const files = new Map(Object.entries(contents).map(([path, content]) => [
    path.toLowerCase(),
    typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  ]))
  return {
    isFile: (path) => files.has(path.toLowerCase()),
    isExecutable: (path) => files.has(path.toLowerCase()),
    realPath: (path) => (files.has(path.toLowerCase()) ? path : null),
    read: (path, maxBytes) => files.get(path.toLowerCase())?.subarray(0, maxBytes) ?? null
  }
}

describe('PATH on Windows', () => {
  const NPM = 'C:\\Users\\example\\AppData\\Roaming\\npm'
  const PNPM = 'C:\\Users\\example\\AppData\\Local\\pnpm'
  const HOME = 'C:\\Users\\example'
  const CLAUDE_PACKAGE = `${NPM}\\node_modules\\@anthropic-ai\\claude-code`
  const CODEX_ENTRY = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`
  const NATIVE = 'MZ\x90\x00 a Windows program'
  const PLACEHOLDER = 'echo "Error: claude native binary not installed." >&2\nexit 1\n'
  const NODE = 'C:\\Program Files\\nodejs\\node.exe'

  const find = (tool: ToolName, env: NodeJS.ProcessEnv, files: Record<string, string | Uint8Array>) =>
    findProgram(tool, { env, platform: 'win32', nodePath: NODE, files: windowsFiles(files) })

  test('an .exe on PATH is started directly, and the Path spelling of the variable works', () => {
    expect(find('claude', { Path: 'C:\\empty;C:\\tools' }, { 'C:\\tools\\claude.exe': NATIVE }))
      .toEqual({ command: 'C:\\tools\\claude.exe', args: [], source: 'path' })
  })

  test('npm shim for Codex: node bin\\codex.js, through the Node kurmis runs on', () => {
    const files = { [`${NPM}\\codex.cmd`]: fixture('npm-global-codex.cmd'), [CODEX_ENTRY]: '#!/usr/bin/env node\n' }
    expect(find('codex', { PATH: NPM }, files)).toEqual({ command: NODE, args: [CODEX_ENTRY], source: 'npm-shim' })
  })

  test('a shim that starts kurmis\' own bundle is skipped, and the search goes on', () => {
    const files = {
      [`${NPM}\\codex.cmd`]: fixture('npm-global-codex.cmd'),
      [CODEX_ENTRY]: '',
      'C:\\tools\\codex.exe': NATIVE
    }
    expect(findProgram('codex', { env: { PATH: `${NPM};C:\\tools` }, platform: 'win32', nodePath: NODE, files: windowsFiles(files),
      ownEntry: CODEX_ENTRY.toUpperCase() })).toEqual({ command: 'C:\\tools\\codex.exe', args: [], source: 'path' })
  })

  test('npm shim for Codex with a node.exe next to it, as with nvm-windows', () => {
    const files = { [`${NPM}\\codex.cmd`]: fixture('npm-global-codex.cmd'), [CODEX_ENTRY]: '', [`${NPM}\\node.exe`]: NATIVE }
    expect(find('codex', { PATH: NPM }, files)).toEqual({ command: `${NPM}\\node.exe`, args: [CODEX_ENTRY], source: 'npm-shim' })
  })

  test('npm shim for Claude Code: its claude.exe, started directly', () => {
    const files = { [`${NPM}\\claude.cmd`]: fixture('npm-global-claude-exe.cmd'), [`${CLAUDE_PACKAGE}\\bin\\claude.exe`]: NATIVE }
    expect(find('claude', { PATH: NPM }, files)).toEqual({ command: `${CLAUDE_PACKAGE}\\bin\\claude.exe`, args: [], source: 'npm-shim' })
  })

  test('Claude Code installed without its postinstall step runs its cli-wrapper.cjs through Node', () => {
    const files = {
      [`${NPM}\\claude.cmd`]: fixture('npm-global-claude-exe.cmd'),
      [`${CLAUDE_PACKAGE}\\bin\\claude.exe`]: PLACEHOLDER,
      [`${CLAUDE_PACKAGE}\\cli-wrapper.cjs`]: '#!/usr/bin/env node\n'
    }
    expect(find('claude', { PATH: NPM }, files)).toEqual({ command: NODE, args: [`${CLAUDE_PACKAGE}\\cli-wrapper.cjs`], source: 'npm-shim' })
  })

  test('without cli-wrapper.cjs that is reported, not started', () => {
    const files = { [`${NPM}\\claude.cmd`]: fixture('npm-global-claude-exe.cmd'), [`${CLAUDE_PACKAGE}\\bin\\claude.exe`]: PLACEHOLDER }
    const error = notFound('claude', { env: { PATH: NPM, USERPROFILE: HOME }, platform: 'win32', nodePath: NODE, files: windowsFiles(files) })
    expect(error.message).toContain(`${NPM}\\claude.cmd: it starts ${CLAUDE_PACKAGE}\\bin\\claude.exe, which is not a Windows program`)
    expect(error.message).toContain('--ignore-scripts')
  })

  test('npm shim for an older Claude Code: node cli.js', () => {
    const files = { [`${NPM}\\claude.cmd`]: fixture('npm-global-claude-cli-js.cmd'), [`${CLAUDE_PACKAGE}\\cli.js`]: '' }
    expect(find('claude', { PATH: NPM }, files)).toEqual({ command: NODE, args: [`${CLAUDE_PACKAGE}\\cli.js`], source: 'npm-shim' })
  })

  test('pnpm global shims', () => {
    const codexEntry = `${PNPM}\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js`
    const claudeExe = `${PNPM}\\global\\5\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`
    const files = {
      [`${PNPM}\\codex.cmd`]: fixture('pnpm-global-codex.cmd'),
      [`${PNPM}\\claude.cmd`]: fixture('pnpm-global-claude-exe.cmd'),
      [codexEntry]: '',
      [claudeExe]: NATIVE
    }
    expect(find('codex', { PATH: PNPM }, files)).toEqual({ command: NODE, args: [codexEntry], source: 'npm-shim' })
    expect(find('claude', { PATH: PNPM }, files)).toEqual({ command: claudeExe, args: [], source: 'npm-shim' })
  })

  test('npm 12 shims', () => {
    const files = {
      [`${NPM}\\codex.cmd`]: fixture('npm12-global-codex.cmd'),
      [`${NPM}\\claude.cmd`]: fixture('npm12-global-claude-exe.cmd'),
      [CODEX_ENTRY]: '',
      [`${CLAUDE_PACKAGE}\\bin\\claude.exe`]: NATIVE
    }
    expect(find('codex', { PATH: NPM }, files)).toEqual({ command: NODE, args: [CODEX_ENTRY], source: 'npm-shim' })
    expect(find('claude', { PATH: NPM }, files)).toEqual({ command: `${CLAUDE_PACKAGE}\\bin\\claude.exe`, args: [], source: 'npm-shim' })
  })

  test('pnpm 11 global shims', () => {
    const group = `${PNPM}\\global\\v11\\50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c\\node_modules`
    const codexEntry = `${group}\\@openai\\codex\\bin\\codex.js`
    const claudeExe = `${group}\\@anthropic-ai\\claude-code\\bin\\claude.exe`
    const files = {
      [`${PNPM}\\codex.cmd`]: fixture('pnpm11-global-codex.cmd'),
      [`${PNPM}\\claude.cmd`]: fixture('pnpm11-global-claude-exe.cmd'),
      [codexEntry]: '',
      [claudeExe]: NATIVE
    }
    expect(find('codex', { PATH: PNPM }, files)).toEqual({ command: NODE, args: [codexEntry], source: 'npm-shim' })
    expect(find('claude', { PATH: PNPM }, files)).toEqual({ command: claudeExe, args: [], source: 'npm-shim' })
  })

  test('a shim in a folder whose name has a %', () => {
    const folder = 'C:\\Users\\example\\100%\\npm'
    const entry = `${folder}\\node_modules\\@openai\\codex\\bin\\codex.js`
    const files = { [`${folder}\\codex.cmd`]: fixture('npm12-global-codex.cmd'), [entry]: '' }
    expect(find('codex', { PATH: folder }, files)).toEqual({ command: NODE, args: [entry], source: 'npm-shim' })
  })

  test('a UTF-8 shim with a byte order mark, in a folder with a non-ASCII name', () => {
    const home = 'C:\\Users\\ex\u00e4mple\\AppData\\Local\\pnpm'
    const node = `${home}\\nodejs\\24.11.0\\node.exe`
    const entry = `${home}\\global\\v11\\50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c\\node_modules\\@openai\\codex\\bin\\codex.js`
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const files = {
      [`${home}\\codex.cmd`]: Buffer.concat([bom, readFileSync(resolve('test/platform/fixtures', 'pnpm11-node-exec-path-non-ascii.cmd'))]),
      [entry]: '',
      [node]: NATIVE,
      // A one-line shim, so the byte order mark is right before its run line.
      [`${home}\\claude.cmd`]: Buffer.concat([bom, Buffer.from('@"%~dp0\\t\u00f6\u00f6ls\\claude.exe"   %*\r\n', 'utf8')]),
      [`${home}\\t\u00f6\u00f6ls\\claude.exe`]: NATIVE
    }
    expect(find('codex', { PATH: home }, files)).toEqual({ command: node, args: [entry], source: 'npm-shim' })
    expect(find('claude', { PATH: home }, files)).toEqual({ command: `${home}\\t\u00f6\u00f6ls\\claude.exe`, args: [], source: 'npm-shim' })
  })

  test('a shim that is not UTF-8 is skipped', () => {
    // "ä" in Windows-1252, as an editor saving in the ANSI code page would write it.
    const files = { 'C:\\a\\codex.cmd': Buffer.from([...Buffer.from('@"%~dp0\\'), 0xe4, ...Buffer.from('\\codex.exe"   %*\r\n')]) }
    const error = notFound('codex', { env: { PATH: 'C:\\a' }, platform: 'win32', files: windowsFiles(files) })
    expect(error.message).toContain('C:\\a\\codex.cmd: it is not a package manager shim kurmis can read (it is not UTF-8 text)')
  })

  test('PATHEXT order decides between a .cmd and an .exe in the same folder', () => {
    const files = { [`${NPM}\\codex.cmd`]: fixture('npm-global-codex.cmd'), [CODEX_ENTRY]: '', [`${NPM}\\codex.exe`]: NATIVE }
    expect(find('codex', { PATH: NPM, PATHEXT: '.CMD;.EXE' }, files).source).toBe('npm-shim')
    expect(find('codex', { PATH: NPM, PATHEXT: '.EXE;.CMD' }, files).source).toBe('path')
    expect(find('codex', { PATH: NPM }, files).source).toBe('path')
  })

  test('.ps1 shims, extensionless shims and other PATHEXT types are never used', () => {
    const files = {
      'C:\\a\\codex.ps1': '#!/usr/bin/env pwsh\n',
      'C:\\a\\codex': '#!/bin/sh\n',
      'C:\\a\\codex.js': '',
      'C:\\a\\codex.vbs': ''
    }
    const error = notFound('codex', { env: { PATH: 'C:\\a', PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.PS1' }, platform: 'win32', files: windowsFiles(files) })
    expect(error.message).toBe([
      'Codex (codex) was not found. Looked in the 1 folder on PATH (as codex.com, codex.exe, codex.bat, codex.cmd).',
      'Install Codex, or set KURMIS_CODEX_BIN to the full path of the program.'
    ].join('\n'))
  })

  test('a shim kurmis cannot use is skipped and the search goes on', () => {
    const files = {
      'C:\\first\\codex.cmd': '@echo off\r\npowershell -File "%~dp0\\codex.ps1"\r\n',
      'C:\\second\\codex.bat': fixture('npm-global-codex.cmd'),
      'C:\\third\\codex.cmd': fixture('npm-global-codex.cmd'),
      'C:\\third\\node_modules\\@openai\\codex\\bin\\codex.js': ''
    }
    expect(find('codex', { PATH: 'C:\\first;C:\\second;C:\\third' }, files))
      .toEqual({ command: NODE, args: ['C:\\third\\node_modules\\@openai\\codex\\bin\\codex.js'], source: 'npm-shim' })
    const error = notFound('codex', { env: { PATH: 'C:\\first;C:\\second' }, platform: 'win32', files: windowsFiles(files) })
    expect(error.message).toContain('Skipped:\n  C:\\first\\codex.cmd: it is not a package manager shim kurmis can read (no line passes the arguments on (%*))')
    expect(error.message).toContain('  C:\\second\\codex.bat: it starts C:\\second\\node_modules\\@openai\\codex\\bin\\codex.js, which does not exist')
  })

  test('Claude Code from its native installer when PATH has none', () => {
    const native = `${HOME}\\.local\\bin\\claude.exe`
    expect(find('claude', { PATH: 'C:\\Windows\\system32', USERPROFILE: HOME }, { [native]: NATIVE }))
      .toEqual({ command: native, args: [], source: 'native-installer' })
    // On PATH, the PATH entry wins.
    expect(find('claude', { PATH: 'C:\\tools', USERPROFILE: HOME }, { [native]: NATIVE, 'C:\\tools\\claude.exe': NATIVE }).source).toBe('path')
  })

  test('the message names the native installer place', () => {
    const error = notFound('claude', { env: { Path: 'C:\\a;C:\\b;C:\\c', UserProfile: HOME }, platform: 'win32', files: windowsFiles({}) })
    expect(error.message).toBe([
      `Claude Code (claude) was not found. Looked in the 3 folders on PATH (as claude.com, claude.exe, claude.bat, claude.cmd) and at ${HOME}\\.local\\bin\\claude.exe.`,
      'Install Claude Code, or set KURMIS_CLAUDE_BIN to the full path of the program.'
    ].join('\n'))
  })
})

describe('pure helpers', () => {
  test('POSIX PATH folders: empty and relative entries are left out', () => {
    expect(posixPathFolders('/usr/bin::bin:./x:/usr/local/bin')).toEqual(['/usr/bin', '/usr/local/bin'])
    expect(posixPathFolders(undefined)).toEqual([])
  })

  test('Windows PATH folders: quotes removed, relative entries left out', () => {
    expect(windowsPathFolders('C:\\Windows;;"C:\\Program Files\\nodejs";.;bin; D:\\tools ;\\\\server\\share\\bin;\\rooted'))
      .toEqual(['C:\\Windows', 'C:\\Program Files\\nodejs', 'D:\\tools', '\\\\server\\share\\bin'])
  })

  test('PATHEXT: lower-case, in order, without repeats, only the types kurmis uses', () => {
    expect(pathExtensions('.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC')).toEqual(['.com', '.exe', '.bat', '.cmd'])
    expect(pathExtensions('.CMD;.exe;.Cmd')).toEqual(['.cmd', '.exe'])
    expect(pathExtensions(undefined)).toEqual(['.com', '.exe', '.bat', '.cmd'])
    expect(pathExtensions('  ')).toEqual(['.com', '.exe', '.bat', '.cmd'])
  })

  test('Windows variables are found whatever their case, and an empty one does not hide another', () => {
    expect(windowsEnv({ Path: 'C:\\a' }, 'PATH')).toBe('C:\\a')
    expect(windowsEnv({ PATH: '', Path: 'C:\\b' }, 'PATH')).toBe('C:\\b')
    expect(windowsEnv({ PATH: 'C:\\c', Path: 'C:\\d' }, 'PATH')).toBe('C:\\c')
    expect(windowsEnv({}, 'PATH')).toBeUndefined()
  })
})
