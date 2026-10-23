import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isTemporaryPath, kurmisEntry, nodeForJobs, spawnDetached, temporaryFolders } from '../../src/platform/detach.ts'
import { canCreateSymlinks } from '../host.ts'

const scratch = mkdtempSync(join(tmpdir(), 'kurmis-detach-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10 }))

describe('kurmisEntry', () => {
  it('takes KURMIS_ENTRY first', () => {
    expect(kurmisEntry({ env: { KURMIS_ENTRY: '/opt/example/kurmis.cjs' }, moduleFile: '/elsewhere/kurmis.cjs' })).toBe('/opt/example/kurmis.cjs')
  })

  it('is null when running from source with no KURMIS_ENTRY', () => {
    expect(kurmisEntry({ env: {}, moduleFile: null })).toBeNull()
    // Under vitest this module is a .ts file, which is not a bundle.
    expect(kurmisEntry({ env: {} })).toBeNull()
  })

  // A symlink to a file needs Developer Mode or an administrator on Windows.
  it.runIf(canCreateSymlinks())('resolves a symlinked bundle to its real file', () => {
    const real = join(scratch, 'real.cjs')
    writeFileSync(real, '')
    const link = join(scratch, 'link.cjs')
    symlinkSync(real, link)
    expect(kurmisEntry({ env: {}, moduleFile: link })).toBe(kurmisEntry({ env: {}, moduleFile: real }))
  })
})

describe('nodeForJobs', () => {
  // These look at real files in the scratch folder, so they use this OS's PATH rules: `node.exe`
  // and `;` on Windows, `node` and `:` elsewhere.
  const platform = process.platform
  const NODE = platform === 'win32' ? 'node.exe' : 'node'

  it('prefers the node on PATH when it is the same file as the running one', () => {
    const bin = join(scratch, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, NODE), '')
    const realpath = (path: string): string => (path === join(bin, NODE) ? '/cellar/node/22.1.0/bin/node' : path)
    expect(nodeForJobs({ env: { PATH: bin }, platform, execPath: '/cellar/node/22.1.0/bin/node', realpath, temporaryFolders: [] }))
      .toBe(join(bin, NODE))
  })

  it("passes over a node on PATH in fnm's per-shell folder or a temporary folder", () => {
    const multishell = join(scratch, 'state', 'fnm_multishells', '4242_1700000000000', 'bin')
    const lasting = join(scratch, 'fnm', 'aliases', 'default', 'bin')
    for (const folder of [multishell, lasting]) {
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, NODE), '')
    }
    const real = '/fnm/node-versions/v22.1.0/installation/bin/node'
    const realpath = (path: string): string => (path.endsWith(NODE) ? real : path)
    const env = { PATH: [multishell, lasting].join(delimiter) }
    expect(nodeForJobs({ env, platform, execPath: real, realpath, temporaryFolders: [] })).toBe(join(lasting, NODE))
    expect(nodeForJobs({ env: { PATH: multishell }, platform, execPath: real, realpath, temporaryFolders: [] })).toBe(real)
    // The scratch folder is in the temporary folder, so with the real list every candidate is passed over.
    expect(nodeForJobs({ env, platform, execPath: real, realpath })).toBe(real)
  })

  it("uses the resolved path of a running node in fnm's per-shell folder, as Windows reports it", () => {
    const shell = 'C:\\Users\\Example\\AppData\\Local\\fnm_multishells\\4242_1700000000000'
    const installed = 'C:\\Users\\Example\\AppData\\Roaming\\fnm\\node-versions\\v22.1.0\\installation\\node.exe'
    const realpath = (path: string): string => (path.startsWith(shell) ? installed : path)
    expect(nodeForJobs({ env: { Path: shell }, platform: 'win32', execPath: `${shell}\\node.exe`, realpath, temporaryFolders: [] }))
      .toBe(installed)
    // When the resolved path is temporary too, nothing better is known.
    expect(nodeForJobs({ env: {}, platform: 'win32', execPath: `${shell}\\node.exe`, realpath: () => `${shell}\\node.exe`, temporaryFolders: [] }))
      .toBe(`${shell}\\node.exe`)
  })

  it('tells temporary paths apart, Windows paths without regard to case', () => {
    expect(isTemporaryPath('/Users/example/.local/state/fnm_multishells/1_2/bin/node', [], 'darwin')).toBe(true)
    expect(isTemporaryPath('/private/var/folders/ab/T/x/node', ['/private/var/folders'], 'darwin')).toBe(true)
    expect(isTemporaryPath('/tmpfoo/node', ['/tmp'], 'linux')).toBe(false)
    expect(isTemporaryPath('/opt/homebrew/bin/node', ['/tmp'], 'darwin')).toBe(false)
    expect(isTemporaryPath('C:\\Users\\Example\\AppData\\Local\\FNM_MULTISHELLS\\1_2\\node.exe', [], 'win32')).toBe(true)
    expect(isTemporaryPath('c:\\users\\example\\appdata\\local\\temp\\n\\node.exe', ['C:\\Users\\Example\\AppData\\Local\\Temp\\'], 'win32')).toBe(true)
    expect(isTemporaryPath('C:\\Program Files\\nodejs\\node.exe', ['C:\\Users\\Example\\AppData\\Local\\Temp'], 'win32')).toBe(false)
    expect(temporaryFolders({ TMPDIR: '/var/tmp/example' }, 'darwin')).toEqual(expect.arrayContaining(['/var/tmp/example', '/tmp', '/var/folders']))
  })

  it('keeps the running node when the one on PATH is another', () => {
    const bin = join(scratch, 'other-bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, NODE), '')
    const realpath = (path: string): string => path
    expect(nodeForJobs({ env: { PATH: bin }, platform, execPath: '/usr/local/bin/node22', realpath, temporaryFolders: [] }))
      .toBe('/usr/local/bin/node22')
  })

  it('keeps the running node when PATH has none', () => {
    expect(nodeForJobs({ env: { PATH: join(scratch, 'empty') }, platform, execPath: process.execPath }))
      .toBe(process.execPath)
  })
})

describe('spawnDetached', () => {
  it('starts a program with the given environment and reports its exit', async () => {
    const marker = join(scratch, 'marker.txt')
    const child = await spawnDetached({
      command: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.env.EXAMPLE_VALUE)`],
      env: { ...process.env, EXAMPLE_VALUE: 'from-the-parent' }
    })
    expect(child.pid).toBeGreaterThan(0)
    expect(await child.exited).toBe(0)
    expect(existsSync(marker)).toBe(true)
  })

  it('rejects when the program does not exist', async () => {
    await expect(spawnDetached({ command: join(scratch, 'no-such-program'), args: [], env: process.env })).rejects.toThrow()
  })
})
