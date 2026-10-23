import { describe, expect, it } from 'vitest'
import { parseWrapperArgs } from '../../src/cli/wrapper-args.ts'

describe('parseWrapperArgs', () => {
  it('passes everything after -- on unchanged', () => {
    expect(parseWrapperArgs(['--', '-p', 'hi', '--login', 'x', '--help', '--'])).toEqual({
      help: false,
      login: null,
      passThrough: ['-p', 'hi', '--login', 'x', '--help', '--']
    })
    expect(parseWrapperArgs([])).toEqual({ help: false, login: null, passThrough: [] })
    expect(parseWrapperArgs(['--'])).toEqual({ help: false, login: null, passThrough: [] })
  })

  it('reads --login before --, as it was typed', () => {
    expect(parseWrapperArgs(['--login', 'work-example', '--', '-p', 'hi'])).toEqual({
      help: false,
      login: 'work-example',
      passThrough: ['-p', 'hi']
    })
    expect(parseWrapperArgs(['--login=side-example', '--', 'mcp', 'list']))
      .toMatchObject({ login: 'side-example', passThrough: ['mcp', 'list'] })
    expect(parseWrapperArgs(['--login', 'k3v9q2m7xa'])).toMatchObject({ login: 'k3v9q2m7xa', passThrough: [] })
  })

  it('sees --help and -h before --', () => {
    expect(parseWrapperArgs(['--help'])).toMatchObject({ help: true })
    expect(parseWrapperArgs(['--login', 'a', '-h'])).toMatchObject({ help: true, login: 'a' })
  })

  it.each([
    [['--login'], '--login needs the alias or id of a login, for example --login work-example'],
    [['--login='], '--login needs the alias or id of a login, for example --login work-example'],
    [['--login', 'a', '--login', 'b'], '--login was given twice'],
    [['-p', 'hi'], 'kurmis does not know -p. Put claude\'s arguments after --, for example "kurmis claude -- -p"'],
    [['--login', 'a', 'mcp'], 'kurmis does not know mcp. Put claude\'s arguments after --, for example "kurmis claude -- mcp"']
  ])('refuses %j', (args, error) => {
    expect(parseWrapperArgs(args)).toEqual({ error })
  })

})
