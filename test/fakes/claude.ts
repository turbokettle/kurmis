// Test-side helpers for the fake `claude` in claude/fake-claude.js: run it, write a made-up
// login for it to read, script it per login, and read back what it recorded.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the fake `claude` script. Run it as `[process.execPath, FAKE_CLAUDE_SCRIPT, ...args]`. */
export const FAKE_CLAUDE_SCRIPT = fileURLToPath(new URL('./claude/fake-claude.js', import.meta.url))

/** The version `claude --version` prints unless `FAKE_CLAUDE_VERSION` says otherwise. */
export const FAKE_CLAUDE_VERSION = '2.1.301'

/** The file name of the per-login scenario, read from the login's credentials folder. */
export const FAKE_CLAUDE_SCENARIO_FILE = 'fake-claude-scenario.json'

/** A made-up OAuth access token: `sk-ant-oat01-fake-<label>`. The fakes record only tokens of this form. */
export function fakeToken(label: string): string {
  return `sk-ant-oat01-fake-${label}`
}

export interface ClaudeCredentials {
  accessToken: string
  /** Null leaves it out, so the CLI never renews the token. */
  refreshToken: string | null
  /** Unix milliseconds. */
  expiresAt: number
  refreshTokenExpiresAt: number
  scopes: string[]
  subscriptionType: string | null
  rateLimitTier: string | null
}

/**
 * Writes `<dir>/.credentials.json` in the real CLI's shape (`claudeAiOauth: {...}`) and returns
 * what it wrote. Defaults: a fake token named after nothing in particular, a refresh token,
 * eight hours to expiry, the inference and profile scopes, a Max plan.
 */
export function writeClaudeCredentials(dir: string, options: Partial<ClaudeCredentials> = {}): ClaudeCredentials {
  const now = Date.now()
  const credentials: ClaudeCredentials = {
    accessToken: fakeToken('access'),
    refreshToken: 'sk-ant-ort01-fake-refresh',
    expiresAt: now + 8 * 3_600_000,
    refreshTokenExpiresAt: now + 30 * 86_400_000,
    scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
    subscriptionType: 'max',
    rateLimitTier: 'default_claude_max_20x',
    ...options
  }
  const { refreshToken, ...rest } = credentials
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.credentials.json'),
    `${JSON.stringify({ claudeAiOauth: refreshToken === null ? rest : { ...rest, refreshToken } }, null, 2)}\n`, { mode: 0o600 })
  return credentials
}

/** Reads `<dir>/.credentials.json` back, e.g. to see whether the fake renewed the token. */
export function readClaudeCredentials(dir: string): Partial<ClaudeCredentials> | null {
  const file = join(dir, '.credentials.json')
  if (!existsSync(file)) return null
  return (JSON.parse(readFileSync(file, 'utf8')) as { claudeAiOauth?: Partial<ClaudeCredentials> }).claudeAiOauth ?? null
}

export interface ClaudeIdentity {
  email: string
  accountUuid?: string
  /** A made-up organization by default; null writes a block without one. */
  organizationUuid?: string | null
  organizationName?: string
}

/**
 * Writes the `oauthAccount` block that `auth status` reads the email and organisation from, into
 * the `.claude.json` at `file`, keeping what else is in it. The real CLI keeps that file at
 * `$CLAUDE_CONFIG_DIR/.claude.json`, or `~/.claude.json` when the variable is unset.
 */
export function writeClaudeIdentity(file: string, identity: ClaudeIdentity): void {
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {}
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({
    ...existing,
    oauthAccount: {
      accountUuid: identity.accountUuid ?? '00000000-0000-4000-8000-0000000000a1',
      emailAddress: identity.email,
      ...(identity.organizationUuid === null ? {} : {
        organizationUuid: identity.organizationUuid ?? '00000000-0000-4000-8000-0000000000b1',
        organizationName: identity.organizationName ?? 'Example Org'
      })
    }
  }, null, 2)}\n`)
}

/** A usage window for the scenario: a percentage, or a percentage with an ISO reset time. Null answers the window as null. */
export type UsageWindowScript = number | { utilization?: number; resetsAt?: string | null } | null

/** What `fake-claude-scenario.json` (or the file `FAKE_CLAUDE_SCENARIO` names) may hold. */
export interface FakeClaudeScenario {
  fiveHour?: UsageWindowScript
  sevenDay?: UsageWindowScript
  sevenDayOpus?: UsageWindowScript
  sevenDaySonnet?: UsageWindowScript
  /** Merged over the whole `get_usage` answer, key by key; arrays and null replace. */
  usage?: Record<string, unknown>
  /** `answer` (default), `error` (a control error answer) or `hang` (never answers). */
  getUsage?: 'answer' | 'error' | 'hang'
  usageDelayMs?: number
  startupDelayMs?: number
  /** Exits 1 at start with this line on stderr, before doing anything. */
  startupFailure?: string
  /**
   * When the token is renewed. `auto` (default): when it expires within five minutes and a
   * refresh token is stored, as the real CLI does. `always`: on every use. `never`. `fail`: a
   * due renewal fails, and the CLI acts as if logged out.
   */
  renew?: 'auto' | 'always' | 'never' | 'fail'
  /** What a renewal writes. Defaults: `<old token>-renewed`, `<old refresh token>-renewed`, eight hours. */
  renewTo?: { accessToken?: string; refreshToken?: string; expiresInMs?: number }
  /** First wait between retries in `-p` mode, doubling up to 32 times this. Default 10 ms. */
  retryDelayMs?: number
  /** When above 0, a `retry-after` header is waited out, scaled by this (0.001 makes 1 s into 1 ms). Default 0: ignored. */
  retryAfterScale?: number
  /** Exit code of an interactive start (no `-p`). Default 0. */
  exitCode?: number
  /** How long an interactive start stays up before exiting. Default 0. */
  holdMs?: number
}

/** Writes the per-login scenario into the login's credentials folder. */
export function writeClaudeScenario(credentialsDir: string, scenario: FakeClaudeScenario): void {
  mkdirSync(credentialsDir, { recursive: true })
  writeFileSync(join(credentialsDir, FAKE_CLAUDE_SCENARIO_FILE), `${JSON.stringify(scenario, null, 2)}\n`)
}

/** One line of the file `FAKE_CLAUDE_RECORD` names. `kind` says which. */
export type FakeClaudeRecord =
  | { kind: 'start'; t: number; pid: number; argv: string[]; cwd: string; env: Record<string, string>; effectiveEnv: Record<string, string>; credentialsDir: string }
  | { kind: 'hello'; t: number; pid: number; status: number; error: string | null }
  | { kind: 'request'; t: number; pid: number; attempt: number; method: string; path: string; headers: Record<string, string>; status: number; error: string | null }
  | { kind: 'retry'; t: number; pid: number; attempt: number; maxRetries: number; status: number; waitMs: number }
  | { kind: 'renew'; t: number; pid: number; reason: string; ok: boolean; from?: string; to?: string }
  | { kind: 'control_request'; t: number; pid: number; subtype: string }
  | { kind: 'result'; t: number; pid: number; isError: boolean; text: string; status: number | null }
  | { kind: 'signal'; t: number; pid: number; signal: string }
  | { kind: 'login' | 'logout'; t: number; pid: number; credentialsDir: string }
  | { kind: 'user_message'; t: number; pid: number }
  | { kind: 'exit'; t: number; pid: number; code: number }

/** Reads the record file. A missing file reads as no lines. */
export function readFakeClaudeRecord(file: string): FakeClaudeRecord[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as FakeClaudeRecord)
}

export interface RunResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

/**
 * Runs the fake once with `node` and collects its output. `env` replaces the environment
 * entirely when `replaceEnv` is set, and is merged over `process.env` otherwise.
 */
export function runFakeClaude(args: string[], options: { env?: Record<string, string | undefined>; replaceEnv?: boolean; input?: string } = {}): Promise<RunResult> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(options.replaceEnv === true ? (options.env ?? {}) : { ...process.env, ...options.env })) {
    if (value !== undefined) env[name] = value
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FAKE_CLAUDE_SCRIPT, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
    child.stdin.end(options.input ?? '')
  })
}
