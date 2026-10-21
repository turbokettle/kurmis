import { describe, expect, it } from 'vitest'
import { parseWrapperArgs } from '../../src/cli/wrapper-args.ts'

describe('parseWrapperArgs', () => {
  it('passes everything on when there are no kurmis options', () => {
    expect(parseWrapperArgs('claude', ['-p', 'hi', '--model', 'x'])).toEqual({
      help: false,
      login: null,
      passThrough: ['-p', 'hi', '--model', 'x']
    })
    expect(parseWrapperArgs('claude', [])).toEqual({ help: false, login: null, passThrough: [] })
  })

  it('reads --login before the first unknown argument', () => {
    expect(parseWrapperArgs('claude', ['--login', 'work', '-p', 'hi'])).toEqual({
      help: false,
      login: 'claude:work',
      passThrough: ['-p', 'hi']
    })
    expect(parseWrapperArgs('codex', ['--login=codex:side', 'exec', 'x'])).toMatchObject({ login: 'codex:side', passThrough: ['exec', 'x'] })
    expect(parseWrapperArgs('claude', ['--login', 'default'])).toMatchObject({ login: 'claude:default', passThrough: [] })
  })

  it('leaves kurmis options after the first unknown argument to the CLI', () => {
    expect(parseWrapperArgs('claude', ['-p', '--login', 'work', '--help'])).toEqual({
      help: false,
      login: null,
      passThrough: ['-p', '--login', 'work', '--help']
    })
  })

  it('stops at -- and drops it', () => {
    expect(parseWrapperArgs('claude', ['--login', 'work', '--', '--help', '--'])).toEqual({
      help: false,
      login: 'claude:work',
      passThrough: ['--help', '--']
    })
  })

  it('sees --help and -h before the first unknown argument', () => {
    expect(parseWrapperArgs('claude', ['--help'])).toMatchObject({ help: true })
    expect(parseWrapperArgs('codex', ['--login', 'a', '-h'])).toMatchObject({ help: true, login: 'codex:a' })
  })

  it.each([
    [['--login'], '--login needs a login id, for example --login work'],
    [['--login', 'a', '--login', 'b'], '--login was given twice'],
    [['--login', 'codex:a'], 'codex:a is a codex login, not a claude one'],
    [['--login', '../x'], '"../x" is not a login name'],
    [['--login=claude:Bad'], '"claude:Bad" is not a login id'],
    [['--login='], '"" is not a login name']
  ])('refuses %j', (args, error) => {
    expect(parseWrapperArgs('claude', args)).toEqual({ error })
  })
})
