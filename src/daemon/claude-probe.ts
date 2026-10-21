// The usage probe of a Claude login: a short-lived `claude` in stream-json mode that answers
// one `get_usage` control request.
//
// The CLI answers `get_usage` before any user message and makes no model call, so a probe costs
// the CLI's start (about a second) and one request to Anthropic's usage endpoint. Before that
// request the CLI renews a token that expires within five minutes, when a refresh token is
// stored, and writes the new one back where it keeps it. That is how the daemon renews tokens:
// it runs a probe and then reads the credentials again. So the probe closes the CLI's input and
// waits for it to exit before it answers.
//
// The wire, one JSON value per line each way:
//
//   -> {"type":"control_request","request_id":"kurmis_1","request":{"subtype":"initialize"}}
//   <- {"type":"control_response","response":{"subtype":"success","request_id":"kurmis_1",
//        "response":{..., "account":{"email":…,"subscriptionType":"Claude Max",…}}}}
//   -> {"type":"control_request","request_id":"kurmis_2",
//        "request":{"subtype":"get_usage","skip_behaviors":true}}
//   <- {"type":"control_response","response":{"subtype":"success","request_id":"kurmis_2",
//        "response":{"subscription_type":"max","rate_limits_available":true,"rate_limits":{…}}}}
//
// A failed request is answered with `"subtype":"error"` and an `error` text, which is never
// shown or stored, because it is the CLI's own words.
//
// **Whether the login is signed in** is read from the answers, with no second process. In the
// CLI (2.1.301, read from its bundled source) `rate_limits_available` is true when the stored
// login is an OAuth subscription login with the `user:profile` scope, and `subscription_type` is
// the plan of a subscription login. `initialize`'s `account.subscriptionType` is present for any
// subscription login and absent when none is stored. So: signed in when `get_usage` says
// `rate_limits_available` or names a plan; when `get_usage` never answered, when
// `initialize` named a plan.
//
// **What it reads.** `CLAUDE_CONFIG_DIR` is always a folder with no transcripts
// (`claudeProbeEnv`), which keeps the answer fast and stops the probe writing into
// `~/.claude.json`. `--setting-sources=` (an empty list) leaves the user, project and local
// settings files out, so an `env` block there (for example `ANTHROPIC_BASE_URL` pointing at this
// daemon) cannot reach the probe, and no hook of the user's runs. `--strict-mcp-config` with an
// empty `--mcp-config` starts no MCP server. `--no-session-persistence` writes no transcript.
// `skip_behaviors` leaves out the walk over the last week's transcripts that fills the answer's
// `behaviors` block, which kurmis does not read; a CLI older than 2.1.272 ignores it.
import { CLAUDE_DEFAULT_ACCOUNT_ID } from '../core/accounts.ts'
import type { AccountUsage } from '../core/claude-usage.ts'
import { usageFromGetUsage } from '../core/usage.ts'
import { applyEnvPatch, claudeProbeEnv } from '../data/login-env.ts'
import { claudeDefaultProbeFolder, probeWorkFolder } from '../data/paths.ts'
import { makePrivateDirSync } from '../platform/files.ts'
import { startFrameProcess, type FrameProcess } from '../platform/frame-process.ts'
import { findProgram, ProgramNotFoundError, type ResolvedProgram } from '../platform/programs.ts'
import {
  abortedProbe,
  failureForExit,
  PendingReplies,
  PROBE_CLOSE_GRACE_MS,
  probeFailure,
  programMissingText,
  replyOrExit,
  type ProbeOptions,
  type ProbeResult,
  type ReplyOrExit
} from './probe-result.ts'

export type { ProbeOptions, ProbeResult } from './probe-result.ts'

/**
 * How long a Claude probe may take in all, from the start of the CLI to its exit. A probe
 * normally takes one to two seconds: about a second to start and a few hundred milliseconds for
 * the usage request. The rest is room for a slow start (a cold disk, a virus scanner looking at
 * `claude.exe` on Windows) and for a token renewal, which is one more request to Anthropic
 * before the usage request.
 */
export const CLAUDE_PROBE_TIMEOUT_MS = 30_000

/** The arguments the probe starts `claude` with, after the ones `findProgram` gives. */
export const CLAUDE_PROBE_ARGS: readonly string[] = [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  // The CLI refuses stream-json output without it.
  '--verbose',
  '--setting-sources=',
  '--strict-mcp-config',
  '--mcp-config', '{"mcpServers":{}}',
  '--no-session-persistence'
]

/**
 * Variables removed from the probe's environment on top of `claudeProbeEnv`'s. Either one makes
 * the CLI use the token it holds instead of the login's stored one, so the probe would report
 * someone else's usage.
 */
const TOKEN_VARIABLES = { CLAUDE_CODE_OAUTH_TOKEN: undefined, CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: undefined }

/**
 * Set on every probe, so a CLI the daemon starts every 15 minutes does not update itself in the
 * background. Updating is left to the CLIs the person starts.
 */
const PROBE_SETTINGS = { DISABLE_AUTOUPDATER: '1' }

type ControlReply = { ok: true; response: unknown } | { ok: false }

/** Asks one Claude login for its plan usage. Never rejects. */
export async function probeClaudeUsage(id: string, options: ProbeOptions): Promise<ProbeResult> {
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? CLAUDE_PROBE_TIMEOUT_MS
  if (options.signal?.aborted === true) return abortedProbe(null)

  let program: ResolvedProgram
  try {
    program = findProgram('claude', { env: options.env })
  } catch (error) {
    if (error instanceof ProgramNotFoundError) {
      return probeFailure(null, 'missing', programMissingText('claude'))
    }
    return probeFailure(null, 'other', 'The claude program could not be looked up.')
  }

  const env = applyEnvPatch(options.env, { ...claudeProbeEnv(id), ...TOKEN_VARIABLES, ...PROBE_SETTINGS })
  const cwd = probeWorkFolder()
  try {
    makePrivateDirSync(cwd)
    if (id === CLAUDE_DEFAULT_ACCOUNT_ID) makePrivateDirSync(claudeDefaultProbeFolder())
  } catch {
    return probeFailure(null, 'other', 'The usage probe could not create its folder in the kurmis data folder.')
  }

  const replies = new PendingReplies<ControlReply>()
  const claude = startFrameProcess(program.command, [...program.args, ...CLAUDE_PROBE_ARGS], {
    env,
    cwd,
    timeoutMs,
    signal: options.signal,
    onFrame: (frame) => {
      const reply = controlReply(frame)
      if (reply !== null) replies.settle(reply.id, reply.reply)
    }
  })

  const result = await converse(claude, replies, id, timeoutMs, now, options.previous ?? null)
  // Wait for the exit in every case, so a renewed token is on disk and no CLI outlives the probe.
  const exit = await claude.close(PROBE_CLOSE_GRACE_MS)
  // The signal fired after the answer: the answer still stands.
  if (!result.ok && exit.end === 'aborted') return abortedProbe(result.signedIn)
  return result
}

async function converse(
  claude: FrameProcess,
  replies: PendingReplies<ControlReply>,
  id: string,
  timeoutMs: number,
  now: () => number,
  previous: AccountUsage | null
): Promise<ProbeResult> {
  const ask = (requestId: string, request: Record<string, unknown>): Promise<ReplyOrExit<ControlReply>> => {
    const reply = replies.wait(requestId)
    claude.send({ type: 'control_request', request_id: requestId, request })
    return replyOrExit(reply, claude.exited)
  }

  const init = await ask('kurmis_1', { subtype: 'initialize' })
  if (init.kind === 'ended') return failureForExit('claude', init.exit, timeoutMs, null)
  if (!init.value.ok) return probeFailure(null, 'upstream_error', 'claude answered the start of the usage probe with an error.')
  const planAtStart = initializePlan(init.value.response)

  const usage = await ask('kurmis_2', { subtype: 'get_usage', skip_behaviors: true })
  if (usage.kind === 'ended') return failureForExit('claude', usage.exit, timeoutMs, planAtStart)
  if (!usage.value.ok) return probeFailure(planAtStart, 'upstream_error', 'Claude answered the usage request with an error.')

  const answer = usage.value.response
  if (!isRecord(answer)) return probeFailure(planAtStart, 'invalid', "Claude's answer to the usage request could not be read.")
  const available = answer.rate_limits_available === true
  const signedIn = available || (typeof answer.subscription_type === 'string' && answer.subscription_type !== '')
  // A login that may read its rate limits but got none: the CLI's request to the usage endpoint
  // failed (it answers `rate_limits: null` then, whatever the reason).
  if (available && !isRecord(answer.rate_limits)) {
    return probeFailure(true, 'upstream_error', 'Claude could not fetch the plan usage from Anthropic.')
  }
  return { ok: true, signedIn, usage: usageFromGetUsage(id, answer, now(), previous) }
}

/**
 * Whether `initialize`'s `account` names a subscription. The CLI fills `subscriptionType` for
 * every subscription login ("Claude Max", "Claude Pro", "Claude API" for one whose plan it does
 * not know) and leaves it out when no login is stored. Null when the answer has no `account`.
 */
function initializePlan(response: unknown): boolean | null {
  if (!isRecord(response) || !isRecord(response.account)) return null
  const plan = response.account.subscriptionType
  return typeof plan === 'string' && plan !== ''
}

/** The request id and outcome of a `control_response` frame, or null for any other frame. */
function controlReply(frame: unknown): { id: string; reply: ControlReply } | null {
  if (!isRecord(frame) || frame.type !== 'control_response' || !isRecord(frame.response)) return null
  const response = frame.response
  if (typeof response.request_id !== 'string') return null
  if (response.subtype === 'success') return { id: response.request_id, reply: { ok: true, response: response.response } }
  return { id: response.request_id, reply: { ok: false } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
