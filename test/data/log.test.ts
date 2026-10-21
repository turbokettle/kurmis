import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toLoginId } from '../../src/data/login-id.ts'
import { errorCodeOf, formatLogLine, methodOf, openDaemonLog, type LogEvent, type LogFields } from '../../src/data/log.ts'
import { logPath } from '../../src/data/paths.ts'

const TIME = Date.UTC(2026, 0, 15, 12)
/** Shaped like an OAuth access token; made up. */
const TOKEN = 'sk-ant-oat01-EXAMPLEexampleEXAMPLEexample0123456789'

let counter = 0
function freshLogPath(): string {
  const dir = join(process.env.KURMIS_HOME as string, `log-${String(counter++)}`)
  mkdirSync(dir, { recursive: true })
  return join(dir, 'daemon.log')
}

describe('formatLogLine', () => {
  it('writes the time, the event and the fields', () => {
    expect(
      formatLogLine('request_forwarded', { login: toLoginId('workclaude'), status: 200, ms: 812, method: 'POST', ok: true }, TIME)
    ).toBe('2026-01-15T12:00:00.000Z request_forwarded login=workclaude status=200 ms=812 method=POST ok=true\n')
  })

  it('writes Infinity for a cooldown with no known end', () => {
    expect(formatLogLine('cooldown_started', { login: toLoginId('workclaude'), until: Infinity }, TIME)).toContain('until=Infinity')
  })

  it('does not let a token in through any field or the event', () => {
    const attempts: Array<[string, Record<string, unknown>]> = [
      [TOKEN, {}],
      ['request_failed', { login: TOKEN }],
      ['request_failed', { fromLogin: `claude:${TOKEN}` }],
      ['request_failed', { reason: TOKEN }],
      ['request_failed', { code: TOKEN }],
      ['request_failed', { method: TOKEN }],
      ['request_failed', { provider: TOKEN }],
      ['request_failed', { status: TOKEN }],
      ['request_failed', { ms: { toString: () => TOKEN } }],
      ['request_failed', { ok: TOKEN }],
      ['request_failed', { authorization: TOKEN }],
      ['request_failed', { [TOKEN]: 1 }],
      ['request_failed', { body: { text: TOKEN } }]
    ]
    for (const [event, fields] of attempts) {
      const line = formatLogLine(event as LogEvent, fields as LogFields, TIME)
      expect(line).not.toContain(TOKEN)
      expect(line).not.toContain('sk-ant')
    }
    expect(formatLogLine(TOKEN as LogEvent, {}, TIME)).toContain(' invalid_event')
    expect(formatLogLine('request_failed', { login: TOKEN } as unknown as LogFields, TIME)).toContain('login=[redacted]')
    expect(formatLogLine('request_failed', { authorization: TOKEN } as unknown as LogFields, TIME)).toContain('[redacted]=[redacted]')
  })

  it('rejects free text at compile time', () => {
    // These lines only have to fail the type check (`pnpm check`); at run time they are redacted.
    // @ts-expect-error an arbitrary string is not a LoginId
    formatLogLine('request_failed', { login: 'workclaude' })
    // @ts-expect-error an unknown event name
    formatLogLine('token was sk-ant-x')
    // @ts-expect-error an unknown field
    formatLogLine('request_failed', { header: 'x' })
    // @ts-expect-error reason is a fixed word
    formatLogLine('request_failed', { reason: 'anything' })
  })

  it('maps errors and methods to fixed words', () => {
    expect(errorCodeOf(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe('ECONNRESET')
    expect(errorCodeOf(Object.assign(new Error('x'), { code: TOKEN }))).toBe('other')
    expect(errorCodeOf(null)).toBe('other')
    expect(methodOf('POST')).toBe('POST')
    expect(methodOf(TOKEN)).toBe('other')
  })
})

describe('openDaemonLog', () => {
  it('appends lines to daemon.log in the data folder', () => {
    const log = openDaemonLog({ now: () => TIME })
    log.write('daemon_started', { pid: 123, port: 28411 })
    log.write('daemon_stopped', { reason: 'signal' })
    expect(readFileSync(logPath(), 'utf8')).toBe(
      '2026-01-15T12:00:00.000Z daemon_started pid=123 port=28411\n2026-01-15T12:00:00.000Z daemon_stopped reason=signal\n'
    )
  })

  it.skipIf(process.platform === 'win32')('is readable by the user only', () => {
    const path = freshLogPath()
    openDaemonLog({ path }).write('daemon_started')
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('rotates once into daemon.log.1 when it reaches the cap', () => {
    const path = freshLogPath()
    const line = formatLogLine('request_forwarded', { status: 200 }, TIME)
    const log = openDaemonLog({ path, maxBytes: line.length * 3, now: () => TIME })
    for (let i = 0; i < 3; i++) log.write('request_forwarded', { status: 200 })
    expect(existsSync(`${path}.1`)).toBe(false)
    log.write('request_forwarded', { status: 201 })
    expect(readFileSync(`${path}.1`, 'utf8')).toBe(line.repeat(3))
    expect(readFileSync(path, 'utf8')).toContain('status=201')
    for (let i = 0; i < 3; i++) log.write('request_forwarded', { status: 202 })
    expect(readFileSync(`${path}.1`, 'utf8')).not.toContain('status=200')
    expect(statSync(path).size).toBeLessThanOrEqual(line.length * 3)
  })

  it('never throws, even when the log cannot be written', () => {
    const dir = freshLogPath()
    mkdirSync(dir)
    expect(() => openDaemonLog({ path: dir }).write('daemon_started')).not.toThrow()
  })
})
