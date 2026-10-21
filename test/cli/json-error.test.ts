// Finding where a text stops being JSON, without quoting it.
import { describe, expect, test } from 'vitest'
import { jsonErrorPlace, notJsonText } from '../../src/cli/json-error.ts'

describe('where a text stops being JSON', () => {
  test('JSON that JSON.parse reads has no error place', () => {
    for (const text of ['{}', ' [1, -2.5e+3, true, false, null] ', '{"a": {"b": ["\\u00e9\\n", 0]}}', '"x"', '0', '-0.1E9']) {
      expect(() => JSON.parse(text)).not.toThrow()
      expect(jsonErrorPlace(text)).toBeNull()
    }
  })

  test('every text JSON.parse refuses has a place, by line and column', () => {
    const cases: Array<[string, number, number]> = [
      ['', 1, 1],
      ['{', 1, 2],
      ['{"a": 1,}', 1, 9],
      ['{\n  "a": 1,\n}', 3, 1],
      ['{"a": sk-x}', 1, 7],
      ['// comment\n{}', 1, 1],
      ['{"a": 01}', 1, 8],
      ['{"a": "line\nbreak"}', 1, 12],
      ['{"a": "\\x"}', 1, 9],
      ['{"a": "\\u12g4"}', 1, 12],
      ['{"a": tru}', 1, 10],
      ['[1 2]', 1, 4],
      ['{} {}', 1, 4],
      ['{"a": 1.}', 1, 9],
      ['{"a": "open', 1, 12]
    ]
    for (const [text, line, column] of cases) {
      expect(() => JSON.parse(text)).toThrow()
      expect(jsonErrorPlace(text), text).toEqual({ line, column })
    }
  })

  test('the sentence names the place only', () => {
    expect(notJsonText('{"key": secret}')).toBe('not valid JSON (line 1, column 9)')
  })
})
