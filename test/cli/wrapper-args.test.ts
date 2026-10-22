import { describe, expect, it } from 'vitest'
import { parseWrapperArgs } from '../../src/cli/wrapper-args.ts'

describe('parseWrapperArgs', () => {
  it('passes everything after -- on unchanged', () => {
    expect(parseWrapperArgs(['--', '-p', 'hi', '--login', 'x', '--help', '--'], 'claude')).toEqual({
      help: false,
      login: null,
      passThrough: ['-p', 'hi', '--login', 'x', '--help', '--']
    })
    expect(parseWrapperArgs([], 'claude')).toEqual({ help: false, login: null, passThrough: [] })
    expect(parseWrapperArgs(['--'], 'claude')).toEqual({ help: false, login: null, passThrough: [] })
  })

  it('reads --login before --, as it was typed', () => {
    expect(parseWrapperArgs(['--login', 'work-example', '--', '-p', 'hi'], 'claude')).toEqual({
      help: false,
      login: 'work-example',
      passThrough: ['-p', 'hi']
    })
    expect(parseWrapperArgs(['--login=codex:side-example', '--', 'exec', 'x'], 'codex'))
      .toMatchObject({ login: 'codex:side-example', passThrough: ['exec', 'x'] })
    expect(parseWrapperArgs(['--login', 'k3v9q2m7xa'], 'claude')).toMatchObject({ login: 'k3v9q2m7xa', passThrough: [] })
  })

  it('sees --help and -h before --', () => {
    expect(parseWrapperArgs(['--help'], 'claude')).toMatchObject({ help: true })
    expect(parseWrapperArgs(['--login', 'a', '-h'], 'claude')).toMatchObject({ help: true, login: 'a' })
  })

  it.each([
    [['--login'], '--login needs the alias or id of a login, for example --login work-example'],
    [['--login='], '--login needs the alias or id of a login, for example --login work-example'],
    [['--login', 'a', '--login', 'b'], '--login was given twice'],
    [['-p', 'hi'], 'kurmis does not know -p. Put claude\'s arguments after --, for example "kurmis claude -- -p"'],
    [['--login', 'a', 'mcp'], 'kurmis does not know mcp. Put claude\'s arguments after --, for example "kurmis claude -- mcp"']
  ])('refuses %j', (args, error) => {
    expect(parseWrapperArgs(args, 'claude')).toEqual({ error })
  })

  it('names codex in the error of kurmis codex', () => {
    expect(parseWrapperArgs(['exec'], 'codex')).toEqual({
      error: 'kurmis does not know exec. Put codex\'s arguments after --, for example "kurmis codex -- exec"'
    })
  })
})
