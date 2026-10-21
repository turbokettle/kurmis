// Login ids: `claude:<name>` and `codex:<name>`. The name half is also the name of the login's
// folder in the data folder, so it is restricted to characters that are safe in a path on
// every OS.
//
// TODO(merge): src/core will define the login id helpers. Use those here once both are merged,
// and keep only the name check and the `LoginId` type if core does not have them.

export type LoginProvider = 'claude' | 'codex'

export const LOGIN_PROVIDERS: readonly LoginProvider[] = ['claude', 'codex']

/**
 * A string that has been checked to be a valid login id. Only `parseLoginId`, `toLoginId`,
 * `loginId` and `isLoginId` produce one, so code that writes a login id to a file or the log
 * cannot be handed an arbitrary string by mistake.
 */
export type LoginId = string & { readonly __loginId: true }

/**
 * A login name: 1 to 32 characters, lowercase letters, digits, `-` and `_`, starting with a
 * letter or a digit. No dots or slashes, so a name can never leave its folder.
 */
export const LOGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** Names Windows will not use for a file or folder, whatever the extension. */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/

/** The name every machine's own login has. */
export const DEFAULT_LOGIN_NAME = 'default'

export function isValidLoginName(name: string): boolean {
  return LOGIN_NAME_PATTERN.test(name) && !WINDOWS_RESERVED_NAMES.test(name)
}

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
