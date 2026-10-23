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
import type { AccountUsage } from '../core/claude-usage.ts'
import { applyEnvPatch } from '../core/routed-env.ts'
import { usageFromGetUsage } from '../core/usage.ts'
import { claudeProbeEnv } from '../data/login-env.ts'
import type { LoginRef } from '../data/login-id.ts'
import { ownClaudeProbeFolder, probeWorkFolder } from '../data/paths.ts'
import { makePrivateDirSync } from '../platform/files.ts'
import { startFrameProcess, type FrameProcessExit } from '../platform/frame-process.ts'
import { findProgramForLaunch, ProgramNotFoundError, type ResolvedProgram } from '../platform/programs.ts'
import type { LogReason } from '../data/log.ts'

export interface ProbeOptions {
  /** The daemon's environment. The login's environment changes are applied to a copy of it. */
  env: NodeJS.ProcessEnv
  now?: () => number
  /** How long the whole probe may take, from the start of the CLI to its exit. */
  timeoutMs?: number
  /** Aborting kills the CLI; the daemon's `close()` aborts the probes that are running. */
  signal?: AbortSignal
  /** The login's last snapshot, which `usageFromGetUsage` weighs the probe's answer against. */
  previous?: AccountUsage | null
}

/**
 * What a probe answers. `error` in a failed answer is shown by `kurmis status` and stored in
 * `state.json`, so it is always one of the fixed sentences written in this file. Nothing the CLI
 * printed, no token and no email ever goes into it; an exit code or a number of seconds may.
 */
export type ProbeResult =
  | {
      ok: true
      signedIn: boolean
      usage: AccountUsage
    }
  | { ok: false; signedIn: boolean | null; reason: LogReason; error: string }

type ProbeFailure = Extract<ProbeResult, { ok: false }>

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
 * How long a probe waits, after it has its answer and has closed the CLI's input, for the CLI to
 * exit before killing it. The CLI exits within a fraction of a second once its input ends.
 * Waiting matters because the CLI may just have renewed the token: the daemon reads the
 * credentials again after the probe and must find the new ones on disk.
 */
const PROBE_CLOSE_GRACE_MS = 5_000

/**
 * Set on every probe, so a claude the daemon starts every 15 minutes does not update itself in
 * the background. Updating is left to the claude the person starts.
 */
const PROBE_SETTINGS = { DISABLE_AUTOUPDATER: '1' }

type ControlReply = { ok: true; response: unknown } | { ok: false }

/** What a probe got for one request: the CLI's reply, or the end of the CLI before it replied. */
type ReplyOrExit = { kind: 'reply'; value: ControlReply } | { kind: 'ended'; exit: FrameProcessExit }

/** Asks one Claude login for its plan usage. Never rejects. */
export async function probeClaudeUsage(login: LoginRef, options: ProbeOptions): Promise<ProbeResult> {
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? CLAUDE_PROBE_TIMEOUT_MS
  if (options.signal?.aborted === true) return abortedProbe(null)

  let program: ResolvedProgram
  try {
    program = await findProgramForLaunch({ env: options.env, signal: options.signal })
  } catch (error) {
    if (error instanceof ProgramNotFoundError) {
      return probeFailure(null, 'missing', programMissingText())
    }
    return probeFailure(null, 'other', 'The claude program could not be looked up.')
  }

  const env = applyEnvPatch(options.env, { ...claudeProbeEnv(login), ...PROBE_SETTINGS })
  const cwd = probeWorkFolder()
  try {
    makePrivateDirSync(cwd)
    if (login.usedByPlainClaude) makePrivateDirSync(ownClaudeProbeFolder())
  } catch {
    return probeFailure(null, 'other', 'The usage probe could not create its folder in the kurmis data folder.')
  }

  // The probe sends one request at a time and waits for its reply. A reply to any other request
  // id is dropped.
  let waiting: { id: string; resolve: (reply: ControlReply) => void } | null = null
  const claude = startFrameProcess(program.command, [...program.args, ...CLAUDE_PROBE_ARGS], {
    env,
    cwd,
    timeoutMs,
    signal: options.signal,
    onFrame: (frame) => {
      const reply = controlReply(frame)
      const pending = waiting
      if (reply === null || pending === null || reply.id !== pending.id) return
      waiting = null
      pending.resolve(reply.reply)
    }
  })
  const ask = (requestId: string, request: Record<string, unknown>): Promise<ReplyOrExit> => {
    const reply = new Promise<ControlReply>((resolve) => { waiting = { id: requestId, resolve } })
    claude.send({ type: 'control_request', request_id: requestId, request })
    return Promise.race([
      reply.then((value): ReplyOrExit => ({ kind: 'reply', value })),
      claude.exited.then((exit): ReplyOrExit => ({ kind: 'ended', exit }))
    ])
  }

  const result = await converse(ask, login.id, timeoutMs, now, options.previous ?? null)
  // Wait for the exit in every case, so a renewed token is on disk and no CLI outlives the probe.
  const exit = await claude.close(PROBE_CLOSE_GRACE_MS)
  // The signal fired after the answer: the answer still stands.
  if (!result.ok && exit.end === 'aborted') return abortedProbe(result.signedIn)
  return result
}

async function converse(
  ask: (requestId: string, request: Record<string, unknown>) => Promise<ReplyOrExit>,
  id: string,
  timeoutMs: number,
  now: () => number,
  previous: AccountUsage | null
): Promise<ProbeResult> {
  const init = await ask('kurmis_1', { subtype: 'initialize' })
  if (init.kind === 'ended') return failureForExit(init.exit, timeoutMs, null)
  if (!init.value.ok) return probeFailure(null, 'upstream_error', 'claude answered the start of the usage probe with an error.')
  const planAtStart = initializePlan(init.value.response)

  const usage = await ask('kurmis_2', { subtype: 'get_usage', skip_behaviors: true })
  if (usage.kind === 'ended') return failureForExit(usage.exit, timeoutMs, planAtStart)
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

/**
 * The error of a probe whose CLI is not found. The daemon looks the program up on the PATH it
 * was started with, which is the PATH of the shell or login item that started it, so a CLI
 * installed or put on PATH since is found only after a restart from a shell that has it.
 */
function programMissingText(): string {
  return 'The claude program was not found on the PATH the kurmis daemon was started with. Install Claude Code, ' +
    'or put claude on PATH, and run "kurmis daemon restart" from a shell that finds it; or set KURMIS_CLAUDE_BIN to the program.'
}

function probeFailure(signedIn: boolean | null, reason: LogReason, error: string): ProbeFailure {
  return { ok: false, signedIn, reason, error }
}

/** The answer for a probe stopped by its AbortSignal: the daemon is shutting down. */
function abortedProbe(signedIn: boolean | null): ProbeFailure {
  return probeFailure(signedIn, 'shutdown', 'The usage probe was stopped because the daemon is shutting down.')
}

/** Seconds for a sentence: `30`, or `2.5` for a timeout that is not whole seconds. */
function seconds(ms: number): string {
  return String(Math.round(ms / 100) / 10)
}

/** The answer for a claude CLI that ended before the probe had what it asked for. */
function failureForExit(exit: FrameProcessExit, timeoutMs: number, signedIn: boolean | null): ProbeFailure {
  switch (exit.end) {
    case 'aborted':
      return abortedProbe(signedIn)
    case 'timeout':
      return probeFailure(signedIn, 'timeout', `The usage probe timed out after ${seconds(timeoutMs)} s.`)
    case 'output_too_large':
      return probeFailure(signedIn, 'invalid', 'claude printed more output than the usage probe accepts.')
    case 'refused':
      return probeFailure(signedIn, 'invalid', 'claude is a batch file, which kurmis never starts.')
    case 'start_failed':
      return probeFailure(signedIn, 'missing', exit.errorCode === null
        ? 'claude could not be started.'
        : `claude could not be started (${safeCode(exit.errorCode)}).`)
    case 'close_timeout':
    case 'exited':
      if (exit.code !== null) {
        return probeFailure(signedIn, 'exited', `claude exited with code ${String(exit.code)} before it answered.`)
      }
      return probeFailure(signedIn, 'exited', exit.signal === null
        ? 'claude ended before it answered.'
        : `claude was ended by ${exit.signal} before it answered.`)
  }
}

/** Node's error codes are short upper-case words; anything else is not put in a sentence. */
function safeCode(code: string): string {
  return /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'unknown error'
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
