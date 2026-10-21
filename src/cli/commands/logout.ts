// `kurmis logout <login>`: removes an extra login, named by its alias or id (`resolveLogin`). In
// this order:
//
// 1. The login is removed from config.json (under the config lock) and a running daemon is told,
//    so it stops routing to the login and probing it before its folder goes.
// 2. `claude auth logout` or `codex logout` runs on the login (`signOutLogin` in `sign-out.ts`),
//    so the CLI removes what it keeps outside the folder (on macOS the Keychain item, on Windows
//    the Credential Manager record). A logout CLI that fails or is missing is reported and the
//    removal goes on: the person asked for the login to be gone, and the credentials file, where
//    there is one, goes with the folder anyway. On macOS and Windows the message names the item
//    that may be left.
// 3. The login's folder is deleted without following links out of it (`removeTreeSync`): a
//    Codex home links into `~/.codex`, and only the links are removed. For a Codex login the
//    record of what was last merged into its home (`codexMergedRecordPath`) goes too.
//
// A bare id that names no login in config.json but has a folder, `claude/<id>/` or `codex/<id>/`
// (a removal or a sign-in that stopped half-way), is cleaned up the same way. A Codex id of which
// only the merged record is left has the record deleted.
//
// The whole removal holds the login's lock (`login-lock.ts`), so it never runs while a
// `kurmis login` of the same login writes into the folder.
import { lstatSync, rmSync } from 'node:fs'
import { changeConfig, ConfigError, findLogin, loadConfig, removeLogin, resolveLogin, type KurmisConfig } from '../../data/config.ts'
import { isLoginId, isLoginProvider, LOGIN_PROVIDERS, type LoginId, type LoginProvider, type LoginRef } from '../../data/login-id.ts'
import { codexMergedRecordPath, loginFolder } from '../../data/paths.ts'
import { type findProgram } from '../../platform/programs.ts'
import { removeTreeSync } from '../../platform/remove-tree.ts'
import { runProgram } from '../../platform/run.ts'
import { EXIT_FAILURE, EXIT_OK, parseCommandArgs, usageError, writeLine, type CliContext, type Command } from '../command.ts'
import { realDaemonClient, realFindProgram, reloadIfRunning, reloadText, type DaemonClient } from '../command-deps.ts'
import { LoginBusyError, lockLogin } from '../login-lock.ts'
import { machineOwnText } from '../login-names.ts'
import { leftBehindText, signOutLogin } from '../sign-out.ts'

export { LOGOUT_TIMEOUT_MS } from '../sign-out.ts'

export interface LogoutDeps {
  daemon: DaemonClient
  findProgram: typeof findProgram
  runProgram: typeof runProgram
  platform: NodeJS.Platform
}

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

/** What `kurmis logout` was asked to remove. */
type LogoutTarget =
  /** A login in config.json. */
  | { kind: 'listed'; login: LoginRef; name: string }
  /** The folders an id left that is in config.json no more. */
  | { kind: 'left-behind'; id: LoginId; providers: LoginProvider[]; recordOnly: boolean }
  | { kind: 'error'; message: string; usage: boolean }

/**
 * The login `text` names, or, for a bare id (or `claude:<id>`, `codex:<id>`) that names no login,
 * the folders it left behind.
 */
function logoutTarget(config: KurmisConfig, text: string): LogoutTarget {
  const resolved = resolveLogin(config, text)
  if ('login' in resolved) {
    const login = resolved.login
    if (login.machineOwn) {
      const cli = login.provider === 'claude' ? 'claude auth logout' : 'codex logout'
      return {
        kind: 'error',
        usage: true,
        message: `${login.alias} is ${machineOwnText(login.provider)} and cannot be removed. To sign it out, run "${cli}" yourself.`
      }
    }
    return { kind: 'listed', login, name: login.alias }
  }
  const colon = text.indexOf(':')
  const prefix = colon < 0 ? null : text.slice(0, colon)
  const id = colon < 0 ? text : text.slice(colon + 1)
  const providers = prefix === null ? LOGIN_PROVIDERS : isLoginProvider(prefix) ? [prefix] : []
  if (isLoginId(id) && findLogin(config, id) === undefined) {
    const withFolder = providers.filter((provider) => exists(loginFolder({ id, provider, machineOwn: false })))
    if (withFolder.length > 0) return { kind: 'left-behind', id, providers: withFolder, recordOnly: false }
    if (providers.includes('codex') && exists(codexMergedRecordPath({ id, provider: 'codex', machineOwn: false }))) {
      return { kind: 'left-behind', id, providers: ['codex'], recordOnly: true }
    }
  }
  return { kind: 'error', usage: false, message: `${resolved.error}; "kurmis list" shows the logins` }
}

export function createLogoutCommand(deps: Partial<LogoutDeps> = {}): Command {
  const daemon = deps.daemon ?? realDaemonClient
  const signOutDeps = {
    findProgram: deps.findProgram ?? realFindProgram,
    runProgram: deps.runProgram ?? runProgram,
    platform: deps.platform ?? process.platform
  }

  return {
    name: 'logout',
    summary: 'Remove a login and its credentials',
    usage: `Usage: kurmis logout <login>

Signs a login out with "claude auth logout" or "codex logout", removes it from kurmis and
deletes its folder in the kurmis data folder. A running daemon stops using it at once.

<login> is the login's alias or its id, as "kurmis list" shows them. When a Claude login and a
Codex login have the same alias, put claude: or codex: in front, for example
codex:work-example.

The machine's own Claude and Codex logins cannot be removed. To sign them out, run
"claude auth logout" or "codex logout" yourself.

An id that is in no list any more but still has a folder in the kurmis data folder, for
example after a removal that stopped half-way, has that folder deleted.

Options:
  -h, --help   Show this help.`,
    async run(args, context) {
      const parsed = parseCommandArgs('logout', args, {}, context, true)
      if (typeof parsed === 'number') return parsed
      if (parsed.positionals.length !== 1) return usageError('logout', 'takes one login, by its alias or id', context)

      let target: LogoutTarget
      try {
        target = logoutTarget(loadConfig(), parsed.positionals[0]!)
      } catch (error) {
        if (error instanceof ConfigError) return fail(context, error.message)
        throw error
      }
      if (target.kind === 'error') return target.usage ? usageError('logout', target.message, context) : fail(context, target.message)

      const id = target.kind === 'listed' ? target.login.id : target.id
      let lock
      try {
        lock = lockLogin(id, target.kind === 'listed' ? target.name : id)
      } catch (error) {
        if (error instanceof LoginBusyError) return fail(context, error.message)
        throw error
      }
      try {
        return target.kind === 'listed' ? await removeListed(target, context) : await removeLeftBehind(target, context)
      } finally {
        lock.release()
      }
    }
  }

  /** Signs `login` out and deletes its folder. Answers the problem with the folder, or null. */
  async function removeFolders(login: LoginRef, name: string, context: CliContext, alwaysSignOut: boolean): Promise<string | null> {
    const folder = loginFolder(login)
    // Claude on macOS keeps the secret in the Keychain, so its logout runs even when the
    // folder is gone.
    if (alwaysSignOut || exists(folder)) {
      const problem = await signOutLogin(login, context.env, signOutDeps)
      if (problem !== null) {
        writeLine(context.stderr, `kurmis logout: ${problem}; ${name} is removed anyway.${leftBehindText(login, signOutDeps.platform)}`)
      }
    }
    try {
      removeTreeSync(folder)
      if (login.provider === 'codex') rmSync(codexMergedRecordPath(login), { force: true })
      return null
    } catch (error) {
      return `its folder ${folder} could not be deleted (${error instanceof Error ? error.message : String(error)})`
    }
  }

  async function removeListed(target: Extract<LogoutTarget, { kind: 'listed' }>, context: CliContext): Promise<number> {
    const { login, name } = target
    try {
      // Read again under the login's lock: another run may have removed it in the meantime.
      if (findLogin(loadConfig(), login.id) === undefined) return fail(context, `${name} was removed by another kurmis command just now`)
      changeConfig((config) => removeLogin(config, login.id))
    } catch (error) {
      if (error instanceof ConfigError) return fail(context, error.message)
      throw error
    }
    const reload = reloadText(await reloadIfRunning(daemon, context.env))
    const problem = await removeFolders(login, name, context, login.provider === 'claude')
    if (problem !== null) {
      // The id still names the folder; the alias is gone with the login.
      return fail(context, `${name} is removed from kurmis, but ${problem}. Close what uses it and run "kurmis logout ${login.id}".`)
    }
    writeLine(context.stdout, `Removed ${name} (id ${login.id}).`)
    if (reload !== null) writeLine(context.stdout, reload)
    return EXIT_OK
  }

  async function removeLeftBehind(target: Extract<LogoutTarget, { kind: 'left-behind' }>, context: CliContext): Promise<number> {
    const { id } = target
    if (target.recordOnly) {
      rmSync(codexMergedRecordPath({ id, provider: 'codex', machineOwn: false }), { force: true })
      writeLine(context.stdout, `Deleted the record of what was merged into the Codex home of ${id}, which ${id} left behind.`)
      return EXIT_OK
    }
    for (const provider of target.providers) {
      const problem = await removeFolders({ id, provider, machineOwn: false }, id, context, false)
      if (problem !== null) return fail(context, `${id} left a folder behind, but ${problem}. Close what uses it and run "kurmis logout ${id}" again.`)
    }
    writeLine(context.stdout, `Deleted the folder that ${id} left behind.`)
    return EXIT_OK
  }
}

export const logoutCommand = createLogoutCommand()
