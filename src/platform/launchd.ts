// launchd on macOS: the plist of the login item `kurmis setup` registers (`autostart.ts`), and
// the `launchctl` calls that load, unload and look at it in the user's GUI domain (`gui/<uid>`).
//
// The GUI domain exists only while the user is logged in at the screen (or through Screen
// Sharing). A process launchd starts there belongs to that login session and can read the login
// Keychain, which a process started from an ssh login cannot.
//
// `KURMIS_LAUNCHCTL_PROGRAM` (a test hook) names a stand-in for `/bin/launchctl`; tests use
// `test/platform/fake-launchctl/launchctl.mjs`.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
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

/** What a login item runs after `<node> <bundle>`. */
export const DAEMON_START_ARGS: readonly string[] = ['daemon', 'start']

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
 * The variables a login item carries besides HOME and PATH, when they are set: the data
 * folder, and the test hooks that point kurmis at other programs. Nothing else, so no token
 * (`ANTHROPIC_*`), no ssh session (`SSH_*`) and no Claude setting (`CLAUDE_*`) reaches a plist
 * or the Windows logon script.
 */
export const DAEMON_JOB_VARIABLES: readonly string[] = [
  'KURMIS_HOME',
  'KURMIS_CLAUDE_BIN',
  'KURMIS_UPSTREAM_URL',
  'KURMIS_SECURITY_PROGRAM',
  'KURMIS_ENTRY',
  ...Object.values(SYSTEM_PROGRAM_VARIABLES).filter((name) => name !== 'KURMIS_SECURITY_PROGRAM'),
  GUARD_VARIABLE,
  REFUSAL_LOG_VARIABLE
]

/** The PATH the login item gets when the caller has none: Homebrew's folders and the system's. */
const FALLBACK_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'

/**
 * The environment of the login item. launchd starts a job with almost no
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
 * The plist of the login item: run the program once when it is loaded, never again by itself
 * (no `KeepAlive`), leave the processes it started alone when it exits (`AbandonProcessGroup`),
 * and throw its output away. The daemon writes its own log, so nothing goes to a file here.
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
}

/**
 * Reads `launchctl print <domain>/<label>`. A job launchd does not have is answered with a
 * non-zero exit (113, "Could not find service"). Otherwise the job's own properties are the
 * lines indented by one tab, such as `path = …`; lines indented deeper belong to its
 * sub-dictionaries.
 */
export function parseLaunchctlPrint(result: RunResult): JobState {
  if (result.code !== 0) return { loaded: false, path: null }
  const path = /^\tpath = (.*)$/m.exec(result.stdout)
  return { loaded: true, path: path === null ? null : (path[1] ?? '').trim() }
}

/** What launchd says about one job in a user's GUI domain. */
export async function jobState(label: string, launchctl: Launchctl = launchctlFor(), uid?: number): Promise<JobState> {
  return parseLaunchctlPrint(await launchctl(['print', `${guiDomain(uid)}/${label}`]))
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
