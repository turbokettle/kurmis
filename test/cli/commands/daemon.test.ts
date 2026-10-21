// The parts of `kurmis daemon` that run without a daemon. Starting and stopping real daemon
// processes is tested in `test/cli/daemon-lifecycle.test.ts` and `daemon-real.test.ts`.
import { describe, expect, it } from 'vitest'
import { daemonStartAssignments } from '../../../src/cli/commands/daemon.ts'
import { runCli } from '../../../src/cli/dispatch.ts'

function quietContext(): { context: Parameters<typeof runCli>[1]; stderr: () => string } {
  let stderr = ''
  return {
    context: { stdout: { write: () => true }, stderr: { write: (text: string) => (stderr += text) }, env: {} },
    stderr: () => stderr
  }
}

describe('daemon start --env', () => {
  it('reads NAME=VALUE for the kurmis variables a login item carries', () => {
    expect(daemonStartAssignments(['KURMIS_HOME=C:\\Users\\Example User\\.kurmis', 'KURMIS_UPSTREAM_URL=http://127.0.0.1:1/a=b']))
      .toEqual({ KURMIS_HOME: 'C:\\Users\\Example User\\.kurmis', KURMIS_UPSTREAM_URL: 'http://127.0.0.1:1/a=b' })
    expect(daemonStartAssignments([])).toEqual({})
  })

  it('refuses other variables and an assignment without "="', () => {
    expect(daemonStartAssignments(['NODE_OPTIONS=--inspect'])).toMatch(/not "NODE_OPTIONS"/)
    expect(daemonStartAssignments(['KURMIS_HOME'])).toMatch(/NAME=VALUE/)
  })

  it('stops with a usage error for a variable it does not take', async () => {
    const { context, stderr } = quietContext()
    expect(await runCli(['daemon', 'start', '--env', 'NODE_OPTIONS=--inspect'], context)).toBe(2)
    expect(stderr()).toContain('kurmis daemon start: --env takes NAME=VALUE')
  })
})

describe('daemon stop --now', () => {
  it('is in the help, which says what an open Claude session sees', async () => {
    let stdout = ''
    const context = { stdout: { write: (text: string) => (stdout += text) }, stderr: { write: () => true }, env: {} }
    expect(await runCli(['daemon', '--help'], context)).toBe(0)
    expect(stdout).toContain('stop [--now]')
    expect(stdout).toContain('sees a dropped\n                          connection and retries the request.')
  })
})
