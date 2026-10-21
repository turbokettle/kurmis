// Login ids as a checked type. The id rules themselves (`claude:<name>`, `codex:<name>`, and
// which names are safe folder names) are in `src/core/accounts.ts`; this file adds the
// `LoginId` type that the stores and the log accept.
import { ACCOUNT_PROVIDERS, DEFAULT_LOGIN_NAME, isLoginName, type AccountProvider } from '../core/accounts.ts'

export { DEFAULT_LOGIN_NAME }

export type LoginProvider = AccountProvider

export const LOGIN_PROVIDERS: readonly LoginProvider[] = ACCOUNT_PROVIDERS

/**
 * A string that has been checked to be a valid login id. Only `parseLoginId`, `toLoginId`,
 * `loginId` and `isLoginId` produce one, so code that writes a login id to a file or the log
 * cannot be handed an arbitrary string by mistake.
 */
export type LoginId = string & { readonly __loginId: true }

/** Whether `name` can be the name half of a login id, and so a folder name on every OS. */
export const isValidLoginName = isLoginName

export function isLoginProvider(value: unknown): value is LoginProvider {
  return value === 'claude' || value === 'codex'
}

export interface ParsedLoginId {
  id: LoginId
  provider: LoginProvider
  name: string
}

/** `claude:work` -> `{ provider: 'claude', name: 'work' }`; null for anything that is not a valid id. */
export function parseLoginId(text: unknown): ParsedLoginId | null {
  if (typeof text !== 'string') return null
  const colon = text.indexOf(':')
  if (colon < 0) return null
  const provider = text.slice(0, colon)
  const name = text.slice(colon + 1)
  if (!isLoginProvider(provider) || !isValidLoginName(name)) return null
  return { id: text as LoginId, provider, name }
}

export function isLoginId(text: unknown): text is LoginId {
  return parseLoginId(text) !== null
}

/** The id as a `LoginId`, or an error naming what is wrong with it. */
export function toLoginId(text: string): LoginId {
  const parsed = parseLoginId(text)
  if (parsed === null) {
    throw new Error(
      `"${text}" is not a login id. A login id is claude:<name> or codex:<name>, where the name ` +
        'is 1 to 32 lowercase letters, digits, "-" or "_".'
    )
  }
  return parsed.id
}

/** The id made of a provider and a name; throws when the name is not valid. */
export function loginId(provider: LoginProvider, name: string): LoginId {
  return toLoginId(`${provider}:${name}`)
}

export function defaultLoginId(provider: LoginProvider): LoginId {
  return `${provider}:${DEFAULT_LOGIN_NAME}` as LoginId
}

/** `claude:default` and `codex:default`, the machine's own logins, in list order. */
export const DEFAULT_LOGIN_IDS: readonly LoginId[] = LOGIN_PROVIDERS.map(defaultLoginId)

export function isDefaultLoginId(id: string): boolean {
  return DEFAULT_LOGIN_IDS.includes(id as LoginId)
}

export function providerOfLoginId(id: LoginId): LoginProvider {
  return id.startsWith('codex:') ? 'codex' : 'claude'
}

export function nameOfLoginId(id: LoginId): string {
  return id.slice(id.indexOf(':') + 1)
}
