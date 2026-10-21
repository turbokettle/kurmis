// The name of a Claude login's macOS Keychain item.
//
// On macOS the Claude CLI keeps a login's credentials record in a generic-password item whose
// service name follows `CLAUDE_SECURESTORAGE_CONFIG_DIR`. Read from the bundled JavaScript of
// Claude Code 2.1.301 (the function that builds the name):
//
//   - variable unset (and `CLAUDE_CONFIG_DIR` unset too): `Claude Code-credentials`;
//   - variable set to the empty string: `Claude Code-credentials`;
//   - variable set to anything else: `Claude Code-credentials-<h>`, where `<h>` is the first 8
//     hex digits of the SHA-256 of the variable's value after Unicode NFC normalisation.
//
// The value is hashed as given. The CLI does not resolve it, make it absolute, or add or strip
// a trailing separator, so `/a/b` and `/a/b/` are two different items. Whatever starts `claude`
// on a login must therefore pass exactly the string this function was given, byte for byte.
// The path of `~/.claude` itself is no exception: passed as a value it gets a hashed name, and
// the machine's own login, whose item has the plain name, is reached only by leaving the
// variable unset.
//
// When `CLAUDE_SECURESTORAGE_CONFIG_DIR` is unset but `CLAUDE_CONFIG_DIR` is set and not empty,
// the CLI hashes the value of `CLAUDE_CONFIG_DIR` the same way instead (checked again in the
// bundled JavaScript of 2.1.306), and reads `.credentials.json` from that folder. So a CLI with
// `CLAUDE_CONFIG_DIR` set has credentials of its own; see "The machine's own Claude login and
// `CLAUDE_CONFIG_DIR`" in `docs/architecture.md`. Kurmis runs `claude auth login` and the usage
// probes of an extra login that way (`claudeLoginEnv` in `src/data/login-env.ts`), with
// `CLAUDE_CONFIG_DIR` set to the same string a routed CLI gets as
// `CLAUDE_SECURESTORAGE_CONFIG_DIR`, so both name the same item.
import { createHash } from 'node:crypto'

/** The plain item name, which the machine's own Claude login uses. */
export const KEYCHAIN_SERVICE_BASE = 'Claude Code-credentials'

/**
 * The Keychain item name for a login whose CLI is started with `CLAUDE_SECURESTORAGE_CONFIG_DIR`
 * set to `secureStorageDir`. Null, or the empty string, is the machine's own login, started
 * without the variable, whose item keeps the plain name.
 */
export function keychainService(secureStorageDir: string | null): string {
  if (secureStorageDir === null || secureStorageDir.length === 0) return KEYCHAIN_SERVICE_BASE
  const digest = createHash('sha256').update(secureStorageDir.normalize('NFC')).digest('hex')
  return `${KEYCHAIN_SERVICE_BASE}-${digest.slice(0, 8)}`
}
