// What a usage probe (`claude-probe.ts`) is given and answers, and the helpers it uses to turn
// the end of its CLI into an answer.
//
// `error` in a failed answer is shown by `kurmis status` and stored in `state.json`, so it is
// always one of the fixed sentences written in these files. Nothing the CLI printed, no token
// and no email ever goes into it; an exit code or a number of seconds may.
import type { AccountUsage } from '../core/claude-usage.ts'
import type { LogReason } from '../data/log.ts'
import type { FrameProcessExit } from '../platform/frame-process.ts'

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

export type ProbeResult =
  | {
      ok: true
      signedIn: boolean
      usage: AccountUsage
    }
  | { ok: false; signedIn: boolean | null; reason: LogReason; error: string }

export type ProbeFailure = Extract<ProbeResult, { ok: false }>

/**
 * How long a probe waits, after it has its answer and has closed the CLI's input, for the CLI to
 * exit before killing it. The CLI exits within a fraction of a second once its input ends.
 * Waiting matters because the CLI may just have renewed the token: the daemon reads the
 * credentials again after the probe and must find the new ones on disk.
 */
export const PROBE_CLOSE_GRACE_MS = 5_000

/**
 * The error of a probe whose CLI is not found. The daemon looks the program up on the PATH it
 * was started with, which is the PATH of the shell or login item that started it, so a CLI
 * installed or put on PATH since is found only after a restart from a shell that has it.
 */
export function programMissingText(): string {
  return 'The claude program was not found on the PATH the kurmis daemon was started with. Install Claude Code, ' +
    'or put claude on PATH, and run "kurmis daemon restart" from a shell that finds it; or set KURMIS_CLAUDE_BIN to the program.'
}

export function probeFailure(signedIn: boolean | null, reason: LogReason, error: string): ProbeFailure {
  return { ok: false, signedIn, reason, error }
}

/** The answer for a probe stopped by its AbortSignal: the daemon is shutting down. */
export function abortedProbe(signedIn: boolean | null): ProbeFailure {
  return probeFailure(signedIn, 'shutdown', 'The usage probe was stopped because the daemon is shutting down.')
}

/** Seconds for a sentence: `30`, or `2.5` for a timeout that is not whole seconds. */
function seconds(ms: number): string {
  return String(Math.round(ms / 100) / 10)
}

/** The answer for a claude CLI that ended before the probe had what it asked for. */
export function failureForExit(
  exit: FrameProcessExit,
  timeoutMs: number,
  signedIn: boolean | null
): ProbeFailure {
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

/** What a probe got for one request: the CLI's reply, or the end of the CLI before it replied. */
export type ReplyOrExit<T> = { kind: 'reply'; value: T } | { kind: 'ended'; exit: FrameProcessExit }

/** Waits for `reply`, or for the CLI to end first. */
export function replyOrExit<T>(reply: Promise<T>, exited: Promise<FrameProcessExit>): Promise<ReplyOrExit<T>> {
  return Promise.race([
    reply.then((value): ReplyOrExit<T> => ({ kind: 'reply', value })),
    exited.then((exit): ReplyOrExit<T> => ({ kind: 'ended', exit }))
  ])
}

/** Replies the CLI sends, matched to the request they answer by its id. */
export class PendingReplies<T> {
  private readonly waiting = new Map<string, (value: T) => void>()

  /** A promise for the reply to request `id`. Ask for it before the request is sent. */
  wait(id: string): Promise<T> {
    return new Promise((resolve) => { this.waiting.set(id, resolve) })
  }

  /** Hands a reply to whoever waits for it. A reply nobody waits for is dropped. */
  settle(id: string, value: T): void {
    const resolve = this.waiting.get(id)
    if (resolve === undefined) return
    this.waiting.delete(id)
    resolve(value)
  }
}
