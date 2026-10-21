/**
 * One id space covers Claude and Codex logins, so no second field is needed to tell
 * them apart. A Codex id is `codex:<local>`. A Claude id is `default` or a short random
 * string. Only the local half names the account's directory, because a colon is not
 * allowed in a Windows path.
 */
const LOCAL_BACKEND_ID = 'local'

export type AccountProvider = 'claude' | 'codex'

export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = ['claude', 'codex']

/**
 * The id of the machine's own `~/.claude` login. Always in the account list and
 * never removable. An explicit id pins a Claude session; null selects Auto.
 */
export const DEFAULT_ACCOUNT_ID = 'default'

const CODEX_ACCOUNT_PREFIX = 'codex:'

/** The id of the machine's own `~/.codex` login. */
export const CODEX_DEFAULT_ACCOUNT_ID = `${CODEX_ACCOUNT_PREFIX}${DEFAULT_ACCOUNT_ID}`

export function isCodexAccountId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(CODEX_ACCOUNT_PREFIX)
}

/** An id with no prefix is a Claude login. */
export function accountProviderOf(id: string | null | undefined): AccountProvider {
  return isCodexAccountId(id) ? 'codex' : 'claude'
}

/** `a1b2c3d4` -> `codex:a1b2c3d4`. Already-prefixed ids are left alone. */
export function codexAccountId(localId: string): string {
  return isCodexAccountId(localId) ? localId : `${CODEX_ACCOUNT_PREFIX}${localId}`
}

/** `codex:a1b2c3d4` -> `a1b2c3d4`, the name of the account's directory on disk. */
export function codexLocalAccountId(id: string): string {
  return isCodexAccountId(id) ? id.slice(CODEX_ACCOUNT_PREFIX.length) : id
}

export function defaultAccountIdFor(provider: AccountProvider): string {
  return provider === 'codex' ? CODEX_DEFAULT_ACCOUNT_ID : DEFAULT_ACCOUNT_ID
}

/** True for the provider's own machine-wide login, which cannot be removed. */
export function isDefaultAccountId(id: string | null | undefined): boolean {
  return id === DEFAULT_ACCOUNT_ID || id === CODEX_DEFAULT_ACCOUNT_ID
}

/**
 * The usage map key. An account id is unique only on its own machine, since every
 * machine has a `default`, so a remote id is prefixed with its backend. A local account
 * keeps its bare id.
 */
export function accountKey(backendId: string | null | undefined, accountId: string): string {
  return backendId === null || backendId === undefined || backendId === LOCAL_BACKEND_ID
    ? accountId
    : `${backendId}#${accountId}`
}
