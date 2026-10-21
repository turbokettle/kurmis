import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/data/config.ts'
import {
  acquireFileLockSync,
  isProcessAlive,
  LockTimeoutError,
  readLockHolder,
  withFileLockSync
} from '../../src/data/lock.ts'

const folder = mkdtempSync(join(tmpdir(), 'kurmis-lock-test-'))
const lockPath = join(folder, 'thing.lock')

afterAll(() => {
  rmSync(folder, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(lockPath, { force: true })
  rmSync(`${lockPath}.break`, { force: true })
})

/** The pid of a process that has exited. */
function deadPid(): number {
  const pid = spawnSync(process.execPath, ['-e', '']).pid
  expect(isProcessAlive(pid)).toBe(false)
  return pid
}

function writeLock(pid: number, createdAt: number, token = 'someone-else'): void {
  writeFileSync(lockPath, `${JSON.stringify({ pid, createdAt, token })}\n`)
}

describe('isProcessAlive', () => {
  it('knows this process and a finished one', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
    expect(isProcessAlive(deadPid())).toBe(false)
    expect(isProcessAlive(0)).toBe(false)
    expect(isProcessAlive(-5)).toBe(false)
  })

  it('counts EPERM (another user, or a process Windows will not open) as running and ESRCH as gone', () => {
    const throwing = (code: string) => () => {
      throw Object.assign(new Error(code), { code })
    }
    expect(isProcessAlive(1234, throwing('EPERM'))).toBe(true)
    expect(isProcessAlive(1234, throwing('ESRCH'))).toBe(false)
    expect(isProcessAlive(1234, () => true)).toBe(true)
  })
})

describe('the lock file', () => {
  it('holds the pid and the time while held and is removed after', () => {
    const before = Date.now()
    const result = withFileLockSync(lockPath, () => {
      const holder = readLockHolder(lockPath)
      expect(holder?.pid).toBe(process.pid)
      expect(holder?.createdAt).toBeGreaterThanOrEqual(before)
      return 'done'
    })
    expect(result).toBe('done')
    expect(existsSync(lockPath)).toBe(false)
  })

  it('is released when the work throws', () => {
    expect(() => withFileLockSync(lockPath, () => {
      throw new Error('boom')
    })).toThrow('boom')
    expect(existsSync(lockPath)).toBe(false)
  })

  it('refuses to be taken twice by the same process instead of waiting forever', () => {
    withFileLockSync(lockPath, () => {
      expect(() => acquireFileLockSync(lockPath, { timeoutMs: 10_000 })).toThrow(/already locked by this process/)
    })
  })

  it('waits for a live holder and then gives up with who holds it', () => {
    writeLock(process.ppid, Date.now())
    const started = Date.now()
    let caught: unknown
    try {
      acquireFileLockSync(lockPath, { timeoutMs: 300 })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(LockTimeoutError)
    expect((caught as LockTimeoutError).holder?.pid).toBe(process.ppid)
    expect((caught as Error).message).toContain(`kurmis process ${String(process.ppid)} has held it`)
    expect(Date.now() - started).toBeGreaterThanOrEqual(290)
    expect(readFileSync(lockPath, 'utf8')).toContain('someone-else')
  })

  it('takes over a lock whose owner is no longer running', () => {
    writeLock(deadPid(), Date.now())
    withFileLockSync(lockPath, () => {
      expect(readLockHolder(lockPath)?.pid).toBe(process.pid)
    }, { timeoutMs: 1000 })
    expect(existsSync(lockPath)).toBe(false)
  })

  it('takes over a lock older than the bound even when its pid runs (a reused pid)', () => {
    writeLock(process.ppid, Date.now() - 60_000)
    withFileLockSync(lockPath, () => {
      expect(readLockHolder(lockPath)?.pid).toBe(process.pid)
    }, { timeoutMs: 1000, staleMs: 10_000 })
  })

  it('waits on a lock file that is not written yet, and takes it over once it is old', () => {
    writeFileSync(lockPath, '')
    expect(() => acquireFileLockSync(lockPath, { timeoutMs: 100 })).toThrow(LockTimeoutError)
    const old = new Date(Date.now() - 60_000)
    utimesSync(lockPath, old, old)
    withFileLockSync(lockPath, () => undefined, { timeoutMs: 1000 })
    expect(existsSync(lockPath)).toBe(false)
  })

  it('removes a .break file left by a process that died while it broke a lock', () => {
    writeLock(deadPid(), Date.now())
    writeFileSync(`${lockPath}.break`, '1')
    const old = new Date(Date.now() - 60_000)
    utimesSync(`${lockPath}.break`, old, old)
    withFileLockSync(lockPath, () => undefined, { timeoutMs: 1000 })
    expect(existsSync(`${lockPath}.break`)).toBe(false)
  })

  it('does not remove a lock another process took over on release', () => {
    const lock = acquireFileLockSync(lockPath)
    writeLock(4242, Date.now(), 'the-new-owner')
    lock.release()
    expect(readFileSync(lockPath, 'utf8')).toContain('the-new-owner')
    lock.release()
  })
})

describe('changeConfig from several processes at once', () => {
  it('keeps every change', { timeout: 60_000 }, async () => {
    const entry = fileURLToPath(new URL('./lock-writer.ts', import.meta.url))
    const bundle = join(folder, 'lock-writer.mjs')
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: bundle, logLevel: 'silent' })
    const home = join(folder, 'kurmis-home')
    const children = 6
    const each = 8
    const start = Date.now() + 500
    const runs = Array.from({ length: children }, (_, index) => new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [bundle, `w${String(index)}`, String(each), String(start)], {
        env: { ...process.env, KURMIS_HOME: home },
        stdio: ['ignore', 'ignore', 'inherit']
      })
      child.on('close', (code) => resolve(code))
    }))
    expect(await Promise.all(runs)).toEqual(Array.from({ length: children }, () => 0))
    const ids = loadConfig(join(home, 'config.json')).logins.map((login) => login.id)
    expect(ids).toHaveLength(2 + children * each)
    for (let index = 0; index < children; index++) {
      for (let i = 0; i < each; i++) expect(ids).toContain(`claude:w${String(index)}-${String(i)}`)
    }
    expect(existsSync(join(home, 'config.json.lock'))).toBe(false)
  })
})
