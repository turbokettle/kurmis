// How the commands name a login to the person: by its alias, and in a command the person may
// type, in the form `resolveLogin` reads back as the same login.
import { resolveLogin, type KurmisConfig } from '../data/config.ts'
import type { LoginProvider } from '../data/login-id.ts'

/** The product name of a provider, for sentences. */
export const PROVIDER_NAMES: Record<LoginProvider, string> = { claude: 'Claude', codex: 'Codex' }

/** The words that mark a machine's own login: `this machine's own Claude sign-in`. */
export function machineOwnText(provider: LoginProvider): string {
  return `this machine's own ${PROVIDER_NAMES[provider]} sign-in`
}

/**
 * How to name a login on a command line such as `kurmis set <ref>`: its alias, or
 * `claude:<alias>` / `codex:<alias>` when a login of the other provider has the same alias.
 */
export function loginArgument(config: KurmisConfig, login: { id: string; provider: LoginProvider; alias: string }): string {
  const found = resolveLogin(config, login.alias)
  return 'login' in found && found.login.id === login.id ? login.alias : `${login.provider}:${login.alias}`
}
