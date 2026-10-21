// Parsing a Claude login's OAuth credentials record.
//
// The Claude CLI keeps one JSON record per login: in `.credentials.json` on Linux, on Windows
// there or (newer versions) in Windows Credential Manager, and on macOS in a Keychain item, or in
// `.credentials.json` when there is no item. All hold the same document, of which only the
// `claudeAiOauth` block matters here:
//
//   { "claudeAiOauth": { "accessToken", "refreshToken", "expiresAt", "scopes", ... } }
//
// `expiresAt` is in unix milliseconds. Kurmis keeps the access token and its expiry. Of the
// refresh token it keeps only whether there is one, never its value: the CLI renews tokens
// itself, and a login whose record has no refresh token cannot be renewed at all, so the daemon
// must not try to renew it and lets its token run out.

/** What the proxy signs a login's requests with. Never logged or written anywhere. */
export interface ClaudeCredentials {
  accessToken: string
  /** When the access token runs out, in unix milliseconds, or null when the record does not say. */
  expiresAt: number | null
  /** True when the record has a non-blank string `refreshToken`, so the CLI can renew the token. */
  hasRefreshToken: boolean
}

/**
 * The access token, its expiry and whether a refresh token is present, from the `claudeAiOauth`
 * block of a credentials record (the file or the Keychain item). Null when `text` is not JSON,
 * has no such block, or the block has no non-blank string `accessToken`. An `expiresAt` that is
 * not a finite number reads as null.
 */
export function parseCredentials(text: string): ClaudeCredentials | null {
  try {
    const parsed = JSON.parse(text) as {
      claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown; refreshToken?: unknown }
    } | null
    const oauth = parsed?.claudeAiOauth
    if (typeof oauth?.accessToken !== 'string' || oauth.accessToken.trim().length === 0) return null
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === 'number' && Number.isFinite(oauth.expiresAt) ? oauth.expiresAt : null,
      hasRefreshToken: typeof oauth.refreshToken === 'string' && oauth.refreshToken.trim().length > 0
    }
  } catch {
    return null
  }
}
