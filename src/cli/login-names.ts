// How the commands name a login to the person: by its alias, and in a command the person may
// type, in the form `resolveLogin` reads back as the same login.
import { resolveLogin, type NamedLogin } from '../data/config.ts'
import type { LoginProvider } from '../data/login-id.ts'

/** The product name of a provider, for sentences. */
export const PROVIDER_NAMES: Record<LoginProvider, string> = { claude: 'Claude', codex: 'Codex' }

/** The words that mark the login a plain CLI uses: `the login plain claude uses`. */
export function machineOwnText(provider: LoginProvider): string {
  return `the login plain ${provider} uses`
}

/**
 * How to name a login on a command line such as `kurmis set <ref>`: its alias, or
 * `claude:<alias>` / `codex:<alias>` when a login of the other provider has the same alias.
 */
export function loginArgument(config: { readonly logins: readonly NamedLogin[] }, login: NamedLogin): string {
  const found = resolveLogin(config, login.alias)
  return 'login' in found && found.login.id === login.id ? login.alias : `${login.provider}:${login.alias}`
}
