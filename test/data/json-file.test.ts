import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readJsonFile,
  readJsonFileSync,
  writeFileAtomic,
  writeFileAtomicSync,
  writeJsonFile,
  writeJsonFileSync
} from '../../src/data/json-file.ts'
import { PRIVATE_FILE_MODE } from '../../src/platform/files.ts'

const root = process.env.KURMIS_HOME as string
let counter = 0
function freshDir(): string {
  const dir = join(root, `json-${String(counter++)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('atomic writes', () => {
  it('writes, replaces and leaves no temp file', async () => {
    const dir = freshDir()
    const path = join(dir, 'a.json')
    writeJsonFileSync(path, { a: 1 })
    expect(readFileSync(path, 'utf8')).toBe('{\n  "a": 1\n}\n')
    await writeJsonFile(path, { a: 2 })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ a: 2 })
    writeFileAtomicSync(path, 'x')
    await writeFileAtomic(path, 'y')
    expect(readFileSync(path, 'utf8')).toBe('y')
    expect(readdirSync(dir)).toEqual(['a.json'])
  })

  it('creates a missing folder', () => {
    const path = join(freshDir(), 'deeper', 'b.json')
    writeJsonFileSync(path, [])
    expect(readJsonFileSync(path)).toMatchObject({ status: 'ok', value: [] })
  })

  it.skipIf(process.platform === 'win32')('gives a secret file mode 0600, also when it replaces a wider one', async () => {
    const path = join(freshDir(), 'secret.json')
    writeFileSync(path, '{}', { mode: 0o644 })
    writeJsonFileSync(path, { s: 1 }, { mode: PRIVATE_FILE_MODE })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    await writeJsonFile(path, { s: 2 }, { mode: PRIVATE_FILE_MODE })
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('removes its temp file when the rename fails', () => {
    const dir = freshDir()
    const target = join(dir, 'is-a-folder')
    mkdirSync(join(target, 'child'), { recursive: true })
    expect(() => writeFileAtomicSync(target, 'x')).toThrow()
    expect(readdirSync(dir)).toEqual(['is-a-folder'])
  })
})

describe('reading', () => {
  it('tells a missing file from a corrupt one', async () => {
    const dir = freshDir()
    expect(readJsonFileSync(join(dir, 'none.json'))).toEqual({ status: 'missing' })
    expect(await readJsonFile(join(dir, 'none.json'))).toEqual({ status: 'missing' })
    writeFileSync(join(dir, 'bad.json'), '{"a":')
    expect(readJsonFileSync(join(dir, 'bad.json')).status).toBe('corrupt')
    expect((await readJsonFile(join(dir, 'bad.json'))).status).toBe('corrupt')
  })

  it('throws read errors other than a missing file', () => {
    expect(() => readJsonFileSync(freshDir())).toThrow()
  })
})
