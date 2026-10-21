// Reading who a Codex login is signed in as from the app-server's `account/read` answer.
import { describe, expect, test } from 'vitest'
import { codexLoginStatus, parseCodexAccountRead } from '../../src/core/codex-account.ts'

describe('parseCodexAccountRead', () => {
  test('reads a ChatGPT sign-in with its plan and email', () => {
    const read = parseCodexAccountRead({
      account: { type: 'chatgpt', email: 'someone@example.com', planType: 'prolite' },
      requiresOpenaiAuth: true
    })

    expect(read).toEqual({
      signIn: { type: 'chatgpt', planType: 'prolite', email: 'someone@example.com' },
      requiresOpenaiAuth: true
    })
  })

  test('reads a signed-out home, with or without the provider flag', () => {
    expect(parseCodexAccountRead({ account: null, requiresOpenaiAuth: true })).toEqual({ signIn: null, requiresOpenaiAuth: true })
    expect(parseCodexAccountRead({ account: null, requiresOpenaiAuth: false, workspaceRouting: null }))
      .toEqual({ signIn: null, requiresOpenaiAuth: false })
    expect(parseCodexAccountRead({})).toEqual({ signIn: null, requiresOpenaiAuth: null })
  })

  test('reads an API key and a kind of sign-in it does not know', () => {
    expect(parseCodexAccountRead({ account: { type: 'apiKey' } })?.signIn).toEqual({ type: 'apiKey' })
    expect(parseCodexAccountRead({ account: { type: 'amazonBedrock', usesCodexManagedCredentials: true } })?.signIn)
      .toEqual({ type: 'other', name: 'amazonBedrock' })
    expect(parseCodexAccountRead({ account: { type: 'somethingNew' } })?.signIn).toEqual({ type: 'other', name: 'somethingNew' })
  })

  test('reads a ChatGPT sign-in whose plan or email is missing or empty as null', () => {
    expect(parseCodexAccountRead({ account: { type: 'chatgpt', email: '', planType: 7 } })?.signIn)
      .toEqual({ type: 'chatgpt', planType: null, email: null })
    expect(parseCodexAccountRead({ account: { type: 'chatgpt' } })?.signIn)
      .toEqual({ type: 'chatgpt', planType: null, email: null })
  })

  test('answers null for a broken answer rather than reading it as signed out, and never throws', () => {
    for (const result of [null, undefined, 'ok', 3, [], { account: 'chatgpt' }, { account: [] }, { account: {} }, { account: { type: 1 } }]) {
      expect(parseCodexAccountRead(result)).toBeNull()
    }
  })

  test('ignores a flag of the wrong type', () => {
    expect(parseCodexAccountRead({ account: null, requiresOpenaiAuth: 'yes' })).toEqual({ signIn: null, requiresOpenaiAuth: null })
  })
})

describe('codexLoginStatus', () => {
  test('a ChatGPT sign-in is signed in, with its plan', () => {
    expect(codexLoginStatus({
      signIn: { type: 'chatgpt', planType: 'plus', email: 'someone@example.com' },
      requiresOpenaiAuth: true
    })).toEqual({ loggedIn: true, subscriptionType: 'plus', email: 'someone@example.com' })
  })

  test('an API key is named, but is not a subscription to route to', () => {
    expect(codexLoginStatus({ signIn: { type: 'apiKey' }, requiresOpenaiAuth: true }))
      .toEqual({ loggedIn: false, subscriptionType: 'api key', email: null })
  })

  test('a signed-out home and another provider are not signed in', () => {
    expect(codexLoginStatus({ signIn: null, requiresOpenaiAuth: true }))
      .toEqual({ loggedIn: false, subscriptionType: null, email: null })
    expect(codexLoginStatus({ signIn: { type: 'other', name: 'amazonBedrock' }, requiresOpenaiAuth: false }))
      .toEqual({ loggedIn: false, subscriptionType: null, email: null })
  })
})
