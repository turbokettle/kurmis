import { expect, test } from 'vitest'
import { parseCredentials } from '../../src/core/credentials.ts'

test('reads the access token and expiry out of the claudeAiOauth block', () => {
  const text = JSON.stringify({
    claudeAiOauth: { accessToken: 'token-one', refreshToken: 'refresh-one', expiresAt: 4_100_000_000_000, scopes: ['user:inference'] }
  })
  expect(parseCredentials(text)).toEqual({ accessToken: 'token-one', expiresAt: 4_100_000_000_000 })
})

test('a record without a numeric expiry has a null one', () => {
  expect(parseCredentials('{"claudeAiOauth":{"accessToken":"token-one"}}')).toEqual({ accessToken: 'token-one', expiresAt: null })
  expect(parseCredentials('{"claudeAiOauth":{"accessToken":"token-one","expiresAt":"soon"}}'))
    .toEqual({ accessToken: 'token-one', expiresAt: null })
})

test('a Keychain answer with a trailing newline parses the same', () => {
  expect(parseCredentials('{"claudeAiOauth":{"accessToken":"token-one","expiresAt":5}}\n'))
    .toEqual({ accessToken: 'token-one', expiresAt: 5 })
})

test.each(['', '{', 'null', '[]', '12', '"text"', '{}', '{"claudeAiOauth":null}', '{"claudeAiOauth":{}}',
  '{"claudeAiOauth":{"accessToken":""}}', '{"claudeAiOauth":{"accessToken":"   "}}',
  '{"claudeAiOauth":{"accessToken":12}}', 'not json'])('no credentials in %j', (text) => {
  expect(parseCredentials(text)).toBeNull()
})
