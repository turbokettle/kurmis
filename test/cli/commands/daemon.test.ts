// The parts of `kurmis daemon` that run without a daemon. Starting and stopping real daemon
// processes is tested in `test/cli/daemon-lifecycle.test.ts` and `daemon-real.test.ts`.
import { describe, expect, it } from 'vitest'
import { daemonRunAssignments } from '../../../src/cli/commands/daemon.ts'

describe('daemon run --env', () => {
  it('reads NAME=VALUE for the kurmis variables a daemon job carries', () => {
    expect(daemonRunAssignments(['KURMIS_HOME=C:\\Users\\Example User\\.kurmis', 'KURMIS_UPSTREAM_URL=http://127.0.0.1:1/a=b']))
      .toEqual({ KURMIS_HOME: 'C:\\Users\\Example User\\.kurmis', KURMIS_UPSTREAM_URL: 'http://127.0.0.1:1/a=b' })
    expect(daemonRunAssignments([])).toEqual({})
  })

  it('refuses other variables and an assignment without "="', () => {
    expect(daemonRunAssignments(['NODE_OPTIONS=--inspect'])).toMatch(/not "NODE_OPTIONS"/)
    expect(daemonRunAssignments(['KURMIS_HOME'])).toMatch(/NAME=VALUE/)
  })
})
