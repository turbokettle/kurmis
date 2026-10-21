// Folder links: real symlinks in temporary folders on this machine, and the Windows branch
// through the pure functions with Windows-shaped paths. Creating a junction needs Windows.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { codexLinkAction } from '../../src/core/codex-home.ts'
import {
  folderLinkType,
  linkFolder,
  linkTargetPath,
  normaliseLinkTarget,
  readFolderLink
} from '../../src/platform/links.ts'

describe('the Windows parts, with Windows-shaped paths', () => {
  test('links folders with a junction on Windows and a directory symlink elsewhere', () => {
    expect(folderLinkType('win32')).toBe('junction')
    expect(folderLinkType('darwin')).toBe('dir')
    expect(folderLinkType('linux')).toBe('dir')
  })

  test('reads a junction target back without the long-path prefix', () => {
    expect(normaliseLinkTarget('\\\\?\\C:\\Users\\someone\\.codex\\sessions', 'win32')).toBe('C:\\Users\\someone\\.codex\\sessions')
    expect(normaliseLinkTarget('\\??\\C:\\Users\\someone\\.codex\\sessions', 'win32')).toBe('C:\\Users\\someone\\.codex\\sessions')
    expect(normaliseLinkTarget('\\\\?\\UNC\\server\\share\\codex', 'win32')).toBe('\\\\server\\share\\codex')
    expect(normaliseLinkTarget('\\\\?\\unc\\server\\share\\codex', 'win32')).toBe('\\\\server\\share\\codex')
    expect(normaliseLinkTarget('C:\\Users\\someone\\.codex\\sessions', 'win32')).toBe('C:\\Users\\someone\\.codex\\sessions')
    expect(normaliseLinkTarget('\\\\server\\share\\codex', 'win32')).toBe('\\\\server\\share\\codex')
  })

  test('leaves a target alone on macOS and Linux, where a backslash is part of a name', () => {
    expect(normaliseLinkTarget('\\\\?\\C:\\x', 'darwin')).toBe('\\\\?\\C:\\x')
    expect(normaliseLinkTarget('/home/someone/.codex/sessions', 'linux')).toBe('/home/someone/.codex/sessions')
  })

  test('makes a target absolute from the folder the link is in', () => {
    const place = 'C:\\Users\\someone\\.kurmis\\codex\\work\\sessions'
    expect(linkTargetPath(place, '\\\\?\\C:\\Users\\someone\\.codex\\sessions', 'win32')).toBe('C:\\Users\\someone\\.codex\\sessions')
    expect(linkTargetPath(place, '..\\..\\..\\.codex\\sessions', 'win32')).toBe('C:\\Users\\someone\\.codex\\sessions')
    expect(linkTargetPath('/home/someone/.kurmis/codex/work/sessions', '../../../.codex/sessions', 'linux'))
      .toBe('/home/someone/.codex/sessions')
    expect(linkTargetPath('/home/someone/.kurmis/codex/work/sessions', '/home/someone/.codex/sessions', 'darwin'))
      .toBe('/home/someone/.codex/sessions')
  })

  test('a junction read back with the prefix counts as linked to the folder it points at', () => {
    const place = 'C:\\Users\\someone\\.kurmis\\codex\\work\\sessions'
    const target = linkTargetPath(place, '\\\\?\\c:\\users\\someone\\.codex\\sessions', 'win32')
    expect(codexLinkAction({ kind: 'link', target }, 'C:\\Users\\someone\\.codex\\sessions', 'win32')).toBe('linked')
  })
})

describe('links on this machine', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kurmis-links-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test.skipIf(process.platform === 'win32')('links a folder so that its files show through the link', async () => {
    const source = join(dir, 'source')
    mkdirSync(source)
    writeFileSync(join(source, 'a.txt'), 'shared\n')
    const place = join(dir, 'place')

    await linkFolder(source, place)

    expect(readFileSync(join(place, 'a.txt'), 'utf8')).toBe('shared\n')
    expect(await readFolderLink(place)).toEqual({ kind: 'link', target: source })
    expect(codexLinkAction(await readFolderLink(place), source)).toBe('linked')
  })

  test('says what is at a place without following a link', async () => {
    mkdirSync(join(dir, 'folder'))
    writeFileSync(join(dir, 'file'), '')
    expect(await readFolderLink(join(dir, 'nothing'))).toEqual({ kind: 'missing' })
    expect(await readFolderLink(join(dir, 'folder'))).toEqual({ kind: 'other' })
    expect(await readFolderLink(join(dir, 'file'))).toEqual({ kind: 'other' })
  })

  test.skipIf(process.platform === 'win32')('reads a relative or dangling symlink back as an absolute target', async () => {
    mkdirSync(join(dir, 'source'))
    symlinkSync('source', join(dir, 'relative'))
    symlinkSync(join(dir, 'gone'), join(dir, 'dangling'))
    expect(await readFolderLink(join(dir, 'relative'))).toEqual({ kind: 'link', target: join(dir, 'source') })
    expect(await readFolderLink(join(dir, 'dangling'))).toEqual({ kind: 'link', target: join(dir, 'gone') })
  })

  test.skipIf(process.platform === 'win32')('never replaces what is at the place', async () => {
    mkdirSync(join(dir, 'source'))
    mkdirSync(join(dir, 'place'))
    await expect(linkFolder(join(dir, 'source'), join(dir, 'place'))).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFolderLink(join(dir, 'place'))).toEqual({ kind: 'other' })
  })

  test('throws a read error other than a missing place', async () => {
    writeFileSync(join(dir, 'file'), '')
    await expect(readFolderLink(join(dir, 'file', 'below'))).rejects.toMatchObject({ code: 'ENOTDIR' })
  })
})
