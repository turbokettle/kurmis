import { describe, expect, it } from 'vitest'
import { isLockedFileError, RENAME_RETRY_DELAYS_MS, retryWhileLocked, retryWhileLockedSync } from '../../src/platform/files.ts'

function errorWithCode(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

/** An operation that fails with `code` the first `failures` times. */
function failing(code: string, failures: number): { calls: () => number; run: () => string } {
  let calls = 0
  return {
    calls: () => calls,
    run: () => {
      calls++
      if (calls <= failures) throw errorWithCode(code)
      return 'done'
    }
  }
}

describe('isLockedFileError', () => {
  it('knows the codes Windows gives for a file held open', () => {
    expect(isLockedFileError(errorWithCode('EPERM'))).toBe(true)
    expect(isLockedFileError(errorWithCode('EBUSY'))).toBe(true)
    expect(isLockedFileError(errorWithCode('EACCES'))).toBe(true)
    expect(isLockedFileError(errorWithCode('ENOENT'))).toBe(false)
    expect(isLockedFileError('EPERM')).toBe(false)
  })
})

describe('retryWhileLockedSync', () => {
  it('retries a locked file on Windows until it is free', () => {
    const op = failing('EBUSY', 2)
    expect(retryWhileLockedSync(op.run, 'win32')).toBe('done')
    expect(op.calls()).toBe(3)
  })

  it('gives up on Windows after every wait', () => {
    const op = failing('EPERM', 100)
    expect(() => retryWhileLockedSync(op.run, 'win32')).toThrow('EPERM')
    expect(op.calls()).toBe(RENAME_RETRY_DELAYS_MS.length + 1)
  })

  it('throws at once on macOS and Linux, where EPERM is a real permission error', () => {
    const op = failing('EPERM', 1)
    expect(() => retryWhileLockedSync(op.run, 'darwin')).toThrow('EPERM')
    expect(op.calls()).toBe(1)
  })

  it('throws other errors at once on Windows', () => {
    const op = failing('ENOENT', 1)
    expect(() => retryWhileLockedSync(op.run, 'win32')).toThrow('ENOENT')
    expect(op.calls()).toBe(1)
  })
})

describe('retryWhileLocked', () => {
  it('retries a locked file on Windows', async () => {
    const op = failing('EACCES', 1)
    await expect(retryWhileLocked(async () => op.run(), 'win32')).resolves.toBe('done')
    expect(op.calls()).toBe(2)
  })

  it('throws at once elsewhere', async () => {
    const op = failing('EBUSY', 1)
    await expect(retryWhileLocked(async () => op.run(), 'linux')).rejects.toThrow('EBUSY')
  })
})
