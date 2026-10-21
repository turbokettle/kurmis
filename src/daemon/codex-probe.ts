// The usage probe of a Codex login: a short-lived `codex app-server` on the login's
// `CODEX_HOME`, asked who it is signed in as and how much of its plan is used.
//
// The wire is JSON-RPC without the `jsonrpc` field, one JSON value per line each way
// (`test/fakes/codex/fake-codex.js` copies it from codex 0.163.0):
//
//   -> {"id":1,"method":"initialize","params":{"clientInfo":{…},"capabilities":{…}}}
//   <- {"id":1,"result":{"userAgent":…,"codexHome":…,…}}
//   -> {"method":"initialized"}
//   -> {"id":2,"method":"account/read","params":{}}
//   <- {"id":2,"result":{"account":{"type":"chatgpt","email":…,"planType":"plus"},…}}
//   -> {"id":3,"method":"account/rateLimits/read"}
//   <- {"id":3,"result":{"rateLimits":{…},"rateLimitsByLimitId":{…},…}}
//
// An error is `{"id":…,"error":{"code":…,"message":…}}`; its message is the server's own words
// and is never shown or stored. Notifications (`{"method":…,"params":…}`, such as
// `remoteControl/status/changed`, which may arrive at any point) are ignored.
//
// `account/rateLimits/read` is asked only of a ChatGPT sign-in: on a signed-out home or an API
// key the server refuses it, and neither is a subscription kurmis can choose between. The
// app-server exits as soon as its input ends, without answering what is still open, so the
// probe closes the input only once it has every answer.
import type { AccountUsage } from '../core/claude-usage.ts'
import { codexLoginStatus, parseCodexAccountRead } from '../core/codex-account.ts'
import { codexUsageFromResult, emptyCodexUsage } from '../core/codex-usage.ts'
import { applyEnvPatch, codexLoginEnv } from '../data/login-env.ts'
import { probeWorkFolder } from '../data/paths.ts'
import { makePrivateDirSync } from '../platform/files.ts'
import { startFrameProcess, type FrameProcess } from '../platform/frame-process.ts'
import { findProgram, ProgramNotFoundError, type ResolvedProgram } from '../platform/programs.ts'
import { kurmisVersion } from '../version.ts'
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
 * How long a Codex probe may take in all, from the start of `codex app-server` to its exit. The
 * server starts in well under a second; `account/read` reads `auth.json` and may renew the
 * login's token, and `account/rateLimits/read` is one request to OpenAI. Thirty seconds leaves
 * room for a slow start and a slow network, and matches the Claude probe.
 */
export const CODEX_PROBE_TIMEOUT_MS = 30_000

/** The arguments the probe starts `codex` with, after the ones `findProgram` gives. */
export const CODEX_PROBE_ARGS: readonly string[] = ['app-server']

type RpcReply = { ok: true; result: unknown } | { ok: false }

/** Asks one Codex login who it is signed in as and for its plan usage. Never rejects. */
export async function probeCodexUsage(id: string, options: ProbeOptions): Promise<ProbeResult> {
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? CODEX_PROBE_TIMEOUT_MS
  if (options.signal?.aborted === true) return abortedProbe(null)

  let program: ResolvedProgram
  try {
    program = findProgram('codex', { env: options.env })
  } catch (error) {
    if (error instanceof ProgramNotFoundError) {
      return probeFailure(null, 'missing', programMissingText('codex'))
    }
    return probeFailure(null, 'other', 'The codex program could not be looked up.')
  }

  const env = applyEnvPatch(options.env, codexLoginEnv(id, options.env))
  const cwd = probeWorkFolder()
  try {
    makePrivateDirSync(cwd)
  } catch {
    return probeFailure(null, 'other', 'The usage probe could not create its folder in the kurmis data folder.')
  }

  const replies = new PendingReplies<RpcReply>()
  const codex = startFrameProcess(program.command, [...program.args, ...CODEX_PROBE_ARGS], {
    env,
    cwd,
    timeoutMs,
    signal: options.signal,
    onFrame: (frame) => {
      const reply = rpcReply(frame)
      if (reply !== null) replies.settle(reply.id, reply.reply)
    }
  })

  const result = await converse(codex, replies, id, timeoutMs, now)
  const exit = await codex.close(PROBE_CLOSE_GRACE_MS)
  // The signal fired after the answers: they still stand.
  if (!result.ok && exit.end === 'aborted') return abortedProbe(result.signedIn)
  return result
}

async function converse(
  codex: FrameProcess,
  replies: PendingReplies<RpcReply>,
  id: string,
  timeoutMs: number,
  now: () => number
): Promise<ProbeResult> {
  let nextId = 1
  const ask = (method: string, params?: unknown): Promise<ReplyOrExit<RpcReply>> => {
    const requestId = nextId++
    const reply = replies.wait(String(requestId))
    codex.send(params === undefined ? { id: requestId, method } : { id: requestId, method, params })
    return replyOrExit(reply, codex.exited)
  }

  const init = await ask('initialize', {
    clientInfo: { name: 'kurmis', title: 'kurmis', version: kurmisVersion },
    capabilities: { experimentalApi: true }
  })
  if (init.kind === 'ended') return failureForExit('codex', init.exit, timeoutMs, null)
  if (!init.value.ok) return probeFailure(null, 'upstream_error', 'codex app-server refused the start of the usage probe.')
  codex.send({ method: 'initialized' })

  // `account/read` needs a params object, even an empty one.
  const account = await ask('account/read', {})
  if (account.kind === 'ended') return failureForExit('codex', account.exit, timeoutMs, null)
  if (!account.value.ok) return probeFailure(null, 'upstream_error', 'codex app-server answered the sign-in question with an error.')
  const read = parseCodexAccountRead(account.value.result)
  if (read === null) return probeFailure(null, 'invalid', "codex app-server's answer about the sign-in could not be read.")
  const status = codexLoginStatus(read)
  if (!status.loggedIn) {
    return { ok: true, signedIn: false, usage: { ...emptyCodexUsage(id, now()), subscriptionType: status.subscriptionType } }
  }

  const limits = await ask('account/rateLimits/read')
  if (limits.kind === 'ended') return failureForExit('codex', limits.exit, timeoutMs, true)
  if (!limits.value.ok) return probeFailure(true, 'upstream_error', 'Codex could not read the plan usage from OpenAI.')
  const usage = codexUsageFromResult(id, limits.value.result, now())
  if (usage === null) return probeFailure(true, 'invalid', "codex app-server's answer about the plan usage could not be read.")
  return { ok: true, signedIn: true, usage: withPlan(usage, status.subscriptionType) }
}

/** The plan from `account/read` when the rate-limit answer named none. */
function withPlan(usage: AccountUsage, plan: string | null): AccountUsage {
  return usage.subscriptionType === null && plan !== null ? { ...usage, subscriptionType: plan } : usage
}

/** The id and outcome of a reply frame, or null for a notification or anything else. */
function rpcReply(frame: unknown): { id: string; reply: RpcReply } | null {
  if (!isRecord(frame) || !('id' in frame) || 'method' in frame) return null
  const id = frame.id
  if (typeof id !== 'number' && typeof id !== 'string') return null
  if ('result' in frame) return { id: String(id), reply: { ok: true, result: frame.result } }
  return { id: String(id), reply: { ok: false } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
