// launchd on macOS: starting the daemon in the user's GUI session, and the plists of the
// launchd jobs kurmis writes.
//
// A process started from an ssh login runs in the ssh session's audit session. It cannot read
// the login Keychain, and neither can any process it starts, so a daemon started that way could
// sign no request with a token from the Keychain. A process launchd starts in the user's GUI
// domain (`gui/<uid>`) belongs to the login session at the screen and can read it. So from ssh
// the CLI starts the daemon through a one-shot launchd job (`startThroughLaunchd`):
//
// 1. It writes a plist in `~/.kurmis/launchd/` whose program is
//    `<node> <kurmis bundle> daemon start --no-launchd`, and loads it with
//    `launchctl bootstrap gui/<uid> <plist>`. `RunAtLoad` makes launchd run it at once.
// 2. That `daemon start`, now in the GUI session, starts the daemon detached (a new session and
//    process group of its own) and exits.
// 3. `AbandonProcessGroup` tells launchd not to end what is left in the job's process group
//    when the job's program exits. The daemon is in a group of its own anyway.
// 4. Once the CLI sees the daemon answer, it unloads the job (`launchctl bootout`) and deletes
//    the plist (`OneShotJob.remove`). Unloading a job ends only its own process group, so the
//    daemon keeps running.
//
// The GUI domain exists only while the user is logged in at the screen (or through Screen
// Sharing). With nobody logged in there, `bootstrap` fails and the CLI says so.
//
// The login item `kurmis setup` registers (`autostart.ts`) is a plist of the same shape in
// `~/Library/LaunchAgents/`, which launchd loads at every login.
//
// `KURMIS_LAUNCHCTL_PROGRAM` (a test hook) names a stand-in for `/bin/launchctl`; tests use
// `test/platform/fake-launchctl/launchctl.mjs`.
import { randomBytes } from 'node:crypto'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchdJobFolder } from '../data/paths.ts'
import { writeFileAtomic } from '../data/json-file.ts'
import { PRIVATE_FILE_MODE } from './files.ts'
import { GUARD_VARIABLE, REFUSAL_LOG_VARIABLE } from './system-program-guard.ts'
import { runProgram, type RunResult } from './run.ts'
import { inheritedTestHooks, realSystemProgram, SYSTEM_PROGRAM_VARIABLES, systemProgram } from './system-programs.ts'

export const LAUNCHCTL_PROGRAM = realSystemProgram('launchctl')

/** The test hook naming a stand-in for `launchctl`. */
export const LAUNCHCTL_VARIABLE = SYSTEM_PROGRAM_VARIABLES.launchctl

/** How long one `launchctl` call may take. A `bootout` waits for the job's process to exit. */
export const LAUNCHCTL_TIMEOUT_MS = 30_000

/** The label of the login item `kurmis setup` registers. */
export const AUTOSTART_LABEL = 'kurmis.daemon'

/**
 * The label of a one-shot start job, before a random suffix of its own: two CLIs can start a
 * daemon at the same time, and each loads its own job.
 */
export const ONE_SHOT_LABEL_PREFIX = 'kurmis.start'

/** The program a launchd job of kurmis runs after `<node> <bundle>`. */
export const DAEMON_START_ARGS: readonly string[] = ['daemon', 'start', '--no-launchd']

/**
 * `KURMIS_LAUNCHCTL_PROGRAM` from `env`, else from `processEnv` (this process's environment),
 * else `/bin/launchctl` (`systemProgram`).
 */
export function launchctlProgram(env: NodeJS.ProcessEnv = process.env, processEnv: NodeJS.ProcessEnv = process.env): string {
  return systemProgram('launchctl', env, processEnv)
}

/** Runs `launchctl` with these arguments and answers what happened. Never rejects. */
export type Launchctl = (args: readonly string[]) => Promise<RunResult>

/** A `Launchctl` that runs `launchctlProgram(env)` through `runProgram`, with no shell. */
export function launchctlFor(env: NodeJS.ProcessEnv = process.env): Launchctl {
  const program = launchctlProgram(env)
  return (args) => runProgram(program, args, { timeoutMs: LAUNCHCTL_TIMEOUT_MS, env })
}

function currentUid(): number {
  return typeof process.getuid === 'function' ? process.getuid() : 0
}

/** The GUI domain of a user: `gui/<uid>`, by default this process's user. */
export function guiDomain(uid: number = currentUid()): string {
  return `gui/${String(uid)}`
}

/** The folder of the user's LaunchAgents. `os.homedir()` follows HOME, so tests stay in their temp home. */
export function launchAgentsDir(): string {
  return join(homedir(), 'Library', 'LaunchAgents')
}

/** The plist of the login item `kurmis setup` registers. */
export function autostartPlistPath(): string {
  return join(launchAgentsDir(), `${AUTOSTART_LABEL}.plist`)
}

// ---------------------------------------------------------------------------------------------
// Plists

export type PlistValue = string | boolean | readonly string[] | Readonly<Record<string, string | boolean>>

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * An XML plist of one top-level dictionary, which is all a job needs. Values are strings,
 * booleans, arrays of strings, or dictionaries of strings and booleans.
 */
export function plistXml(root: Readonly<Record<string, PlistValue>>): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>'
  ]
  const string = (value: string): string => `<string>${escapeXml(value)}</string>`
  const scalar = (value: string | boolean): string => typeof value === 'boolean' ? (value ? '<true/>' : '<false/>') : string(value)
  for (const [key, value] of Object.entries(root)) {
    lines.push(`  <key>${escapeXml(key)}</key>`)
    if (typeof value === 'string' || typeof value === 'boolean') lines.push(`  ${scalar(value)}`)
    else if (Array.isArray(value)) lines.push('  <array>', ...(value as readonly string[]).map((item) => `    ${string(item)}`), '  </array>')
    else {
      lines.push('  <dict>')
      for (const [name, item] of Object.entries(value as Readonly<Record<string, string | boolean>>)) {
        lines.push(`    <key>${escapeXml(name)}</key>`, `    ${scalar(item)}`)
      }
      lines.push('  </dict>')
    }
  }
  lines.push('</dict>', '</plist>', '')
  return lines.join('\n')
}

/**
 * The variables a daemon job carries besides HOME and PATH, when they are set: the data
 * folder, and the test hooks that point kurmis at other programs. Nothing else, so no token
 * (`ANTHROPIC_*`), no ssh session (`SSH_*`) and no Claude setting (`CLAUDE_*`) reaches a plist.
 */
export const DAEMON_JOB_VARIABLES: readonly string[] = [
  'KURMIS_HOME',
  'KURMIS_CLAUDE_BIN',
  'KURMIS_CODEX_BIN',
  'KURMIS_UPSTREAM_URL',
  'KURMIS_SECURITY_PROGRAM',
  'KURMIS_ENTRY',
  ...Object.values(SYSTEM_PROGRAM_VARIABLES).filter((name) => name !== 'KURMIS_SECURITY_PROGRAM'),
  GUARD_VARIABLE,
  REFUSAL_LOG_VARIABLE
]

/** The PATH a job gets when the caller has none: Homebrew's folders and the system's. */
const FALLBACK_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

/**
 * The environment a launchd job of kurmis is given. launchd starts a job with almost no
 * environment, so the plist carries HOME, the caller's PATH (so the daemon finds `claude` the
 * way the caller does), `KURMIS_HOME` resolved to an absolute path, and the variables of
 * `DAEMON_JOB_VARIABLES` that are set. The stand-ins of a test are taken from `processEnv` when
 * `env` lacks them (`inheritedTestHooks`).
 */
export function daemonJobEnvironment(env: NodeJS.ProcessEnv = process.env, processEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {
    HOME: env.HOME !== undefined && env.HOME !== '' ? env.HOME : homedir(),
    PATH: env.PATH !== undefined && env.PATH !== '' ? env.PATH : FALLBACK_PATH
  }
  const hooks = inheritedTestHooks(env, processEnv)
  for (const name of DAEMON_JOB_VARIABLES) {
    const value = env[name] || hooks[name]
    if (value === undefined || value === '') continue
    out[name] = name === 'KURMIS_HOME' ? resolve(value) : value
  }
  return out
}

export interface DaemonJobPlist {
  label: string
  programArguments: readonly string[]
  environment: Readonly<Record<string, string>>
}

/**
 * The plist of a kurmis job: run the program once when it is loaded, never again by itself
 * (no `KeepAlive`), leave the processes it started alone when it exits, and throw its output
 * away. The daemon writes its own log, which holds no free text, so nothing goes to a file here.
 */
export function daemonJobPlist(job: DaemonJobPlist): string {
  return plistXml({
    Label: job.label,
    ProgramArguments: job.programArguments,
    EnvironmentVariables: job.environment,
    WorkingDirectory: job.environment.HOME ?? homedir(),
    RunAtLoad: true,
    AbandonProcessGroup: true,
    StandardOutPath: '/dev/null',
    StandardErrorPath: '/dev/null'
  })
}

// ---------------------------------------------------------------------------------------------
// launchctl answers

/** What `launchctl print <domain>/<label>` says about one job. */
export interface JobState {
  /** Whether launchd has the job loaded. */
  loaded: boolean
  /** The plist the job was loaded from, when launchctl names it. */
  path: string | null
  /** The pid of the job's running process, or null when it runs none. */
  pid: number | null
  /**
   * The exit code of the job's last run, or null when it has not exited yet ("(never exited)")
   * or launchctl does not say. launchd itself answers 78 (EX_CONFIG) when it could not start
   * the program, for example one on a volume the job may not read.
   */
  lastExitCode: number | null
}

/**
 * Reads `launchctl print <domain>/<label>`. A job launchd does not have is answered with a
 * non-zero exit (113, "Could not find service"). Otherwise the job's own properties are the
 * lines indented by one tab, such as `path = …`, `state = running`, `pid = 501` and
 * `last exit code = 78: EX_CONFIG`; lines indented deeper belong to its sub-dictionaries.
 */
export function parseLaunchctlPrint(result: RunResult): JobState {
  if (result.code !== 0) return { loaded: false, path: null, pid: null, lastExitCode: null }
  const top = new Map<string, string>()
  for (const match of result.stdout.matchAll(/^\t([^\t=][^=\n]*?) = (.*)$/gm)) {
    const key = match[1] ?? ''
    if (!top.has(key)) top.set(key, (match[2] ?? '').trim())
  }
  const pid = Number(top.get('pid'))
  const exit = /^-?\d+/.exec(top.get('last exit code') ?? '')
  return {
    loaded: true,
    path: top.get('path') ?? null,
    pid: top.get('state') === 'running' && Number.isSafeInteger(pid) && pid > 0 ? pid : null,
    lastExitCode: exit === null ? null : Number(exit[0])
  }
}

/** What launchd says about one job in a user's GUI domain. */
export async function jobState(label: string, launchctl: Launchctl = launchctlFor(), uid?: number): Promise<JobState> {
  return parseLaunchctlPrint(await launchctl(['print', `${guiDomain(uid)}/${label}`]))
}

/** Whether launchd has the job loaded in a user's GUI domain. */
export async function jobLoaded(label: string, launchctl: Launchctl = launchctlFor(), uid?: number): Promise<boolean> {
  return (await jobState(label, launchctl, uid)).loaded
}

/** What launchctl printed, in one line, or why it did not run. */
function launchctlSaid(result: RunResult): string {
  if (result.error !== null) return result.error
  const said = `${result.stderr}\n${result.stdout}`.replace(/\s+/g, ' ').trim()
  return said === '' ? `exit ${String(result.code)}` : `exit ${String(result.code)}: ${said}`
}

/**
 * Whether a failed `bootout` means the job was not loaded: launchctl answers 3 ("No such
 * process") or 113 ("Could not find specified service") for that.
 */
export function isNotLoaded(result: RunResult): boolean {
  if (result.code === 3 || result.code === 113) return true
  return /no such process|could not find (specified )?service/i.test(`${result.stderr}\n${result.stdout}`)
}

/**
 * Whether a failed `bootstrap` means the GUI domain is missing, which is what launchctl answers
 * when nobody is logged in at the screen: 125 ("Domain does not support specified action") or
 * 112 ("Could not find domain").
 */
export function isMissingGuiDomain(result: RunResult): boolean {
  if (result.code === 125 || result.code === 112) return true
  return /domain does not support specified action|could not find domain/i.test(`${result.stderr}\n${result.stdout}`)
}

/** A sentence saying why `launchctl bootstrap` did not load a job. */
export function bootstrapFailure(result: RunResult, domain: string): string {
  const said = launchctlSaid(result)
  if (result.error === null && isMissingGuiDomain(result)) {
    return `launchd could not load the job into ${domain} (${said}). This usually means nobody is logged in at this ` +
      "Mac's screen: the GUI session, the only one that can read the login Keychain, exists only while you are " +
      'logged in there or through Screen Sharing.'
  }
  return `launchd could not load the job into ${domain} (${said}).`
}

/** Loads a plist into a user's GUI domain. Throws an Error saying what launchctl answered. */
export async function bootstrapJob(plistPath: string, launchctl: Launchctl = launchctlFor(), uid?: number): Promise<void> {
  const domain = guiDomain(uid)
  const result = await launchctl(['bootstrap', domain, plistPath])
  if (result.code !== 0 || result.error !== null) throw new Error(bootstrapFailure(result, domain))
}

/**
 * Unloads a job from a user's GUI domain. Answers whether it was loaded. Throws when launchctl
 * failed for another reason than the job not being loaded.
 */
export async function bootoutJob(label: string, launchctl: Launchctl = launchctlFor(), uid?: number): Promise<boolean> {
  const target = `${guiDomain(uid)}/${label}`
  const result = await launchctl(['bootout', target])
  if (result.code === 0 && result.error === null) return true
  if (result.error === null && isNotLoaded(result)) return false
  throw new Error(`launchd could not unload ${target} (${launchctlSaid(result)}).`)
}

// ---------------------------------------------------------------------------------------------
// One-shot start

/** A one-shot launchd job that is loaded. */
export interface OneShotJob {
  label: string
  plistPath: string
  /** What launchd says about the job now: whether its program runs, and how its last run ended. */
  state(): Promise<JobState>
  /** Unloads the job, ignoring a failure, and deletes its plist. Safe to call more than once. */
  remove(): Promise<void>
}

export interface LaunchdStart {
  /** The program and its arguments, normally `<node> <bundle> daemon start --no-launchd`. */
  programArguments: readonly string[]
  /** The caller's environment, which `daemonJobEnvironment` takes the job's from. */
  env: NodeJS.ProcessEnv
  launchctl?: Launchctl
  /** Where the plist is written. `launchdJobFolder()` by default. */
  folder?: string
  uid?: number
  /** The clock, for the age of plists that earlier starts left behind. */
  now?: () => number
}

/** A one-shot plist older than this was left behind by a CLI that did not finish its start. */
export const STALE_ONE_SHOT_MS = 10 * 60_000

/**
 * Unloads and deletes one-shot jobs that a CLI left behind (it was killed between loading its
 * job and removing it). Only plists older than `STALE_ONE_SHOT_MS` are touched, so another
 * CLI's start that is still going on is left alone. Failures are ignored.
 */
export async function removeStaleOneShotJobs(folder: string, launchctl: Launchctl, now: number, uid?: number): Promise<void> {
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith(`${ONE_SHOT_LABEL_PREFIX}.`) || !name.endsWith('.plist')) continue
    const file = join(folder, name)
    try {
      if (now - statSync(file).mtimeMs < STALE_ONE_SHOT_MS) continue
    } catch {
      continue
    }
    await launchctl(['bootout', `${guiDomain(uid)}/${name.slice(0, -'.plist'.length)}`])
    rmSync(file, { force: true })
  }
}

/** A new one-shot label: the prefix and eight random hex digits. */
export function oneShotLabel(): string {
  return `${ONE_SHOT_LABEL_PREFIX}.${randomBytes(4).toString('hex')}`
}

/**
 * Writes a one-shot job for `programArguments` (mode 0600) and loads it into the user's GUI
 * domain, where launchd runs it at once. Answers the loaded job; call `remove()` once its
 * program has done its work. When launchd refuses the job, the plist is deleted and the Error
 * says what launchctl answered.
 */
export async function startThroughLaunchd(start: LaunchdStart): Promise<OneShotJob> {
  const launchctl = start.launchctl ?? launchctlFor(start.env)
  const folder = start.folder ?? launchdJobFolder()
  await removeStaleOneShotJobs(folder, launchctl, (start.now ?? Date.now)(), start.uid)
  const label = oneShotLabel()
  const plistPath = join(folder, `${label}.plist`)
  await writeFileAtomic(plistPath, daemonJobPlist({
    label,
    programArguments: start.programArguments,
    environment: daemonJobEnvironment(start.env)
  }), { mode: PRIVATE_FILE_MODE })
  try {
    await bootstrapJob(plistPath, launchctl, start.uid)
  } catch (error) {
    rmSync(plistPath, { force: true })
    throw error
  }
  let removed = false
  return {
    label,
    plistPath,
    state: () => jobState(label, launchctl, start.uid),
    async remove() {
      if (removed) return
      removed = true
      await launchctl(['bootout', `${guiDomain(start.uid)}/${label}`])
      rmSync(plistPath, { force: true })
    }
  }
}
