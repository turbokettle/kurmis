import { describe, expect, it } from 'vitest'
import { parseWrapperArgs } from '../../src/cli/wrapper-args.ts'

describe('parseWrapperArgs', () => {
  it('passes everything on when there are no kurmis options', () => {
    expect(parseWrapperArgs(['-p', 'hi', '--model', 'x'])).toEqual({
      help: false,
      login: null,
      passThrough: ['-p', 'hi', '--model', 'x']
    })
    expect(parseWrapperArgs([])).toEqual({ help: false, login: null, passThrough: [] })
  })

  it('reads --login before the first unknown argument, as it was typed', () => {
    expect(parseWrapperArgs(['--login', 'work-example', '-p', 'hi'])).toEqual({
      help: false,
      login: 'work-example',
      passThrough: ['-p', 'hi']
    })
    expect(parseWrapperArgs(['--login=codex:side-example', 'exec', 'x'])).toMatchObject({ login: 'codex:side-example', passThrough: ['exec', 'x'] })
    expect(parseWrapperArgs(['--login', 'k3v9q2m7xa'])).toMatchObject({ login: 'k3v9q2m7xa', passThrough: [] })
  })

  it('leaves kurmis options after the first unknown argument to the CLI', () => {
    expect(parseWrapperArgs(['-p', '--login', 'work', '--help'])).toEqual({
      help: false,
      login: null,
      passThrough: ['-p', '--login', 'work', '--help']
    })
  })

  it('stops at -- and drops it', () => {
    expect(parseWrapperArgs(['--login', 'work', '--', '--help', '--'])).toEqual({
      help: false,
      login: 'work',
      passThrough: ['--help', '--']
    })
  })

  it('sees --help and -h before the first unknown argument', () => {
    expect(parseWrapperArgs(['--help'])).toMatchObject({ help: true })
    expect(parseWrapperArgs(['--login', 'a', '-h'])).toMatchObject({ help: true, login: 'a' })
  })

  it.each([
    [['--login'], '--login needs the alias or id of a login, for example --login work-example'],
    [['--login='], '--login needs the alias or id of a login, for example --login work-example'],
    [['--login', 'a', '--login', 'b'], '--login was given twice']
  ])('refuses %j', (args, error) => {
    expect(parseWrapperArgs(args)).toEqual({ error })
  })
})
