import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import { KEYCHAIN_SERVICE_BASE, keychainService } from '../../src/core/keychain-service.ts'

test('the machine own login keeps the plain item name', () => {
  expect(KEYCHAIN_SERVICE_BASE).toBe('Claude Code-credentials')
  expect(keychainService(null)).toBe('Claude Code-credentials')
  // The CLI treats an empty CLAUDE_SECURESTORAGE_CONFIG_DIR like an unset one.
  expect(keychainService('')).toBe('Claude Code-credentials')
})

test('a named login gets the first 8 hex digits of the SHA-256 of its folder path', () => {
  const path = '/Users/example/.kurmis/claude/work'
  // Worked out once outside the test, so the test does not only repeat the implementation.
  expect(keychainService(path)).toBe('Claude Code-credentials-1f0a7ed0')
  expect(keychainService(path)).toBe(`Claude Code-credentials-${createHash('sha256').update(path).digest('hex').slice(0, 8)}`)
})

test('the path is hashed as given, so a trailing separator names another item', () => {
  expect(keychainService('/Users/example/.kurmis/claude/work/')).toBe('Claude Code-credentials-303f9e4e')
})

test('the path is NFC-normalised before hashing, as the CLI does', () => {
  const composed = '/Users/example/.kurmis/claude/café'
  const decomposed = '/Users/example/.kurmis/claude/café'
  expect(composed).not.toBe(decomposed)
  expect(keychainService(decomposed)).toBe(keychainService(composed))
  expect(keychainService(composed)).toBe(`Claude Code-credentials-${createHash('sha256').update(composed).digest('hex').slice(0, 8)}`)
})
