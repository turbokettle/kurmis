// A stand-in for the `claude` CLI, for tests. It covers only what kurmis starts `claude` for:
// `--version`, `auth status|login|logout`, a stream-json process that answers `initialize` and
// `get_usage` (the daemon's usage probe), and `-p <prompt>`, which sends one streaming
// `POST /v1/messages` to ANTHROPIC_BASE_URL the way the real CLI does. Any other start (an
// interactive session) records itself and exits. test/fakes/README.md lists every knob.
//
// Plain JavaScript on purpose: tests spawn it as a child process, and Node 22 cannot run
// TypeScript without a flag. It never reads the Keychain and refuses any base URL that is not
// a loopback address, so it cannot reach the network or a real login.
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { clearTimeout as clearTimer, setTimeout as setTimer } from 'node:timers'
import { setTimeout as sleep } from 'node:timers/promises'
import { createInterface } from 'node:readline'

const VERSION = process.env.FAKE_CLAUDE_VERSION || '2.1.301'
const CREDENTIALS_FILE = '.credentials.json'
const SCENARIO_FILE = 'fake-claude-scenario.json'
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
/** The real CLI renews a token this long before it expires. */
const RENEW_MARGIN_MS = 5 * 60_000

/** Flags that never take a value. Any other flag takes the next argument unless that starts with `-`. */
const BOOLEAN_FLAGS = new Set([
  '-p', '--print', '--verbose', '--json', '--bare', '--debug', '-d', '--continue', '-c', '--version', '-v',
  '--help', '-h', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions',
  '--no-session-persistence', '--replay-user-messages', '--include-partial-messages', '--strict-mcp-config',
  '--claudeai', '--console'
])

/** Environment variables a record names. The two key variables are recorded only as `<set>`. */
const RECORDED_ENV = [
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR',
  'ENABLE_TOOL_SEARCH', 'CLAUDE_CODE_MAX_RETRIES', 'HOME', 'USERPROFILE', 'KURMIS_HOME'
]
const SECRET_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']

const MODEL_ALIASES = { sonnet: 'claude-sonnet-5', opus: 'claude-opus-5', haiku: 'claude-haiku-4-5-20251001', default: 'claude-sonnet-5' }

const argv = process.argv.slice(2)
const args = parseArgs(argv)
const env = effectiveEnv(process.env, args.flags)

async function main() {
  if (has('--version') || has('-v')) {
    await writeOut(process.stdout, `${VERSION} (Claude Code)\n`)
    return
  }
  record({ kind: 'start', pid: process.pid, argv, cwd: process.cwd(), env: pickEnv(process.env), effectiveEnv: pickEnv(env), credentialsDir: credentialsDir() })
  const scenario = loadScenario()
  if (scenario.startupDelayMs > 0) await sleep(scenario.startupDelayMs)
  if (scenario.startupFailure !== null) {
    await finish(1, '', `${scenario.startupFailure}\n`)
    return
  }
  if (args.positionals[0] === 'auth') {
    await runAuth(args.positionals[1] ?? '')
    return
  }
  if (args.flags.get('--input-format') === 'stream-json') {
    await runStreamJson(scenario)
    return
  }
  if (has('-p') || has('--print')) {
    await runPrint(scenario)
    return
  }
  await runInteractive(scenario)
}

// ---------------------------------------------------------------------------------------------
// Arguments and environment

/**
 * @param {string[]} list
 * @returns {{ flags: Map<string, string | true>, positionals: string[] }}
 */
function parseArgs(list) {
  /** @type {Map<string, string | true>} */
  const flags = new Map()
  const positionals = []
  for (let i = 0; i < list.length; i++) {
    const arg = list[i]
    if (arg === '--') {
      positionals.push(...list.slice(i + 1))
      break
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    if (arg.startsWith('--') && eq > 0) {
      flags.set(arg.slice(0, eq), arg.slice(eq + 1))
      continue
    }
    const next = list[i + 1]
    if (BOOLEAN_FLAGS.has(arg) || next === undefined || next.startsWith('-')) {
      flags.set(arg, true)
      continue
    }
    flags.set(arg, next)
    i++
  }
  return { flags, positionals }
}

/** @param {string} flag */
function has(flag) {
  return args.flags.has(flag)
}

/** @param {string} flag @returns {string | null} */
function flagValue(flag) {
  const value = args.flags.get(flag)
  return typeof value === 'string' ? value : null
}

/**
 * The environment the real CLI ends up with: the process environment, then the `env` block of
 * the user's `settings.json`, then the `env` block of `--settings`. Each beats the one before
 * (docs/architecture.md).
 *
 * @param {NodeJS.ProcessEnv} base
 * @param {Map<string, string | true>} flags
 */
function effectiveEnv(base, flags) {
  const out = { ...base }
  const configDir = base.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  applyEnvBlock(out, readJson(join(configDir, 'settings.json')))
  const settings = flags.get('--settings')
  if (typeof settings === 'string') {
    applyEnvBlock(out, settings.trimStart().startsWith('{') ? parseJson(settings) : readJson(settings))
  }
  return out
}

/** @param {Record<string, string | undefined>} target @param {unknown} settings */
function applyEnvBlock(target, settings) {
  const block = asObject(asObject(settings).env)
  for (const [name, value] of Object.entries(block)) {
    if (typeof value === 'string') target[name] = value
    else if (typeof value === 'number' || typeof value === 'boolean') target[name] = String(value)
  }
}

/** @param {Record<string, string | undefined>} source */
function pickEnv(source) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const name of RECORDED_ENV) if (source[name] !== undefined) out[name] = source[name]
  for (const name of SECRET_ENV) if (source[name] !== undefined) out[name] = '<set>'
  return out
}

// ---------------------------------------------------------------------------------------------
// Where the login is

/**
 * The folder holding `.credentials.json`. The first of the two variables that is set names it,
 * an empty `CLAUDE_SECURESTORAGE_CONFIG_DIR` meaning `~/.claude`; there is no fallback to the
 * next one (PROTOCOL.md, "Authentication: the credentials file").
 */
function credentialsDir() {
  const secure = env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  if (secure !== undefined) return secure === '' ? join(homedir(), '.claude') : secure
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR
  return join(homedir(), '.claude')
}

/** The config folder: `CLAUDE_CONFIG_DIR`, else `~/.claude`. */
function configDir() {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

/** `.claude.json`, which holds `oauthAccount`: inside `CLAUDE_CONFIG_DIR`, else `~/.claude.json`. */
function claudeJsonPath() {
  return env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json')
}

/**
 * @typedef {{ accessToken?: string, refreshToken?: string, expiresAt?: number, refreshTokenExpiresAt?: number,
 *   scopes?: string[], subscriptionType?: string | null, rateLimitTier?: string | null }} OauthRecord
 */

/** @returns {OauthRecord | null} */
function readCredentials() {
  const file = join(credentialsDir(), CREDENTIALS_FILE)
  const data = readJson(file)
  if (data === null) return null
  const oauth = asObject(asObject(data).claudeAiOauth)
  return typeof oauth.accessToken === 'string' ? /** @type {OauthRecord} */ (oauth) : null
}

/** @param {OauthRecord} oauth */
function writeCredentials(oauth) {
  const file = join(credentialsDir(), CREDENTIALS_FILE)
  const existing = asObject(readJson(file))
  writeJsonAtomic(file, { ...existing, claudeAiOauth: oauth })
}

function readIdentity() {
  return asObject(asObject(readJson(claudeJsonPath())).oauthAccount)
}

// ---------------------------------------------------------------------------------------------
// Scenario

/**
 * @typedef {{
 *   usage: Record<string, unknown>,
 *   windows: Record<string, unknown>,
 *   getUsage: 'answer' | 'error' | 'hang',
 *   usageDelayMs: number,
 *   startupDelayMs: number,
 *   startupFailure: string | null,
 *   renew: 'auto' | 'always' | 'never' | 'fail',
 *   renewTo: { accessToken?: string, refreshToken?: string, expiresInMs?: number },
 *   retryDelayMs: number,
 *   retryAfterScale: number,
 *   exitCode: number,
 *   holdMs: number
 * }} Scenario
 */

/**
 * Builds the scenario from, in rising order: the single `FAKE_CLAUDE_*` variables, the JSON file
 * `FAKE_CLAUDE_SCENARIO` names, and `fake-claude-scenario.json` in the login's credentials
 * folder. The last one is how a test scripts each login differently when the daemon starts the
 * fakes itself with one shared environment.
 *
 * @returns {Scenario}
 */
function loadScenario() {
  const fromEnv = {
    windows: {
      ...(env.FAKE_CLAUDE_USAGE_FIVE_HOUR ? { fiveHour: Number(env.FAKE_CLAUDE_USAGE_FIVE_HOUR) } : {}),
      ...(env.FAKE_CLAUDE_USAGE_SEVEN_DAY ? { sevenDay: Number(env.FAKE_CLAUDE_USAGE_SEVEN_DAY) } : {})
    },
    ...(env.FAKE_CLAUDE_GET_USAGE ? { getUsage: env.FAKE_CLAUDE_GET_USAGE } : {}),
    ...(env.FAKE_CLAUDE_USAGE_DELAY_MS ? { usageDelayMs: Number(env.FAKE_CLAUDE_USAGE_DELAY_MS) } : {}),
    ...(env.FAKE_CLAUDE_STARTUP_DELAY_MS ? { startupDelayMs: Number(env.FAKE_CLAUDE_STARTUP_DELAY_MS) } : {}),
    ...(env.FAKE_CLAUDE_STARTUP_FAILURE ? { startupFailure: env.FAKE_CLAUDE_STARTUP_FAILURE } : {}),
    ...(env.FAKE_CLAUDE_RENEW ? { renew: env.FAKE_CLAUDE_RENEW } : {}),
    ...(env.FAKE_CLAUDE_RETRY_DELAY_MS ? { retryDelayMs: Number(env.FAKE_CLAUDE_RETRY_DELAY_MS) } : {}),
    ...(env.FAKE_CLAUDE_RETRY_AFTER_SCALE ? { retryAfterScale: Number(env.FAKE_CLAUDE_RETRY_AFTER_SCALE) } : {}),
    ...(env.FAKE_CLAUDE_EXIT_CODE ? { exitCode: Number(env.FAKE_CLAUDE_EXIT_CODE) } : {}),
    ...(env.FAKE_CLAUDE_HOLD_MS ? { holdMs: Number(env.FAKE_CLAUDE_HOLD_MS) } : {})
  }
  const shared = env.FAKE_CLAUDE_SCENARIO ? asObject(readJson(env.FAKE_CLAUDE_SCENARIO)) : {}
  const own = asObject(readJson(join(credentialsDir(), SCENARIO_FILE)))
  const merged = deepMerge(deepMerge(fromEnv, shared), own)
  const windows = {}
  for (const key of ['fiveHour', 'sevenDay', 'sevenDayOpus', 'sevenDaySonnet']) {
    if (key in merged) windows[key] = merged[key]
  }
  return {
    usage: asObject(merged.usage),
    windows: { ...asObject(merged.windows), ...windows },
    getUsage: oneOf(merged.getUsage, ['answer', 'error', 'hang'], 'answer'),
    usageDelayMs: numberOr(merged.usageDelayMs, 0),
    startupDelayMs: numberOr(merged.startupDelayMs, 0),
    startupFailure: typeof merged.startupFailure === 'string' ? merged.startupFailure : null,
    renew: oneOf(merged.renew, ['auto', 'always', 'never', 'fail'], 'auto'),
    renewTo: /** @type {Scenario['renewTo']} */ (asObject(merged.renewTo)),
    retryDelayMs: numberOr(merged.retryDelayMs, 10),
    retryAfterScale: numberOr(merged.retryAfterScale, 0),
    exitCode: numberOr(merged.exitCode, 0),
    holdMs: numberOr(merged.holdMs, 0)
  }
}

// ---------------------------------------------------------------------------------------------
// Token renewal

/**
 * Renews the token the way the real CLI does before using it: when it expires within five
 * minutes and a refresh token is stored. Nothing is sent anywhere; the fake writes a new token
 * into the credentials file itself. `renew` in the scenario changes when, or makes it fail.
 *
 * @param {Scenario} scenario
 * @param {string} reason
 * @param {boolean} [force] renew whatever the expiry says (after a 401)
 * @returns {OauthRecord | null} the credentials to use, or null when there are none usable
 */
function renewIfDue(scenario, reason, force = false) {
  const oauth = readCredentials()
  if (oauth === null) return null
  const expiring = typeof oauth.expiresAt === 'number' && Date.now() + RENEW_MARGIN_MS >= oauth.expiresAt
  const canRenew = typeof oauth.refreshToken === 'string' && oauth.refreshToken.length > 0
  const due = scenario.renew === 'always' || ((expiring || force) && canRenew && scenario.renew !== 'never')
  if (!due) return oauth
  if (scenario.renew === 'fail') {
    record({ kind: 'renew', reason, ok: false })
    return null
  }
  const renewed = {
    ...oauth,
    accessToken: scenario.renewTo.accessToken ?? `${oauth.accessToken}-renewed`,
    refreshToken: scenario.renewTo.refreshToken ?? (canRenew ? `${oauth.refreshToken}-renewed` : oauth.refreshToken),
    expiresAt: Date.now() + (scenario.renewTo.expiresInMs ?? 8 * HOUR_MS)
  }
  writeCredentials(renewed)
  record({ kind: 'renew', reason, ok: true, from: tokenLabel(oauth.accessToken), to: tokenLabel(renewed.accessToken) })
  return renewed
}

// ---------------------------------------------------------------------------------------------
// auth status | login | logout

/** @param {string} command */
async function runAuth(command) {
  if (command === 'status') return await authStatus()
  if (command === 'login') return await authLogin()
  if (command === 'logout') return await authLogout()
  await finish(1, '', `error: unknown command 'auth ${command}'\n`)
}

/**
 * `{loggedIn, authMethod, apiProvider, analyticsDisabled, projectsDirectory, email, orgId,
 * orgName, subscriptionType}`, two-space indented. `loggedIn` and `subscriptionType` come from
 * the credentials file, the identity from `.claude.json`'s `oauthAccount` (null when there is
 * none). Without a credentials file it prints `loggedIn: false` and exits 1.
 */
async function authStatus() {
  const oauth = readCredentials()
  const base = { apiProvider: 'firstParty', analyticsDisabled: false, projectsDirectory: join(configDir(), 'projects') }
  const json = has('--json')
  if (oauth === null) {
    const status = { loggedIn: false, authMethod: 'none', ...base }
    await finish(1, json ? `${JSON.stringify(status, null, 2)}\n` : 'Not logged in. Run claude auth login to sign in.\n')
    return
  }
  const identity = readIdentity()
  const status = {
    loggedIn: true,
    authMethod: 'claude.ai',
    ...base,
    email: stringOrNull(identity.emailAddress),
    orgId: stringOrNull(identity.organizationUuid),
    orgName: stringOrNull(identity.organizationName),
    subscriptionType: stringOrNull(oauth.subscriptionType)
  }
  const text = `Logged in with a Claude account${status.email ? ` as ${status.email}` : ''}` +
    `${status.subscriptionType ? ` (${status.subscriptionType})` : ''}.\n`
  await finish(0, json ? `${JSON.stringify(status, null, 2)}\n` : text)
}

/**
 * Prints the real CLI's three lines (the last is a prompt with no newline), then writes a
 * made-up login: `.credentials.json` in the credentials folder and `oauthAccount` in
 * `.claude.json`. `FAKE_CLAUDE_LOGIN=fail` makes it fail instead.
 */
async function authLogin() {
  await writeOut(process.stdout, 'Opening browser to sign in…\n' +
    'If the browser didn\'t open, visit: https://claude.example.com/oauth/authorize?code=true&client_id=fake-client&state=fake-state\n' +
    'Paste code here if prompted > ')
  await sleep(20)
  if (env.FAKE_CLAUDE_LOGIN === 'fail') {
    await finish(1, '', 'Login failed: the fake claude was told to fail\n')
    return
  }
  const email = flagValue('--email') ?? env.FAKE_CLAUDE_EMAIL ?? 'user@example.com'
  const subscriptionType = env.FAKE_CLAUDE_SUBSCRIPTION || 'max'
  const now = Date.now()
  mkdirSync(credentialsDir(), { recursive: true })
  writeCredentials({
    accessToken: `sk-ant-oat01-fake-login-${randomBytes(6).toString('hex')}`,
    refreshToken: `sk-ant-ort01-fake-login-${randomBytes(6).toString('hex')}`,
    expiresAt: now + 8 * HOUR_MS,
    refreshTokenExpiresAt: now + 30 * DAY_MS,
    scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
    subscriptionType,
    rateLimitTier: 'default_claude_max_20x'
  })
  const file = claudeJsonPath()
  const existing = asObject(readJson(file))
  writeJsonAtomic(file, {
    ...existing,
    oauthAccount: {
      accountUuid: env.FAKE_CLAUDE_ACCOUNT_UUID || '00000000-0000-4000-8000-0000000000a1',
      emailAddress: email,
      organizationUuid: env.FAKE_CLAUDE_ORG_ID || '00000000-0000-4000-8000-0000000000b1',
      organizationName: env.FAKE_CLAUDE_ORG_NAME || 'Example Org'
    }
  })
  record({ kind: 'login', credentialsDir: credentialsDir() })
  await finish(0, '\nLogin successful.\n')
}

/** Deletes the credentials file. The real CLI also revokes the refresh token; the fake sends nothing. */
async function authLogout() {
  rmSync(join(credentialsDir(), CREDENTIALS_FILE), { force: true })
  record({ kind: 'logout', credentialsDir: credentialsDir() })
  await finish(0, 'Successfully logged out from your Anthropic account.\n')
}

// ---------------------------------------------------------------------------------------------
// stream-json: initialize and get_usage

/** @param {Scenario} scenario */
async function runStreamJson(scenario) {
  /** @type {Set<Promise<void>>} */
  const running = new Set()
  /** @type {Set<string>} */
  const cancelled = new Set()
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim() === '') continue
    const frame = asObject(parseJson(line))
    if (frame.type === 'control_request') {
      const work = answerControl(scenario, frame, cancelled)
      running.add(work)
      void work.finally(() => running.delete(work))
    } else if (frame.type === 'control_cancel_request') {
      cancelled.add(String(frame.request_id))
    } else if (frame.type === 'user') {
      record({ kind: 'user_message' })
      emit({
        type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 0, duration_ms: 0,
        result: 'The fake claude does not run turns in stream-json mode.', session_id: sessionId()
      })
    }
  }
  // stdin ended: finish answering what is being worked on, then exit 0. A request the scenario
  // leaves hanging was never added to `running`.
  await Promise.all(running)
  await finish(0, '')
}

/**
 * @param {Scenario} scenario
 * @param {Record<string, unknown>} frame
 * @param {Set<string>} cancelled
 */
async function answerControl(scenario, frame, cancelled) {
  const requestId = String(frame.request_id)
  const request = asObject(frame.request)
  const subtype = String(request.subtype)
  record({ kind: 'control_request', subtype })
  if (subtype === 'initialize') {
    respond(requestId, initializeResponse())
    return
  }
  if (subtype === 'get_usage') {
    if (scenario.usageDelayMs > 0) await sleep(scenario.usageDelayMs)
    if (scenario.getUsage === 'hang') return
    if (cancelled.has(requestId)) return
    if (scenario.getUsage === 'error') {
      respondError(requestId, 'Failed to fetch usage')
      return
    }
    respond(requestId, usageResponse(scenario))
    return
  }
  if (subtype === 'interrupt') {
    respond(requestId, {})
    return
  }
  respondError(requestId, `Unsupported control request subtype: ${subtype}`)
}

function initializeResponse() {
  const oauth = readCredentials()
  const identity = readIdentity()
  return {
    commands: [],
    agents: [],
    models: [
      { value: 'default', displayName: 'Default (recommended)', description: 'Sonnet 5' },
      { value: 'opus', displayName: 'Opus', description: 'Opus 5' },
      { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5' }
    ],
    account: oauth === null ? {} : {
      email: stringOrNull(identity.emailAddress) ?? undefined,
      organization: stringOrNull(identity.organizationName) ?? undefined,
      subscriptionType: oauth.subscriptionType === 'max' ? 'Claude Max' : oauth.subscriptionType === 'pro' ? 'Claude Pro' : (oauth.subscriptionType ?? undefined),
      apiProvider: 'firstParty'
    },
    output_style: 'default',
    available_output_styles: ['default', 'Explanatory', 'Learning'],
    current_permission_mode: 'default',
    session_state: 'idle',
    pending_permission_requests: [],
    pending_user_dialog_requests: [],
    claude_code_version: VERSION
  }
}

/**
 * The `get_usage` answer: `{session, subscription_type, rate_limits_available, rate_limits,
 * behaviors}`, utilizations in percent and resets as ISO strings (PROTOCOL.md, "`get_usage`
 * answers before any user message too"). A login with no usable token, or one without the
 * `user:profile` scope, answers `rate_limits_available: false, rate_limits: null`.
 *
 * @param {Scenario} scenario
 */
function usageResponse(scenario) {
  const oauth = renewIfDue(scenario, 'get_usage')
  const session = { total_cost_usd: 0, total_lines_added: 0, total_lines_removed: 0 }
  const profile = oauth !== null && (oauth.scopes === undefined || oauth.scopes.includes('user:profile'))
  if (!profile) {
    return deepMerge({ session, subscription_type: oauth?.subscriptionType ?? null, rate_limits_available: false, rate_limits: null, behaviors: {} },
      scenario.usage)
  }
  const now = Date.now()
  const iso = (ms) => new Date(now + ms).toISOString()
  /** @type {Record<string, unknown>} */
  const rateLimits = {
    five_hour: { utilization: 42, resets_at: iso(3 * HOUR_MS) },
    seven_day: { utilization: 13, resets_at: iso(4 * DAY_MS) },
    seven_day_opus: { utilization: 4, resets_at: iso(4 * DAY_MS) },
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    extra_usage: { is_enabled: false, monthly_limit: 0, used_credits: 0, utilization: 0, currency: 'USD', disabled_reason: 'not_enabled' },
    limits: [],
    model_scoped: [{ display_name: 'Opus', utilization: 4, resets_at: iso(4 * DAY_MS) }]
  }
  const keys = { fiveHour: 'five_hour', sevenDay: 'seven_day', sevenDayOpus: 'seven_day_opus', sevenDaySonnet: 'seven_day_sonnet' }
  for (const [short, key] of Object.entries(keys)) {
    if (!(short in scenario.windows)) continue
    const value = scenario.windows[short]
    if (value === null) rateLimits[key] = null
    else if (typeof value === 'number') rateLimits[key] = { ...asObject(rateLimits[key]), utilization: value }
    else {
      const window = asObject(value)
      rateLimits[key] = {
        ...asObject(rateLimits[key]),
        ...('utilization' in window ? { utilization: window.utilization } : {}),
        ...('resetsAt' in window ? { resets_at: window.resetsAt } : {})
      }
    }
  }
  return deepMerge({
    session,
    subscription_type: oauth.subscriptionType ?? null,
    rate_limits_available: true,
    rate_limits: rateLimits,
    behaviors: {}
  }, scenario.usage)
}

/** @param {string} requestId @param {unknown} response */
function respond(requestId, response) {
  emit({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
}

/** @param {string} requestId @param {string} error */
function respondError(requestId, error) {
  emit({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } })
}

/** @param {unknown} frame */
function emit(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

// ---------------------------------------------------------------------------------------------
// -p <prompt>: one streaming request

/** @param {Scenario} scenario */
async function runPrint(scenario) {
  const started = Date.now()
  const json = flagValue('--output-format') === 'json'
  let prompt = args.positionals.join(' ')
  if (prompt === '') prompt = await readStdin()
  if (prompt.trim() === '') {
    await finish(1, '', prompt === ''
      ? 'Error: Input must be provided either through stdin or as a prompt argument when using --print\n'
      : 'Error: Input contained only whitespace. Provide a prompt with text through stdin or as a prompt argument when using --print\n')
    return
  }
  const baseUrl = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '')
  if (!isLoopback(baseUrl)) {
    await finish(2, '', `fake claude: refusing to reach ${baseUrl}. Set ANTHROPIC_BASE_URL to a loopback address.\n`)
    return
  }
  const auth = authHeaders(scenario)
  if (auth === null) {
    await printResult({ json, started, isError: true, text: 'Not logged in · Please run /login' })
    return
  }
  const session = sessionId()
  await hello(baseUrl)
  const outcome = await sendWithRetries(scenario, baseUrl, auth, session, prompt)
  await printResult({ json, started, ...outcome })
}

/**
 * The headers that sign the request: `ANTHROPIC_AUTH_TOKEN` as a bearer, else
 * `ANTHROPIC_API_KEY` as `x-api-key`, else the OAuth token from the credentials file.
 *
 * @param {Scenario} scenario
 * @returns {{ headers: Record<string, string>, subscription: boolean, oauth: boolean } | null}
 */
function authHeaders(scenario) {
  if (env.ANTHROPIC_AUTH_TOKEN) return { headers: { authorization: `Bearer ${env.ANTHROPIC_AUTH_TOKEN}` }, subscription: false, oauth: false }
  if (env.ANTHROPIC_API_KEY) return { headers: { 'x-api-key': env.ANTHROPIC_API_KEY }, subscription: false, oauth: false }
  const oauth = renewIfDue(scenario, 'request')
  if (oauth === null || typeof oauth.accessToken !== 'string') return null
  return { headers: { authorization: `Bearer ${oauth.accessToken}` }, subscription: true, oauth: (oauth.scopes ?? ['user:inference']).includes('user:inference') }
}

/** `HEAD /api/hello` before the first request, without the custom headers. Its answer is ignored. */
async function hello(baseUrl) {
  const answer = await send('HEAD', `${baseUrl}/api/hello`, { 'user-agent': userAgent() }, null, 5000)
  record({ kind: 'hello', status: answer.status, error: answer.error })
}

/**
 * Sends the request until it is answered 200, gives up, or runs out of retries. Like the real
 * CLI: a usage-limit 429 on a subscription login is final at once; a 529, a 5xx, a 429 without
 * usage-limit headers and a failed connection are retried up to `CLAUDE_CODE_MAX_RETRIES`
 * times (default 10, at most 15); a `retry-after` over 60 seconds ends the retries. The waits
 * are short and scripted rather than the real 0.5 s doubling to 32 s.
 *
 * @param {Scenario} scenario
 * @param {string} baseUrl
 * @param {{ headers: Record<string, string>, subscription: boolean, oauth: boolean }} auth
 * @param {string} session
 * @param {string} prompt
 * @returns {Promise<{ isError: boolean, text: string, status?: number }>}
 */
async function sendWithRetries(scenario, baseUrl, auth, session, prompt) {
  const maxRetries = Math.min(15, Math.max(0, Number.parseInt(env.CLAUDE_CODE_MAX_RETRIES ?? '', 10) || 10))
  const model = MODEL_ALIASES[flagValue('--model') ?? 'default'] ?? flagValue('--model')
  const body = JSON.stringify(requestBody(model, session, prompt))
  let signing = auth
  let renewedAfter401 = false
  let attempt = 0
  for (;;) {
    const headers = requestHeaders(signing, session)
    const answer = await send('POST', `${baseUrl}/v1/messages?beta=true`, headers, body, 30_000)
    record({ kind: 'request', attempt, method: 'POST', path: '/v1/messages?beta=true', headers: redactHeaders(headers), status: answer.status, error: answer.error })
    if (answer.status === 200) {
      const parsed = parseSse(answer.body)
      if (parsed.error === null) return { isError: false, text: parsed.text }
      if (parsed.error.type !== 'overloaded_error' || attempt >= maxRetries) {
        return { isError: true, text: `API Error: ${parsed.error.message}` }
      }
    } else if (answer.status === 401 && signing.subscription && !renewedAfter401) {
      renewedAfter401 = true
      const renewed = renewIfDue(scenario, '401', true)
      if (renewed !== null) {
        signing = { ...signing, headers: { authorization: `Bearer ${renewed.accessToken}` } }
        continue
      }
      return finalError(answer)
    } else if (answer.status === 429 && signing.subscription && isUsageLimit(answer.headers)) {
      return { isError: true, text: usageLimitText(answer.headers), status: 429 }
    } else if (!retryable(answer.status)) {
      return finalError(answer)
    }
    const after = Number(answer.headers['retry-after'])
    if (attempt >= maxRetries || (Number.isFinite(after) && after > 60)) return finalError(answer)
    const backoff = scenario.retryDelayMs * 2 ** Math.min(attempt, 5)
    const wait = Number.isFinite(after) && scenario.retryAfterScale > 0 ? Math.max(backoff, after * 1000 * scenario.retryAfterScale) : backoff
    record({ kind: 'retry', attempt: attempt + 1, maxRetries, status: answer.status, waitMs: wait })
    await sleep(wait)
    attempt++
  }
}

/** @param {number} status */
function retryable(status) {
  return status === 0 || status === 408 || status === 409 || status === 429 || status >= 500
}

/**
 * Whether a 429 is a usage limit: it carries the unified status `rejected`, a representative
 * claim or an overage status. The real CLI does not retry those on a subscription login.
 *
 * @param {Record<string, string>} headers
 */
function isUsageLimit(headers) {
  const prefix = 'anthropic-ratelimit-unified-'
  return headers[`${prefix}status`] === 'rejected' || headers[`${prefix}representative-claim`] !== undefined ||
    headers[`${prefix}overage-status`] !== undefined
}

/**
 * The text the real CLI shows for a usage limit: "You've hit your session limit · resets 2:10pm
 * (Europe/Berlin)" for the five-hour window. The weekly and Opus wording, and the date format of a
 * reset more than a day away, are guesses.
 *
 * @param {Record<string, string>} headers
 */
function usageLimitText(headers) {
  const claim = headers['anthropic-ratelimit-unified-representative-claim'] ?? ''
  const label = claim === 'five_hour' ? 'session' : claim.startsWith('seven_day_opus') ? 'Opus' : claim.startsWith('seven_day') ? 'weekly' : null
  const reset = Number(headers['anthropic-ratelimit-unified-reset'])
  if (label === null || !Number.isFinite(reset)) return 'You\'ve hit your usage limit.'
  return `You've hit your ${label} limit · resets ${resetText(reset * 1000)}`
}

/** "2:10pm (Europe/Berlin)", or "Oct 24, 2:10pm (Europe/Berlin)" when the reset is more than a day away. */
function resetText(ms) {
  const date = new Date(ms)
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const time = `${String(hours % 12 === 0 ? 12 : hours % 12)}${minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`}${hours < 12 ? 'am' : 'pm'}`
  const day = ms - Date.now() > DAY_MS ? `${date.toLocaleString('en-US', { month: 'short' })} ${String(date.getDate())}, ` : ''
  return `${day}${time} (${zone})`
}

/**
 * The text the CLI ends with when it gives up on an answer.
 *
 * @param {{ status: number, headers: Record<string, string>, body: string, error: string | null }} answer
 * @returns {{ isError: true, text: string, status?: number }}
 */
function finalError(answer) {
  if (answer.status === 0) return { isError: true, text: `API Error: Connection error. (${answer.error ?? 'no answer'})` }
  const message = errorMessage(answer.body)
  if (answer.status === 529) return { isError: true, text: 'API Error: Repeated 529 Overloaded errors', status: 529 }
  if (answer.status === 429) return { isError: true, text: `API Error: Request rejected (429) · ${message}`, status: 429 }
  if (answer.status === 401) return { isError: true, text: `Failed to authenticate. API Error: 401 ${answer.body} · Please run /login`, status: 401 }
  return { isError: true, text: `API Error: ${String(answer.status)} ${answer.body}`, status: answer.status }
}

/** @param {string} body */
function errorMessage(body) {
  const message = asObject(asObject(parseJson(body)).error).message
  return typeof message === 'string' ? message : body
}

/**
 * @param {string} model
 * @param {string} session
 * @param {string} prompt
 */
function requestBody(model, session, prompt) {
  const identity = readIdentity()
  return {
    model,
    max_tokens: 32000,
    stream: true,
    system: [{ type: 'text', text: 'You are Claude Code, Anthropic\'s official CLI for Claude.' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    metadata: {
      user_id: JSON.stringify({ device_id: deviceId(), account_uuid: stringOrNull(identity.accountUuid) ?? '', session_id: session })
    }
  }
}

/**
 * The headers of an inference request (PROTOCOL.md, "Authentication, the base URL and rate
 * limits"), with the `ANTHROPIC_CUSTOM_HEADERS` lines added last.
 *
 * @param {{ headers: Record<string, string>, oauth: boolean }} auth
 * @param {string} session
 */
function requestHeaders(auth, session) {
  const betas = ['claude-code-20250219', ...(auth.oauth ? ['oauth-2025-04-20'] : []), 'interleaved-thinking-2025-05-14']
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': betas.join(','),
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-app': 'cli',
    'user-agent': userAgent(),
    'X-Claude-Code-Session-Id': session,
    ...auth.headers,
    ...customHeaders()
  }
}

/** `ANTHROPIC_CUSTOM_HEADERS`: one `Name: value` per line. Lines without a colon are skipped. */
function customHeaders() {
  /** @type {Record<string, string>} */
  const out = {}
  for (const line of (env.ANTHROPIC_CUSTOM_HEADERS ?? '').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim()
    if (name !== '') out[name] = line.slice(colon + 1).trim()
  }
  return out
}

function userAgent() {
  return `claude-cli/${VERSION} (external, cli)`
}

let cachedSession = ''
function sessionId() {
  if (cachedSession === '') cachedSession = flagValue('--session-id') ?? flagValue('--resume') ?? randomUUID()
  return cachedSession
}

function deviceId() {
  return env.FAKE_CLAUDE_DEVICE_ID || 'f'.repeat(64)
}

/**
 * Text of a streamed answer, or the `error` event it carried.
 *
 * @param {string} body
 * @returns {{ text: string, error: { type: string, message: string } | null }}
 */
function parseSse(body) {
  let text = ''
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
    if (data === '') continue
    const event = asObject(parseJson(data))
    if (event.type === 'content_block_delta') {
      const delta = asObject(event.delta)
      if (delta.type === 'text_delta' && typeof delta.text === 'string') text += delta.text
    } else if (event.type === 'error') {
      const error = asObject(event.error)
      return { text, error: { type: String(error.type ?? 'api_error'), message: String(error.message ?? 'stream error') } }
    }
  }
  return { text, error: null }
}

/**
 * @param {{ json: boolean, started: number, isError: boolean, text: string, status?: number }} outcome
 */
async function printResult(outcome) {
  record({ kind: 'result', isError: outcome.isError, text: outcome.text, status: outcome.status ?? null })
  const code = outcome.isError ? 1 : 0
  if (!outcome.json) {
    await finish(code, `${outcome.text}\n`)
    return
  }
  const result = {
    type: 'result',
    subtype: 'success',
    is_error: outcome.isError,
    duration_ms: Date.now() - outcome.started,
    duration_api_ms: Date.now() - outcome.started,
    num_turns: 1,
    result: outcome.text,
    stop_reason: outcome.isError ? null : 'end_turn',
    session_id: sessionId(),
    total_cost_usd: 0,
    usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
    ...(outcome.isError ? { terminal_reason: 'api_error' } : {}),
    ...(outcome.status === undefined ? {} : { api_error_status: outcome.status }),
    uuid: randomUUID()
  }
  await finish(code, `${JSON.stringify(result)}\n`)
}

/**
 * One HTTP request. Status 0 means no answer arrived (refused connection, dropped socket,
 * timeout), with `error` saying which.
 *
 * @param {string} method
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {string | null} body
 * @param {number} timeoutMs
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string, error: string | null }>}
 */
function send(method, url, headers, body, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const req = httpRequest(url, { method, headers: body === null ? headers : { ...headers, 'content-length': String(Buffer.byteLength(body)) } }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        /** @type {Record<string, string>} */
        const out = {}
        for (const [name, value] of Object.entries(res.headers)) {
          if (value !== undefined) out[name] = Array.isArray(value) ? value.join(', ') : value
        }
        done({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks).toString('utf8'), error: null })
      })
      res.on('error', (error) => done({ status: 0, headers: {}, body: '', error: error.message }))
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer within ${String(timeoutMs)} ms`)))
    req.on('error', (error) => done({ status: 0, headers: {}, body: '', error: /** @type {NodeJS.ErrnoException} */ (error).code ?? error.message }))
    req.end(body ?? undefined)
  })
}

/** @param {string} url */
function isLoopback(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------------------------
// Anything else: an interactive start

/**
 * Records the start, prints one line, and exits with `exitCode` after `holdMs`. Ctrl-C (SIGINT)
 * while holding is recorded and exits 130, SIGTERM exits 143.
 *
 * @param {Scenario} scenario
 */
async function runInteractive(scenario) {
  if (scenario.holdMs > 0) {
    // The handlers go on before the line is printed, so a test that waits for the line and
    // then sends a signal always finds them.
    const held = new Promise((resolve) => {
      const timer = setTimer(() => resolve(null), scenario.holdMs)
      for (const name of ['SIGINT', 'SIGTERM']) {
        process.on(name, () => {
          clearTimer(timer)
          resolve(name)
        })
      }
    })
    await writeOut(process.stdout, `fake claude ${VERSION}: started without -p\n`)
    const signal = await held
    if (signal !== null) {
      record({ kind: 'signal', signal })
      await finish(signal === 'SIGINT' ? 130 : 143, '')
      return
    }
  } else {
    await writeOut(process.stdout, `fake claude ${VERSION}: started without -p\n`)
  }
  await finish(scenario.exitCode, '')
}

// ---------------------------------------------------------------------------------------------
// Recording and output

/**
 * Appends one JSON line to the file `FAKE_CLAUDE_RECORD` names. Tokens are written only when
 * they are fake ones (`sk-ant-...-fake-...`); anything else is replaced with its length.
 *
 * @param {Record<string, unknown>} entry
 */
function record(entry) {
  const file = process.env.FAKE_CLAUDE_RECORD
  if (!file) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${JSON.stringify({ t: Date.now(), pid: process.pid, ...entry })}\n`)
}

/** @param {Record<string, string>} headers */
function redactHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower === 'authorization') out[lower] = value.replace(/^Bearer\s+(.*)$/i, (_, token) => `Bearer ${tokenLabel(token)}`)
    else if (lower === 'x-api-key') out[lower] = tokenLabel(value)
    else out[lower] = value
  }
  return out
}

/** @param {string | undefined} token */
function tokenLabel(token) {
  if (typeof token !== 'string') return null
  return /^sk-ant-[a-z]+\d*-fake-/.test(token) ? token : `<redacted, ${String(token.length)} characters>`
}

/** @param {number} code @param {string} stdout @param {string} [stderr] */
async function finish(code, stdout, stderr = '') {
  if (stdout !== '') await writeOut(process.stdout, stdout)
  if (stderr !== '') await writeOut(process.stderr, stderr)
  record({ kind: 'exit', code })
  process.exit(code)
}

/** Waits for the write to be flushed, so output on a pipe is not lost at exit. */
function writeOut(stream, text) {
  return new Promise((resolve) => stream.write(text, () => resolve(undefined)))
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('')
      return
    }
    const chunks = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', () => resolve(''))
  })
}

// ---------------------------------------------------------------------------------------------
// Small helpers

/** @param {string} file */
function readJson(file) {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** @param {string} text */
function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Writes through a temporary file and a rename, so a reader never sees half a file. */
function writeJsonAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${String(process.pid)}.tmp`
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, file)
}

/** @param {unknown} value @returns {Record<string, any>} */
function asObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? /** @type {Record<string, any>} */ (value) : {}
}

/** @param {unknown} value */
function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** @param {unknown} value @param {number} fallback */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** @template {string} T @param {unknown} value @param {T[]} allowed @param {T} fallback @returns {T} */
function oneOf(value, allowed, fallback) {
  return allowed.includes(/** @type {T} */ (value)) ? /** @type {T} */ (value) : fallback
}

/**
 * Merges `over` into `base`: plain objects are merged key by key, anything else (arrays, null,
 * numbers) replaces.
 *
 * @param {Record<string, any>} base
 * @param {Record<string, any>} over
 * @returns {Record<string, any>}
 */
function deepMerge(base, over) {
  const out = { ...base }
  for (const [key, value] of Object.entries(over)) {
    const current = out[key]
    const bothObjects = typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof current === 'object' && current !== null && !Array.isArray(current)
    out[key] = bothObjects ? deepMerge(current, value) : value
  }
  return out
}

// Started last, so every module-level binding above is initialised first.
main().catch(async (error) => {
  await writeOut(process.stderr, `fake claude crashed: ${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(70)
})
