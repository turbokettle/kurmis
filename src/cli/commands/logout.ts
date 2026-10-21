// `kurmis logout <id>`: removes an extra login. In this order:
//
// 1. The login is removed from config.json (under the config lock) and a running daemon is told,
//    so it stops routing to the login and probing it before its folder goes.
// 2. `claude auth logout` or `codex logout` runs on the login, so the CLI removes what it keeps
//    outside the folder (on macOS the Keychain item). A logout CLI that fails or is missing is
//    reported and the removal goes on: the person asked for the login to be gone, and the
//    credentials file, where there is one, goes with the folder anyway. On macOS the message
//    names the Keychain item that may be left.
// 3. The login's folder is deleted without following links out of it (`removeTreeSync`): a
//    Codex home links into `~/.codex`, and only the links are removed.
//
// A login that is no longer in config.json but still has a folder (a removal that stopped
// half-way) is cleaned up the same way.
import { lstatSync } from 'node:fs'
import { keychainService } from '../../core/keychain-service.ts'
import { changeConfig, ConfigError, findLogin, loadConfig, removeLogin } from '../../data/config.ts'
import { applyEnvPatch, claudeLoginEnv, codexLoginEnv } from '../../data/login-env.ts'
import { isDefaultLoginId, parseLoginId } from '../../data/login-id.ts'
import { loginFolder } from '../../data/paths.ts'
import { ProgramNotFoundError, type findProgram } from '../../platform/programs.ts'
import { removeTreeSync } from '../../platform/remove-tree.ts'
import { runProgram } from '../../platform/run.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, realFindProgram, reloadIfRunning, reloadText, type DaemonClient } from '../command-deps.ts'

export interface LogoutDeps {
  daemon: DaemonClient
  findProgram: typeof findProgram
  runProgram: typeof runProgram
  platform: NodeJS.Platform
}

/** How long `claude auth logout` or `codex logout` may take. Both only remove local files and items, and Claude revokes its token. */
export const LOGOUT_TIMEOUT_MS = 30_000

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function fail(context: CliContext, message: string): number {
  writeLine(context.stderr, `kurmis logout: ${message}`)
  return EXIT_FAILURE
}

export function createLogoutCommand(deps: Partial<LogoutDeps> = {}): Command {
  const daemon = deps.daemon ?? realDaemonClient
  const find = deps.findProgram ?? realFindProgram
  const run = deps.runProgram ?? runProgram
  const platform = deps.platform ?? process.platform

  /** Runs the provider's logout on the login. Answers a sentence about what went wrong, or null. */
  async function signOut(id: string, provider: 'claude' | 'codex', folder: string, env: NodeJS.ProcessEnv): Promise<string | null> {
    const cliName = provider === 'claude' ? 'claude auth logout' : 'codex logout'
    let problem: string
    try {
      const program = find(provider, { env })
      const patch = provider === 'claude' ? claudeLoginEnv(id) : codexLoginEnv(id, env)
      const cliArgs = provider === 'claude' ? ['auth', 'logout'] : ['logout']
      const result = await run(program.command, [...program.args, ...cliArgs], { timeoutMs: LOGOUT_TIMEOUT_MS, env: applyEnvPatch(env, patch) })
      if (result.code === 0) return null
      problem = result.error ?? `exit code ${String(result.code)}`
    } catch (error) {
      if (!(error instanceof ProgramNotFoundError)) throw error
      problem = error.message
    }
    const left = provider === 'claude' && platform === 'darwin'
      ? ` Its Keychain item "${keychainService(folder)}" may be left; Keychain Access can delete it.`
      : ''
    return `"${cliName}" did not finish (${problem}); the login is removed anyway.${left}`
  }

  return {
    name: 'logout',
    summary: 'Remove a login and its credentials',
    usage: `Usage: kurmis logout <id>

Signs out the login <id> (claude:<name> or codex:<name>) with "claude auth logout" or
"codex logout", removes it from kurmis and deletes its folder in the kurmis data folder.
A running daemon stops using it at once. The machine's own logins, claude:default and
codex:default, cannot be removed.

Options:
  -h, --help   Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs('logout', args, {}, context, true)
      if (typeof parsed === 'number') return parsed
      if (parsed.positionals.length !== 1) return usageError('logout', 'takes one login id', context)
      const text = parsed.positionals[0]!
      const login = parseLoginId(text)
      if (login === null) return usageError('logout', `"${text}" is not a login id (claude:<name> or codex:<name>)`, context)
      const { id, provider } = login
      if (isDefaultLoginId(id)) {
        const cli = provider === 'claude' ? 'claude auth logout' : 'codex logout'
        return usageError('logout', `${id} is the machine's own login and cannot be removed. To sign it out, run "${cli}" yourself.`, context)
      }

      const folder = loginFolder(id)
      let listed: boolean
      try {
        listed = findLogin(loadConfig(), id) !== undefined
        if (listed) changeConfig((config) => removeLogin(config, id))
      } catch (error) {
        if (error instanceof ConfigError) return fail(context, error.message)
        throw error
      }
      const hasFolder = exists(folder)
      if (!listed && !hasFolder) return fail(context, `there is no login ${id}; "kurmis list" shows them`)
      const reload = listed ? reloadText(await reloadIfRunning(daemon, context.env)) : null

      // Claude on macOS keeps the secret in the Keychain, so its logout runs even when the folder is gone.
      if (hasFolder || provider === 'claude') {
        const problem = await signOut(id, provider, folder, context.env)
        if (problem !== null) writeLine(context.stderr, `kurmis logout: ${problem}`)
      }
      try {
        removeTreeSync(folder)
      } catch (error) {
        return fail(context, `${listed ? `${id} is removed from kurmis, but ` : ''}its folder ${folder} could not be deleted ` +
          `(${error instanceof Error ? error.message : String(error)}). Close what uses it and run "kurmis logout ${id}" again.`)
      }
      writeLine(context.stdout, listed ? `Removed ${id}.` : `Deleted the folder that ${id} left behind.`)
      if (reload !== null) writeLine(context.stdout, reload)
      return EXIT_OK
    }
  }
}

export const logoutCommand = createLogoutCommand()
