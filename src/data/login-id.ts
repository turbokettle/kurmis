// Login ids as a checked type, and how a new one is made.
//
// A login id is a random string of lowercase letters and digits, made once when kurmis first
// knows about the login (`newLoginId`) and never changed. It names the login's folder in the data
// folder (`claude/<id>/`, `codex/<id>/`), its entries in `state.json` and the log. Ids are unique
// across both providers, so an id alone names one login. Which provider a login belongs to, and
// whether it is the machine's own sign-in, is recorded with the login in `config.json`
// (`LoginRef`), not in the id.
import { randomInt } from 'node:crypto'
import { ACCOUNT_PROVIDERS, isLoginIdText, type AccountProvider } from '../core/accounts.ts'

export type LoginProvider = AccountProvider

export const LOGIN_PROVIDERS: readonly LoginProvider[] = ACCOUNT_PROVIDERS

/**
 * A string that has been checked to be a valid login id. Only `toLoginId`, `isLoginId` and
 * `newLoginId` produce one, so code that writes a login id to a file or the log cannot be handed
 * an arbitrary string by mistake.
 */
export type LoginId = string & { readonly __loginId: true }

/** What code needs to know about a login to find its credentials and folders. */
export interface LoginRef {
  id: LoginId
  provider: LoginProvider
  /**
   * The machine's own sign-in of the provider: the credentials of a plain `claude` (`~/.claude`)
   * or a plain `codex` (`~/.codex`). It has no folder in the data folder, and kurmis never signs
   * it out.
   */
  machineOwn: boolean
}

/** The number of characters in an id `newLoginId` makes. */
export const NEW_LOGIN_ID_LENGTH = 10

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function isLoginProvider(value: unknown): value is LoginProvider {
  return value === 'claude' || value === 'codex'
}

export function isLoginId(text: unknown): text is LoginId {
  return typeof text === 'string' && isLoginIdText(text)
}

/** The id as a `LoginId`, or an error naming what is wrong with it. */
export function toLoginId(text: string): LoginId {
  if (!isLoginId(text)) {
    throw new Error(`"${text}" is not a login id. A login id is 1 to 32 lowercase letters and digits.`)
  }
  return text
}

/**
 * A new random id, from the operating system's secure random source, that is none of `taken`.
 * `taken` holds the ids of every login of both providers.
 */
export function newLoginId(taken: Iterable<string> = []): LoginId {
  const used = new Set(taken)
  for (;;) {
    let id = ''
    for (let index = 0; index < NEW_LOGIN_ID_LENGTH; index++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)]
    if (!used.has(id) && isLoginIdText(id)) return id as LoginId
  }
}
