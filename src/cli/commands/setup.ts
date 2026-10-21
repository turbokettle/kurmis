// `kurmis setup [--pause | --uninstall-and-logout [--yes]]`: global routing.
//
// - `kurmis setup` turns global routing on. It starts the daemon, puts kurmis' routing variables
//   in the `env` of the user's Claude Code settings file (`global-settings.ts`), registers the
//   daemon to start at login and deletes `paused.json` (`global-routing.ts`).
// - `--pause` takes kurmis' variables out of the settings file and writes `paused.json`. The
//   daemon, its start at login, the logins and the settings backup stay. A later `kurmis setup`
//   puts the variables back. It finds a file without kurmis' settings, so it replaces the backup
//   with the file as it is then.
// - `--uninstall-and-logout` removes everything kurmis set up (`runUninstall` below).
//
// Every Claude Code session that was started while global routing was on keeps the settings it
// read at its start, and so keeps sending its requests to the daemon until it ends.
//
// The daemon comes first: once `settings.json` names it, every Claude Code on the machine sends
// its requests there, so the file is written only when a daemon answers on the port it names.
// The file is checked before the daemon is started, so a file setup would refuse starts nothing.
// When the daemon cannot be started, nothing is written. When autostart then fails, the command
// says so and exits with 1; running it again is safe, since every step does nothing when it is
// already done. An autostart entry that loads only at the next login (macOS with nobody at the
// screen), a machine where no entry can be written (Windows without Windows Script Host), an
// entry that starts a Node in a temporary folder and a platform without autostart are warnings:
// the daemon runs, and the entry or the next kurmis command starts it again after a restart.
//
// Setup refuses to run while `CLAUDE_CONFIG_DIR` names `~/.claude` itself on macOS and Windows,
// or names another folder whose `settings.json` is a link to `~/.claude/settings.json`
// (`defaultFolderRefusal`).
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { ConfigError, extraLogins, findLogin, loadConfig, type KurmisConfig } from '../../data/config.ts'
import { readOrCreateKey } from '../../data/daemon-file.ts'
import { configDirHasOwnCredentials, namesDefaultClaudeFolder, sharesDefaultSettingsFile } from '../../data/login-env.ts'
import { isLoginId, LOGIN_PROVIDERS, type LoginRef } from '../../data/login-id.ts'
import { kurmisHome, providerFolder } from '../../data/paths.ts'
import { removeDataFolder, type DataFolderRemoval } from '../../data/remove-data-folder.ts'
import {
  registerAutostart,
  unregisterAutostart,
  type AutostartOptions,
  type AutostartResult
} from '../../platform/autostart.ts'
import { autostartPlistPath } from '../../platform/launchd.ts'
import { RUN_ENTRY_DESCRIPTION } from '../../platform/windows-autostart.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, type DaemonClient } from '../command-deps.ts'
import { DaemonError, stopDaemon, type DaemonClientOptions } from '../daemon-client.ts'
import { clearPaused, isPaused, markPaused } from '../global-routing.ts'
import {
  backupPathFor,
  checkSetupSettingsFile,
  claudeSettingsPath,
  setupSettingsFile,
  SettingsFileError,
  undoSettingsFile,
  undoSetupInText,
  type EnvChange,
  type SettingsFileResult
} from '../global-settings.ts'
import { createLoginLogout, type LoginLogout } from './logout.ts'

export interface SetupDeps {
  daemon: DaemonClient
  registerAutostart(options: AutostartOptions): Promise<AutostartResult>
  unregisterAutostart(options: AutostartOptions): Promise<AutostartResult>
  /** `stopDaemon` in `daemon-client.ts`: false when no daemon was running. */
  stopDaemon(options: DaemonClientOptions): Promise<boolean>
  /** Removes one login the way `kurmis logout` does. */
  logOutLogin: LoginLogout
  /** Whether standard input is a terminal, where `--uninstall-and-logout` can ask. */
  stdinIsTerminal(): boolean
  /** Asks a question at the terminal. Answers null when there is no answer (Ctrl-C, end of input). */
  ask(question: string, context: CliContext): Promise<string | null>
  platform: NodeJS.Platform
}

/** The command `--uninstall-and-logout` tells the person to run as the last step. */
const NPM_UNINSTALL = 'npm uninstall -g kurmis'

const USAGE = `Usage: kurmis setup [--pause | --uninstall-and-logout [--yes]]

Turns global routing on: every Claude Code on this machine goes through kurmis, not only the
ones started with "kurmis claude". Setup:

- starts the daemon now, and goes no further when it cannot;
- puts kurmis' address and key in the "env" block of your Claude Code settings file,
  ~/.claude/settings.json (or settings.json in CLAUDE_CONFIG_DIR when that is set), so a plain
  "claude" and the IDE extensions use your kurmis logins too. Nothing else in the file changes,
  and the file is copied to settings.json.kurmis-backup before kurmis adds its settings.
  Because the file then holds kurmis' key, on macOS and Linux setup makes it and the copy
  readable only by you;
- makes the kurmis daemon start when you log in (macOS and Windows).

Claude Code sessions that are already open keep the settings they started with; start them
again.

Options:
  --pause                 Take kurmis' settings out of the settings file, so a plain "claude"
                          no longer goes through kurmis. A setting you changed yourself is left
                          as it is. The daemon, its start at login, your logins and the backup
                          copy stay. "kurmis setup" turns global routing on again.
  --uninstall-and-logout  Remove everything kurmis set up: its settings and the backup copy,
                          the daemon's start at login, every login you added to kurmis (each is
                          signed out first, which removes its Keychain or Credential Manager
                          item), the daemon and the kurmis data folder. Your own Claude Code
                          and Codex sign-ins are not signed out, so a plain "claude" and
                          "codex" keep working. It lists what it removes and asks first. The
                          last step, "${NPM_UNINSTALL}", is yours to run.
  --yes                   With --uninstall-and-logout: do not ask. Without a terminal to ask
                          at, --uninstall-and-logout needs it.
  -h, --help              Show this help.`

/** One line about one variable, in plain words. Never shows the key. */
function changeLine(change: EnvChange, undo: boolean): string | null {
  const note = change.note === undefined ? '' : ` (${change.note})`
  switch (change.action) {
    case 'added': return `Added ${change.name}${note}.`
    case 'updated': return undo ? `Changed ${change.name}${note}.` : `Updated ${change.name} to kurmis' current value${note}.`
    case 'removed': return `Removed ${change.name}${note}.`
    case 'unchanged': return null
    case 'kept': return `Left ${change.name} as it is: ${change.note ?? 'it is not kurmis\' value'}.`
  }
}

function reportFile(result: SettingsFileResult, undo: boolean, context: CliContext): void {
  writeLine(context.stdout, `Claude Code settings: ${result.path}`)
  if (result.backupWritten !== null) writeLine(context.stdout, `Saved a copy of the file as it was to ${result.backupWritten}.`)
  if (!undo && !result.existed) writeLine(context.stdout, 'Created the file, readable only by you.')
  if (result.modeBefore !== null) {
    writeLine(context.stdout, `Made the file readable only by you, because it holds kurmis' key (its mode was ${modeText(result.modeBefore)}).`)
  }
  if (result.backupModeBefore !== null) {
    writeLine(context.stdout, `Made ${backupPathFor(result.path)} readable only by you (its mode was ${modeText(result.backupModeBefore)}).`)
  }
  if (result.envCreated) writeLine(context.stdout, 'Added an "env" block.')
  for (const change of result.changes) {
    const line = changeLine(change, undo)
    if (line !== null) writeLine(context.stdout, line)
  }
  if (result.envRemoved) writeLine(context.stdout, 'Removed the "env" block, which had nothing else in it.')
  if (!result.changed) {
    writeLine(context.stdout, undo
      ? 'The file has none of kurmis\' settings; nothing to take out.'
      : 'The file already has kurmis\' settings; nothing to change.')
  }
  for (const warning of result.warnings) writeLine(context.stderr, `Warning: ${warning}`)
  if (!undo && result.linkTarget !== null) {
    writeLine(context.stderr, `Warning: ${result.path} is a symbolic link, so kurmis' key is written to the file it points to, ${result.linkTarget}.`)
  }
}

/** A file mode in octal, as `chmod` takes it: `0644`. */
function modeText(mode: number): string {
  return `0${(mode & 0o777).toString(8).padStart(3, '0')}`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function autostartStep(
  remove: boolean,
  deps: SetupDeps,
  context: CliContext
): Promise<boolean> {
  let result: AutostartResult
  try {
    const options = { env: context.env, platform: deps.platform }
    result = remove ? await deps.unregisterAutostart(options) : await deps.registerAutostart(options)
  } catch (error) {
    result = { changed: false, where: null, warning: errorText(error) }
  }
  const supported = deps.platform === 'darwin' || deps.platform === 'win32'
  const warnsOnly = result.warningOnly === true || result.loadsAtNextLogin === true ||
    result.noEntryPossible === true || !supported
  if (!remove && result.warning !== undefined && warnsOnly) {
    // The daemon runs now, and the entry, or the next kurmis command, starts it after a restart.
    writeLine(context.stderr, `Warning: ${result.warning}`)
    return true
  }
  if (result.warning !== undefined) {
    writeLine(context.stderr, remove
      ? `Could not remove the daemon's start at login: ${result.warning}`
      : `Could not make the daemon start at login: ${result.warning}`)
    return false
  }
  const where = result.where === null ? '' : ` (${result.where})`
  if (remove) {
    if (!supported) return true
    writeLine(context.stdout, result.changed
      ? `Removed the daemon's start at login${where}.`
      : 'The daemon was not set to start at login.')
  } else {
    writeLine(context.stdout, result.changed
      ? `The daemon now starts at login${where}.`
      : `The daemon already starts at login${where}.`)
  }
  return true
}

/**
 * Starts the daemon. Answers its key when it runs on `port`, or null after saying what went wrong.
 * `hadKurmis` says whether the settings file holds kurmis' settings from an earlier setup.
 */
async function daemonStep(port: number, path: string, hadKurmis: boolean, deps: SetupDeps,
  context: CliContext): Promise<string | null> {
  const unchanged = hadKurmis
    ? `${path} was not changed. It still holds kurmis' settings from an earlier setup, so Claude Code that reads it ` +
      'reaches kurmis only while a daemon runs on the port they name. Run "kurmis setup" again once the daemon runs, ' +
      'or "kurmis setup --pause" to take them out.'
    : `${path} was not changed, so Claude Code does not use kurmis yet. Run "kurmis setup" again once the daemon runs.`
  try {
    const connection = await deps.daemon.ensureDaemon({ env: context.env })
    if (connection.port !== port) {
      writeLine(context.stderr,
        `The daemon runs on port ${String(connection.port)}, but config.json names port ${String(port)}. ` +
          'Stop it with "kurmis daemon stop" and run "kurmis setup" again, so it starts on that port.')
      writeLine(context.stderr, unchanged)
      return null
    }
    writeLine(context.stdout, `The daemon is running on port ${String(connection.port)}.`)
    return connection.key
  } catch (error) {
    writeLine(context.stderr, `The daemon could not be started: ${errorText(error)}`)
    writeLine(context.stderr, `${unchanged} "kurmis daemon start" starts it and says what is wrong.`)
    return null
  }
}

/** The pid of the running daemon, or null when none answers. */
async function runningDaemonPid(deps: SetupDeps, context: CliContext): Promise<number | null> {
  try {
    return (await deps.daemon.findDaemon({ env: context.env }))?.pid ?? null
  } catch {
    return null
  }
}

/**
 * Why setup refuses to run with this `CLAUDE_CONFIG_DIR`, or null. A value that names
 * `~/.claude` itself makes the CLI keep credentials apart from the default ones on macOS and
 * Windows (`configDirHasOwnCredentials`), while `~/.claude/settings.json` is the file every
 * plain `claude` reads. Setup cannot write one file that is right for both, so it asks for the
 * variable to be unset. The same holds, on every platform, for another folder whose
 * `settings.json` is a link to `~/.claude/settings.json`.
 */
function defaultFolderRefusal(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const value = env['CLAUDE_CONFIG_DIR']
  const home = homedir()
  if (value === undefined || !configDirHasOwnCredentials(env, platform)) return null
  const folder = join(home, '.claude')
  const defaultFile = join(folder, 'settings.json')
  if (namesDefaultClaudeFolder(value, platform, home)) {
    return `CLAUDE_CONFIG_DIR is set to ${value}, which is the default Claude Code folder ${folder}. A claude started ` +
      'with CLAUDE_CONFIG_DIR set keeps its credentials apart from one started without it, even when the variable names ' +
      `that folder, and both read ${defaultFile}, so kurmis cannot write settings there ` +
      'that are right for both. Unset CLAUDE_CONFIG_DIR and run "kurmis setup" again.'
  }
  if (sharesDefaultSettingsFile(value, platform, home)) {
    return `CLAUDE_CONFIG_DIR is set to ${value}, and ${join(value, 'settings.json')} is a link to the default Claude Code ` +
      `settings file ${defaultFile}. A claude started with CLAUDE_CONFIG_DIR set signs in with the credentials in ` +
      `${value}, a plain claude with those in ${folder}, and both read that one file, so kurmis cannot write settings ` +
      'there that are right for both. Unset CLAUDE_CONFIG_DIR and run "kurmis setup" again, or give that folder a ' +
      'settings.json of its own.'
  }
  return null
}

/** The settings file setup edits, or null after saying why it cannot be named. */
function settingsPathOrFail(context: CliContext): string | null {
  try {
    return claudeSettingsPath(context.env)
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error
    writeLine(context.stderr, `kurmis setup: ${error.message}`)
    return null
  }
}

/** The port in `config.json`, or null when the file cannot be read: undo then knows kurmis' address by its key header. */
function portOrNull(): number | null {
  try {
    return loadConfig().port
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    return null
  }
}

async function runSetup(deps: SetupDeps, context: CliContext): Promise<number> {
  const refusal = defaultFolderRefusal(context.env, deps.platform)
  if (refusal !== null) {
    writeLine(context.stderr, `kurmis setup: ${refusal}`)
    return EXIT_FAILURE
  }
  const path = settingsPathOrFail(context)
  if (path === null) return EXIT_FAILURE
  let port: number
  try {
    port = loadConfig().port
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    writeLine(context.stderr, `kurmis setup: ${error.message}`)
    return EXIT_FAILURE
  }

  let hadKurmis: boolean
  try {
    hadKurmis = checkSetupSettingsFile(path, { port, key: readOrCreateKey() })
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error
    writeLine(context.stderr, `kurmis setup: ${error.message}`)
    return EXIT_FAILURE
  }
  const key = await daemonStep(port, path, hadKurmis, deps, context)
  if (key === null) return EXIT_FAILURE

  let result: SettingsFileResult
  try {
    result = setupSettingsFile(path, { port, key, credentialsOfItsOwn: configDirHasOwnCredentials(context.env, deps.platform) })
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error
    writeLine(context.stderr, `kurmis setup: ${error.message}`)
    return EXIT_FAILURE
  }
  reportFile(result, false, context)
  if (clearPaused()) writeLine(context.stdout, 'Global routing was paused; it is on again.')
  if (configDirHasOwnCredentials(context.env, deps.platform)) {
    writeLine(context.stdout, 'CLAUDE_CONFIG_DIR is set, so a plain claude that reads this file signs in with the login in that ' +
      'folder, which is not the machine\'s own Claude login. Kurmis sends its requests only to the extra logins and never ' +
      'signs them as the machine\'s own Claude login. "kurmis claude" still starts on the machine\'s own Claude login.')
  }

  const ok = await autostartStep(false, deps, context)
  if (result.changed) {
    writeLine(context.stdout, 'Claude Code sessions that are already open keep the settings they started with; start them again.')
  }
  if (!ok) {
    writeLine(context.stderr, 'The settings file change above was made; run "kurmis setup" again to finish.')
    return EXIT_FAILURE
  }
  return EXIT_OK
}

async function runPause(deps: SetupDeps, context: CliContext): Promise<number> {
  const path = settingsPathOrFail(context)
  if (path === null) return EXIT_FAILURE
  let result: SettingsFileResult
  try {
    result = undoSettingsFile(path, { port: portOrNull() })
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error
    writeLine(context.stderr, `kurmis setup: ${error.message}`)
    return EXIT_FAILURE
  }
  const wasPaused = isPaused()
  if (!result.changed && !wasPaused) {
    reportFile(result, true, context)
    writeLine(context.stdout, 'Global routing is not on, so there is nothing to pause. "kurmis setup" turns it on.')
    return EXIT_OK
  }
  reportFile(result, true, context)
  if (!wasPaused) markPaused()
  writeLine(context.stdout, wasPaused && !result.changed
    ? 'Global routing is already paused.'
    : 'Paused global routing: a plain claude and the IDE extensions no longer go through kurmis.')
  writeLine(context.stdout, 'The daemon, its start at login, your logins and the settings backup stay. "kurmis setup" turns ' +
    'global routing on again.')
  if (result.changed) {
    writeLine(context.stdout, 'Claude Code sessions that are already open keep the settings they started with, and so keep ' +
      'using kurmis until they end; start them again.')
  }
  if (await runningDaemonPid(deps, context) !== null) {
    writeLine(context.stdout, '"kurmis claude" still uses the daemon; "kurmis daemon stop" stops it.')
  }
  return EXIT_OK
}

// ---------------------------------------------------------------------------------------------
// `--uninstall-and-logout`.
//
// The steps, in order:
//
// 1. Kurmis' settings come out of the settings file, and the backup copy is deleted. When the
//    file cannot be changed, nothing else is removed: the daemon has to keep running for the
//    Claude Code that the file still sends to it.
// 2. The daemon's start at login is removed.
// 3. The daemon is stopped, so it uses no login and probes none while they are signed out.
// 4. Each login kurmis added is removed through `kurmis logout`'s code (`createLoginLogout`).
//    The logins are the extra ones in config.json and every login folder in the data folder,
//    so a run that stopped half-way finds the rest.
// 5. The data folder is deleted (`removeDataFolder`).
//
// A failed step is reported and the steps after it still run, except that the data folder is
// kept when the daemon could not be stopped or a login could not be removed. That folder holds
// what a second run needs to finish (a login's folder names its Keychain item). The command
// then exits 1 and says to run it again.

/** A login `--uninstall-and-logout` removes, and how its list names it. */
interface AddedLogin {
  login: LoginRef
  name: string
}

/**
 * The logins kurmis added: the extra ones in config.json, and every folder under `claude/` and
 * `codex/` that is named by an id, which a removal or a sign-in that stopped half-way leaves.
 * The logins of plain claude and plain codex are never among them.
 */
function loginsKurmisAdded(config: KurmisConfig): AddedLogin[] {
  const added = extraLogins(config).map((login): AddedLogin => ({
    login: { id: login.id, provider: login.provider, machineOwn: false },
    name: login.alias
  }))
  for (const provider of LOGIN_PROVIDERS) {
    let names: string[]
    try {
      names = readdirSync(providerFolder(provider))
    } catch {
      continue
    }
    for (const name of names) {
      if (!isLoginId(name) || findLogin(config, name)?.machineOwn === true) continue
      if (added.some(({ login }) => login.id === name && login.provider === provider)) continue
      added.push({ login: { id: name, provider, machineOwn: false }, name })
    }
  }
  return added
}

/** Where the daemon's start at login is, for the list of what is removed; null where there is none. */
function autostartEntry(platform: NodeJS.Platform): string | null {
  if (platform === 'darwin') return existsSync(autostartPlistPath()) ? autostartPlistPath() : null
  if (platform === 'win32') return `${RUN_ENTRY_DESCRIPTION}, if it is set`
  return null
}

/** Whether taking kurmis' settings out would change the file. Throws a `SettingsFileError` for a file it cannot change. */
function settingsHaveKurmis(path: string, port: number): boolean {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  let backupText: string | null
  try {
    backupText = readFileSync(backupPathFor(path), 'utf8')
  } catch {
    backupText = null
  }
  try {
    return undoSetupInText(text, { port, backupText }).changed
  } catch (error) {
    if (error instanceof SettingsFileError) throw new SettingsFileError(`${path} cannot be changed: ${error.message}`)
    throw error
  }
}

function listLine(context: CliContext, text: string): void {
  writeLine(context.stdout, `  - ${text}`)
}

async function runUninstall(yes: boolean, deps: SetupDeps, context: CliContext): Promise<number> {
  const path = settingsPathOrFail(context)
  if (path === null) return EXIT_FAILURE
  let config: KurmisConfig
  let inSettings: boolean
  try {
    config = loadConfig()
    inSettings = settingsHaveKurmis(path, config.port)
  } catch (error) {
    if (!(error instanceof ConfigError) && !(error instanceof SettingsFileError)) throw error
    writeLine(context.stderr, `kurmis setup: ${error.message} Nothing was removed.`)
    return EXIT_FAILURE
  }
  const logins = loginsKurmisAdded(config)
  const backup = backupPathFor(path)
  const hasBackup = existsSync(backup)
  const autostart = autostartEntry(deps.platform)
  const pid = await runningDaemonPid(deps, context)
  const dataFolder = kurmisHome()

  writeLine(context.stdout, 'This removes what kurmis set up on this machine:')
  if (inSettings) listLine(context, `kurmis' settings in ${path}`)
  if (hasBackup) listLine(context, `${backup}, the copy of that file kurmis made`)
  if (autostart !== null) listLine(context, `the daemon's start at login (${autostart})`)
  listLine(context, logins.length === 0 ? 'no logins: none was added to kurmis'
    : `the logins added to kurmis, each signed out first: ${logins.map(({ name }) => name).join(', ')}`)
  if (pid !== null) listLine(context, `the running daemon (pid ${String(pid)}), which is stopped`)
  if (existsSync(dataFolder)) listLine(context, `the kurmis data folder ${dataFolder}`)
  writeLine(context.stdout, 'Your own Claude Code and Codex sign-ins are not signed out, so a plain "claude" and "codex" keep working.')

  if (!yes) {
    if (!deps.stdinIsTerminal()) {
      writeLine(context.stderr, 'kurmis setup: --uninstall-and-logout asks before it removes anything, and there is no terminal ' +
        'to ask at. Run it again with --yes to remove all of the above. Nothing was removed.')
      return EXIT_FAILURE
    }
    const answer = await deps.ask('Remove all of this? [y/N] ', context)
    if (answer === null || !/^\s*y(es)?\s*$/i.test(answer)) {
      writeLine(context.stdout, 'Nothing was removed.')
      return EXIT_FAILURE
    }
  }

  // 1. The settings file. Nothing else goes when it cannot be changed.
  let result: SettingsFileResult
  try {
    result = undoSettingsFile(path, { port: config.port })
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error
    writeLine(context.stderr, `kurmis setup: ${error.message}`)
    writeLine(context.stderr, 'Nothing else was removed, since Claude Code that reads the file still uses the daemon.')
    return EXIT_FAILURE
  }
  reportFile(result, true, context)
  let failed = false
  try {
    if (existsSync(backup)) {
      rmSync(backup, { force: true })
      writeLine(context.stdout, `Deleted ${backup}.`)
    }
  } catch (error) {
    writeLine(context.stderr, `Could not delete ${backup}: ${errorText(error)}`)
    failed = true
  }

  // 2. The start at login.
  if (!(await autostartStep(true, deps, context))) failed = true

  // 3. The daemon.
  let keepData = false
  try {
    writeLine(context.stdout, await deps.stopDaemon({ env: context.env })
      ? `Stopped the daemon${pid === null ? '' : ` (pid ${String(pid)})`}.`
      : 'The daemon was not running.')
  } catch (error) {
    if (!(error instanceof DaemonError)) throw error
    writeLine(context.stderr, `Could not stop the daemon: ${error.message}`)
    failed = true
    keepData = true
  }

  // 4. The logins.
  const notRemoved: string[] = []
  for (const { login, name } of logins) {
    const code = await deps.logOutLogin(login, context, { keepFolderWhenSignOutFails: true, again: 'kurmis setup --uninstall-and-logout' })
    if (code !== EXIT_OK) notRemoved.push(name)
  }
  if (notRemoved.length > 0) {
    writeLine(context.stderr, `Could not remove ${notRemoved.join(', ')}; see above.`)
    failed = true
    keepData = true
  }

  // 5. The data folder.
  if (keepData) {
    writeLine(context.stderr, `Kept the kurmis data folder ${dataFolder}, which a second run needs to finish.`)
  } else {
    let removal: DataFolderRemoval | null = null
    try {
      removal = removeDataFolder(deps.platform)
    } catch (error) {
      writeLine(context.stderr, `Could not delete the kurmis data folder ${dataFolder}: ${errorText(error)}`)
      failed = true
    }
    if (removal !== null && removal.removed) writeLine(context.stdout, `Deleted the kurmis data folder ${dataFolder}.`)
    if (removal !== null && !removal.removed) {
      writeLine(context.stdout, `Deleted kurmis' files in ${dataFolder}. The folder is left, because it also holds files ` +
        `kurmis did not write: ${removal.left.join(', ')}.`)
    }
  }

  if (result.changed) {
    writeLine(context.stdout, 'Claude Code sessions that are already open keep the settings they started with and can no ' +
      'longer reach kurmis; start them again.')
  }
  if (failed) {
    writeLine(context.stderr, 'Fix what is named above and run "kurmis setup --uninstall-and-logout" again to finish.')
    return EXIT_FAILURE
  }
  writeLine(context.stdout, `Last step: remove the kurmis program with "${NPM_UNINSTALL}".`)
  return EXIT_OK
}

/** Asks at the terminal on standard input and output. Ctrl-C and the end of the input answer null. */
async function askAtTerminal(question: string): Promise<string | null> {
  const lines = createInterface({ input: process.stdin, output: process.stdout })
  const controller = new AbortController()
  lines.on('SIGINT', () => controller.abort())
  lines.on('close', () => controller.abort())
  try {
    return await lines.question(question, { signal: controller.signal })
  } catch {
    return null
  } finally {
    lines.close()
  }
}

export function createSetupCommand(deps: Partial<SetupDeps> = {}): Command {
  const daemon = deps.daemon ?? realDaemonClient
  const platform = deps.platform ?? process.platform
  const full: SetupDeps = {
    daemon,
    registerAutostart: deps.registerAutostart ?? registerAutostart,
    unregisterAutostart: deps.unregisterAutostart ?? unregisterAutostart,
    stopDaemon: deps.stopDaemon ?? stopDaemon,
    logOutLogin: deps.logOutLogin ?? createLoginLogout({ daemon, platform }),
    stdinIsTerminal: deps.stdinIsTerminal ?? (() => process.stdin.isTTY === true),
    ask: deps.ask ?? askAtTerminal,
    platform
  }
  return {
    name: 'setup',
    summary: 'Turn global routing on, pause it, or remove everything kurmis set up',
    usage: USAGE,
    async run(args, context) {
      const parsed = parseCommandArgs('setup', args, {
        pause: { type: 'boolean' },
        'uninstall-and-logout': { type: 'boolean' },
        yes: { type: 'boolean' }
      }, context)
      if (typeof parsed === 'number') return parsed
      const pause = parsed.values.pause === true
      const uninstall = parsed.values['uninstall-and-logout'] === true
      const yes = parsed.values.yes === true
      if (pause && uninstall) return usageError('setup', '--pause and --uninstall-and-logout cannot be used together', context)
      if (yes && !uninstall) return usageError('setup', '--yes goes with --uninstall-and-logout', context)
      if (uninstall) return runUninstall(yes, full, context)
      return pause ? runPause(full, context) : runSetup(full, context)
    }
  }
}

export const setupCommand: Command = createSetupCommand()
