import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTreeSync, type RemoveTreeFs } from '../../src/platform/remove-tree.ts'
import { canCreateSymlinks, linkFolder } from '../host.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kurmis-remove-tree-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10 })
})

describe('removeTreeSync on this machine', () => {
  it('removes a folder with folder links into another folder and leaves the targets alone', () => {
    const outside = join(root, 'outside')
    mkdirSync(join(outside, 'sessions'), { recursive: true })
    writeFileSync(join(outside, 'sessions', 'one.jsonl'), 'kept')
    const home = join(root, 'home')
    mkdirSync(join(home, 'nested', 'deeper'), { recursive: true })
    writeFileSync(join(home, 'auth.json'), '{}')
    writeFileSync(join(home, 'nested', 'deeper', 'file'), 'x')
    linkFolder(join(outside, 'sessions'), join(home, 'sessions'))
    linkFolder(join(outside, 'sessions'), join(home, 'nested', 'link'))

    removeTreeSync(home)

    expect(existsSync(home)).toBe(false)
    expect(readFileSync(join(outside, 'sessions', 'one.jsonl'), 'utf8')).toBe('kept')
  })

  // A symlink to a file, and a dangling one, need Developer Mode or an administrator on Windows.
  it.runIf(canCreateSymlinks())('removes a folder with a file symlink and a dangling symlink and leaves the target alone', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'config.toml'), 'kept')
    const home = join(root, 'home')
    mkdirSync(home)
    symlinkSync(join(outside, 'config.toml'), join(home, 'config.toml'), 'file')
    symlinkSync(join(root, 'nowhere'), join(home, 'broken'))

    removeTreeSync(home)

    expect(existsSync(home)).toBe(false)
    expect(readFileSync(join(outside, 'config.toml'), 'utf8')).toBe('kept')
  })

  // A junction (or directory symlink) whose folder was deleted afterwards: this needs no
  // Developer Mode on Windows, so it runs everywhere.
  it('removes a folder holding a folder link whose target was deleted', () => {
    const gone = join(root, 'gone')
    mkdirSync(gone)
    const home = join(root, 'home')
    mkdirSync(home)
    linkFolder(gone, join(home, 'sessions'))
    rmSync(gone, { recursive: true })

    removeTreeSync(home)

    expect(existsSync(home)).toBe(false)
  })

  it('removes a link given as the folder itself, not its target', () => {
    const target = join(root, 'target')
    mkdirSync(target)
    writeFileSync(join(target, 'file'), 'kept')
    linkFolder(target, join(root, 'link'))
    removeTreeSync(join(root, 'link'))
    expect(existsSync(join(root, 'link'))).toBe(false)
    expect(readFileSync(join(target, 'file'), 'utf8')).toBe('kept')
  })

  it('accepts a path that does not exist', () => {
    expect(() => removeTreeSync(join(root, 'missing'))).not.toThrow()
  })
})

/** `real` is what the real path of a folder resolves to, when it is not the folder itself (a mount point). */
type Entry = { kind: 'dir'; children: string[]; real?: string } | { kind: 'file'; readOnly?: boolean } | { kind: 'junction' }

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
    },
    realpathSync(path) {
      const entry = get(path)
      return entry.kind === 'dir' && entry.real !== undefined ? entry.real : path
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

  it('removes a volume mounted into a folder as an entry, without going into it', () => {
    // libuv reports a volume mount point as a plain folder; its real path is the volume.
    const mounted = join(home, 'mounted')
    const onVolume = join(mounted, 'data.bin')
    const { fs, calls, entries } = fakeWindowsFs({
      [home]: { kind: 'dir', children: ['mounted'] },
      [mounted]: { kind: 'dir', children: ['data.bin'], real: '\\\\?\\Volume{00000000-0000-0000-0000-000000000001}\\' },
      [onVolume]: { kind: 'file' }
    })
    removeTreeSync(home, { fs, platform: 'win32' })
    expect(calls).toEqual([`readdir ${home}`, `rmdir ${mounted}`, `rmdir ${home}`])
    expect(Object.keys(entries)).toEqual([onVolume])
  })

  it('goes into a folder whose real path differs only in case', () => {
    const sub = join(home, 'Sub')
    const file = join(sub, 'f')
    const { fs, entries } = fakeWindowsFs({
      [home]: { kind: 'dir', children: ['Sub'] },
      [sub]: { kind: 'dir', children: ['f'], real: sub.toUpperCase() },
      [file]: { kind: 'file' }
    })
    removeTreeSync(home, { fs, platform: 'win32' })
    expect(entries).toEqual({})
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
      chmodSync: () => undefined,
      realpathSync: (path) => path
    }
    expect(() => removeTreeSync(home, { fs, platform: 'win32' })).toThrow('ENAMETOOLONG')
  })
})
