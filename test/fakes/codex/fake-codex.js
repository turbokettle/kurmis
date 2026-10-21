// A stand-in for the `codex` CLI, for tests. It answers `codex --version`, runs a small
// `codex app-server` on stdin and stdout, and for any other command line it prints one line
// and exits. Which login it is signed in as comes from `$CODEX_HOME/auth.json`. What it
// answers can be changed with a scenario file. test/fakes/README.md lists every setting.
//
// The wire format is the one the real `codex app-server` 0.163.0 was measured to use: one JSON
// message per line, no `jsonrpc` field, answers `{id, result}` or `{error: {code, message}, id}`,
// and notifications `{method, params, emittedAtMs}`. The refusal messages are copied from the real server.
//
// It never prints or records a token, and it writes nothing to disk except the record file
// that FAKE_CODEX_RECORD names.

import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs'
import { arch, homedir, release } from 'node:os'
import { join, resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'

const DEFAULT_VERSION = '0.163.0'
const SCENARIO_FILE_NAME = 'fake-codex-scenario.json'

/** Error code the real server uses for every refused request, an unknown method included. */
const INVALID_REQUEST = -32600
/** Error code the real server uses when reading rate limits from the backend fails. */
const INTERNAL_ERROR = -32603

/** The methods this fake answers. An unknown method's error lists them, as the real one lists its own. */
const KNOWN_METHODS = ['initialize', 'account/read', 'account/rateLimits/read']

/** Environment variables whose names, but never values, go into the record. */
const RECORDED_NAME_PREFIXES = ['CODEX_', 'OPENAI_', 'KURMIS_', 'ANTHROPIC_', 'CLAUDE_']

const args = process.argv.slice(2)
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
const recordPath = process.env.FAKE_CODEX_RECORD || ''
const version = process.env.FAKE_CODEX_VERSION || DEFAULT_VERSION

main()

function main() {
  const command = subcommand(args)
  record({
    event: 'start',
    mode: command === '--version' ? 'version' : command === 'app-server' ? 'app-server' : 'other',
    argv: args,
    codexHome: process.env.CODEX_HOME ?? null,
    authFile: existsSync(join(codexHome, 'auth.json')),
    envNames: Object.keys(process.env)
      .filter((name) => RECORDED_NAME_PREFIXES.some((prefix) => name.startsWith(prefix)))
      .sort()
  })
  if (command === '--version') {
    process.stdout.write(`codex-cli ${version}\n`)
    return
  }
  if (command === 'app-server') {
    runAppServer()
    return
  }
  process.stdout.write(`fake-codex: this is the test stand-in for codex, started with ${JSON.stringify(args)}\n`)
  process.exitCode = Number(process.env.FAKE_CODEX_EXIT_CODE || '0')
}

/**
 * The first argument that is not a global option: `-c key=value` and `--config key=value`
 * may come before the subcommand on the real CLI. `--version` and `-V` count as a command.
 * @param {string[]} argv
 * @returns {string}
 */
function subcommand(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '-c' || arg === '--config') {
      i++
      continue
    }
    if (arg === '--version' || arg === '-V') return '--version'
    return arg
  }
  return ''
}

// ---- the app-server

function runAppServer() {
  let scenario
  try {
    scenario = loadScenario()
  } catch (error) {
    process.stderr.write(`fake-codex: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
    return
  }
  const failure = scenario.startupFailure
  if (failure) {
    process.stderr.write(`${failure.stderr ?? 'Error: fake-codex was told to fail at startup'}\n`)
    record({ event: 'exit', reason: 'startupFailure', code: failure.exitCode ?? 1 })
    process.exitCode = failure.exitCode ?? 1
    return
  }

  let initialized = false
  let buffer = ''
  let stopped = false
  /** Answers waiting on a delay, so ending stdin can cancel them. */
  const timers = new Set()

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line.length > 0) onLine(line)
      newline = buffer.indexOf('\n')
    }
  })
  // The real server exits with code 0 soon after stdin ends, without answering the requests
  // that are still open.
  process.stdin.on('end', stop)
  process.stdin.on('close', stop)

  function stop() {
    if (stopped) return
    stopped = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    record({ event: 'exit', reason: 'stdinEnded', code: 0 })
    process.exitCode = 0
  }

  /** @param {string} line */
  function onLine(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      process.stderr.write('fake-codex: a line on stdin was not JSON\n')
      return
    }
    if (message === null || typeof message !== 'object' || typeof message.method !== 'string') return
    const id = message.id
    if (id === undefined || id === null) {
      record({ event: 'notification', method: message.method })
      return
    }
    record({ event: 'request', method: message.method, id })
    handle(id, message.method, message.params)
  }

  /**
   * @param {string | number} id
   * @param {string} method
   * @param {unknown} params
   */
  function handle(id, method, params) {
    if (method === 'initialize') {
      // `initialize` is answered at once, so `delayMs` slows only the requests after it.
      answerInitialize(id, params)
      return
    }
    if (!initialized) {
      fail(id, INVALID_REQUEST, 'Not initialized')
      return
    }
    let current
    try {
      current = loadScenario()
    } catch (error) {
      fail(id, INTERNAL_ERROR, `fake-codex: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (method === 'account/rateLimits/read' && current.rateLimitsHang === true) return
    const delay = (current.delayMs ?? 0) + (method === 'account/rateLimits/read' ? current.rateLimitsDelayMs ?? 0 : 0)
    if (delay <= 0) {
      answer(id, method, params, current)
      return
    }
    const timer = setTimeout(() => {
      timers.delete(timer)
      answer(id, method, params, current)
    }, delay)
    timers.add(timer)
  }

  /**
   * @param {string | number} id
   * @param {unknown} params
   */
  function answerInitialize(id, params) {
    if (params === undefined) {
      fail(id, INVALID_REQUEST, 'Invalid request: missing field `params`')
      return
    }
    if (initialized) {
      fail(id, INVALID_REQUEST, 'Already initialized')
      return
    }
    initialized = true
    const clientInfo = isObject(params) && isObject(params.clientInfo) ? params.clientInfo : {}
    const clientName = typeof clientInfo.name === 'string' ? clientInfo.name : 'unknown'
    const clientVersion = typeof clientInfo.version === 'string' ? clientInfo.version : 'unknown'
    const platform = platformInfo()
    reply(id, {
      userAgent: `${clientName}/${version} (${platform.label} ${release()}; ${platform.arch}) unknown (${clientName}; ${clientVersion})`,
      codexHome: canonicalPath(codexHome),
      platformFamily: platform.family,
      platformOs: platform.os
    })
    // The real server sends this notification right after the answer.
    notify('remoteControl/status/changed', {
      status: 'disabled',
      serverName: 'fake-codex-host',
      installationId: '00000000-0000-4000-8000-00000000c0de',
      environmentId: null
    })
  }

  /**
   * @param {string | number} id
   * @param {string} method
   * @param {unknown} params
   * @param {Scenario} current
   */
  function answer(id, method, params, current) {
    if (stopped) return
    if (method === 'account/read') {
      if (params === undefined) {
        fail(id, INVALID_REQUEST, 'Invalid request: missing field `params`')
        return
      }
      const login = readLogin()
      reply(id, { account: login?.account ?? null, requiresOpenaiAuth: true, workspaceRouting: null })
      return
    }
    if (method === 'account/rateLimits/read') {
      const login = readLogin()
      if (login === null || login.account.type !== 'chatgpt') {
        fail(id, INVALID_REQUEST, 'codex account authentication required to read rate limits')
        return
      }
      const error = current.rateLimitsError
      if (error) {
        const detail = error === true ? {} : error
        fail(id, detail.code ?? INTERNAL_ERROR, detail.message ?? 'failed to fetch codex rate limits: fake-codex scenario error')
        return
      }
      reply(id, rateLimitsAnswer(current, login))
      return
    }
    fail(id, INVALID_REQUEST, `Invalid request: unknown variant \`${method}\`, expected one of ${KNOWN_METHODS.map((name) => `\`${name}\``).join(', ')}`)
  }
}

/**
 * @param {string | number} id
 * @param {unknown} result
 */
function reply(id, result) {
  write({ id, result })
}

/**
 * @param {string | number} id
 * @param {number} code
 * @param {string} message
 */
function fail(id, code, message) {
  write({ error: { code, message }, id })
}

/**
 * @param {string} method
 * @param {unknown} params
 */
function notify(method, params) {
  write({ method, params, emittedAtMs: Date.now() })
}

/** @param {unknown} message */
function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

// ---- the login

/**
 * @typedef {{ type: 'chatgpt', email: string | null, planType: string } | { type: 'apiKey' }} Account
 * @typedef {{ account: Account, accountId: string | null }} Login
 */

/**
 * Who `$CODEX_HOME/auth.json` is signed in as. The real file keeps the email and the plan
 * inside the `id_token` JWT, under `email` and `https://api.openai.com/auth`. Null when there
 * is no file, or it names no login.
 * @returns {Login | null}
 */
function readLogin() {
  let auth
  try {
    auth = JSON.parse(readFileSync(join(codexHome, 'auth.json'), 'utf8'))
  } catch {
    return null
  }
  if (!isObject(auth)) return null
  const tokens = isObject(auth.tokens) ? auth.tokens : null
  if (tokens && typeof tokens.id_token === 'string') {
    const claims = jwtClaims(tokens.id_token)
    const openai = isObject(claims['https://api.openai.com/auth']) ? claims['https://api.openai.com/auth'] : {}
    const profile = isObject(claims['https://api.openai.com/profile']) ? claims['https://api.openai.com/profile'] : {}
    const email = typeof claims.email === 'string' ? claims.email : typeof profile.email === 'string' ? profile.email : null
    const planType = typeof openai.chatgpt_plan_type === 'string' ? openai.chatgpt_plan_type : 'unknown'
    const accountId =
      typeof tokens.account_id === 'string' ? tokens.account_id
        : typeof openai.chatgpt_account_id === 'string' ? openai.chatgpt_account_id
          : null
    return { account: { type: 'chatgpt', email, planType }, accountId }
  }
  if (typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0) {
    return { account: { type: 'apiKey' }, accountId: null }
  }
  return null
}

/**
 * The payload of a JWT, without checking its signature. An empty object when it is not one.
 * @param {string} token
 * @returns {Record<string, unknown>}
 */
function jwtClaims(token) {
  const payload = token.split('.')[1]
  if (payload === undefined) return {}
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return isObject(claims) ? claims : {}
  } catch {
    return {}
  }
}

// ---- rate limits

/**
 * @typedef {{ usedPercent?: number, windowDurationMins?: number | null, resetsAt?: number | null, resetsInSeconds?: number }} WindowSetting
 * @typedef {{ limitName?: string | null, primary?: WindowSetting | null, secondary?: WindowSetting | null }} BucketSetting
 * @typedef {{
 *   startupFailure?: { exitCode?: number, stderr?: string },
 *   delayMs?: number,
 *   rateLimitsDelayMs?: number,
 *   rateLimitsHang?: boolean,
 *   rateLimitsError?: true | { code?: number, message?: string },
 *   primary?: WindowSetting | null,
 *   secondary?: WindowSetting | null,
 *   credits?: { hasCredits: boolean, unlimited: boolean, balance: string | null } | null,
 *   planType?: string | null,
 *   accountId?: string | null,
 *   rateLimitReachedType?: string | null,
 *   ordinaryUsageAllowed?: boolean | null,
 *   buckets?: Record<string, BucketSetting> | null,
 *   resetCredits?: number | { availableCount: number, credits: unknown[] | null } | null
 * }} Scenario
 */

/**
 * The answer to `account/rateLimits/read`, in the shape of 0.163.0's
 * `GetAccountRateLimitsResponse`. `resetsAt` is in unix seconds, as on the real server.
 * @param {Scenario} scenario
 * @param {Login} login
 */
function rateLimitsAnswer(scenario, login) {
  const now = Math.floor(Date.now() / 1000)
  const planType = scenario.planType !== undefined ? scenario.planType : login.account.type === 'chatgpt' ? login.account.planType : null
  /**
   * @param {string} limitId
   * @param {string | null} limitName
   * @param {WindowSetting | null | undefined} primary
   * @param {WindowSetting | null | undefined} secondary
   * @param {unknown} credits
   */
  const snapshot = (limitId, limitName, primary, secondary, credits) => ({
    limitId,
    limitName,
    normalModelSlug: null,
    primary: windowOf(primary, 300, now),
    secondary: windowOf(secondary, 10080, now),
    credits,
    individualLimit: null,
    spendControlReached: false,
    planType,
    // The real server has been seen to send null here even at 100 % used.
    rateLimitReachedType: scenario.rateLimitReachedType ?? null
  })
  const credits = scenario.credits !== undefined ? scenario.credits : { hasCredits: false, unlimited: false, balance: '0' }
  const main = snapshot('codex', null, scenario.primary, scenario.secondary, credits)
  /** @type {Record<string, unknown> | null} */
  let byLimitId = null
  if (scenario.buckets !== null) {
    byLimitId = { codex: main }
    for (const [limitId, bucket] of Object.entries(scenario.buckets ?? {})) {
      byLimitId[limitId] = snapshot(limitId, bucket.limitName ?? null, bucket.primary, bucket.secondary, null)
    }
  }
  return {
    ordinaryUsageAllowed: scenario.ordinaryUsageAllowed !== undefined ? scenario.ordinaryUsageAllowed : true,
    rateLimits: main,
    rateLimitsByLimitId: byLimitId,
    rateLimitResetCredits: resetCreditsOf(scenario.resetCredits, now),
    accountId: scenario.accountId !== undefined ? scenario.accountId : login.accountId,
    rateLimitUpsell: null
  }
}

/**
 * A window from its setting. `null` means the bucket has no such window. A missing field
 * takes its default: 0 % used, the given length, and a reset one full window from now.
 * `resetsInSeconds` is a fake-only shorthand for `resetsAt = now + resetsInSeconds`.
 * @param {WindowSetting | null | undefined} setting
 * @param {number} defaultMins
 * @param {number} now unix seconds
 */
function windowOf(setting, defaultMins, now) {
  if (setting === null) return null
  const given = setting ?? {}
  const windowDurationMins = given.windowDurationMins !== undefined ? given.windowDurationMins : defaultMins
  const resetsAt =
    given.resetsAt !== undefined ? given.resetsAt
      : given.resetsInSeconds !== undefined ? now + given.resetsInSeconds
        : now + (windowDurationMins ?? defaultMins) * 60
  return { usedPercent: given.usedPercent ?? 0, windowDurationMins, resetsAt }
}

/**
 * `rateLimitResetCredits`. A number is a shorthand for that many available credits.
 * @param {Scenario['resetCredits']} setting
 * @param {number} now unix seconds
 */
function resetCreditsOf(setting, now) {
  if (setting === undefined) return { availableCount: 0, credits: [] }
  if (setting === null || typeof setting !== 'number') return setting
  const credits = []
  for (let i = 1; i <= setting; i++) {
    credits.push({
      id: `fake-reset-credit-${String(i)}`,
      resetType: 'codexRateLimits',
      status: 'available',
      grantedAt: now - 86400,
      expiresAt: null,
      title: null,
      description: null
    })
  }
  return { availableCount: setting, credits }
}

// ---- settings

/**
 * The scenario: `$CODEX_HOME/fake-codex-scenario.json` when it exists, otherwise the file
 * FAKE_CODEX_SCENARIO names, otherwise none. Read again for every request, so a test can
 * change it while the process runs. Throws when the file is there but is not a JSON object.
 * @returns {Scenario}
 */
function loadScenario() {
  const ownFile = join(codexHome, SCENARIO_FILE_NAME)
  const path = existsSync(ownFile) ? ownFile : process.env.FAKE_CODEX_SCENARIO || ''
  if (path.length === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`could not read the scenario file ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (!isObject(parsed)) throw new Error(`the scenario file ${path} does not hold a JSON object`)
  return /** @type {Scenario} */ (parsed)
}

/**
 * Appends one line to the FAKE_CODEX_RECORD file. Every line carries the pid, so the lines of
 * several processes sharing one file can be told apart.
 * @param {Record<string, unknown>} entry
 */
function record(entry) {
  if (recordPath.length === 0) return
  appendFileSync(recordPath, `${JSON.stringify({ pid: process.pid, ...entry })}\n`)
}

// ---- small helpers

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The real server answers `codexHome` with symlinks resolved, e.g. `/private/tmp/...` on macOS.
 * @param {string} path
 */
function canonicalPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function platformInfo() {
  const cpu = arch() === 'x64' ? 'x86_64' : arch()
  if (process.platform === 'win32') return { label: 'Windows', arch: cpu, family: 'windows', os: 'windows' }
  if (process.platform === 'darwin') return { label: 'Mac OS', arch: cpu, family: 'unix', os: 'macos' }
  return { label: 'Linux', arch: cpu, family: 'unix', os: process.platform }
}
