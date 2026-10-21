// Test-side helpers for the fake `codex` in test/fakes/codex/fake-codex.js: install it on a
// PATH folder, give a CODEX_HOME a made-up login, script its rate limits, and read what it
// recorded. test/fakes/README.md describes every setting.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installLauncher, type InstalledFake } from './launcher.ts'

/** Absolute path of the fake's script. */
export const FAKE_CODEX_SCRIPT = fileURLToPath(new URL('./codex/fake-codex.js', import.meta.url))

/** What `codex --version` reports when FAKE_CODEX_VERSION is not set. */
export const FAKE_CODEX_DEFAULT_VERSION = '0.163.0'

/** The scenario file the fake reads from the CODEX_HOME it runs with. */
export const FAKE_CODEX_SCENARIO_FILE = 'fake-codex-scenario.json'

/** Writes a `codex` launcher for the fake into `binDir`. See `installLauncher`. */
export function installFakeCodex(binDir: string, platform: NodeJS.Platform = process.platform): InstalledFake {
  return installLauncher(binDir, 'codex', FAKE_CODEX_SCRIPT, platform)
}

export interface FakeCodexLogin {
  /** Defaults to `codex-user@example.com`. */
  email?: string
  /** A Codex plan type such as `plus`, `pro` or `prolite`. Defaults to `plus`. */
  planType?: string
  /** The ChatGPT account id, `tokens.account_id` in the file. Defaults to `fake-account-0001`. */
  accountId?: string
  /** Defaults to `fake-user-0001`. */
  userId?: string
}

/**
 * Writes `<codexHome>/auth.json` for a made-up ChatGPT login, in the real file's shape:
 * `auth_mode`, `OPENAI_API_KEY: null`, `tokens` and `last_refresh`. The email and the plan
 * are claims inside `tokens.id_token`, an unsigned JWT, which is where the real CLI reads
 * them. The tokens are not real and work nowhere. Returns the file's path.
 */
export function writeCodexAuth(codexHome: string, login: FakeCodexLogin = {}): string {
  return writeJson(join(codexHome, 'auth.json'), authFileValue(login))
}

/**
 * Writes the sign-in of a made-up ChatGPT login into the fake's stand-in keyring, the folder
 * `keyringDir` that FAKE_CODEX_KEYRING_DIR names, as the item of `codexHome`. The fake reads it
 * when the home's `config.toml` sets `cli_auth_credentials_store` to `keyring` or `auto`.
 * Returns the item's path.
 */
export function writeCodexKeyringAuth(keyringDir: string, codexHome: string, login: FakeCodexLogin = {}): string {
  const name = createHash('sha256').update(resolve(codexHome)).digest('hex').slice(0, 16)
  return writeJson(join(keyringDir, `${name}.json`), authFileValue(login))
}

/** What `auth.json` holds for a made-up ChatGPT login. */
function authFileValue(login: FakeCodexLogin): Record<string, unknown> {
  const email = login.email ?? 'codex-user@example.com'
  const accountId = login.accountId ?? 'fake-account-0001'
  const userId = login.userId ?? 'fake-user-0001'
  const now = Math.floor(Date.now() / 1000)
  const openai = {
    chatgpt_account_id: accountId,
    chatgpt_plan_type: login.planType ?? 'plus',
    chatgpt_user_id: userId,
    user_id: userId
  }
  const idToken = unsignedJwt({ email, email_verified: true, 'https://api.openai.com/auth': openai, iat: now, exp: now + 3600 })
  const accessToken = unsignedJwt({ 'https://api.openai.com/auth': openai, iat: now, exp: now + 864000 })
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: { id_token: idToken, access_token: accessToken, refresh_token: 'fake-refresh-token', account_id: accountId },
    last_refresh: new Date().toISOString()
  }
}

/** Writes `<codexHome>/auth.json` for an API-key login, with a made-up key. Returns the file's path. */
export function writeCodexApiKeyAuth(codexHome: string): string {
  return writeJson(join(codexHome, 'auth.json'), { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-fake-not-a-real-key' })
}

/** One rate-limit window. A field left out takes the fake's default. */
export interface FakeCodexWindow {
  /** Defaults to 0. */
  usedPercent?: number
  /** Defaults to 300 for `primary` and 10080 for `secondary`. */
  windowDurationMins?: number | null
  /** Unix seconds. Defaults to one full window from now. */
  resetsAt?: number | null
  /** Sets `resetsAt` to this many seconds from the moment of the answer. Fake only. */
  resetsInSeconds?: number
}

/**
 * What the fake app-server does. Every key is optional; an empty scenario signs in as
 * `auth.json` says and reports 0 % used on a 300-minute and a 10080-minute window.
 */
export interface FakeCodexScenario {
  /** Exit at once with this code (default 1) after writing `stderr` as one line. */
  startupFailure?: { exitCode?: number; stderr?: string }
  /** Wait this long before answering every request after `initialize`. */
  delayMs?: number
  /** Wait this long, on top of `delayMs`, before answering `account/rateLimits/read`. */
  rateLimitsDelayMs?: number
  /** Never answer `account/rateLimits/read`. */
  rateLimitsHang?: boolean
  /** Answer `account/rateLimits/read` with an error. `true` is code -32603 and a message like the real network failure. */
  rateLimitsError?: true | { code?: number; message?: string }
  /** The `codex` bucket's shorter window. `null` leaves it out. */
  primary?: FakeCodexWindow | null
  /** The `codex` bucket's longer window. `null` leaves it out. */
  secondary?: FakeCodexWindow | null
  /** Defaults to `{hasCredits: false, unlimited: false, balance: "0"}`. */
  credits?: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null
  /** Defaults to the plan in `auth.json`. */
  planType?: string | null
  /** Defaults to `tokens.account_id` in `auth.json`. */
  accountId?: string | null
  /** Defaults to null. */
  rateLimitReachedType?: string | null
  /** Defaults to true. */
  ordinaryUsageAllowed?: boolean | null
  /** More metered limits for `rateLimitsByLimitId`, by limit id. `null` makes `rateLimitsByLimitId` null. */
  buckets?: Record<string, { limitName?: string | null; primary?: FakeCodexWindow | null; secondary?: FakeCodexWindow | null }> | null
  /** `rateLimitResetCredits`. A number is that many available credits. Defaults to `{availableCount: 0, credits: []}`. */
  resetCredits?: number | { availableCount: number; credits: unknown[] | null } | null
}

/** Writes the scenario for one login, `<codexHome>/fake-codex-scenario.json`. Returns the file's path. */
export function writeCodexScenario(codexHome: string, scenario: FakeCodexScenario): string {
  return writeJson(join(codexHome, FAKE_CODEX_SCENARIO_FILE), scenario)
}

/**
 * Writes a scenario file anywhere, for FAKE_CODEX_SCENARIO: the scenario of every login whose
 * CODEX_HOME has no scenario file of its own. Returns `path`.
 */
export function writeSharedCodexScenario(path: string, scenario: FakeCodexScenario): string {
  return writeJson(path, scenario)
}

/** One line of the FAKE_CODEX_RECORD file. */
export type FakeCodexRecord =
  | {
      pid: number
      event: 'start'
      mode: 'version' | 'app-server' | 'login-status' | 'other'
      argv: string[]
      /** CODEX_HOME as the process got it, or null when it was not set. */
      codexHome: string | null
      /** Whether `auth.json` was in the CODEX_HOME the fake used. */
      authFile: boolean
      /** Names, never values, of the variables starting with CODEX_, OPENAI_, KURMIS_, ANTHROPIC_ or CLAUDE_. */
      envNames: string[]
    }
  | { pid: number; event: 'request'; method: string; id: string | number }
  | { pid: number; event: 'notification'; method: string }
  | { pid: number; event: 'exit'; reason: 'stdinEnded' | 'startupFailure'; code: number }

/** The lines of a FAKE_CODEX_RECORD file, oldest first. An empty list when there is no file. */
export function readCodexRecord(path: string): FakeCodexRecord[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as FakeCodexRecord)
}

function unsignedJwt(claims: Record<string, unknown>): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.fake-signature`
}

function writeJson(path: string, value: unknown): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  return path
}
