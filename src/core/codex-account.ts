// Who a Codex login is signed in as, from the `codex app-server` answer to `account/read`.
// The rule for what counts as signed in is the original router's (`updateStatus` in
// `src/tools/claude/main/accounts/codex-registry.ts`); the parsing is written for kurmis.
//
// The answer, on Codex 0.163.0:
//
//   signed out:        {"account": null, "requiresOpenaiAuth": true}
//   ChatGPT sign-in:   {"account": {"type": "chatgpt", "email": "…", "planType": "prolite"},
//                       "requiresOpenaiAuth": true}
//   an API key:        {"account": {"type": "apiKey"}, ...}
//
// `requiresOpenaiAuth` follows the configured model provider, not the sign-in. The answer
// never carries a token.
//
// The email is personal data. It may be shown by `kurmis list`, which prints to the user's
// own terminal, and nowhere else: it must never reach `daemon.log`, `state.json`, an error
// message or a test fixture with a real address.

/** How a Codex home is signed in, as `account/read` named it. */
export type CodexSignIn =
  /** A ChatGPT subscription: the only kind kurmis can choose between. */
  | {
      type: 'chatgpt'
      /** The plan, such as `plus`, `pro` or `prolite`; null when the answer had none. */
      planType: string | null
      /** For display by `kurmis list` only. Never log or store it. */
      email: string | null
    }
  /** An OpenAI API key, which is billed per use rather than by a subscription. */
  | { type: 'apiKey' }
  /** Amazon Bedrock, or a kind of sign-in newer than this parser. `name` is the wire `type`. */
  | { type: 'other'; name: string }

/** The answer to `account/read`, checked. */
export interface CodexAccountRead {
  /** Null when the home is not signed in. */
  signIn: CodexSignIn | null
  /** Whether the configured model provider needs an OpenAI sign-in; null when not said. */
  requiresOpenaiAuth: boolean | null
}

/** What a login's row shows after an `account/read`. */
export interface CodexLoginStatus {
  /**
   * True only for a ChatGPT sign-in. An API key or another provider is not a subscription
   * kurmis can route to, so such a login counts as not signed in.
   */
  loggedIn: boolean
  /** The plan for a ChatGPT sign-in, `api key` for an API key, else null. */
  subscriptionType: string | null
  /** For display by `kurmis list` only. Never log or store it. */
  email: string | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-empty string, or null. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The JSON-RPC `result` of `account/read` checked into `CodexAccountRead`. Null when the
 * answer is not an object, or when `account` is neither null nor an object with a string
 * `type`, so a broken answer is never read as "signed out". A missing `account` reads as
 * signed out, as the original router reads it. Never throws.
 */
export function parseCodexAccountRead(result: unknown): CodexAccountRead | null {
  if (!isObject(result)) return null
  const requiresOpenaiAuth = typeof result['requiresOpenaiAuth'] === 'boolean' ? result['requiresOpenaiAuth'] : null
  const account = result['account']
  if (account === null || account === undefined) return { signIn: null, requiresOpenaiAuth }
  if (!isObject(account) || typeof account['type'] !== 'string') return null
  const type = account['type']
  let signIn: CodexSignIn
  if (type === 'chatgpt') signIn = { type, planType: text(account['planType']), email: text(account['email']) }
  else if (type === 'apiKey') signIn = { type }
  else signIn = { type: 'other', name: type }
  return { signIn, requiresOpenaiAuth }
}

/** What a checked `account/read` means for the login's row. */
export function codexLoginStatus(read: CodexAccountRead): CodexLoginStatus {
  const signIn = read.signIn
  if (signIn?.type === 'chatgpt') return { loggedIn: true, subscriptionType: signIn.planType, email: signIn.email }
  // An API key is not a subscription kurmis can pick between, but it is a signed-in state
  // worth naming rather than showing as signed out.
  if (signIn?.type === 'apiKey') return { loggedIn: false, subscriptionType: 'api key', email: null }
  return { loggedIn: false, subscriptionType: null, email: null }
}
