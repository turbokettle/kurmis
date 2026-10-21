// `kurmis setup [--undo]`: global mode. Setup starts the daemon, puts kurmis' routing variables
// in the `env` of the user's Claude Code settings file (`global-settings.ts`), and registers the
// daemon to start at login. Undo takes the variables out and removes the autostart entry.
//
// Undo leaves the daemon running: `kurmis claude` still uses it, and every Claude Code session
// that was started while global mode was on keeps sending its requests to it until it ends.
//
// The daemon comes first: once `settings.json` names it, every Claude Code on the machine sends
// its requests there, so the file is written only when a daemon answers on the port it names.
// The file is checked before the daemon is started, so a file setup would refuse starts nothing.
// When the daemon cannot be started, nothing is written. When autostart then fails, the command
// says so and exits with 1; running it again is safe, since every step does nothing when it is
// already done. An autostart entry that loads only at the next login (macOS with nobody at the
// screen), a machine where no entry can be written (Windows without Windows Script Host) and a
// platform without autostart are warnings: the daemon runs, and the next kurmis command starts
// it again after a restart.
//
// Setup refuses to run while `CLAUDE_CONFIG_DIR` names `~/.claude` itself on macOS and Windows
// (`defaultFolderRefusal`).
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ConfigError, loadConfig } from '../../data/config.ts'
import { readOrCreateKey } from '../../data/daemon-file.ts'
import { configDirHasOwnCredentials, namesDefaultClaudeFolder } from '../../data/login-env.ts'
import {
  registerAutostart,
  unregisterAutostart,
  type AutostartOptions,
  type AutostartResult
} from '../../platform/autostart.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, type DaemonClient } from '../command-deps.ts'
import {
  backupPathFor,
  checkSetupSettingsFile,
  claudeSettingsPath,
  setupSettingsFile,
  SettingsFileError,
  undoSettingsFile,
  type EnvChange,
  type SettingsFileResult
} from '../global-settings.ts'

export interface SetupDeps {
  daemon: DaemonClient
  registerAutostart(options: AutostartOptions): Promise<AutostartResult>
  unregisterAutostart(options: AutostartOptions): Promise<AutostartResult>
  platform: NodeJS.Platform
}

const USAGE = `Usage: kurmis setup [--undo]

Routes every Claude Code on this machine through kurmis, not only the ones started with
"kurmis claude":

- starts the daemon now, and goes no further when it cannot;
- puts kurmis' address and key in the "env" block of your Claude Code settings file,
  ~/.claude/settings.json (or settings.json in CLAUDE_CONFIG_DIR when that is set), so a plain
  "claude" and the IDE extensions use your kurmis logins too. Nothing else in the file changes,
  and the file is copied to settings.json.kurmis-backup before kurmis adds its settings.
  Because the file then holds kurmis' key, on macOS and Linux setup makes it and the copy
  readable only by you;
- makes the kurmis daemon start when you log in.

Claude Code sessions that are already open keep their settings; start them again.

Options:
  --undo       Take kurmis' settings out of the file again and stop starting the daemon at
               login. A setting you changed yourself is left as it is. The daemon keeps
               running for "kurmis claude"; stop it with "kurmis daemon stop".
  -h, --help   Show this help.`

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
  undo: boolean,
  deps: SetupDeps,
  context: CliContext
): Promise<boolean> {
  let result: AutostartResult
  try {
    const options = { env: context.env, platform: deps.platform }
    result = undo ? await deps.unregisterAutostart(options) : await deps.registerAutostart(options)
  } catch (error) {
    result = { changed: false, where: null, warning: errorText(error) }
  }
  const supported = deps.platform === 'darwin' || deps.platform === 'win32'
  const warnsOnly = result.loadsAtNextLogin === true || result.noEntryPossible === true || !supported
  if (!undo && result.warning !== undefined && warnsOnly) {
    // The daemon runs now, and the entry, or the next kurmis command, starts it after a restart.
    writeLine(context.stderr, `Warning: ${result.warning}`)
    return true
  }
  if (result.warning !== undefined) {
    writeLine(context.stderr, undo
      ? `Could not remove the daemon's start at login: ${result.warning}`
      : `Could not make the daemon start at login: ${result.warning}`)
    return false
  }
  const where = result.where === null ? '' : ` (${result.where})`
  if (undo) {
    writeLine(context.stdout, result.changed
      ? `The daemon no longer starts at login${where}.`
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
      'or "kurmis setup --undo" to take them out.'
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

async function daemonRuns(deps: SetupDeps, context: CliContext): Promise<boolean> {
  try {
    return (await deps.daemon.findDaemon({ env: context.env })) !== null
  } catch {
    return false
  }
}

/**
 * Why setup refuses to run with this `CLAUDE_CONFIG_DIR`, or null. A value that names
 * `~/.claude` itself makes the CLI keep credentials apart from the default ones on macOS and
 * Windows (`configDirHasOwnCredentials`), while `~/.claude/settings.json` is the file every
 * plain `claude` reads. Setup cannot write one file that is right for both, so it asks for the
 * variable to be unset.
 */
function defaultFolderRefusal(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | null {
  const value = env['CLAUDE_CONFIG_DIR']
  const home = homedir()
  if (value === undefined || !configDirHasOwnCredentials(env, platform) || !namesDefaultClaudeFolder(value, platform, home)) {
    return null
  }
  const folder = join(home, '.claude')
  return `CLAUDE_CONFIG_DIR is set to ${value}, which is the default Claude Code folder ${folder}. A claude started ` +
    'with CLAUDE_CONFIG_DIR set keeps its credentials apart from one started without it, even when the variable names ' +
    `that folder, and both read ${join(folder, 'settings.json')}, so kurmis cannot write settings there ` +
    'that are right for both. Unset CLAUDE_CONFIG_DIR and run "kurmis setup" again.'
}

async function runSetup(undo: boolean, deps: SetupDeps, context: CliContext): Promise<number> {
  let path: string
  let port: number | null
  const refusal = undo ? null : defaultFolderRefusal(context.env, deps.platform)
  if (refusal !== null) {
    writeLine(context.stderr, `kurmis setup: ${refusal}`)
    return EXIT_FAILURE
  }
  try {
    path = claudeSettingsPath(context.env)
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error
    writeLine(context.stderr, `kurmis setup: ${error.message}`)
    return EXIT_FAILURE
  }
  try {
    port = loadConfig().port
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    if (!undo) {
      writeLine(context.stderr, `kurmis setup: ${error.message}`)
      return EXIT_FAILURE
    }
    // Undo still recognises kurmis' address by the key header next to it.
    port = null
  }

  let key: string | null = null
  if (!undo) {
    let hadKurmis: boolean
    try {
      hadKurmis = checkSetupSettingsFile(path, { port: port!, key: readOrCreateKey() })
    } catch (error) {
      if (!(error instanceof SettingsFileError)) throw error
      writeLine(context.stderr, `kurmis setup: ${error.message}`)
      return EXIT_FAILURE
    }
    key = await daemonStep(port!, path, hadKurmis, deps, context)
    if (key === null) return EXIT_FAILURE
  }

  let result: SettingsFileResult
  try {
    result = undo ? undoSettingsFile(path, { port })
      : setupSettingsFile(path, { port: port!, key: key!, credentialsOfItsOwn: configDirHasOwnCredentials(context.env, deps.platform) })
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error
    writeLine(context.stderr, `kurmis setup: ${error.message}`)
    return EXIT_FAILURE
  }
  reportFile(result, undo, context)
  if (!undo && configDirHasOwnCredentials(context.env, deps.platform)) {
    writeLine(context.stdout, 'CLAUDE_CONFIG_DIR is set, so a plain claude that reads this file signs in with the login in that ' +
      'folder, which is not kurmis\' claude:default. Kurmis sends its requests only to the extra logins and never signs them ' +
      'as claude:default. "kurmis claude" still starts on claude:default.')
  }

  const ok = await autostartStep(undo, deps, context)
  if (undo) {
    if (await daemonRuns(deps, context)) {
      writeLine(context.stdout, 'The daemon keeps running for "kurmis claude" and for sessions already open; "kurmis daemon stop" stops it.')
    }
  } else if (result.changed) {
    writeLine(context.stdout, 'Claude Code sessions that are already open keep their old settings; start them again.')
  }
  if (!ok) {
    writeLine(context.stderr, undo
      ? 'The settings file change above was made; run "kurmis setup --undo" again to finish.'
      : 'The settings file change above was made; run "kurmis setup" again to finish.')
    return EXIT_FAILURE
  }
  return EXIT_OK
}

export function createSetupCommand(deps: Partial<SetupDeps> = {}): Command {
  const full: SetupDeps = {
    daemon: deps.daemon ?? realDaemonClient,
    registerAutostart: deps.registerAutostart ?? registerAutostart,
    unregisterAutostart: deps.unregisterAutostart ?? unregisterAutostart,
    platform: deps.platform ?? process.platform
  }
  return {
    name: 'setup',
    summary: 'Route every Claude Code on this machine through kurmis',
    usage: USAGE,
    async run(args, context) {
      const parsed = parseCommandArgs('setup', args, { undo: { type: 'boolean' } }, context)
      if (typeof parsed === 'number') return parsed
      return runSetup(parsed.values.undo === true, full, context)
    }
  }
}

export const setupCommand: Command = createSetupCommand()
