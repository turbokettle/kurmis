// Where a text stops being JSON, for error messages about the person's settings files.
//
// `JSON.parse`'s own message quotes the text around the error ("Unexpected token 's',
// "{"key": sk-ant-…" is not valid JSON"), and a settings file can hold a key or a token, so that
// message is never shown. This scanner finds the first place where the text is not JSON, as
// `JSON.parse` reads it, and the message names only its line and column.

/** A place in a text: line and column both start at 1; the column counts UTF-16 units. */
export interface TextPlace {
  line: number
  column: number
}

class NotJson extends Error {
  constructor(readonly at: number) {
    super('not JSON')
  }
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r'])

/** The place of the first character that makes `text` not JSON, or of its end when it stops too early; null when it is JSON. */
export function jsonErrorPlace(text: string): TextPlace | null {
  let pos = 0
  const fail = (): never => {
    throw new NotJson(pos)
  }
  const skip = (): void => {
    while (pos < text.length && WHITESPACE.has(text[pos]!)) pos++
  }
  const expect = (char: string): void => {
    if (text[pos] !== char) fail()
    pos++
  }
  const string = (): void => {
    expect('"')
    for (;;) {
      if (pos >= text.length) fail()
      const char = text[pos]!
      if (char === '"') {
        pos++
        return
      }
      if (char.charCodeAt(0) < 0x20) fail()
      if (char === '\\') {
        pos++
        const escaped = text[pos]
        if (escaped === 'u') {
          for (let i = 1; i <= 4; i++) {
            if (!/[0-9a-fA-F]/.test(text[pos + i] ?? '')) {
              pos += i
              fail()
            }
          }
          pos += 5
          continue
        }
        if (escaped === undefined || !'"\\/bfnrt'.includes(escaped)) fail()
      }
      pos++
    }
  }
  const digits = (): void => {
    if (!/[0-9]/.test(text[pos] ?? '')) fail()
    while (/[0-9]/.test(text[pos] ?? '')) pos++
  }
  const number = (): void => {
    if (text[pos] === '-') pos++
    if (text[pos] === '0') pos++
    else digits()
    if (text[pos] === '.') {
      pos++
      digits()
    }
    if (text[pos] === 'e' || text[pos] === 'E') {
      pos++
      if (text[pos] === '+' || text[pos] === '-') pos++
      digits()
    }
  }
  const word = (expected: string): void => {
    for (const char of expected) expect(char)
  }
  const value = (): void => {
    skip()
    const char = text[pos]
    if (char === '{') {
      pos++
      skip()
      if (text[pos] === '}') {
        pos++
        return
      }
      for (;;) {
        skip()
        string()
        skip()
        expect(':')
        value()
        skip()
        if (text[pos] === '}') {
          pos++
          return
        }
        expect(',')
      }
    }
    if (char === '[') {
      pos++
      skip()
      if (text[pos] === ']') {
        pos++
        return
      }
      for (;;) {
        value()
        skip()
        if (text[pos] === ']') {
          pos++
          return
        }
        expect(',')
      }
    }
    if (char === '"') return string()
    if (char === 't') return word('true')
    if (char === 'f') return word('false')
    if (char === 'n') return word('null')
    if (char === '-' || /[0-9]/.test(char ?? '')) return number()
    fail()
  }
  try {
    value()
    skip()
    if (pos < text.length) fail()
    return null
  } catch (error) {
    if (!(error instanceof NotJson)) throw error
    return placeOf(text, Math.min(error.at, text.length))
  }
}

function placeOf(text: string, at: number): TextPlace {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < at; i++) {
    if (text[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: at - lineStart + 1 }
}

/** `not valid JSON (line 3, column 7)`: what to say about a text `JSON.parse` refused, without quoting it. */
export function notJsonText(text: string): string {
  const place = jsonErrorPlace(text)
  return place === null
    ? 'not valid JSON'
    : `not valid JSON (line ${String(place.line)}, column ${String(place.column)})`
}
