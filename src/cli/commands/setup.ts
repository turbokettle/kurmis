// `kurmis setup [--undo]`: global mode. Setup puts kurmis' routing variables in the `env` of the
// user's Claude Code settings file (`global-settings.ts`), registers the daemon to start at
// login, and starts the daemon. Undo takes the variables out and removes the autostart entry.
//
// Undo leaves the daemon running: `kurmis claude` still uses it, and every Claude Code session
// that was started while global mode was on keeps sending its requests to it until it ends.
//
// The settings change is made first and stands on its own. When autostart or the daemon then
// fails, the command says so and exits with 1; running it again is safe, since every step does
// nothing when it is already done.
import { ConfigError, loadConfig } from '../../data/config.ts'
import { readOrCreateKey } from '../../data/daemon-file.ts'
import {
  registerAutostart,
  unregisterAutostart,
  type AutostartOptions,
  type AutostartResult
} from '../../platform/autostart.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, type DaemonClient } from '../command-deps.ts'
import {
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

- puts kurmis' address and key in the "env" block of your Claude Code settings file,
  ~/.claude/settings.json (or settings.json in CLAUDE_CONFIG_DIR when that is set), so a plain
  "claude" and the IDE extensions use your kurmis logins too. Nothing else in the file changes,
  and the file is copied to settings.json.kurmis-backup before kurmis first changes it;
- makes the kurmis daemon start when you log in;
- starts the daemon now.

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

async function daemonStep(port: number, deps: SetupDeps, context: CliContext): Promise<boolean> {
  try {
    const connection = await deps.daemon.ensureDaemon({ env: context.env })
    writeLine(context.stdout, `The daemon is running on port ${String(connection.port)}.`)
    if (connection.port !== port) {
      writeLine(context.stderr,
        `The daemon runs on port ${String(connection.port)}, but config.json and the settings file name port ${String(port)}. ` +
          'Stop it with "kurmis daemon stop" and run "kurmis setup" again, so it starts on that port.')
      return false
    }
    return true
  } catch (error) {
    writeLine(context.stderr, `The daemon could not be started: ${errorText(error)}`)
    writeLine(context.stderr, 'Claude Code cannot reach kurmis until it runs; try "kurmis daemon start".')
    return false
  }
}

async function daemonRuns(deps: SetupDeps, context: CliContext): Promise<boolean> {
  try {
    return (await deps.daemon.findDaemon({ env: context.env })) !== null
  } catch {
    return false
  }
}

async function runSetup(undo: boolean, deps: SetupDeps, context: CliContext): Promise<number> {
  let path: string
  let port: number | null
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

  let result: SettingsFileResult
  try {
    result = undo ? undoSettingsFile(path, { port }) : setupSettingsFile(path, { port: port!, key: readOrCreateKey() })
  } catch (error) {
    if (!(error instanceof SettingsFileError)) throw error
    writeLine(context.stderr, `kurmis setup: ${error.message}`)
    return EXIT_FAILURE
  }
  reportFile(result, undo, context)

  let ok = await autostartStep(undo, deps, context)
  if (undo) {
    if (await daemonRuns(deps, context)) {
      writeLine(context.stdout, 'The daemon keeps running for "kurmis claude" and for sessions already open; "kurmis daemon stop" stops it.')
    }
  } else {
    ok = (await daemonStep(port!, deps, context)) && ok
    if (result.changed) writeLine(context.stdout, 'Claude Code sessions that are already open keep their old settings; start them again.')
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
