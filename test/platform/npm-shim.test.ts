// The fixtures in `fixtures/`:
// - `npm-*.cmd` were written by npm's own cmd-shim 8.0.0 (the copy inside npm 11.9.0), run
//   against a temporary folder with the same layout as an npm global install
//   (`<prefix>\<name>.cmd` and `<prefix>\node_modules\...`) or a project install
//   (`node_modules\.bin\<name>.cmd`).
// - `npm12-*.cmd` were written the same way by cmd-shim 9.0.2, the copy inside npm 12.2.0.
// - `pnpm-*.cmd` were written by pnpm's @zkochan/cmd-shim 9.0.8 the same way, with pnpm's global
//   layout (`<PNPM_HOME>\global\5\node_modules\...`), a project's `.pnpm` folder, and the
//   options pnpm can pass (`nodePath`, `nodeExecPath`, `preserveSymlinks`, `progArgs`). The
//   `NODE_PATH` and Node paths in them are made up.
// - `pnpm11-*.cmd` were written by @pnpm/bins.cmd-shim 1100.0.4 (the same code pnpm 11.28.6
//   bundles) with pnpm 11's global layout (`<PNPM_HOME>\global\v11\<hash>\node_modules\...`).
//   The hash, the `NODE_PATH` and the Node paths (one in a folder with a non-ASCII name, one in a
//   folder with a `%`) are made up.
// - `handwritten-*.cmd` follow the source of older cmd-shim versions (2 and 4), which are not on
//   this machine to run.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { cmdShimInvocation, decodeCmdShim, isAbsoluteWindowsPath, parseCmdShim } from '../../src/platform/npm-shim.ts'
import type { CmdShim } from '../../src/platform/npm-shim.ts'

const FIXTURES = resolve('test/platform/fixtures')
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

const NPM = 'C:\\Users\\example\\AppData\\Roaming\\npm'
const PNPM = 'C:\\Users\\example\\AppData\\Local\\pnpm'
const PROJECT = 'D:\\work\\project'
const NODE_LOOKUP = ['node']

describe('shims written by npm', () => {
  test.each([
    ['npm-global-codex.cmd', `${NPM}\\codex.cmd`, {
      target: `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`,
      interpreters: [`${NPM}\\node.exe`, ...NODE_LOOKUP]
    }],
    ['npm-global-claude-cli-js.cmd', `${NPM}\\claude.cmd`, {
      target: `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`,
      interpreters: [`${NPM}\\node.exe`, ...NODE_LOOKUP]
    }],
    ['npm-global-claude-exe.cmd', `${NPM}\\claude.cmd`, {
      target: `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
      interpreters: []
    }],
    ['npm-local-bin-codex.cmd', `${PROJECT}\\node_modules\\.bin\\codex.cmd`, {
      target: `${PROJECT}\\node_modules\\@openai\\codex\\bin\\codex.js`,
      interpreters: [`${PROJECT}\\node_modules\\.bin\\node.exe`, ...NODE_LOOKUP]
    }],
    ['npm-local-bin-claude-exe.cmd', `${PROJECT}\\node_modules\\.bin\\claude.cmd`, {
      target: `${PROJECT}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
      interpreters: []
    }],
    ['npm12-global-codex.cmd', `${NPM}\\codex.cmd`, {
      target: `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`,
      interpreters: [`${NPM}\\node.exe`, ...NODE_LOOKUP]
    }],
    ['npm12-global-claude-exe.cmd', `${NPM}\\claude.cmd`, {
      target: `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
      interpreters: []
    }]
  ])('%s', (name, shimPath, expected) => {
    expect(parseCmdShim(fixture(name), shimPath)).toEqual({ ...expected, interpreterArgs: [], targetArgs: [] })
  })

  test('the arguments of the #! line go between Node and the target', () => {
    expect(parseCmdShim(fixture('npm-shebang-args.cmd'), `${NPM}\\tool.cmd`)).toEqual({
      target: `${NPM}\\node_modules\\example-tool\\bin\\tool.js`,
      interpreters: [`${NPM}\\node.exe`, 'node'],
      interpreterArgs: ['--stack-size=4000'],
      targetArgs: []
    })
  })

  test('older npm shims (cmd-shim 2 and 4)', () => {
    const codex: CmdShim = {
      target: `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`,
      interpreters: [`${NPM}\\node.exe`, 'node'],
      interpreterArgs: [],
      targetArgs: []
    }
    expect(parseCmdShim(fixture('handwritten-npm-cmd-shim-2-codex.cmd'), `${NPM}\\codex.cmd`)).toEqual(codex)
    expect(parseCmdShim(fixture('handwritten-npm-cmd-shim-4-codex.cmd'), `${NPM}\\codex.cmd`)).toEqual(codex)
    expect(parseCmdShim(fixture('handwritten-npm-cmd-shim-2-claude-exe.cmd'), `${NPM}\\claude.cmd`)).toEqual({
      target: `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
      interpreters: [],
      interpreterArgs: [],
      targetArgs: []
    })
  })
})

describe('shims written by pnpm', () => {
  test('a global install, with its NODE_PATH block', () => {
    expect(parseCmdShim(fixture('pnpm-global-codex.cmd'), `${PNPM}\\codex.cmd`)).toEqual({
      target: `${PNPM}\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js`,
      interpreters: [`${PNPM}\\node.exe`, 'node'],
      interpreterArgs: [],
      targetArgs: []
    })
    expect(parseCmdShim(fixture('pnpm-global-claude-exe.cmd'), `${PNPM}\\claude.cmd`)).toEqual({
      target: `${PNPM}\\global\\5\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
      interpreters: [],
      interpreterArgs: [],
      targetArgs: []
    })
  })

  test('a project install, into the .pnpm folder', () => {
    expect(parseCmdShim(fixture('pnpm-local-bin-codex.cmd'), `${PROJECT}\\node_modules\\.bin\\codex.cmd`)).toEqual({
      target: `${PROJECT}\\node_modules\\.pnpm\\@openai+codex@0.163.0\\node_modules\\@openai\\codex\\bin\\codex.js`,
      interpreters: [`${PROJECT}\\node_modules\\.bin\\node.exe`, 'node'],
      interpreterArgs: [],
      targetArgs: []
    })
  })

  test('a fixed Node, --preserve-symlinks and extra arguments after the target', () => {
    expect(parseCmdShim(fixture('pnpm-node-exec-path.cmd'), `${PNPM}\\codex.cmd`)).toEqual({
      target: `${PNPM}\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js`,
      interpreters: ['C:\\Program Files\\nodejs\\node.exe'],
      interpreterArgs: ['--preserve-symlinks'],
      targetArgs: ['--from-shim']
    })
  })
})

describe('shims written by pnpm 11', () => {
  const GROUP = `${PNPM}\\global\\v11\\50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c\\node_modules`

  test('a global install', () => {
    expect(parseCmdShim(fixture('pnpm11-global-codex.cmd'), `${PNPM}\\codex.cmd`)).toEqual({
      target: `${GROUP}\\@openai\\codex\\bin\\codex.js`,
      interpreters: [`${PNPM}\\node.exe`, 'node'],
      interpreterArgs: [],
      targetArgs: []
    })
    expect(parseCmdShim(fixture('pnpm11-global-claude-exe.cmd'), `${PNPM}\\claude.cmd`)).toEqual({
      target: `${GROUP}\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
      interpreters: [],
      interpreterArgs: [],
      targetArgs: []
    })
  })

  test('a fixed Node in a folder with a non-ASCII name, with the chcp lines around it', () => {
    const home = 'C:\\Users\\ex\u00e4mple\\AppData\\Local\\pnpm'
    const text = decodeCmdShim(readFileSync(join(FIXTURES, 'pnpm11-node-exec-path-non-ascii.cmd'))) as string
    expect(parseCmdShim(text, `${home}\\codex.cmd`)).toEqual({
      target: `${home}\\global\\v11\\50d858e0985ecc7f60418aaf0cc5ab587f42c2570a884095a9e8ccacd0f6545c\\node_modules\\@openai\\codex\\bin\\codex.js`,
      interpreters: [`${home}\\nodejs\\24.11.0\\node.exe`],
      interpreterArgs: [],
      targetArgs: []
    })
  })

  test('a fixed Node in a folder with a %, which pnpm writes as %%', () => {
    expect(parseCmdShim(fixture('pnpm11-node-exec-path-percent.cmd'), `${PNPM}\\codex.cmd`)).toEqual({
      target: `${GROUP}\\@openai\\codex\\bin\\codex.js`,
      interpreters: ['C:\\Users\\example\\tools\\100%\\node.exe'],
      interpreterArgs: [],
      targetArgs: []
    })
  })
})

describe('reading', () => {
  test('line endings, case and a shim on a network share', () => {
    const text = '@IF EXIST "%~DP0\\node.exe" (\n  "%~DP0\\node.exe" "%~DP0\\lib\\cli.js" %*\n) ELSE (\n  node "%~Dp0\\lib\\cli.js" %*\n)\n'
    expect(parseCmdShim(text, '\\\\server\\tools\\cli.cmd')).toEqual({
      target: '\\\\server\\tools\\lib\\cli.js',
      interpreters: ['\\\\server\\tools\\node.exe', 'node'],
      interpreterArgs: [],
      targetArgs: []
    })
  })

  test('a % in the shim\'s own folder is kept as it is', () => {
    const folder = 'C:\\Users\\example\\100%\\npm'
    expect(parseCmdShim(fixture('npm12-global-codex.cmd'), `${folder}\\codex.cmd`)).toEqual({
      target: `${folder}\\node_modules\\@openai\\codex\\bin\\codex.js`,
      interpreters: [`${folder}\\node.exe`, 'node'],
      interpreterArgs: [],
      targetArgs: []
    })
    expect(parseCmdShim(fixture('pnpm-global-claude-exe.cmd'), 'C:\\a%b%\\claude.cmd')).toMatchObject({
      target: 'C:\\a%b%\\global\\5\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
    })
  })

  test('%% is read as one %, and is not the start of a variable', () => {
    expect(parseCmdShim('@"%~dp0\\50%%\\tool.exe"   %*\r\n', 'C:\\tools\\tool.cmd')).toMatchObject({
      target: 'C:\\tools\\50%\\tool.exe',
      interpreters: [],
      targetArgs: []
    })
    expect(parseCmdShim('@node "%~dp0\\cli.js" --rate=50%% %*\r\n', 'C:\\tools\\tool.cmd')).toMatchObject({
      target: 'C:\\tools\\cli.js',
      targetArgs: ['--rate=50%']
    })
    // `%%~dp0` is the text `%~dp0`, not the shim's folder, so the target is a relative path.
    expect(parseCmdShim('@node "%%~dp0\\cli.js" %*\r\n', 'C:\\tools\\tool.cmd'))
      .toEqual({ unreadable: 'it uses %%~dp0\\cli.js, which kurmis cannot work out' })
  })

  test('a byte order mark is dropped and the text is read as UTF-8', () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('@"%~dp0\\t\u00f6\u00f6l\\tool.exe"   %*\r\n', 'utf8')])
    const text = decodeCmdShim(bytes)
    expect(text).toBe('@"%~dp0\\t\u00f6\u00f6l\\tool.exe"   %*\r\n')
    expect(parseCmdShim(text as string, 'C:\\Users\\ex\u00e4mple\\tool.cmd')).toMatchObject({
      target: 'C:\\Users\\ex\u00e4mple\\t\u00f6\u00f6l\\tool.exe',
      interpreters: []
    })
  })

  test('bytes that are not UTF-8 are not decoded', () => {
    // "ä" in Windows-1252, as an editor saving in the ANSI code page would write it.
    expect(decodeCmdShim(Buffer.from([0x40, 0x22, 0x43, 0x3a, 0x5c, 0xe4, 0x22, 0x20, 0x25, 0x2a]))).toBeNull()
  })

  test('.. in the target is resolved', () => {
    const shim = parseCmdShim('@"%~dp0\\..\\..\\tool\\tool.exe" %*\r\n', 'C:\\a\\b\\c\\tool.cmd')
    expect(shim).toMatchObject({ target: 'C:\\a\\tool\\tool.exe', interpreters: [] })
  })

  test.each([
    ['no line passes the arguments on', '@ECHO off\r\nnode "%~dp0\\cli.js"\r\n', 'no line passes the arguments on'],
    ['a file that is not a shim', 'just some text', 'no line passes the arguments on'],
    ['a variable other than the shim folder', '@"%APPDATA%\\npm\\tool.exe" %*\r\n', '%APPDATA%'],
    ['a variable in the target', '@node "%~dp0\\%TOOL%\\cli.js" %*\r\n', '%TOOL%'],
    ['a variable after the shim folder', '@"%dp0%%APPDATA%\\tool.exe" %*\r\n', '%APPDATA%'],
    ['a batch argument', '@node "%~dp0\\cli.js" %1 %*\r\n', '%1'],
    ['a single % before %%', '@"%~dp0\\a%b%%c\\tool.exe" %*\r\n', 'a%b%%c'],
    ['a relative target', '@node "lib\\cli.js" %*\r\n', 'starts no file by its path'],
    ['an interpreter by relative path', '@"bin\\node.exe" "%~dp0\\cli.js" %*\r\n', 'neither an absolute path'],
    ['no target path', '@node --version %*\r\n', 'starts no file by its path'],
    ['a pipe', '@node "%~dp0\\cli.js" | more %*\r\n', 'not a plain command'],
    ['a redirection', '@node "%~dp0\\cli.js" > out.txt %*\r\n', 'not a plain command'],
    ['_prog never set', '"%_prog%" "%dp0%\\cli.js" %*\r\n', 'never sets it'],
    ['branches that start different files', '@IF EXIST x (\r\n  node "%~dp0\\a.js" %*\r\n) ELSE (\r\n  node "%~dp0\\b.js" %*\r\n)\r\n', 'different programs']
  ])('%s is unreadable', (_name, text, reason) => {
    const reading = parseCmdShim(text, 'C:\\tools\\tool.cmd')
    expect(reading).toEqual({ unreadable: expect.stringContaining(reason) })
  })

  test('absolute Windows paths', () => {
    expect(isAbsoluteWindowsPath('C:\\x')).toBe(true)
    expect(isAbsoluteWindowsPath('c:\\')).toBe(true)
    expect(isAbsoluteWindowsPath('\\\\server\\share')).toBe(true)
    expect(isAbsoluteWindowsPath('\\x')).toBe(false)
    expect(isAbsoluteWindowsPath('C:x')).toBe(false)
    expect(isAbsoluteWindowsPath('/usr/bin')).toBe(false)
    expect(isAbsoluteWindowsPath('node')).toBe(false)
  })
})

describe('starting what a shim starts', () => {
  const nodeShim = parseCmdShim(fixture('npm-global-codex.cmd'), `${NPM}\\codex.cmd`) as CmdShim
  const target = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`

  test('a node.exe next to the shim is used when it exists', () => {
    expect(cmdShimInvocation(nodeShim, { nodePath: 'C:\\kurmis\\node.exe', isFile: (path) => path === `${NPM}\\node.exe` }))
      .toEqual({ command: `${NPM}\\node.exe`, args: [target] })
  })

  test('otherwise the Node kurmis was given stands for the node on PATH', () => {
    expect(cmdShimInvocation(nodeShim, { nodePath: 'C:\\kurmis\\node.exe', isFile: () => false }))
      .toEqual({ command: 'C:\\kurmis\\node.exe', args: [target] })
  })

  test('a fixed Node is used only when it exists', () => {
    const shim = parseCmdShim(fixture('pnpm-node-exec-path.cmd'), `${PNPM}\\codex.cmd`) as CmdShim
    const pnpmTarget = `${PNPM}\\global\\5\\node_modules\\@openai\\codex\\bin\\codex.js`
    expect(cmdShimInvocation(shim, { nodePath: 'C:\\kurmis\\node.exe', isFile: () => true })).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['--preserve-symlinks', pnpmTarget, '--from-shim']
    })
    expect(cmdShimInvocation(shim, { nodePath: 'C:\\kurmis\\node.exe', isFile: () => false }))
      .toEqual({ refused: expect.stringContaining('which kurmis does not start') })
  })

  test('an .exe target is started directly', () => {
    const shim = parseCmdShim(fixture('npm-global-claude-exe.cmd'), `${NPM}\\claude.cmd`) as CmdShim
    expect(cmdShimInvocation(shim, { nodePath: 'C:\\node.exe', isFile: () => true }))
      .toEqual({ command: `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`, args: [] })
  })

  test.each([
    ['a batch file target', { target: 'C:\\x\\tool.cmd', interpreters: [], interpreterArgs: [], targetArgs: [] }, 'batch file'],
    ['a batch file run through cmd', { target: 'C:\\x\\tool.BAT', interpreters: ['cmd'], interpreterArgs: ['/C'], targetArgs: [] }, 'batch file'],
    ['a direct target that is not an .exe', { target: 'C:\\x\\tool', interpreters: [], interpreterArgs: [], targetArgs: [] }, 'not an .exe'],
    ['another interpreter', { target: 'C:\\x\\tool.sh', interpreters: ['C:\\x\\sh.exe', 'sh'], interpreterArgs: [], targetArgs: [] }, 'with C:\\x\\sh.exe or sh']
  ])('%s is refused', (_name, shim, reason) => {
    expect(cmdShimInvocation(shim, { nodePath: 'C:\\node.exe', isFile: () => false })).toEqual({ refused: expect.stringContaining(reason) })
  })

  test('node.exe as a bare name counts as node', () => {
    const shim: CmdShim = { target: 'C:\\x\\cli.js', interpreters: ['NODE.EXE'], interpreterArgs: [], targetArgs: ['--a'] }
    expect(cmdShimInvocation(shim, { nodePath: 'C:\\node.exe', isFile: () => false })).toEqual({ command: 'C:\\node.exe', args: ['C:\\x\\cli.js', '--a'] })
  })
})
