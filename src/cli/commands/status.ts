// `kurmis status [--json]`: every login with its settings and usage, whether the daemon runs, and
// whether global routing is on. It never starts the daemon, and exits 0 whether or not one runs.
// When the daemon runs, the logins come from its status answer. When none runs, or its status
// request fails, or this kurmis cannot read its answer, they come from `config.json`, with the
// usage the daemon last wrote to `state.json` and whether each login's credentials are on this
// machine (`checkCredentials`).
//
// Status reads `config.json` with `loadConfig`, as the other commands do, so when the file has no
// entry for the login plain claude or plain codex uses (or there is no file), it adds one with a
// new id and saves the file. It writes no other file.
import { homedir } from 'node:os'
import { CONTROL_API_VERSION, type StatusAnswer } from '../../core/control-api.ts'
import { ConfigError, loadConfig, type KurmisConfig } from '../../data/config.ts'
import { readClaudeIdentity } from '../../data/identity.ts'
import { loadState } from '../../data/state.ts'
import type { findProgram } from '../../platform/programs.ts'
import { runProgram } from '../../platform/run.ts'
import { kurmisVersion } from '../../version.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, realFindProgram, settleWithin, type DaemonClient } from '../command-deps.ts'
import type { DaemonConnection } from '../daemon-client.ts'
import { globalRoutingState, type GlobalRoutingState } from '../global-routing.ts'
import { checkCredentials } from '../local-credentials.ts'
import { daemonOf, daemonReport, formatStatus, statusJson, type ReportLogin, type StatusReport } from '../status-format.ts'

/**
 * How long `kurmis status` waits for the first usage probe of a daemon that has read no usage
 * yet. Claude probes start one short-lived `claude` per login, and they run side by side.
 */
export const STATUS_PROBE_WAIT_MS = 15_000

export interface StatusDeps {
  daemon: DaemonClient
  now: () => number
  platform: NodeJS.Platform
  probeWaitMs: number
  /** The user's home folder, where `~/.claude`, `~/.claude.json` and `~/.codex` are. */
  home: () => string
  /**
   * Find and run `codex login status` for a Codex login that keeps its sign-in in the keyring,
   * and `security` (macOS) or PowerShell (Windows) for a Claude login without `.credentials.json`.
   */
  findProgram: typeof findProgram
  runProgram: typeof runProgram
  globalRouting: (env: NodeJS.ProcessEnv) => GlobalRoutingState
  /** This kurmis' version, which tells whether the running daemon is older. */
  version: string
}

const USAGE = `Usage: kurmis status [--json]

Shows every login with its settings and usage, whether the daemon runs, and whether global
routing is on. It does not start the daemon, and it exits 0 either way. For example:

  kurmis daemon 0.1.0, pid 4242, port 28411, running for 2h 5m
  Global routing is off: only Claude Code started with "kurmis claude" goes
  through kurmis. "kurmis setup" turns it on.

  own-example (Claude, id k3v9q2m7xa)           <- alias, provider and id
    the login plain claude uses
    signed in, routing on, limits 100% 5 hour, 100% weekly, 2 sessions, plan max
    5 hour       42%  resets in 2h 10m      limit 100%
    7 day        63%  resets in 3d 4h       limit 100%
    usage read 3m ago

  work-example (Claude, id p8x2n4c6ve)  work@example.com
    signed in, routing on, limits 90% 5 hour, 100% weekly, use first, 1 session
    5 hour       92%  resets in 45m         limit 90%
    7 day         0%  reset since read      limit 100%
    passed over: at its limit, the 5 hour window is at 92% of 90%; it resets in
      45m                                   <- why Auto skips this login now

A warning at the top says when two logins are the same account, so they use one subscription.

While the daemon is not running, the logins come from config.json with the last usage the
daemon read, and "credentials on this machine" takes the place of "signed in": kurmis checks
that the token is there without reading it. The README describes every line.

Options:
  --json       Print the same as JSON. "daemon" is null while the daemon is not running, and
               "source" says whether the logins come from the daemon or from the files. Each
               login has "alias", "id", "provider", "usedByPlainCli" (whether plain claude
               or plain codex uses it), "signedIn" (from the daemon) and "credentials"
               (from the files: true, false or "unknown").
               "warnings" holds the warnings.
  -h, --help   Show this help.`

export function createStatusCommand(overrides: Partial<StatusDeps> = {}): Command {
  const deps: StatusDeps = {
    daemon: realDaemonClient,
    now: Date.now,
    platform: process.platform,
    probeWaitMs: STATUS_PROBE_WAIT_MS,
    home: homedir,
    findProgram: realFindProgram,
    runProgram,
    globalRouting: globalRoutingState,
    version: kurmisVersion,
    ...overrides
  }
  return {
    name: 'status',
    summary: 'Show the logins, their usage, and whether the daemon runs',
    usage: USAGE,
    run: (args, context) => runStatus(args, context, deps)
  }
}

export const statusCommand: Command = createStatusCommand()

/** Whether no login that may be signed in has any usage yet, so a first probe is worth waiting for. */
export function nothingProbedYet(status: StatusAnswer): boolean {
  const signedIn = status.logins.filter((login) => login.signedIn !== false)
  return signedIn.length > 0 && signedIn.every((login) => login.usage === null)
}

async function runStatus(args: string[], context: CliContext, deps: StatusDeps): Promise<number> {
  const parsed = parseCommandArgs('status', args, { json: { type: 'boolean' } }, context)
  if (typeof parsed === 'number') return parsed
  // Read before the daemon is looked for, so that the logins of plain claude and plain codex have
  // their ids in the file whichever way the status is shown. A config that cannot be read is
  // reported only when the logins are shown from the files.
  let config: KurmisConfig | ConfigError
  try {
    config = loadConfig()
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    config = error
  }
  const globalRouting = deps.globalRouting(context.env)
  let connection: DaemonConnection | null
  try {
    connection = await deps.daemon.findDaemon({ env: context.env })
  } catch (error) {
    writeLine(context.stderr, `kurmis status: could not look for the kurmis daemon: ${messageOf(error)}`)
    connection = null
  }
  let report: StatusReport
  if (connection === null) {
    const files = await reportFromFiles(config, null, globalRouting, context, deps)
    if (files === null) return EXIT_FAILURE
    report = files
  } else {
    let status: StatusAnswer | null
    try {
      status = await deps.daemon.readStatus(connection)
    } catch (error) {
      writeLine(context.stderr, `kurmis status: the kurmis daemon (pid ${String(connection.pid)}) did not answer the status ` +
        `request: ${messageOf(error)}`)
      writeLine(context.stderr, 'Showing the logins from config.json instead. The daemon\'s log is daemon.log in the kurmis data ' +
        'folder; "kurmis daemon restart" replaces the daemon.')
      status = null
    }
    if (status === null) {
      const files = await reportFromFiles(config, null, globalRouting, context, deps)
      if (files === null) return EXIT_FAILURE
      report = files
    } else if (status.apiVersion !== CONTROL_API_VERSION) {
      const files = await reportFromFiles(config, status, globalRouting, context, deps)
      if (files === null) return EXIT_FAILURE
      report = files
    } else {
      if (nothingProbedYet(status)) status = await firstProbe(connection, status, context, deps)
      report = daemonReport(status, globalRouting, deps.version)
    }
  }
  const now = deps.now()
  const options = { keychain: deps.platform === 'darwin' }
  if (parsed.values.json === true) {
    writeLine(context.stdout, JSON.stringify(statusJson(report, now, options), null, 2))
  } else {
    context.stdout.write(formatStatus(report, now, options))
  }
  return EXIT_OK
}

/** The daemon's status after its first usage probe, or `status` when the probe fails or takes longer than `probeWaitMs`. */
async function firstProbe(connection: DaemonConnection, status: StatusAnswer, context: CliContext, deps: StatusDeps): Promise<StatusAnswer> {
  const probed = await settleWithin((signal) => deps.daemon.requestProbe(connection, undefined, signal), deps.probeWaitMs)
  if (probed.kind === 'done') return probed.value
  writeLine(context.stderr, probed.kind === 'timeout'
    ? `kurmis status: the first usage probe did not finish within ${String(deps.probeWaitMs / 1000)} s; showing what the daemon has.`
    : `kurmis status: the usage probe failed (${messageOf(probed.error)}); showing what the daemon has.`)
  return status
}

/**
 * The report from `config.json` and `state.json`, for when no daemon runs or answers (`daemon`
 * null) or this kurmis cannot read the answer of the one that runs. Null after saying why
 * `config.json` cannot be read.
 */
async function reportFromFiles(config: KurmisConfig | ConfigError, daemon: StatusAnswer | null, globalRouting: GlobalRoutingState,
  context: CliContext, deps: StatusDeps): Promise<StatusReport | null> {
  if (config instanceof ConfigError) {
    writeLine(context.stderr, `kurmis status: ${config.message}`)
    return null
  }
  const now = deps.now()
  const state = loadState(now).state
  const home = deps.home()
  const logins: ReportLogin[] = config.logins.map((login) => {
    const cooldown = state.cooldowns.get(login.id)
    const claude = login.provider === 'claude' ? readClaudeIdentity(login, home) : null
    let sessions = 0
    for (const placement of state.sessions.values()) if (placement.login === login.id) sessions++
    return {
      id: login.id,
      provider: login.provider,
      alias: login.alias,
      usedByPlainCli: login.usedByPlainCli,
      routing: login.routing,
      fiveHourLimit: login.fiveHourLimit,
      weeklyLimit: login.weeklyLimit,
      useFirst: login.useFirst,
      signedIn: null,
      usage: state.usage.get(login.id) ?? null,
      cooldownUntil: cooldown === undefined ? null : Number.isFinite(cooldown) ? cooldown : 'unknown',
      block: null,
      sessions,
      // A Codex login's email is known only to a running daemon, from its last usage probe.
      email: claude?.email ?? null,
      organizationUuid: claude?.organizationUuid ?? null,
      probing: false
    }
  })
  const credentials = await checkCredentials(config.logins, context.env, home, deps)
  return {
    daemon: daemon === null ? null : daemonOf(daemon),
    source: 'files',
    logins,
    credentials,
    globalRouting,
    version: deps.version
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
