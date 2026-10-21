// Parsing a Claude login's OAuth credentials record. Copied from the original router's
// `src/tools/claude/main/accounts/router/credentials.ts`.
//
// The Claude CLI keeps one JSON record per login: in `.credentials.json` on Windows and Linux,
// and in a macOS Keychain item instead of the file on macOS. Both hold the same document, of
// which only the `claudeAiOauth` block matters here:
//
//   { "claudeAiOauth": { "accessToken", "refreshToken", "expiresAt", "scopes", ... } }
//
// `expiresAt` is in unix milliseconds. Kurmis reads only the access token and its expiry, and
// never the refresh token, because the CLI renews tokens itself.

/** What the proxy signs a login's requests with. Never logged or written anywhere. */
export interface ClaudeCredentials {
  accessToken: string
  /** When the access token runs out, in unix milliseconds, or null when the record does not say. */
  expiresAt: number | null
}

/**
 * The access token and expiry in the `claudeAiOauth` block of a credentials record, from either
 * the file or the Keychain item. Null when `text` is not JSON, has no such block, or the block has
 * no non-blank string `accessToken`. An `expiresAt` that is not a finite number reads as null.
 */
export function parseCredentials(text: string): ClaudeCredentials | null {
  try {
    const parsed = JSON.parse(text) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } } | null
    const oauth = parsed?.claudeAiOauth
    if (typeof oauth?.accessToken !== 'string' || oauth.accessToken.trim().length === 0) return null
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === 'number' && Number.isFinite(oauth.expiresAt) ? oauth.expiresAt : null
    }
  } catch {
    return null
  }
}
