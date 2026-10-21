import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTreeSync, type RemoveTreeFs } from '../../src/platform/remove-tree.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kurmis-remove-tree-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('removeTreeSync on this machine', () => {
  it('removes a folder with links into another folder and leaves the targets alone', () => {
    const outside = join(root, 'outside')
    mkdirSync(join(outside, 'sessions'), { recursive: true })
    writeFileSync(join(outside, 'sessions', 'one.jsonl'), 'kept')
    writeFileSync(join(outside, 'config.toml'), 'kept')
    const home = join(root, 'home')
    mkdirSync(join(home, 'nested', 'deeper'), { recursive: true })
    writeFileSync(join(home, 'auth.json'), '{}')
    writeFileSync(join(home, 'nested', 'deeper', 'file'), 'x')
    symlinkSync(join(outside, 'sessions'), join(home, 'sessions'), 'dir')
    symlinkSync(join(outside, 'config.toml'), join(home, 'config.toml'), 'file')
    symlinkSync(join(outside, 'sessions'), join(home, 'nested', 'link'), 'dir')
    symlinkSync(join(root, 'nowhere'), join(home, 'broken'))

    removeTreeSync(home)

    expect(existsSync(home)).toBe(false)
    expect(readFileSync(join(outside, 'sessions', 'one.jsonl'), 'utf8')).toBe('kept')
    expect(readFileSync(join(outside, 'config.toml'), 'utf8')).toBe('kept')
  })

  it('removes a link given as the folder itself, not its target', () => {
    const target = join(root, 'target')
    mkdirSync(target)
    writeFileSync(join(target, 'file'), 'kept')
    symlinkSync(target, join(root, 'link'), 'dir')
    removeTreeSync(join(root, 'link'))
    expect(existsSync(join(root, 'link'))).toBe(false)
    expect(readFileSync(join(target, 'file'), 'utf8')).toBe('kept')
  })

  it('accepts a path that does not exist', () => {
    expect(() => removeTreeSync(join(root, 'missing'))).not.toThrow()
  })
})

type Entry = { kind: 'dir'; children: string[] } | { kind: 'file'; readOnly?: boolean } | { kind: 'junction' }

/** A Windows-shaped file system in memory, recording each operation. */
function fakeWindowsFs(entries: Record<string, Entry>): { fs: RemoveTreeFs; calls: string[]; entries: Record<string, Entry> } {
  const calls: string[] = []
  const error = (code: string): Error => Object.assign(new Error(code), { code })
  const get = (path: string): Entry => {
    const entry = entries[path]
    if (entry === undefined) throw error('ENOENT')
    return entry
  }
  const fs: RemoveTreeFs = {
    lstatSync(path) {
      const entry = get(path)
      return { isDirectory: () => entry.kind === 'dir', isSymbolicLink: () => entry.kind === 'junction' }
    },
    readdirSync(path) {
      calls.push(`readdir ${path}`)
      const entry = get(path)
      if (entry.kind !== 'dir') throw error('ENOTDIR')
      return entry.children
    },
    unlinkSync(path) {
      calls.push(`unlink ${path}`)
      const entry = get(path)
      // As if libuv did not recognise the junction's reparse data.
      if (entry.kind === 'junction' || entry.kind === 'dir' || (entry.kind === 'file' && entry.readOnly === true)) throw error('EPERM')
      delete entries[path]
    },
    rmdirSync(path) {
      calls.push(`rmdir ${path}`)
      get(path)
      delete entries[path]
    },
    chmodSync(path) {
      calls.push(`chmod ${path}`)
      const entry = get(path)
      if (entry.kind === 'file') entry.readOnly = false
    }
  }
  return { fs, calls, entries }
}

describe('removeTreeSync on Windows', () => {
  const home = join('C:', 'kurmis', 'codex', 'work')

  it('removes a junction with rmdir and never lists what it points at', () => {
    const sessions = join(home, 'sessions')
    const auth = join(home, 'auth.json')
    const { fs, calls, entries } = fakeWindowsFs({
      [home]: { kind: 'dir', children: ['sessions', 'auth.json'] },
      [sessions]: { kind: 'junction' },
      [auth]: { kind: 'file' }
    })
    removeTreeSync(home, { fs, platform: 'win32' })
    expect(entries).toEqual({})
    expect(calls).toEqual([`readdir ${home}`, `unlink ${sessions}`, `rmdir ${sessions}`, `unlink ${auth}`, `rmdir ${home}`])
  })

  it('clears the read-only flag of a file it cannot delete', () => {
    const file = join(home, 'locked')
    const { fs, calls, entries } = fakeWindowsFs({
      [home]: { kind: 'dir', children: ['locked'] },
      [file]: { kind: 'file', readOnly: true }
    })
    removeTreeSync(home, { fs, platform: 'win32' })
    expect(entries).toEqual({})
    expect(calls).toContain(`chmod ${file}`)
  })

  it('throws an error it does not expect', () => {
    const fs: RemoveTreeFs = {
      lstatSync: () => ({ isDirectory: () => false, isSymbolicLink: () => true }),
      readdirSync: () => [],
      unlinkSync: () => {
        throw Object.assign(new Error('ENAMETOOLONG'), { code: 'ENAMETOOLONG' })
      },
      rmdirSync: () => undefined,
      chmodSync: () => undefined
    }
    expect(() => removeTreeSync(home, { fs, platform: 'win32' })).toThrow('ENAMETOOLONG')
  })
})
