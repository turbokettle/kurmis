// The parts of the `codex app-server` JSON-RPC answers that kurmis reads, written by hand.
//
// the original router generates the whole protocol from `codex app-server generate-ts` (Codex 0.163.0).
// Kurmis reads only two answers, `account/rateLimits/read` and `account/read`, so only the
// fields its parsers read are written out here, with the same names and nullability as the
// generated types. Fields the server sends that nothing here reads are left out; each type
// says which.
//
// These types describe what the parsers in `codex-usage.ts` and `codex-account.ts` hand
// back after checking an answer. Nothing may cast a raw answer to one of them: the server
// can change, so an answer is `unknown` until a parser has checked it.
//
// To read them under the namespace the original router uses: `import type * as v2 from './codex-protocol.ts'`.

/**
 * One rate-limit window of a bucket. `usedPercent` is 0-100 and can pass 100. `resetsAt` is
 * unix seconds, not milliseconds and not an ISO string.
 */
export type RateLimitWindow = {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

/**
 * The pay-as-you-go credits of the plan. The server also sends `hasCredits` and `unlimited`,
 * which nothing here reads.
 */
export type CreditsSnapshot = {
  /** The balance as the server wrote it, a decimal number in a string such as `"0"`. */
  balance: string | null
}

/**
 * One metered limit of the plan (a "bucket"). `primary` is its shorter window and
 * `secondary` its longer one; which durations those are differs per plan. The general limit
 * has `limitId: "codex"` and no `limitName`; a limit the server meters apart, such as one
 * model, names itself in `limitName`.
 *
 * Left out: `normalModelSlug` and `individualLimit`.
 */
export type RateLimitSnapshot = {
  limitId: string | null
  limitName: string | null
  primary: RateLimitWindow | null
  secondary: RateLimitWindow | null
  credits: CreditsSnapshot | null
  /** Whether a spending control set on the workspace has been reached; null when unknown. */
  spendControlReached: boolean | null
  /** The plan, such as `plus`, `pro` or `prolite`. Kept as a string: the server adds plans. */
  planType: string | null
  /**
   * Set when a limit has been reached, such as `rate_limit_reached` or
   * `workspace_member_usage_limit_reached`. Kept as a string for the same reason.
   */
  rateLimitReachedType: string | null
}

/** `available`, `redeeming`, `redeemed` or `unknown`. Only `available` ones can be spent. */
export type RateLimitResetCreditStatus = string

/**
 * One limit reset the account has been granted. Left out: `id`, `resetType`, `grantedAt`,
 * `title` and `description`.
 */
export type RateLimitResetCredit = {
  status: RateLimitResetCreditStatus
  /** Unix seconds when it runs out, or null when it does not. */
  expiresAt: number | null
}

/**
 * The limit resets the account holds. The generated type says `availableCount` is a bigint
 * (a u64 on the server), but the JSON carries a plain number.
 */
export type RateLimitResetCreditsSummary = {
  availableCount: number
  /**
   * The available credits, when the server sent them. Null means only the count is known.
   * The server may cap the list, so it can be shorter than `availableCount`.
   */
  credits: RateLimitResetCredit[] | null
}

/**
 * The answer to `account/rateLimits/read`, as far as kurmis reads it. Left out:
 * `ordinaryUsageAllowed`, `accountId` and `rateLimitUpsell`.
 */
export type GetAccountRateLimitsResponse = {
  /** One bucket, kept for older clients. */
  rateLimits: RateLimitSnapshot | null
  /**
   * Every metered limit, keyed by limit id. It already contains the bucket in `rateLimits`;
   * a plan with one limit may send null here.
   */
  rateLimitsByLimitId: Record<string, RateLimitSnapshot | undefined> | null
  rateLimitResetCredits: RateLimitResetCreditsSummary | null
}

/**
 * Who a Codex home is signed in as, from `account/read`. The `chatgpt` email is personal
 * data: see `codex-account.ts` for where it may go.
 *
 * Left out: `usesCodexManagedCredentials` of `amazonBedrock`.
 */
export type Account =
  | { type: 'apiKey' }
  | { type: 'chatgpt'; email: string | null; planType: string }
  | { type: 'amazonBedrock' }

/**
 * The answer to `account/read`. `account` is null when the home is not signed in.
 * `requiresOpenaiAuth` says whether the configured model provider needs an OpenAI sign-in
 * at all. Left out: `workspaceRouting`.
 */
export type GetAccountResponse = {
  account: Account | null
  requiresOpenaiAuth: boolean
}
