// `kurmis status [--json]`: every login with its settings and usage, whether the daemon runs, and
// whether global routing is on. It never starts the daemon, and exits 0 whether or not one runs.
// When the daemon runs, the logins come from its status answer. When none runs, or its status
// request fails, or this kurmis cannot read its answer, they come from `config.json`, with the
// usage the daemon last wrote to `state.json` and whether each login's credentials are on this
// machine (`hasCredentials`).
//
// Status writes nothing in the data folder: it reads `config.json` with `readConfig`, which never
// writes the file. While the file has no entry for the login plain claude or plain codex uses,
// that login is shown without an id (`noIdYet`).
import { homedir } from 'node:os'
import { CONTROL_API_VERSION, type StatusAnswer } from '../../core/control-api.ts'
import { ConfigError, newLoginSettings, readConfig, type KurmisConfig, type LoginSettings } from '../../data/config.ts'
import { readClaudeIdentity } from '../../data/identity.ts'
import { LOGIN_PROVIDERS, type LoginId, type LoginProvider } from '../../data/login-id.ts'
import { loadState } from '../../data/state.ts'
import type { findProgram } from '../../platform/programs.ts'
import { runProgram } from '../../platform/run.ts'
import { kurmisVersion } from '../../version.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, realFindProgram, settleWithin, type DaemonClient } from '../command-deps.ts'
import type { DaemonConnection } from '../daemon-client.ts'
import { globalRoutingState, type GlobalRoutingState } from '../global-routing.ts'
import { hasCredentials } from '../local-credentials.ts'
import { daemonReport, formatStatus, noIdYetStandIn, statusJson, type ReportLogin, type StatusReport } from '../status-format.ts'

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
  /** Find and run `codex login status` for a Codex login that keeps its sign-in in the keyring. */
  findProgram: typeof findProgram
  runProgram: typeof runProgram
  globalRouting: (env: NodeJS.ProcessEnv) => GlobalRoutingState
  /** This kurmis' version, which tells whether the running daemon is older. */
  version: string
}

const USAGE = `Usage: kurmis status [--json]

Shows every login with its settings and its five-hour and weekly usage, whether the daemon
is running, and whether global routing ("kurmis setup") is on, paused or off, with the command
that changes it. It never starts the daemon.

Each login is shown by its alias, with its provider, its id (when the alias is not the id)
and the account's email when kurmis knows it. The login plain claude uses and the login plain
codex uses are marked: they are the accounts a plain "claude" and a plain "codex" are signed
in to. When two Claude logins are the same account, a warning says so, because both then use
one subscription. The same goes for Codex.

While the daemon runs, the status comes from it: whether each login is signed in, its usage,
how many sessions it serves, why routing would pass it over now, and which login
"kurmis codex" would start on. When no usage has been read yet, it waits up to 15 seconds for
the daemon's first usage probe.

While the daemon is not running, the logins come from config.json, and the usage is the last
the daemon read, with how long ago it read it. Kurmis cannot tell then whether a login is
signed in; it shows whether the login's credentials are on this machine, from its files and,
for a Codex login that keeps its sign-in in the system's keyring, from "codex login status".
Codex logins show no email then, so the warning about one subscription covers Claude logins
only. "kurmis claude", "kurmis codex" without --login, "kurmis setup" and
"kurmis daemon start" each start the daemon.

When the daemon runs an older kurmis than this one, the status still comes from it, and the
next command that starts the daemon replaces it. When the daemon does not answer the status
request, or this kurmis cannot read its answer, the logins come from config.json as above,
with a note on stderr.

Status changes no file. While config.json has no entry for the login plain claude or plain
codex uses (before the first other kurmis command, or after an uninstall), that login is shown
without an id. It exits 0 whether or not the daemon runs.

Options:
  --json       Print the same as JSON. "daemon" is null while the daemon is not running, and
               "source" says whether the logins come from the daemon or from the files. Each
               login has "alias", "id", "provider", "usedByPlainCli" (whether plain claude
               or plain codex uses it), "signedIn" (from the daemon) and "credentials"
               (from the files); "id" and "alias" are null for a login without an id yet.
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
    const files = await reportFromFiles(null, globalRouting, context, deps)
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
      const files = await reportFromFiles(null, globalRouting, context, deps)
      if (files === null) return EXIT_FAILURE
      report = files
    } else if (status.apiVersion !== CONTROL_API_VERSION) {
      const files = await reportFromFiles(status, globalRouting, context, deps)
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
 * `config.json` cannot be read. Writes nothing.
 */
async function reportFromFiles(daemon: StatusAnswer | null, globalRouting: GlobalRoutingState, context: CliContext,
  deps: StatusDeps): Promise<StatusReport | null> {
  let config: KurmisConfig
  try {
    config = readConfig()
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    writeLine(context.stderr, `kurmis status: ${error.message}`)
    return null
  }
  const now = deps.now()
  const state = loadState(now).state
  const home = deps.home()
  const shown = withPlainCliLogins(config)
  const logins: ReportLogin[] = shown.map(({ login, noIdYet }) => {
    const cooldown = noIdYet ? undefined : state.cooldowns.get(login.id)
    let sessions = 0
    if (!noIdYet) for (const placement of state.sessions.values()) if (placement.login === login.id) sessions++
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
      usage: noIdYet ? null : state.usage.get(login.id) ?? null,
      cooldownUntil: cooldown === undefined ? null : Number.isFinite(cooldown) ? cooldown : 'unknown',
      block: null,
      sessions,
      // A Codex login's email is known only to a running daemon, from its last usage probe.
      email: login.provider === 'claude' ? readClaudeIdentity(login, home)?.email ?? null : null,
      probing: false,
      ...(noIdYet ? { noIdYet: true } : {})
    }
  })
  // The `codex login status` runs, if any, run at the same time.
  const checks = await Promise.all(shown.map(async ({ login }) =>
    [login.id, await hasCredentials(login, context.env, home, deps)] as const))
  return {
    daemon: daemon === null ? null : { version: daemon.version, pid: daemon.pid, port: daemon.port, startedAt: daemon.startedAt },
    source: 'files',
    logins,
    credentials: new Map(checks),
    globalRouting,
    version: deps.version
  }
}

/**
 * The logins to show from `config`: the logins of plain claude and plain codex first, each one
 * that the file has no entry for as a login with default settings and a stand-in id
 * (`noIdYet`), then the extra logins.
 */
function withPlainCliLogins(config: KurmisConfig): { login: LoginSettings; noIdYet: boolean }[] {
  const own = LOGIN_PROVIDERS.map((provider: LoginProvider) => {
    const found = config.logins.find((login) => login.usedByPlainCli && login.provider === provider)
    if (found !== undefined) return { login: found, noIdYet: false }
    return { login: newLoginSettings({ id: noIdYetStandIn(provider) as LoginId, provider, usedByPlainCli: true }), noIdYet: true }
  })
  return [...own, ...config.logins.filter((login) => !login.usedByPlainCli).map((login) => ({ login, noIdYet: false }))]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
