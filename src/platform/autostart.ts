// Starting the daemon when the user logs in, for `kurmis setup`: a launchd agent on macOS and a
// per-user logon entry on Windows (`windows-autostart.ts`). Other platforms answer a warning.
//
// Both run `<node> <kurmis bundle> daemon start --no-launchd`, which starts the daemon detached
// and exits, the same way every other start does. So `setup --undo`, which unloads the launchd
// job, does not end a daemon that is running.
//
// - **macOS:** `~/Library/LaunchAgents/kurmis.daemon.plist`, with the shape of the one-shot
//   jobs in `launchd.ts` (RunAtLoad, AbandonProcessGroup, no KeepAlive, output thrown away, the
//   environment from `daemonJobEnvironment`). launchd loads it at every login. Registering also
//   loads it now (`launchctl bootstrap`), which runs it once: a daemon that already runs makes
//   that start a no-op. A plist whose content changed is unloaded and loaded again, since launchd
//   keeps what it read at load time. Unregistering unloads it (`bootout`) and deletes it.
// - Both are idempotent: what is there is compared first, and `changed` says whether anything
//   was written, loaded or removed.
import { readFileSync, rmSync } from 'node:fs'
import { kurmisEntry, nodeForJobs } from './detach.ts'
import {
  AUTOSTART_LABEL,
  DAEMON_START_ARGS,
  autostartPlistPath,
  bootoutJob,
  bootstrapJob,
  daemonJobEnvironment,
  daemonJobPlist,
  jobState,
  launchctlFor,
  type Launchctl
} from './launchd.ts'
import { registerWindowsAutostart, unregisterWindowsAutostart, type Reg } from './windows-autostart.ts'
import { writeFileAtomic } from '../data/json-file.ts'

export interface AutostartOptions {
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  /** The bundle to start. `kurmisEntry({ env })` by default; null answers a warning. */
  entry?: string | null
  /** The Node to start it with. `nodeForJobs({ env, platform })` by default. */
  nodePath?: string
  /** macOS: runs launchctl. `launchctlFor(env)` by default. */
  launchctl?: Launchctl
  /** macOS: the user whose GUI domain the job is loaded into. This process's by default. */
  uid?: number
  /** Windows: runs reg.exe. `regFor(env)` by default. */
  reg?: Reg
  /** Windows: where the logon script is. `windowsAutostartScriptPath()` by default. */
  windowsScriptPath?: string
}

export interface AutostartResult {
  /** Whether anything was changed. */
  changed: boolean
  /** Where the entry is (a file path or a registry value), for the person to see. */
  where: string | null
  /** A sentence when it could not be done; the rest of `setup` goes on. */
  warning?: string
  /**
   * The entry is written and starts the daemon at the next login, but could not be loaded now
   * (macOS with nobody at the screen). `warning` says why. Setup counts this as done.
   */
  loadsAtNextLogin?: boolean
}

const UNSUPPORTED = 'Starting the daemon at login is not supported on this platform; the next kurmis command starts it.'

const NO_ENTRY = 'kurmis is not running from its bundle, so there is no program to start at login; ' +
  'run kurmis setup from the installed kurmis.'

/** The program a login item runs: `<node> <entry> daemon start --no-launchd`, or null without a bundle. */
function loginProgram(options: AutostartOptions, platform: NodeJS.Platform): string[] | null {
  const entry = options.entry === undefined ? kurmisEntry({ env: options.env }) : options.entry
  if (entry === null) return null
  const node = options.nodePath ?? nodeForJobs({ env: options.env, platform })
  return [node, entry, ...DAEMON_START_ARGS]
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Registers the daemon to start at login. Never throws for what the system refused; see `warning`. */
export async function registerAutostart(options: AutostartOptions): Promise<AutostartResult> {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin' && platform !== 'win32') return { changed: false, where: null, warning: UNSUPPORTED }
  const programArguments = loginProgram(options, platform)
  if (programArguments === null) return { changed: false, where: null, warning: NO_ENTRY }
  if (platform === 'win32') {
    return await registerWindowsAutostart({
      env: options.env,
      programArguments,
      ...(options.windowsScriptPath === undefined ? {} : { scriptPath: options.windowsScriptPath }),
      ...(options.reg === undefined ? {} : { reg: options.reg })
    })
  }
  return await registerLaunchAgent(options, programArguments)
}

/** Removes what `registerAutostart` registered. Doing it twice is not an error. */
export async function unregisterAutostart(options: AutostartOptions): Promise<AutostartResult> {
  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    return await unregisterWindowsAutostart({
      env: options.env,
      ...(options.windowsScriptPath === undefined ? {} : { scriptPath: options.windowsScriptPath }),
      ...(options.reg === undefined ? {} : { reg: options.reg })
    })
  }
  if (platform !== 'darwin') return { changed: false, where: null }
  return await unregisterLaunchAgent(options)
}

async function registerLaunchAgent(options: AutostartOptions, programArguments: readonly string[]): Promise<AutostartResult> {
  const launchctl = options.launchctl ?? launchctlFor(options.env)
  const path = autostartPlistPath()
  const plist = daemonJobPlist({ label: AUTOSTART_LABEL, programArguments, environment: daemonJobEnvironment(options.env) })
  const written = readText(path) !== plist
  // 0644, as LaunchAgents usually are: it names programs and folders, not secrets.
  if (written) await writeFileAtomic(path, plist, { mode: 0o644 })
  const state = await jobState(AUTOSTART_LABEL, launchctl, options.uid)
  if (state.loaded && !written && (state.path === null || state.path === path)) return { changed: false, where: path }
  try {
    if (state.loaded) await bootoutJob(AUTOSTART_LABEL, launchctl, options.uid)
    await bootstrapJob(path, launchctl, options.uid)
  } catch (error) {
    return {
      changed: true,
      where: path,
      warning: `The login item is written and starts the daemon at your next login, but it could not be loaded now: ${(error as Error).message}`,
      loadsAtNextLogin: true
    }
  }
  return { changed: true, where: path }
}

async function unregisterLaunchAgent(options: AutostartOptions): Promise<AutostartResult> {
  const launchctl = options.launchctl ?? launchctlFor(options.env)
  const path = autostartPlistPath()
  let changed = false
  let warning: string | undefined
  try {
    changed = await bootoutJob(AUTOSTART_LABEL, launchctl, options.uid)
  } catch (error) {
    warning = `${(error as Error).message} The login item's file is removed, so it does not start the daemon at the next login.`
  }
  if (readText(path) !== null) {
    rmSync(path, { force: true })
    changed = true
  }
  return warning === undefined ? { changed, where: path } : { changed, where: path, warning }
}
