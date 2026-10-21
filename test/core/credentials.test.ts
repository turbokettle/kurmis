import { expect, test } from 'vitest'
import { parseCredentials } from '../../src/core/credentials.ts'

test('reads the access token, expiry and refresh-token presence out of the claudeAiOauth block', () => {
  const text = JSON.stringify({
    claudeAiOauth: { accessToken: 'token-one', refreshToken: 'refresh-one', expiresAt: 4_100_000_000_000, scopes: ['user:inference'] }
  })
  expect(parseCredentials(text)).toEqual({ accessToken: 'token-one', expiresAt: 4_100_000_000_000, hasRefreshToken: true })
})

test('keeps only whether a refresh token is present, never its value', () => {
  const parsed = parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: 'token-one', refreshToken: 'fake-refresh-value' } }))
  expect(parsed?.hasRefreshToken).toBe(true)
  expect(JSON.stringify(parsed)).not.toContain('fake-refresh-value')
})

test.each([
  ['missing', {}],
  ['empty', { refreshToken: '' }],
  ['blank', { refreshToken: '   ' }],
  ['null', { refreshToken: null }],
  ['a number', { refreshToken: 12 }],
  ['an object', { refreshToken: { value: 'x' } }]
])('a refresh token that is %s is not present', (_label, extra) => {
  const parsed = parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: 'token-one', expiresAt: 5, ...extra } }))
  expect(parsed).toEqual({ accessToken: 'token-one', expiresAt: 5, hasRefreshToken: false })
})

test('a record without a numeric expiry has a null one', () => {
  expect(parseCredentials('{"claudeAiOauth":{"accessToken":"token-one"}}'))
    .toEqual({ accessToken: 'token-one', expiresAt: null, hasRefreshToken: false })
  expect(parseCredentials('{"claudeAiOauth":{"accessToken":"token-one","expiresAt":"soon"}}'))
    .toEqual({ accessToken: 'token-one', expiresAt: null, hasRefreshToken: false })
})

test('a Keychain answer with a trailing newline parses the same', () => {
  expect(parseCredentials('{"claudeAiOauth":{"accessToken":"token-one","expiresAt":5,"refreshToken":"r"}}\n'))
    .toEqual({ accessToken: 'token-one', expiresAt: 5, hasRefreshToken: true })
})

test.each(['', '{', 'null', '[]', '12', '"text"', '{}', '{"claudeAiOauth":null}', '{"claudeAiOauth":{}}',
  '{"claudeAiOauth":{"accessToken":""}}', '{"claudeAiOauth":{"accessToken":"   "}}',
  '{"claudeAiOauth":{"accessToken":12}}', '{"claudeAiOauth":{"refreshToken":"r"}}', 'not json'])('no credentials in %j', (text) => {
  expect(parseCredentials(text)).toBeNull()
})
