import type * as fs from 'node:fs'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateDaemonSecret,
  readDaemonFile,
  readKey,
  readOrCreateKey,
  removeDaemonFile,
  writeDaemonFile,
  type DaemonInfo
} from '../../src/data/daemon-file.ts'
import { daemonFilePath, keyPath, kurmisHome } from '../../src/data/paths.ts'

/**
 * The error code `linkSync` fails with while it is set, as on a file system without hard links,
 * and the one a rename of a `.removing` file back fails with.
 */
const linkFails = vi.hoisted(() => ({ code: null as string | null, renameBack: null as string | null, before: null as (() => void) | null }))
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof fs>()
  return {
    ...real,
    linkSync: (...args: Parameters<typeof fs.linkSync>) => {
      linkFails.before?.()
      if (linkFails.code !== null) throw Object.assign(new Error(`link failed (${linkFails.code})`), { code: linkFails.code })
      real.linkSync(...args)
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (linkFails.renameBack !== null && String(args[0]).endsWith('.removing')) {
        throw Object.assign(new Error(`rename failed (${linkFails.renameBack})`), { code: linkFails.renameBack })
      }
      real.renameSync(...args)
    }
  }
})

function info(patch: Partial<DaemonInfo> = {}): DaemonInfo {
  return { pid: 4242, port: 28411, version: '0.1.0', startedAt: 1_700_000_000_000, ...patch }
}

beforeEach(() => {
  rmSync(kurmisHome(), { recursive: true, force: true, maxRetries: 10 })
})

describe('daemon.json', () => {
  it('round-trips', () => {
    const written = info()
    writeDaemonFile(written)
    expect(readDaemonFile()).toEqual({ status: 'ok', info: written })
  })

  it.skipIf(process.platform === 'win32')('is readable by the user only, in a private folder', () => {
    writeDaemonFile(info())
    expect(statSync(daemonFilePath()).mode & 0o777).toBe(0o600)
    expect(statSync(kurmisHome()).mode & 0o777).toBe(0o700)
  })

  it('tells missing from invalid', () => {
    expect(readDaemonFile()).toEqual({ status: 'missing' })
    mkdirSync(kurmisHome(), { recursive: true })
    writeFileSync(daemonFilePath(), 'not json')
    expect(readDaemonFile().status).toBe('invalid')
    writeFileSync(daemonFilePath(), JSON.stringify({ ...info(), port: 70000 }))
    expect(readDaemonFile()).toMatchObject({ status: 'invalid', reason: expect.stringContaining('port') })
  })

  it('is removed only by the daemon it names', () => {
    writeDaemonFile(info({ pid: 100 }))
    expect(removeDaemonFile(200)).toBe(false)
    expect(readDaemonFile().status).toBe('ok')
    expect(removeDaemonFile(100)).toBe(true)
    expect(readDaemonFile().status).toBe('missing')
    expect(removeDaemonFile(100)).toBe(false)
  })

  it('written by another daemon between the check and the removal is kept', () => {
    writeDaemonFile(info({ pid: 100 }))
    expect(removeDaemonFile(100, daemonFilePath(), () => { writeDaemonFile(info({ pid: 300 })) })).toBe(false)
    expect(readDaemonFile()).toMatchObject({ status: 'ok', info: { pid: 300 } })
    expect(readdirSync(kurmisHome()).filter((name) => name.endsWith('.removing'))).toEqual([])
  })

  it('written by another daemon in the meantime is put back by a rename where a hard link cannot be made', () => {
    writeDaemonFile(info({ pid: 100 }))
    linkFails.code = 'EPERM'
    try {
      expect(removeDaemonFile(100, daemonFilePath(), () => { writeDaemonFile(info({ pid: 300 })) })).toBe(false)
    } finally {
      linkFails.code = null
    }
    expect(readDaemonFile()).toMatchObject({ status: 'ok', info: { pid: 300 } })
    expect(readdirSync(kurmisHome()).filter((name) => name.endsWith('.removing'))).toEqual([])
  })

  it('written by another daemon in the meantime is kept aside, not deleted, when it cannot be put back', () => {
    writeDaemonFile(info({ pid: 100 }))
    linkFails.code = 'EPERM'
    linkFails.renameBack = 'EACCES'
    try {
      expect(removeDaemonFile(100, daemonFilePath(), () => { writeDaemonFile(info({ pid: 300 })) })).toBe(false)
    } finally {
      linkFails.code = null
      linkFails.renameBack = null
    }
    const kept = readdirSync(kurmisHome()).filter((name) => name.endsWith('.removing'))
    expect(kept).toHaveLength(1)
    expect(readDaemonFile(join(kurmisHome(), kept[0] ?? ''))).toMatchObject({ status: 'ok', info: { pid: 300 } })
  })

  it('that is damaged is removed, but not a good one written in its place in the meantime', () => {
    mkdirSync(kurmisHome(), { recursive: true })
    writeFileSync(daemonFilePath(), 'not json')
    expect(removeDaemonFile(-1)).toBe(true)
    expect(readDaemonFile().status).toBe('missing')
    writeFileSync(daemonFilePath(), 'not json')
    expect(removeDaemonFile(-1, daemonFilePath(), () => { writeDaemonFile(info({ pid: 300 })) })).toBe(false)
    expect(readDaemonFile()).toMatchObject({ status: 'ok', info: { pid: 300 } })
  })
})

describe('the key file', () => {
  it('is created once and then kept', () => {
    expect(readKey()).toBeNull()
    const key = readOrCreateKey()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(readOrCreateKey()).toBe(key)
    expect(readKey()).toBe(key)
    expect(readdirSync(kurmisHome())).toEqual(['key'])
  })

  it.skipIf(process.platform === 'win32')('is readable by the user only', () => {
    readOrCreateKey()
    expect(statSync(keyPath()).mode & 0o777).toBe(0o600)
  })

  for (const code of ['EPERM', 'ENOTSUP']) {
    it(`is created with an exclusive write where a hard link cannot be made (${code})`, () => {
      linkFails.code = code
      try {
        const key = readOrCreateKey()
        expect(key).toMatch(/^[0-9a-f]{64}$/)
        expect(readKey()).toBe(key)
        expect(readOrCreateKey()).toBe(key)
        expect(readdirSync(kurmisHome())).toEqual(['key'])
        if (process.platform !== 'win32') expect(statSync(keyPath()).mode & 0o777).toBe(0o600)
      } finally {
        linkFails.code = null
      }
    })
  }

  it('without hard links, is read from the file another process created first', () => {
    mkdirSync(kurmisHome(), { recursive: true })
    const theirs = generateDaemonSecret()
    linkFails.code = 'EPERM'
    // The other process's file appears between this process's first read and its create.
    linkFails.before = () => { writeFileSync(keyPath(), `${theirs}\n`) }
    try {
      expect(readOrCreateKey()).toBe(theirs)
    } finally {
      linkFails.code = null
      linkFails.before = null
    }
    expect(readKey()).toBe(theirs)
    expect(readdirSync(kurmisHome())).toEqual(['key'])
  })

  it('replaces a damaged key', () => {
    mkdirSync(kurmisHome(), { recursive: true })
    writeFileSync(keyPath(), 'not-a-key')
    expect(readKey()).toBeNull()
    const key = readOrCreateKey()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(readKey()).toBe(key)
  })
})

describe('the secret', () => {
  it('is 64 hex characters and different every time', () => {
    const a = generateDaemonSecret()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(generateDaemonSecret()).not.toBe(a)
  })
})
