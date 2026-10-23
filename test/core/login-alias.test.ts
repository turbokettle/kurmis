import { describe, expect, it } from 'vitest'
import { aliasFromEmail, automaticAlias, isAliasText, MAX_ALIAS_LENGTH, type AliasNeighbours } from '../../src/core/login-alias.ts'

const NONE: AliasNeighbours = { aliases: [], ids: [] }

describe('the alias of an email', () => {
  it.each([
    ['jo.doe@example.com', 'jo-doe-example'],
    ['cc1@example.org', 'cc1-example'],
    ['Some.Person@Example.COM', 'some-person-example'],
    ['person+work@example.com', 'person-work-example'],
    ['a..b__c@mail.example.co.uk', 'a-b-c-mail-example-co'],
    ['42@example.com', '42-example'],
    ['  padded@example.com  ', 'padded-example'],
    ['_x_@example.com', 'x-example'],
    ['cc1@localhost', 'cc1-localhost'],
    ['no-at-sign', 'no-at-sign'],
    ['first.last', 'first-last']
  ])('%j gives %j', (email, alias) => {
    expect(aliasFromEmail(email)).toBe(alias)
  })

  it('is cut to 32 characters without a "-" at the end', () => {
    expect(aliasFromEmail(`${'a'.repeat(40)}@example.com`)).toBe('a'.repeat(32))
    expect(aliasFromEmail(`${'a'.repeat(31)}.b@example.com`)).toBe('a'.repeat(31))
    const long = aliasFromEmail('a-very-long-name.with.parts@subdomain.example.com')
    expect(long.length).toBeLessThanOrEqual(MAX_ALIAS_LENGTH)
    expect(long).toBe('a-very-long-name-with-parts-subd')
    expect(isAliasText(long)).toBe(true)
  })

  it.each(['', '   ', '@.com', '...', '@'])('%j gives nothing', (email) => {
    expect(aliasFromEmail(email)).toBe('')
  })
})

describe('the automatic alias', () => {
  it("is the email's alias when it is free", () => {
    expect(automaticAlias('jo.doe@example.com', 'workclaude', null, NONE)).toBe('jo-doe-example')
  })

  it('is the id without an email, or when the email gives nothing', () => {
    expect(automaticAlias(null, 'workclaude', 'cc1-example', NONE)).toBe('workclaude')
    expect(automaticAlias('@.com', 'workclaude', null, NONE)).toBe('workclaude')
  })

  it('gets -2, -3, ... when another login has the alias', () => {
    expect(automaticAlias('cc1@example.org', 'secondone', null, { aliases: ['cc1-example'], ids: [] })).toBe('cc1-example-2')
    expect(automaticAlias('cc1@example.org', 'thirdone1', null, { aliases: ['cc1-example', 'cc1-example-2'], ids: [] }))
      .toBe('cc1-example-3')
    expect(automaticAlias('cc1@example.org', 'fourth', null, { aliases: ['cc1-example', 'cc1-example-3'], ids: [] }))
      .toBe('cc1-example-2')
  })

  it('counts past 9', () => {
    const taken = ['cc1-example', ...Array.from({ length: 9 }, (_, index) => `cc1-example-${String(index + 2)}`)]
    expect(automaticAlias('cc1@example.org', 'another', null, { aliases: taken, ids: [] })).toBe('cc1-example-11')
  })

  it('cuts a long alias so the number fits in 32 characters', () => {
    const email = `${'a'.repeat(40)}@example.com`
    const plain = 'a'.repeat(32)
    expect(automaticAlias(email, 'secondone', null, { aliases: [plain], ids: [] })).toBe(`${'a'.repeat(30)}-2`)
    // From -10 on the number takes three characters, so the alias is cut one shorter.
    const upToNine = Array.from({ length: 8 }, (_, index) => `${'a'.repeat(30)}-${String(index + 2)}`)
    const taken = [plain, ...upToNine]
    expect(automaticAlias(email, 'another', null, { aliases: taken, ids: [] })).toBe(`${'a'.repeat(29)}-10`)
    expect(automaticAlias(email, 'another', null, { aliases: [...taken, `${'a'.repeat(29)}-10`], ids: [] }))
      .toBe(`${'a'.repeat(29)}-11`)
  })

  it('leaves no "-" before the number where the cut falls after one', () => {
    // The alias is 29 letters, "-", then more, so cutting it to 30 for "-2" ends in "-".
    const email = `${'a'.repeat(29)}.bbbb@example.com`
    const plain = aliasFromEmail(email)
    expect(plain).toBe(`${'a'.repeat(29)}-bb`)
    expect(automaticAlias(email, 'secondone', null, { aliases: [plain], ids: [] })).toBe(`${'a'.repeat(29)}-2`)
  })

  it('keeps a numbered alias the login already has, so two logins do not swap', () => {
    const neighbours = { aliases: ['cc1-example'], ids: [] }
    expect(automaticAlias('cc1@example.org', 'secondone', 'cc1-example-2', neighbours)).toBe('cc1-example-2')
    // Even when a lower number, or the plain alias, is free.
    expect(automaticAlias('cc1@example.org', 'secondone', 'cc1-example-3', neighbours)).toBe('cc1-example-3')
    expect(automaticAlias('cc1@example.org', 'secondone', 'cc1-example-3', NONE)).toBe('cc1-example-3')
    expect(automaticAlias('cc1@example.org', 'firstone', 'cc1-example', NONE)).toBe('cc1-example')
  })

  it('keeps a cut numbered alias', () => {
    const email = `${'a'.repeat(40)}@example.com`
    const current = `${'a'.repeat(30)}-2`
    expect(automaticAlias(email, 'secondone', current, { aliases: ['a'.repeat(32)], ids: [] })).toBe(current)
  })

  it('does not keep an alias that is not of this email, or that another login took', () => {
    expect(automaticAlias('cc2@example.org', 'workclaude', 'cc1-example', NONE)).toBe('cc2-example')
    expect(automaticAlias('cc2@example.org', 'workclaude', 'cc1-example-2', NONE)).toBe('cc2-example')
    expect(automaticAlias('cc1@example.org', 'workclaude', 'cc1-example-1', NONE)).toBe('cc1-example')
    expect(automaticAlias('cc1@example.org', 'workclaude', 'cc1-example-02', NONE)).toBe('cc1-example')
    expect(automaticAlias('cc1@example.org', 'workclaude', 'cc1-example-2', { aliases: ['cc1-example-2'], ids: [] }))
      .toBe('cc1-example')
    expect(automaticAlias('cc1@example.org', 'workclaude', 'workclaude', NONE)).toBe('cc1-example')
  })

  it("is never another login's id", () => {
    expect(automaticAlias('cc1@.com', 'workclaude', null, { aliases: [], ids: ['cc1'] })).toBe('cc1-2')
    expect(automaticAlias('abc@.com', 'workclaude', null, { aliases: [], ids: ['abc'] })).toBe('abc-2')
  })

  it('may be "claude", like any other word', () => {
    expect(aliasFromEmail('@claude.com')).toBe('claude')
    expect(automaticAlias('@claude.com', 'workclaude', null, NONE)).toBe('claude')
    expect(automaticAlias('@claude.com', 'workclaude', 'claude', NONE)).toBe('claude')
  })
})

describe('an alias the person sets', () => {
  it.each(['work', 'a', 'a'.repeat(32), 'work_2', 'side-work', '0', 'claude2', 'my-work', 'claude'])('%j may be an alias', (text) => {
    expect(isAliasText(text)).toBe(true)
  })

  it.each(['', 'a'.repeat(33), 'Work', 'claude:work', 'a b', 'a.b', 'á', 'a/b', '-x', '_x'])('%j may not', (text) => {
    expect(isAliasText(text)).toBe(false)
  })
})
