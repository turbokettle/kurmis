// A login's alias: the name the person sees and types for it.
//
// A login's alias is made from its account's email (`aliasFromEmail`) unless the person set one
// (`kurmis login … --alias`, `kurmis set … --alias`). While no email is known the alias is the
// login's id. Aliases are unique per provider, so the same account signed in to Claude and Codex
// can have the same alias for both.

/** The words `kurmis login` takes in place of a login, which an alias therefore cannot be. */
const RESERVED_ALIASES: ReadonlySet<string> = new Set(['claude', 'codex'])

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** The longest alias. */
export const MAX_ALIAS_LENGTH = 32

/** The rule `isAliasText` checks, for messages. */
export const ALIAS_RULE = '1 to 32 lowercase letters, digits, "-" or "_", starting with a letter or digit, and not "claude" or "codex"'

/** Whether `text` may be an alias the person sets. */
export function isAliasText(text: string): boolean {
  return ALIAS.test(text) && !RESERVED_ALIASES.has(text)
}

/**
 * The alias an email gives, before it is made unique: the email without its top-level domain,
 * in lowercase, with every run of characters other than `a-z` and `0-9` turned into one `-`,
 * without `-` at either end, and cut to 32 characters. `jo.doe@example.com` gives
 * `jo-doe-example`. Empty when nothing is left.
 */
export function aliasFromEmail(email: string): string {
  const text = email.trim().toLowerCase()
  const at = text.lastIndexOf('@')
  const domainDot = at < 0 ? -1 : text.lastIndexOf('.')
  const withoutTld = domainDot > at ? text.slice(0, domainDot) : text
  return trimDashes(trimDashes(withoutTld.replace(/[^a-z0-9]+/g, '-')).slice(0, MAX_ALIAS_LENGTH))
}

function trimDashes(text: string): string {
  return text.replace(/^-+|-+$/g, '')
}

/** What `automaticAlias` must not collide with. */
export interface AliasNeighbours {
  /** The aliases of the other logins of the same provider. */
  aliases: Iterable<string>
  /** The ids of the other logins of both providers. */
  ids: Iterable<string>
}

/**
 * The alias a login gets from its email, unique among its neighbours: the email's alias, or the
 * first free of `<alias>-2`, `<alias>-3`, … (cut so the whole stays within 32 characters).
 * `current` is kept when it is still one of those and free, so two logins of the same account
 * do not swap their aliases each time they are looked at. Without an email, or when the email
 * gives nothing, the alias is the id, which is unique already.
 */
export function automaticAlias(email: string | null, id: string, current: string | null, neighbours: AliasNeighbours): string {
  const base = email === null ? '' : aliasFromEmail(email)
  if (base === '') return id
  const taken = new Set([...neighbours.aliases, ...neighbours.ids])
  const free = (alias: string): boolean => !taken.has(alias) && !RESERVED_ALIASES.has(alias)
  if (current !== null && free(current) && isNumbered(current, base)) return current
  if (free(base)) return base
  for (let number = 2; ; number++) {
    const suffix = `-${String(number)}`
    const candidate = trimDashes(base.slice(0, MAX_ALIAS_LENGTH - suffix.length)) + suffix
    if (free(candidate)) return candidate
  }
}

/** Whether `alias` is `base`, or `base` (perhaps cut) followed by `-<number of 2 or more>`. */
function isNumbered(alias: string, base: string): boolean {
  if (alias === base) return true
  const match = /^(.*)-([2-9]|[1-9][0-9]+)$/.exec(alias)
  if (match === null) return false
  const suffix = `-${match[2]!}`
  return match[1] === trimDashes(base.slice(0, MAX_ALIAS_LENGTH - suffix.length))
}
