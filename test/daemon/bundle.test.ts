import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTestBundle, disposeTestBundles } from './bundle.ts'

function run(bundle: string, args: string[]): { status: number | null; stdout: string } {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.NODE_OPTIONS
  const result = spawnSync(process.execPath, [bundle, ...args], { env, encoding: 'utf8', timeout: 10_000 })
  return { status: result.status, stdout: result.stdout }
}

describe('buildTestBundle', () => {
  it('builds the real CLI with the given version, once per version and entry', async () => {
    const first = await buildTestBundle({ version: '0.0.7', entry: 'real' })
    expect(await buildTestBundle({ version: '0.0.7', entry: 'real' })).toBe(first)
    expect(run(first, ['--version'])).toEqual({ status: 0, stdout: '0.0.7\n' })
    const other = await buildTestBundle({ version: '0.0.8', entry: 'real' })
    expect(other).not.toBe(first)
    expect(run(other, ['--version']).stdout).toBe('0.0.8\n')
  }, 30_000)

  it('builds the fake entry, which runs the real CLI for other commands', async () => {
    const bundle = await buildTestBundle({ version: '0.0.9', entry: 'fake' })
    expect(run(bundle, ['--version'])).toEqual({ status: 0, stdout: '0.0.9\n' })
  }, 30_000)

  it('removes the bundles when disposed', async () => {
    const bundle = await buildTestBundle({ version: '0.0.7', entry: 'real' })
    disposeTestBundles()
    expect(existsSync(bundle)).toBe(false)
    const rebuilt = await buildTestBundle({ version: '0.0.7', entry: 'real' })
    expect(existsSync(rebuilt)).toBe(true)
  }, 30_000)
})
