// The fake launchctl answers the way the real one does for the calls kurmis makes.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { daemonJobPlist, launchctlFor } from '../../src/platform/launchd.ts'

const dir = (): string => process.env.FAKE_LAUNCHCTL_DIR ?? ''
const launchctl = launchctlFor()

function writePlist(label: string): string {
  const file = join(process.env.HOME ?? '', `${label}.plist`)
  writeFileSync(file, daemonJobPlist({ label, programArguments: ['/usr/bin/true'], environment: {} }))
  return file
}

beforeEach(() => {
  rmSync(dir(), { recursive: true, force: true, maxRetries: 10 })
  mkdirSync(dir(), { recursive: true })
})

describe('fake launchctl', () => {
  it('loads, prints and unloads a job, with launchctl exit codes', async () => {
    const plist = writePlist('example.one')
    expect((await launchctl(['print', 'gui/501/example.one'])).code).toBe(113)
    expect((await launchctl(['bootstrap', 'gui/501', plist])).code).toBe(0)
    const again = await launchctl(['bootstrap', 'gui/501', plist])
    expect(again.code).toBe(5)
    expect(again.stderr).toContain('Bootstrap failed: 5: Input/output error')
    const printed = await launchctl(['print', 'gui/501/example.one'])
    expect(printed.code).toBe(0)
    expect(printed.stdout).toContain(`\tpath = ${plist}\n`)
    expect(printed.stdout).toContain('\tstate = not running\n')
    expect((await launchctl(['bootout', 'gui/501/example.one'])).code).toBe(0)
    const missing = await launchctl(['bootout', 'gui/501/example.one'])
    expect(missing.code).toBe(3)
    expect(missing.stderr).toContain('Boot-out failed: 3: No such process')
  })

  it('refuses a domain that is not gui/<uid>, a missing plist, and on request every bootstrap', async () => {
    const plist = writePlist('example.two')
    expect((await launchctl(['bootstrap', 'user/501', plist])).code).toBe(125)
    expect((await launchctl(['bootstrap', 'gui/501', `${plist}.missing`])).code).toBe(2)
    const refused = await launchctlFor({ ...process.env, FAKE_LAUNCHCTL_FAIL_BOOTSTRAP: '125' })(['bootstrap', 'gui/501', plist])
    expect(refused.code).toBe(125)
    expect(refused.stderr).toContain('Domain does not support specified action')
    expect((await launchctl(['unknown'])).code).toBe(64)
  })

  it('records every call', async () => {
    await launchctl(['print', 'gui/501/example.three'])
    await launchctl(['bootout', 'gui/501/example.three'])
    const lines = readFileSync(join(dir(), 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as unknown)
    expect(lines).toEqual([['print', 'gui/501/example.three'], ['bootout', 'gui/501/example.three']])
  })

  it('keeps every job when several are loaded at once', async () => {
    const labels = ['example.p1', 'example.p2', 'example.p3', 'example.p4']
    const answers = await Promise.all(labels.map((label) => launchctl(['bootstrap', 'gui/501', writePlist(label)])))
    expect(answers.map((answer) => answer.code)).toEqual([0, 0, 0, 0])
    const state = JSON.parse(readFileSync(join(dir(), 'state.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(state).sort()).toEqual(labels)
  })
})
